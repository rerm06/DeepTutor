import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const MANAGERS: Role[] = ["owner", "location_manager", "front_desk"];
const NO_LEADS: Role[] = [
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
  "member",
  "guardian",
];

async function staffId(org: OrgFixture, role: Role): Promise<string> {
  const { rows } = await t.admin.query<{ id: string }>(
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
    [org.orgId, org.people[role], role],
  );
  return rows[0]?.id as string;
}

let seq = 0;
const INSERT_LEAD =
  "INSERT INTO app.lead (location_id, source, full_name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id";
/** Create a lead as `role` (through RLS) and return its id. Each call uses a fresh synthetic email. */
async function newLead(
  org: OrgFixture,
  role: Role = "front_desk",
  loc = org.locations[0],
  email: string | null = `lead${++seq}.${Date.now()}@demo.invalid`,
): Promise<string> {
  return asCaller(t.api, t.claims(org, role), async (tx) => {
    const { rows } = await tx.query<{ id: string }>(INSERT_LEAD, [
      loc,
      "web",
      `Demo Prospecto ${seq}`,
      email,
      "+1 787 555 0100",
    ]);
    return rows[0]?.id as string;
  });
}

/** Run one statement as `role`, expecting a refusal with the given SQLSTATE. */
async function refused(
  org: OrgFixture,
  role: Role,
  sql: string,
  params: unknown[],
  code: string,
  claimsOverride?: Parameters<typeof asCaller>[1],
) {
  await asCaller(t.api, claimsOverride ?? t.claims(org, role), async (tx) => {
    await expect(tx.query(sql, params), `${role}: ${sql}`).rejects.toMatchObject({ code });
  });
}

describe("leads: who can see and manage them", () => {
  it.each(MANAGERS.map((r) => [r]))(
    "%s creates a lead at its location and reads it back",
    async (role) => {
      const id = await newLead(t.fx.A, role);
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        const { rows } = await tx.query(
          "SELECT stage, created_by, member_id FROM app.lead WHERE id = $1",
          [id],
        );
        expect(rows[0]).toEqual({ stage: "new", created_by: t.fx.A.people[role], member_id: null });
      });
      const audit = await t.admin.query(
        "SELECT actor_role FROM app.audit_log WHERE action = 'lead.create' AND entity_id = $1",
        [id],
      );
      expect(audit.rows).toEqual([{ actor_role: role }]);
    },
  );

  it.each(NO_LEADS.map((r) => [r]))(
    "%s sees no leads or activities and cannot create one",
    async (role) => {
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.lead")).rowCount).toBe(0);
        expect((await tx.query("SELECT 1 FROM app.lead_activity")).rowCount).toBe(0);
        const upd = await tx.query("UPDATE app.lead SET notes = 'x'");
        expect(upd.rowCount).toBe(0);
      });
      await refused(
        t.fx.A,
        role,
        INSERT_LEAD.replace(" RETURNING id", ""),
        [t.fx.A.locations[0], "web", "X", "x@demo.invalid", null],
        "42501",
      );
    },
  );

  it("scoped managers see only their location; the owner sees the whole org", async () => {
    const { A } = t.fx;
    for (const role of ["location_manager", "front_desk"] as Role[]) {
      await asCaller(t.api, t.claims(A, role), async (tx) => {
        const { rows } = await tx.query("SELECT DISTINCT location_id FROM app.lead");
        expect(rows.map((r) => r.location_id)).toEqual([A.locations[0]]);
        const upd = await tx.query("UPDATE app.lead SET notes = 'x' WHERE location_id = $1", [
          A.locations[1],
        ]);
        expect(upd.rowCount).toBe(0);
      });
      // Without RETURNING, so the INSERT policy itself (not the SELECT policy on RETURNING) must refuse it.
      await refused(
        A,
        role,
        "INSERT INTO app.lead (location_id, source, full_name, email) VALUES ($1, $2, $3, $4)",
        [A.locations[1], "web", "X", "x@demo.invalid"],
        "42501",
      );
    }
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      const { rows } = await tx.query("SELECT DISTINCT location_id FROM app.lead ORDER BY 1");
      expect(rows.map((r) => r.location_id).sort()).toEqual([...A.locations].sort());
    });
  });

  it("the other organisation is invisible and unreachable", async () => {
    const { A, B } = t.fx;
    const bLead = await newLead(B, "owner");
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.lead WHERE id = $1", [bLead])).rowCount).toBe(0);
      expect(
        (await tx.query("UPDATE app.lead SET stage = 'contacted' WHERE id = $1", [bLead])).rowCount,
      ).toBe(0);
      await tx.query("SAVEPOINT s");
      // The composite FK (org_id, location_id) refuses it exactly like a location that does not exist.
      await expect(
        tx.query(INSERT_LEAD, [B.locations[0], "web", "X", "x@demo.invalid", null]),
      ).rejects.toMatchObject({
        code: "23503",
      });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(tx.query("SELECT app.convert_lead($1)", [bLead])).rejects.toMatchObject({
        code: "42501",
      });
    });
    const still = await t.admin.query("SELECT stage, member_id FROM app.lead WHERE id = $1", [
      bLead,
    ]);
    expect(still.rows[0]).toEqual({ stage: "new", member_id: null });
  });
});

describe("leads: forbidden columns and hostile input", () => {
  it.each([
    ["UPDATE app.lead SET member_id = $2 WHERE id = $1", "member"],
    ["UPDATE app.lead SET org_id = $2 WHERE id = $1", "org"],
    ["UPDATE app.lead SET created_by = $2 WHERE id = $1", "person"],
    [
      "UPDATE app.lead SET created_at = '2001-01-01' WHERE id = $1 AND $2::text IS NOT NULL",
      "none",
    ],
    ["UPDATE app.lead SET location_id = $2 WHERE id = $1", "location"],
  ])("%s → 42501", async (sql, kind) => {
    const { A, B } = t.fx;
    const id = await newLead(A, "owner");
    const value = {
      member: A.members[1],
      org: B.orgId,
      person: A.people.owner,
      none: "x",
      location: A.locations[1],
    }[kind];
    await refused(A, "owner", sql, [id, value], "42501");
  });

  it("stage and member_id cannot be chosen on insert", async () => {
    const { A } = t.fx;
    await refused(
      A,
      "front_desk",
      "INSERT INTO app.lead (location_id, source, full_name, email, stage) VALUES ($1, 'web', 'X', 'x@demo.invalid', 'won')",
      [A.locations[0]],
      "42501",
    );
    await refused(
      A,
      "front_desk",
      "INSERT INTO app.lead (location_id, source, full_name, email, member_id) VALUES ($1, 'web', 'X', 'x@demo.invalid', $2)",
      [A.locations[0], A.members[0]],
      "42501",
    );
  });

  it("'won' cannot be set by hand: only convert_lead links a member", async () => {
    const id = await newLead(t.fx.A);
    await refused(
      t.fx.A,
      "front_desk",
      "UPDATE app.lead SET stage = 'won' WHERE id = $1",
      [id],
      "23514",
    );
  });

  it.each([
    ["full_name", "Demo\nNombre"],
    ["full_name", "   "],
    ["full_name", "x".repeat(201)],
    ["email", "no-at-sign"],
    ["email", "a@b"],
    ["phone", "787-CALL-NOW"],
    ["phone", "+1 787 555 0100 ext 9"],
    ["notes", "x".repeat(2001)],
  ])("hostile %s %j is refused (23514)", async (col, value) => {
    const id = await newLead(t.fx.A);
    await refused(
      t.fx.A,
      "front_desk",
      `UPDATE app.lead SET ${col} = $2 WHERE id = $1`,
      [id, value],
      "23514",
    );
  });

  it("a lead needs an email or a phone", async () => {
    await refused(
      t.fx.A,
      "front_desk",
      "INSERT INTO app.lead (location_id, source, full_name) VALUES ($1, 'walk_in', 'Demo Sin Contacto')",
      [t.fx.A.locations[0]],
      "23514",
    );
  });

  it("the lead owner must be active staff of that location (other org / other location → invalid_owner)", async () => {
    const { A, B } = t.fx;
    const id = await newLead(A, "owner");
    const bStaff = await staffId(B, "front_desk");
    const aFront = await staffId(A, "front_desk"); // assigned to locations[0] only
    const trainer = await staffId(A, "trainer"); // also at locations[0]
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query("UPDATE app.lead SET owner_staff_id = $2 WHERE id = $1", [id, bStaff]),
      ).rejects.toMatchObject({ code: "22023", message: "invalid_owner" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        tx.query(
          "INSERT INTO app.lead (location_id, source, full_name, phone, owner_staff_id) VALUES ($1, 'web', 'Demo X', '7875550100', $2)",
          [A.locations[1], aFront],
        ),
      ).rejects.toMatchObject({ code: "22023", message: "invalid_owner" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      // A trainer at the right location still cannot own a lead (trainers never see leads).
      await expect(
        tx.query("UPDATE app.lead SET owner_staff_id = $2 WHERE id = $1", [id, trainer]),
      ).rejects.toMatchObject({ code: "22023", message: "invalid_owner" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      const ok = await tx.query("UPDATE app.lead SET owner_staff_id = $2 WHERE id = $1", [
        id,
        aFront,
      ]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it("leads cannot be deleted by anyone (they are closed as lost)", async () => {
    const id = await newLead(t.fx.A, "owner");
    await refused(t.fx.A, "owner", "DELETE FROM app.lead WHERE id = $1", [id], "42501");
  });
});

describe("stage changes are logged as activities automatically", () => {
  it("moving a lead writes one stage_change activity with the real actor, and an audit row", async () => {
    const { A } = t.fx;
    const id = await newLead(A);
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query("UPDATE app.lead SET stage = 'contacted' WHERE id = $1", [id]);
      await tx.query("UPDATE app.lead SET stage = 'tour_booked' WHERE id = $1", [id]);
      await tx.query("UPDATE app.lead SET notes = 'sin cambio de etapa' WHERE id = $1", [id]);
      const { rows } = await tx.query(
        "SELECT kind, from_stage, to_stage, by_person_id FROM app.lead_activity WHERE lead_id = $1 ORDER BY at, from_stage",
        [id],
      );
      expect(rows).toEqual([
        {
          kind: "stage_change",
          from_stage: "new",
          to_stage: "contacted",
          by_person_id: A.people.front_desk,
        },
        {
          kind: "stage_change",
          from_stage: "contacted",
          to_stage: "tour_booked",
          by_person_id: A.people.front_desk,
        },
      ]);
    });
    const audit = await t.admin.query(
      "SELECT actor_role, meta FROM app.audit_log WHERE action = 'lead.stage' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows).toEqual([
      { actor_role: "front_desk", meta: { from: "new", to: "contacted" } },
      { actor_role: "front_desk", meta: { from: "contacted", to: "tour_booked" } },
    ]);
  });

  it("'lost' requires a reason; leaving 'lost' clears it", async () => {
    const { A } = t.fx;
    const id = await newLead(A);
    await refused(
      A,
      "front_desk",
      "UPDATE app.lead SET stage = 'lost' WHERE id = $1",
      [id],
      "22023",
    );
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await tx.query(
        "UPDATE app.lead SET stage = 'lost', lost_reason = 'Demo: se mudó' WHERE id = $1",
        [id],
      );
      await tx.query("UPDATE app.lead SET stage = 'contacted' WHERE id = $1", [id]);
      const { rows } = await tx.query("SELECT stage, lost_reason FROM app.lead WHERE id = $1", [
        id,
      ]);
      expect(rows[0]).toEqual({ stage: "contacted", lost_reason: null });
      const act = await tx.query(
        "SELECT body FROM app.lead_activity WHERE lead_id = $1 AND to_stage = 'lost'",
        [id],
      );
      expect(act.rows).toEqual([{ body: "Demo: se mudó" }]);
    });
  });

  it("request traffic cannot forge, edit or delete timeline rows", async () => {
    const { A } = t.fx;
    const id = await newLead(A);
    const ins = "INSERT INTO app.lead_activity (lead_id, kind, body) VALUES ($1, $2, 'x')";
    await refused(A, "front_desk", ins, [id, "stage_change"], "42501");
    await refused(
      A,
      "front_desk",
      "INSERT INTO app.lead_activity (lead_id, kind, body, by_person_id) VALUES ($1, 'note', 'x', $2)",
      [id, A.people.owner],
      "42501",
    );
    await refused(
      A,
      "front_desk",
      "INSERT INTO app.lead_activity (lead_id, kind, body, at) VALUES ($1, 'note', 'x', '2001-01-01')",
      [id],
      "42501",
    );
    await refused(
      A,
      "owner",
      "UPDATE app.lead_activity SET body = 'x' WHERE lead_id = $1",
      [id],
      "42501",
    );
    await refused(A, "owner", "DELETE FROM app.lead_activity WHERE lead_id = $1", [id], "42501");
    // A lead at another location is not a valid target either.
    const other = await newLead(A, "owner", A.locations[1]);
    await refused(A, "front_desk", ins, [other, "note"], "42501");
  });

  it("front desk logs a call, a tour and a note on its own lead", async () => {
    const { A } = t.fx;
    const id = await newLead(A);
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      for (const kind of ["call", "tour", "note", "message"])
        await tx.query("INSERT INTO app.lead_activity (lead_id, kind, body) VALUES ($1, $2, $3)", [
          id,
          kind,
          `Demo ${kind}`,
        ]);
      const { rows } = await tx.query(
        "SELECT count(*)::int AS n FROM app.lead_activity WHERE lead_id = $1",
        [id],
      );
      expect(rows[0].n).toBe(4);
    });
  });
});

describe("convert_lead", () => {
  async function convert(org: OrgFixture, role: Role, lead: string): Promise<string> {
    return asCaller(t.api, t.claims(org, role), async (tx) => {
      const { rows } = await tx.query<{ id: string }>("SELECT app.convert_lead($1) AS id", [lead]);
      return rows[0]?.id as string;
    });
  }

  it.each(MANAGERS.map((r) => [r]))(
    "%s converts: exactly one member, linked, stage won, activity and audit, and NO consent",
    async (role) => {
      const { A } = t.fx;
      const email = `convert.${role}@demo.invalid`;
      const lead = await newLead(A, "front_desk", A.locations[0], email);
      const memberId = await convert(A, role, lead);
      const members = await t.admin.query(
        `SELECT m.id, m.full_name, m.phone, m.home_location_id FROM app.member m JOIN app.person p ON p.id = m.person_id
          WHERE lower(p.email) = $1 AND m.org_id = $2`,
        [email, A.orgId],
      );
      expect(members.rows).toHaveLength(1);
      expect(members.rows[0]).toMatchObject({
        id: memberId,
        phone: "+1 787 555 0100",
        home_location_id: A.locations[0],
      });
      expect(members.rows[0].full_name).toMatch(/^Demo Prospecto/);
      const l = await t.admin.query("SELECT stage, member_id FROM app.lead WHERE id = $1", [lead]);
      expect(l.rows[0]).toEqual({ stage: "won", member_id: memberId });
      const act = await t.admin.query(
        "SELECT from_stage, to_stage, by_person_id FROM app.lead_activity WHERE lead_id = $1 AND kind = 'stage_change'",
        [lead],
      );
      expect(act.rows).toEqual([
        { from_stage: "new", to_stage: "won", by_person_id: A.people[role] },
      ]);
      const audit = await t.admin.query(
        "SELECT action, actor_role, meta FROM app.audit_log WHERE entity_id = $1 AND action IN ('lead.convert', 'member.register') OR (action = 'member.register' AND entity_id = $2) ORDER BY id",
        [lead, memberId],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(["member.register", "lead.convert"]);
      expect(audit.rows[1]).toMatchObject({
        actor_role: role,
        meta: { member_id: memberId, from: "new" },
      });
      // Capturing or converting a lead never creates messaging consent (E8 model stays in charge).
      const consent = await t.admin.query(
        "SELECT (SELECT count(*) FROM app.consent WHERE member_id = $1)::int + (SELECT count(*) FROM app.consent_event WHERE member_id = $1)::int AS n",
        [memberId],
      );
      expect(consent.rows[0].n).toBe(0);
    },
  );

  it("converting twice fails cleanly (23505 already_converted) and leaves one member", async () => {
    const { A } = t.fx;
    const email = "twice@demo.invalid";
    const lead = await newLead(A, "front_desk", A.locations[0], email);
    await convert(A, "front_desk", lead);
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await expect(tx.query("SELECT app.convert_lead($1)", [lead])).rejects.toMatchObject({
        code: "23505",
        message: "already_converted",
      });
    });
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE p.email = $1",
      [email],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("concurrent conversions of the same lead: one wins, the other waits on the row lock and fails", async () => {
    const { A } = t.fx;
    const email = "race@demo.invalid";
    const lead = await newLead(A, "front_desk", A.locations[0], email);
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    let second: unknown;
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, t.claims(A, "front_desk"));
      await c1.query("SELECT app.convert_lead($1)", [lead]); // holds FOR UPDATE on the lead
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, t.claims(A, "owner"));
      const p2 = c2.query("SELECT app.convert_lead($1)", [lead]).then(
        () => null,
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      second = await p2;
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(second).toMatchObject({ code: "23505", message: "already_converted" });
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE p.email = $1",
      [email],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("a converted lead cannot be moved back out of 'won'", async () => {
    const { A } = t.fx;
    const lead = await newLead(A, "front_desk", A.locations[0], "locked@demo.invalid");
    await convert(A, "front_desk", lead);
    await refused(
      A,
      "front_desk",
      "UPDATE app.lead SET stage = 'contacted' WHERE id = $1",
      [lead],
      "22023",
    );
  });

  it("refuses: roles outside front of house, other location, missing email, an email that is already a member", async () => {
    const { A } = t.fx;
    const lead = await newLead(A, "front_desk", A.locations[0], "denied@demo.invalid");
    for (const role of NO_LEADS)
      await refused(A, role, "SELECT app.convert_lead($1)", [lead], "42501");
    const elsewhere = await newLead(A, "owner", A.locations[1], "elsewhere@demo.invalid");
    await refused(A, "front_desk", "SELECT app.convert_lead($1)", [elsewhere], "42501");
    await refused(A, "location_manager", "SELECT app.convert_lead($1)", [elsewhere], "42501");
    const noEmail = await newLead(A, "front_desk", A.locations[0], null);
    await refused(A, "front_desk", "SELECT app.convert_lead($1)", [noEmail], "22023");
    // No state oracle: out-of-scope callers get 'forbidden' before any lead-specific error.
    for (const role of NO_LEADS)
      await refused(A, role, "SELECT app.convert_lead($1)", [noEmail], "42501");
    const elsewhereNoEmail = await newLead(A, "owner", A.locations[1], null);
    await refused(A, "front_desk", "SELECT app.convert_lead($1)", [elsewhereNoEmail], "42501");
    // member.a@demo.invalid is already Demo member A in this org → conflict, nothing linked.
    const dup = await newLead(A, "front_desk", A.locations[0], "member.a@demo.invalid");
    await refused(A, "front_desk", "SELECT app.convert_lead($1)", [dup], "23505");
    const l = await t.admin.query("SELECT stage, member_id FROM app.lead WHERE id = ANY($1)", [
      [lead, elsewhere, noEmail, dup],
    ]);
    for (const r of l.rows) expect(r).toEqual({ stage: "new", member_id: null });
  });

  it("is not executable by PUBLIC and is owned by app_definer with a pinned search_path", async () => {
    const { rows } = await t.admin.query(
      `SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS pub
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.pronamespace = 'app'::regnamespace AND p.proname LIKE ANY (ARRAY['convert_lead', 'crm_%'])
        ORDER BY 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) {
      expect(r.pub, r.proname).toBe(false);
      if (r.prosecdef) {
        expect(r.owner, r.proname).toBe("app_definer");
        expect(r.proconfig, r.proname).toContain("search_path=app, pg_temp");
      }
    }
  });
});

describe("tasks", () => {
  const INSERT_TASK =
    "INSERT INTO app.crm_task (location_id, title, due_at, assigned_staff_id, lead_id, member_id) VALUES ($1, $2, now() + interval '2 days', $3, $4, $5) RETURNING id";

  async function newTask(
    org: OrgFixture,
    assignee: Role,
    subject: { lead?: string; member?: string } = {},
  ) {
    const staff = await staffId(org, assignee);
    return asCaller(t.api, t.claims(org, "front_desk"), async (tx) => {
      const { rows } = await tx.query<{ id: string }>(INSERT_TASK, [
        org.locations[0],
        "Demo tarea",
        staff,
        subject.lead ?? null,
        subject.member ?? null,
      ]);
      return rows[0]?.id as string;
    });
  }

  it("a trainer sees only the tasks assigned to them", async () => {
    const { A } = t.fx;
    const mine = await newTask(A, "trainer");
    const notMine = await newTask(A, "front_desk");
    const trainer = await staffId(A, "trainer");
    await asCaller(t.api, t.claims(A, "trainer"), async (tx) => {
      const { rows } = await tx.query("SELECT id, assigned_staff_id FROM app.crm_task");
      expect(rows.length).toBeGreaterThanOrEqual(2); // fixture task + mine
      for (const r of rows) expect(r.assigned_staff_id).toBe(trainer);
      expect(rows.map((r) => r.id)).toContain(mine);
      expect(rows.map((r) => r.id)).not.toContain(notMine);
    });
  });

  it("a trainer completes their own task (audited) but cannot edit it otherwise, nor touch others' tasks", async () => {
    const { A } = t.fx;
    const mine = await newTask(A, "trainer");
    const notMine = await newTask(A, "front_desk");
    await asCaller(t.api, t.claims(A, "trainer"), async (tx) => {
      expect(
        (await tx.query("UPDATE app.crm_task SET status = 'done' WHERE id = $1", [mine])).rowCount,
      ).toBe(1);
      const r = await tx.query(
        "SELECT status, completed_at IS NOT NULL AS c FROM app.crm_task WHERE id = $1",
        [mine],
      );
      expect(r.rows[0]).toEqual({ status: "done", c: true });
      expect(
        (await tx.query("UPDATE app.crm_task SET status = 'done' WHERE id = $1", [notMine]))
          .rowCount,
      ).toBe(0);
    });
    await refused(
      A,
      "trainer",
      "UPDATE app.crm_task SET title = 'x' WHERE id = $1",
      [mine],
      "42501",
    );
    await refused(
      A,
      "trainer",
      "UPDATE app.crm_task SET assigned_staff_id = $2 WHERE id = $1",
      [mine, await staffId(A, "front_desk")],
      "42501",
    );
    await refused(
      A,
      "trainer",
      INSERT_TASK,
      [A.locations[0], "x", await staffId(A, "trainer"), null, null],
      "42501",
    );
    const audit = await t.admin.query(
      "SELECT actor_role, meta FROM app.audit_log WHERE action = 'crm_task.update' AND entity_id = $1",
      [mine],
    );
    expect(audit.rows).toEqual([{ actor_role: "trainer", meta: { status: "done" } }]);
  });

  it.each(
    ["nutritionist", "chef", "clinician", "accountant", "member", "guardian"].map((r) => [
      r as Role,
    ]),
  )("%s sees no tasks and cannot create one", async (role) => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, role), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.crm_task")).rowCount).toBe(0);
      expect((await tx.query("UPDATE app.crm_task SET status = 'cancelled'")).rowCount).toBe(0);
    });
    await refused(
      A,
      role,
      INSERT_TASK.replace(" RETURNING id", ""),
      [A.locations[0], "x", await staffId(A, "front_desk"), null, null],
      "42501",
    );
  });

  it("managers see tasks of their location only; the owner sees all; other org sees none", async () => {
    const { A, B } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      const { rows } = await tx.query("SELECT DISTINCT location_id FROM app.crm_task");
      expect(rows.map((r) => r.location_id)).toEqual([A.locations[0]]);
    });
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      expect((await tx.query("SELECT DISTINCT location_id FROM app.crm_task")).rowCount).toBe(2);
    });
    const bTask = await newTask(B, "front_desk");
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.crm_task WHERE id = $1", [bTask])).rowCount).toBe(
        0,
      );
      expect(
        (await tx.query("UPDATE app.crm_task SET status = 'done' WHERE id = $1", [bTask])).rowCount,
      ).toBe(0);
    });
    await refused(
      A,
      "front_desk",
      INSERT_TASK.replace(" RETURNING id", ""),
      [A.locations[1], "x", await staffId(A, "owner"), null, null],
      "42501",
    );
  });

  it("task targets are validated without revealing rows outside the caller's scope", async () => {
    const { A, B } = t.fx;
    const fd = await staffId(A, "front_desk");
    const leadElsewhere = await newLead(A, "owner", A.locations[1]);
    const cases: Array<[unknown[], string, string]> = [
      // A chef at the right location: roles that can never see tasks are never assignees.
      [[A.locations[0], "x", await staffId(A, "chef"), null, null], "22023", "invalid_assignee"],
      [
        [A.locations[0], "x", await staffId(B, "front_desk"), null, null],
        "22023",
        "invalid_assignee",
      ],
      [
        [A.locations[0], "x", await staffId(A, "owner"), leadElsewhere, null],
        "22023",
        "invalid_lead",
      ],
      [
        [A.locations[0], "x", fd, "00000000-0000-4000-8000-000000000000", null],
        "22023",
        "invalid_lead",
      ],
      [[A.locations[0], "x", fd, null, A.members[1]], "22023", "invalid_member"],
      [[A.locations[0], "x", fd, null, B.members[0]], "22023", "invalid_member"],
      [[A.locations[0], "x\ny", fd, null, null], "23514", ""],
    ];
    for (const [params, code, message] of cases) {
      await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
        await expect(tx.query(INSERT_TASK, params), JSON.stringify(params)).rejects.toMatchObject(
          message ? { code, message } : { code },
        );
      });
    }
    const lead = await newLead(A);
    await refused(
      A,
      "front_desk",
      INSERT_TASK,
      [A.locations[0], "x", fd, lead, A.members[0]],
      "23514",
    );
    await refused(A, "front_desk", "UPDATE app.crm_task SET completed_at = now()", [], "42501");
    await refused(
      A,
      "front_desk",
      "UPDATE app.crm_task SET location_id = $1",
      [A.locations[0]],
      "42501",
    );
    await refused(
      A,
      "front_desk",
      "UPDATE app.crm_task SET member_id = $1",
      [A.members[0]],
      "42501",
    );
    await refused(A, "owner", "DELETE FROM app.crm_task", [], "42501");
  });

  it("member-related tasks are listed for that member", async () => {
    const { A } = t.fx;
    const id = await newTask(A, "front_desk", { member: A.members[0] });
    await asCaller(t.api, t.claims(A, "location_manager"), async (tx) => {
      const { rows } = await tx.query("SELECT id FROM app.crm_task WHERE member_id = $1", [
        A.members[0],
      ]);
      expect(rows.map((r) => r.id)).toContain(id);
    });
  });
});

describe("funnel report", () => {
  const FUNNEL =
    "SELECT location_id, source, total::int, new::int, contacted::int, tour_booked::int, trial::int, won::int, lost::int, conversion_pct::float AS pct FROM app.crm_funnel($1, $2, $3)";
  const row = (loc: string, source: string, counts: number[], pct: number) => {
    const [total, n, contacted, tour, trial, won, lost] = counts;
    return {
      location_id: loc,
      source,
      total,
      new: n,
      contacted,
      tour_booked: tour,
      trial,
      won,
      lost,
      pct,
    };
  };
  const expected = (org: OrgFixture) =>
    [
      row(org.locations[0], "web", [3, 1, 1, 0, 0, 1, 0], 33.3),
      row(org.locations[0], "referral", [2, 0, 0, 0, 1, 0, 1], 0),
      row(org.locations[1], "walk_in", [1, 0, 0, 1, 0, 0, 0], 0),
    ].sort((a, b) => (a.location_id + a.source).localeCompare(b.location_id + b.source));
  const sorted = (rows: Array<{ location_id: string; source: string }>) =>
    [...rows].sort((a, b) => (a.location_id + a.source).localeCompare(b.location_id + b.source));

  it("owner: numbers match the fixture cohort exactly, per org", async () => {
    for (const org of [t.fx.A, t.fx.B]) {
      await asCaller(t.api, t.claims(org, "owner"), async (tx) => {
        const { rows } = await tx.query(FUNNEL, ["2025-06-01", "2025-06-30", null]);
        expect(sorted(rows)).toEqual(expected(org));
      });
    }
  });

  it("location filter and date range bound the cohort", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      const one = await tx.query(FUNNEL, ["2025-06-01", "2025-06-30", A.locations[1]]);
      expect(one.rows).toEqual([row(A.locations[1], "walk_in", [1, 0, 0, 1, 0, 0, 0], 0)]);
      const narrow = await tx.query(FUNNEL, ["2025-06-02", "2025-06-03", null]);
      expect(narrow.rows).toEqual([row(A.locations[0], "web", [2, 1, 1, 0, 0, 0, 0], 0)]);
    });
  });

  it("a location manager only counts their location", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "location_manager"), async (tx) => {
      const { rows } = await tx.query(FUNNEL, ["2025-06-01", "2025-06-30", null]);
      expect(sorted(rows)).toEqual(expected(A).filter((r) => r.location_id === A.locations[0]));
    });
  });

  it("other roles are refused; invalid ranges are refused", async () => {
    const { A } = t.fx;
    for (const role of ["front_desk", ...NO_LEADS] as Role[])
      await refused(A, role, FUNNEL, ["2025-06-01", "2025-06-30", null], "42501");
    await refused(A, "owner", FUNNEL, ["2025-06-30", "2025-06-01", null], "22023");
    await refused(A, "owner", FUNNEL, ["2024-01-01", "2025-06-01", null], "22023");
  });
});
