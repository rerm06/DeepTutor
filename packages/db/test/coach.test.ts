import type { Claims, Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
let wardA: string;

const NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false };
const as = (role: Role, org: OrgFixture = t.fx.A, person?: string) => t.claims(org, role, person);

let seq = 0;
/** A fresh member (and their person) per test so cases never depend on each other's data. */
async function newMember(org: OrgFixture = t.fx.A, loc = org.locations[0]) {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`coach${seq}.${Date.now()}@demo.invalid`],
  );
  const person = p.rows[0]?.id as string;
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, member_no, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id",
    [org.orgId, person, loc, `Demo coach ${seq}`, `T-${seq}`],
  );
  const id = m.rows[0]?.id as string;
  return { id, person, claims: as("member", org, person) };
}

async function write(
  tx: Tx,
  member: string,
  op: string,
  target: string | null,
  cat: string,
  topic: string,
  content: string,
  source = "member",
) {
  const { rows } = await tx.query<{ id: string }>(
    "SELECT app.coach_memory_write($1, $2, $3, $4, $5, $6, $7) AS id",
    [member, op, target, cat, topic, content, source],
  );
  return rows[0]?.id as string;
}
async function checkin(
  tx: Tx,
  member: string,
  a: {
    sleep?: number;
    energy?: number;
    pain?: number;
    area?: string | null;
    acute?: boolean;
    note?: string | null;
    score?: number | null;
  } = {},
) {
  const { rows } = await tx.query(
    "SELECT * FROM app.coach_register_checkin($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      member,
      a.sleep ?? 3,
      a.energy ?? 3,
      a.pain ?? 0,
      a.area ?? null,
      a.acute ?? false,
      a.note ?? null,
      a.score ?? null,
    ],
  );
  return rows[0] as {
    id: string;
    baseline_days: number;
    score: number | null;
    escalated: boolean;
    emergency: boolean;
  };
}
async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await t.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${sql}) x`,
    params,
  );
  return rows[0]?.n ?? 0;
}
async function visible(claims: Claims, table: string, member: string): Promise<number> {
  return asCaller(t.api, claims, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.${table} WHERE member_id = $1`,
      [member],
    );
    return rows[0]?.n ?? 0;
  });
}
async function signTriage(member: string, conditions: string[] = [], weight = 70) {
  return asCaller(t.api, as("trainer"), async (tx) => {
    const a = await tx.query<{ id: string }>(
      `INSERT INTO app.assessment (member_id, parq, declared_conditions, height_cm, weight_kg)
       VALUES ($1, $2, $3, 168, $4) RETURNING id`,
      [member, JSON.stringify(NO), conditions, weight],
    );
    await tx.query("SELECT app.sign_assessment($1)", [a.rows[0]?.id]);
  });
}
const DRAFT_BODY = JSON.stringify({
  sections: [{ heading: "Rango propuesto (borrador)", items: ["Energía: 1,800 a 2,000 kcal/día"] }],
});
const draft = (
  member: string,
  goal = "maintenance",
  birth = "1990-05-01",
  claims = as("nutritionist"),
) =>
  asCaller(t.api, claims, (tx) =>
    tx.query(
      "SELECT app.coach_nutrition_draft($1, $2, $3, 'Borrador de rango de energía (para revisión)', $4, 'Demo') AS id",
      [member, goal, birth, DRAFT_BODY],
    ),
  );

beforeAll(async () => {
  t = await createTestDb();
  const g = await t.admin.query<{ member_id: string }>(
    "SELECT member_id FROM app.guardian_link WHERE org_id = $1 AND guardian_person_id = $2",
    [t.fx.A.orgId, t.fx.A.people.guardian],
  );
  wardA = g.rows[0]?.member_id as string;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

describe("member_memory", () => {
  it("member writes; the member, trainer and location manager of the home location read; nobody else", async () => {
    const m = await newMember();
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "preference", "training_schedule", "Prefiere entrenar temprano"),
    );
    expect(await visible(m.claims, "member_memory", m.id)).toBe(1);
    expect(await visible(as("trainer"), "member_memory", m.id)).toBe(1);
    expect(await visible(as("location_manager"), "member_memory", m.id)).toBe(1);
    for (const role of [
      "owner",
      "front_desk",
      "chef",
      "accountant",
      "nutritionist",
      "clinician",
      "guardian",
      "member",
    ] as Role[])
      expect(await visible(as(role), "member_memory", m.id), role).toBe(0);
    for (const role of ["owner", "trainer", "location_manager"] as Role[])
      expect(await visible(as(role, t.fx.B), "member_memory", m.id), `B ${role}`).toBe(0);
  });

  it("trainer of ANOTHER location of the same org sees nothing", async () => {
    const m = await newMember(t.fx.A, t.fx.A.locations[1]);
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "goal", "goal_5k", "Quiere correr un 5k"),
    );
    expect(await visible(as("trainer"), "member_memory", m.id)).toBe(0);
    expect(await visible(as("location_manager"), "member_memory", m.id)).toBe(0);
  });

  it("the guardian reads, edits and deletes the ward's facts", async () => {
    const g = as("guardian");
    const id = await asCaller(t.api, g, (tx) =>
      write(
        tx,
        wardA,
        "ADD",
        null,
        "schedule",
        "training_schedule",
        "Entrena después de la escuela",
      ),
    );
    expect(await visible(g, "member_memory", wardA)).toBeGreaterThan(0);
    await asCaller(t.api, g, (tx) =>
      write(tx, wardA, "UPDATE", id, "schedule", "training_schedule", "Entrena los sábados"),
    );
    await asCaller(t.api, g, (tx) =>
      write(tx, wardA, "DELETE", id, "schedule", "deleted", "(borrado)"),
    );
    const row = await t.admin.query(
      "SELECT content, deleted_at FROM app.member_memory WHERE id = $1",
      [id],
    );
    expect(row.rows[0].content).toBe("(borrado)");
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it("refuses writes by staff, by other members, for other orgs, and the 'staff' source", async () => {
    const m = await newMember();
    const other = await newMember();
    for (const c of [
      as("trainer"),
      as("location_manager"),
      as("owner"),
      as("front_desk"),
      other.claims,
      as("member", t.fx.B),
    ])
      await expect(
        asCaller(t.api, c, (tx) => write(tx, m.id, "ADD", null, "other", "x", "Demo")),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, m.claims, (tx) =>
        write(tx, m.id, "ADD", null, "other", "x", "Demo", "staff"),
      ),
    ).rejects.toMatchObject({ message: "invalid_source" });
    const id = await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "other", "mine", "Demo hecho"),
    );
    // Another member cannot update or delete it even knowing the id (passing their own member id).
    await expect(
      asCaller(t.api, other.claims, (tx) =>
        write(tx, other.id, "DELETE", id, "other", "d", "(borrado)"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("request traffic has no direct INSERT/UPDATE/DELETE on coach tables", async () => {
    const m = await newMember();
    for (const sql of [
      `INSERT INTO app.member_memory (member_id, category, topic, content, source, created_by) VALUES ('${m.id}', 'other', 'x', 'y', 'member', '${m.person}')`,
      "UPDATE app.member_memory SET content = 'x'",
      "DELETE FROM app.member_memory",
      "UPDATE app.daily_checkin SET score = 100",
      "UPDATE app.coach_action SET status = 'executed'",
      "UPDATE app.coach_escalation SET status = 'closed'",
    ])
      await expect(
        asCaller(t.api, m.claims, (tx) => tx.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: "42501" });
    // Internal helpers are not callable by request traffic.
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.coach_escalate($1, 'checkin_pain', NULL)", [m.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("hostile content is refused by the CHECK (markup, braces/tool syntax, links, control characters)", async () => {
    const m = await newMember();
    for (const bad of [
      "<script>alert(1)</script>",
      '{"name":"book_class","arguments":{}}',
      "ver http://demo.invalid",
      "visita www.demo.invalid",
      "linea1\nlinea2",
      "`rm -rf`",
      "x".repeat(281),
    ])
      await expect(
        asCaller(t.api, m.claims, (tx) => write(tx, m.id, "ADD", null, "other", "bad", bad)),
        bad,
      ).rejects.toMatchObject({ code: "23514" });
  });

  it("delete really forgets (text scrubbed, row hidden) and every change is audited without content", async () => {
    const m = await newMember();
    const id = await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "restriction", "food_allergy", "Alérgica al maní"),
    );
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "DELETE", id, "restriction", "deleted", "(borrado)"),
    );
    expect(await visible(m.claims, "member_memory", m.id)).toBe(0);
    const audit = await t.admin.query(
      "SELECT action, actor_person_id, actor_role, meta FROM app.audit_log WHERE entity = 'member_memory' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["coach.memory.add", "coach.memory.delete"]);
    expect(audit.rows[0].actor_person_id).toBe(m.person);
    expect(audit.rows[0].actor_role).toBe("member");
    expect(JSON.stringify(audit.rows)).not.toMatch(/man[ií]/i);
  });

  it("an injury fact escalates to a human with a neutral CRM task (front desk sees the task, never the detail)", async () => {
    const m = await newMember();
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "injury", "injury_knee", "Lesión en la rodilla derecha"),
    );
    const e = await t.admin.query(
      "SELECT reason, crm_task_id, assigned_staff_id FROM app.coach_escalation WHERE member_id = $1",
      [m.id],
    );
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0].reason).toBe("memory_injury");
    const task = await t.admin.query(
      "SELECT title, assigned_staff_id FROM app.crm_task WHERE id = $1",
      [e.rows[0].crm_task_id],
    );
    // Front desk can read CRM tasks: no coach/health wording, no name, no reason-dependent urgency.
    expect(task.rows[0].title).toMatch(/^Seguimiento con socio /);
    expect(task.rows[0].title).not.toMatch(/coach|rodilla|lesi|dolor|salud|demo/i);
    const lm = await t.admin.query(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2",
      [t.fx.A.orgId, t.fx.A.people.location_manager],
    );
    expect(task.rows[0].assigned_staff_id).toBe(lm.rows[0].id);
    expect(await visible(as("front_desk"), "coach_escalation", m.id)).toBe(0);
    expect(await visible(as("trainer"), "coach_escalation", m.id)).toBe(1);
  });

  it("caps live facts at 50 (refuses instead of silently evicting)", async () => {
    const m = await newMember();
    await t.admin.query(
      `INSERT INTO app.member_memory (org_id, member_id, category, topic, content, source, created_by)
       SELECT $1, $2, 'other', 'f' || g, 'Demo hecho ' || g, 'member', $3 FROM generate_series(1, 50) g`,
      [t.fx.A.orgId, m.id, m.person],
    );
    await expect(
      asCaller(t.api, m.claims, (tx) => write(tx, m.id, "ADD", null, "other", "f51", "Demo 51")),
    ).rejects.toMatchObject({ message: "memory_full" });
  });

  it("concurrent ADDs of the same topic serialise: one row, the other refused", async () => {
    const m = await newMember();
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, m.claims);
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, m.claims);
      await write(c1, m.id, "ADD", null, "schedule", "training_schedule", "Entrena de mañana");
      const second = write(
        c2,
        m.id,
        "ADD",
        null,
        "schedule",
        "training_schedule",
        "Entrena de mañana",
      ).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
      await new Promise((r) => setTimeout(r, 150)); // c2 is now waiting on the per-member lock
      await c1.query("COMMIT");
      expect(await second).toBe("23505");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(
      await count("SELECT 1 FROM app.member_memory WHERE member_id = $1 AND deleted_at IS NULL", [
        m.id,
      ]),
    ).toBe(1);
  });
});

describe("daily_checkin", () => {
  it("first days: no score ('estableciendo tu línea base'), even if a score is passed", async () => {
    const m = await newMember();
    const r = await asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, { score: 90 }));
    expect(r.baseline_days).toBe(0);
    expect(r.score).toBeNull();
    expect(r.escalated).toBe(false);
  });

  it("with ≥ 7 prior check-ins in 28 days the score is stored; the count is taken by SQL, not the caller", async () => {
    const m = await newMember();
    await t.admin.query(
      `INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, baseline_days, created_by)
       SELECT $1, $2, (now() AT TIME ZONE 'America/Puerto_Rico')::date - g, 3, 3, 0, 0, $3 FROM generate_series(1, 7) g`,
      [t.fx.A.orgId, m.id, m.person],
    );
    const r = await asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, { score: 63 }));
    expect(r.baseline_days).toBe(7);
    expect(r.score).toBe(63);
    await expect(
      asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, { score: 101 })),
    ).rejects.toBeTruthy();
  });

  it("pain ≥ 4 or pain flagged acute escalates; pain 3 does not", async () => {
    const low = await newMember();
    expect(
      (await asCaller(t.api, low.claims, (tx) => checkin(tx, low.id, { pain: 3, area: "knee" })))
        .escalated,
    ).toBe(false);
    const high = await newMember();
    const r = await asCaller(t.api, high.claims, (tx) =>
      checkin(tx, high.id, { pain: 4, area: "knee" }),
    );
    expect(r).toMatchObject({ escalated: true, emergency: false });
    const e = await t.admin.query(
      "SELECT reason, source_id, crm_task_id FROM app.coach_escalation WHERE member_id = $1",
      [high.id],
    );
    expect(e.rows[0]).toMatchObject({ reason: "checkin_pain", source_id: r.id });
    expect(e.rows[0].crm_task_id).not.toBeNull();
    const acute = await newMember();
    expect(
      (
        await asCaller(t.api, acute.claims, (tx) =>
          checkin(tx, acute.id, { pain: 2, area: "ankle", acute: true }),
        )
      ).escalated,
    ).toBe(true);
  });

  it("acute-symptom words or chest pain set the emergency flag", async () => {
    for (const [a, expected] of [
      [{ note: "Anoche tuve dolor de pecho" }, true],
      [{ note: "Me DESMAYÉ en la clase" }, true],
      [{ note: "siento falta de aire" }, true],
      [{ pain: 2, area: "chest" }, true],
      [{ note: "Dormí poco" }, false],
    ] as const) {
      const m = await newMember();
      const r = await asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, a));
      expect(r.emergency, JSON.stringify(a)).toBe(expected);
      if (expected) expect(r.escalated).toBe(true);
      if (expected)
        expect(
          await count(
            "SELECT 1 FROM app.coach_escalation WHERE member_id = $1 AND reason = 'checkin_acute'",
            [m.id],
          ),
        ).toBe(1);
    }
  });

  it("one check-in per local day; two concurrent submissions → exactly one row", async () => {
    const m = await newMember();
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, m.claims);
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, m.claims);
      await checkin(c1, m.id);
      const second = checkin(c2, m.id).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      expect(await second).toBe("23505");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(await count("SELECT 1 FROM app.daily_checkin WHERE member_id = $1", [m.id])).toBe(1);
  });

  it("RLS: trainer/manager of the location see trends; front desk, chef, accountant, owner, other members, org B do not", async () => {
    const m = await newMember();
    await asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, { pain: 1, area: "neck" }));
    expect(await visible(m.claims, "daily_checkin", m.id)).toBe(1);
    expect(await visible(as("trainer"), "daily_checkin", m.id)).toBe(1);
    expect(await visible(as("location_manager"), "daily_checkin", m.id)).toBe(1);
    for (const role of [
      "front_desk",
      "chef",
      "accountant",
      "owner",
      "member",
      "guardian",
      "nutritionist",
    ] as Role[])
      expect(await visible(as(role), "daily_checkin", m.id), role).toBe(0);
    expect(await visible(as("trainer", t.fx.B), "daily_checkin", m.id)).toBe(0);
    // Staff cannot register a check-in for a member; other members neither.
    const other = await newMember();
    for (const c of [as("trainer"), as("front_desk"), other.claims])
      await expect(asCaller(t.api, c, (tx) => checkin(tx, m.id))).rejects.toMatchObject({
        code: "42501",
      });
  });

  it("invalid answers are refused (ranges, pain area iff pain, unsafe note)", async () => {
    for (const a of [
      { sleep: 6 },
      { energy: 0 },
      { pain: 11, area: "knee" },
      { pain: 0, area: "knee" },
      { pain: 5 },
      { note: "<b>hola</b>" },
    ]) {
      const m = await newMember();
      await expect(
        asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, a)),
        JSON.stringify(a),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });
});

describe("coach_escalation", () => {
  it("assigns the member's trainer (latest appointment) and staff move it open → acknowledged → closed", async () => {
    const m = await newMember();
    const trainer = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2",
      [t.fx.A.orgId, t.fx.A.people.trainer],
    );
    await t.admin.query(
      `INSERT INTO app.appointment (org_id, location_id, kind, staff_member_id, member_id, starts_at, ends_at, created_by)
       VALUES ($1, $2, 'personal_training', $3, $4, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', $5)`,
      [t.fx.A.orgId, t.fx.A.locations[0], trainer.rows[0]?.id, m.id, t.fx.A.people.front_desk],
    );
    await asCaller(t.api, m.claims, (tx) => checkin(tx, m.id, { pain: 6, area: "shoulder" }));
    const e = await t.admin.query<{ id: string; assigned_staff_id: string; crm_task_id: string }>(
      "SELECT id, assigned_staff_id, crm_task_id FROM app.coach_escalation WHERE member_id = $1",
      [m.id],
    );
    const esc = e.rows[0] as { id: string; assigned_staff_id: string; crm_task_id: string };
    expect(esc.assigned_staff_id).toBe(trainer.rows[0]?.id);
    // The trainer sees the CRM task assigned to them.
    const seen = await asCaller(t.api, as("trainer"), (tx) =>
      tx.query("SELECT 1 FROM app.crm_task WHERE id = $1", [esc.crm_task_id]),
    );
    expect(seen.rowCount).toBe(1);
    for (const c of [as("front_desk"), as("owner"), m.claims, as("trainer", t.fx.B)])
      await expect(
        asCaller(t.api, c, (tx) =>
          tx.query("SELECT app.coach_escalation_set_status($1, 'acknowledged')", [esc.id]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    await asCaller(t.api, as("trainer"), (tx) =>
      tx.query("SELECT app.coach_escalation_set_status($1, 'acknowledged')", [esc.id]),
    );
    await asCaller(t.api, as("location_manager"), (tx) =>
      tx.query("SELECT app.coach_escalation_set_status($1, 'closed')", [esc.id]),
    );
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.coach_escalation_set_status($1, 'acknowledged')", [esc.id]),
      ),
    ).rejects.toMatchObject({ message: "invalid_transition" });
    const audit = await t.admin.query(
      "SELECT action, actor_role FROM app.audit_log WHERE entity_id = $1 ORDER BY id",
      [esc.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "coach.escalation.create",
      "coach.escalation.acknowledged",
      "coach.escalation.closed",
    ]);
  });

  it("a repeat of the same reason within 24 h reuses the open escalation (no task spam)", async () => {
    const m = await newMember();
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "injury", "injury_knee", "Dolor de rodilla"),
    );
    await asCaller(t.api, m.claims, (tx) =>
      write(tx, m.id, "ADD", null, "injury", "injury_hip", "Molestia en la cadera"),
    );
    expect(await count("SELECT 1 FROM app.coach_escalation WHERE member_id = $1", [m.id])).toBe(1);
  });
});

describe("coach_action (write proposals)", () => {
  const propose = (c: Claims, member: string, tool = "add_memory") =>
    asCaller(
      t.api,
      c,
      async (tx) =>
        (
          await tx.query<{ id: string }>("SELECT app.coach_action_propose($1, $2, $3, $4) AS id", [
            member,
            tool,
            JSON.stringify({ content: "Demo" }),
            "Recordar: Demo",
          ])
        ).rows[0]?.id as string,
    );
  const decide = (c: Claims, id: string, confirm: boolean) =>
    asCaller(t.api, c, (tx) =>
      tx.query("SELECT status FROM app.coach_action_decide($1, $2)", [id, confirm]),
    );

  it("only the member (or guardian) proposes, sees and decides; staff and other members never", async () => {
    const m = await newMember();
    const other = await newMember();
    const id = await propose(m.claims, m.id);
    expect(await visible(m.claims, "coach_action", m.id)).toBe(1);
    for (const role of ["trainer", "location_manager", "owner", "front_desk"] as Role[])
      expect(await visible(as(role), "coach_action", m.id), role).toBe(0);
    for (const c of [as("trainer"), as("owner"), other.claims, as("member", t.fx.B)]) {
      await expect(decide(c, id, true)).rejects.toMatchObject({ code: "42501" });
      await expect(propose(c, m.id)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await decide(m.claims, id, false)).rows[0].status).toBe("rejected");
    await expect(decide(m.claims, id, true)).rejects.toMatchObject({
      message: "invalid_transition",
    });
  });

  it("finish requires a confirmed action; expired proposals cannot be confirmed; unknown tools refused", async () => {
    const m = await newMember();
    const id = await propose(m.claims, m.id);
    await expect(
      asCaller(t.api, m.claims, (tx) =>
        tx.query("SELECT app.coach_action_finish($1, true, NULL, NULL)", [id]),
      ),
    ).rejects.toMatchObject({ message: "invalid_transition" });
    await decide(m.claims, id, true);
    const fin = await asCaller(t.api, m.claims, (tx) =>
      tx.query("SELECT app.coach_action_finish($1, true, '{}', NULL) AS s", [id]),
    );
    expect(fin.rows[0].s).toBe("executed");
    const old = await propose(m.claims, m.id);
    await t.admin.query(
      "UPDATE app.coach_action SET proposed_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [old],
    );
    await expect(decide(m.claims, old, true)).rejects.toMatchObject({ message: "action_expired" });
    await expect(propose(m.claims, m.id, "delete_everything")).rejects.toMatchObject({
      code: "23514",
    });
    const audit = await t.admin.query(
      "SELECT action FROM app.audit_log WHERE entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "coach.action.propose",
      "coach.action.confirmed",
      "coach.action.executed",
    ]);
  });

  it("at most 5 open proposals per member", async () => {
    const m = await newMember();
    for (let i = 0; i < 5; i++) await propose(m.claims, m.id);
    await expect(propose(m.claims, m.id)).rejects.toMatchObject({ message: "too_many_proposals" });
  });

  it("two concurrent confirmations: exactly one wins", async () => {
    const m = await newMember();
    const id = await propose(m.claims, m.id);
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, m.claims);
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, m.claims);
      await c1.query("SELECT app.coach_action_decide($1, true)", [id]);
      const second = c2.query("SELECT app.coach_action_decide($1, true)", [id]).then(
        () => "ok",
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      expect(await second).toBe("invalid_transition");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
  });
});

describe("energy-range drafts (nutrition care_plan draft)", () => {
  it("nutritionist of the location creates a DRAFT the member cannot see; audited", async () => {
    const m = await newMember();
    await signTriage(m.id);
    const r = await draft(m.id);
    const id = r.rows[0].id as string;
    const p = await t.admin.query(
      "SELECT kind, status, created_by FROM app.care_plan WHERE id = $1",
      [id],
    );
    expect(p.rows[0]).toMatchObject({ kind: "nutrition", status: "draft" });
    const seen = await asCaller(t.api, m.claims, (tx) =>
      tx.query("SELECT 1 FROM app.care_plan WHERE id = $1", [id]),
    );
    expect(seen.rowCount).toBe(0);
    expect(
      await count(
        "SELECT 1 FROM app.audit_log WHERE action = 'coach.nutrition_draft' AND entity_id = $1",
        [id],
      ),
    ).toBe(1);
  });

  it("refusals: no triage, red triage, minors (guardian link or age < 18), deficit with pregnancy/lactation/ED flags", async () => {
    const none = await newMember();
    await expect(draft(none.id)).rejects.toMatchObject({ message: "triage_required" });
    const red = await newMember();
    await signTriage(red.id, ["eating_disorder_screen_positive"]);
    await expect(draft(red.id)).rejects.toMatchObject({ message: "triage_red_blocks_nutrition" });
    await signTriage(wardA);
    await expect(draft(wardA)).rejects.toMatchObject({ message: "minor_no_calorie_counting" });
    // A guardian link added AFTER the triage (no_calorie_counting still false) also blocks the draft.
    const later = await newMember();
    await signTriage(later.id);
    await t.admin.query(
      "INSERT INTO app.guardian_link (org_id, guardian_person_id, member_id) VALUES ($1, $2, $3)",
      [t.fx.A.orgId, t.fx.A.people.guardian, later.id],
    );
    await expect(draft(later.id)).rejects.toMatchObject({ message: "minor_no_calorie_counting" });
    const young = await newMember();
    await signTriage(young.id);
    const sixteen = new Date(Date.now() - 16 * 365.25 * 86400_000).toISOString().slice(0, 10);
    await expect(draft(young.id, "maintenance", sixteen)).rejects.toMatchObject({
      message: "minor_no_calorie_counting",
    });
    for (const cond of ["pregnancy", "lactation"]) {
      const m = await newMember();
      await signTriage(m.id, [cond]);
      await expect(draft(m.id, "deficit")).rejects.toMatchObject({
        message: "deficit_not_allowed",
      });
      expect((await draft(m.id, "maintenance")).rows[0].id).toBeTruthy(); // amber: approval needs the referral ack (health)
    }
  });

  it("only the licensed-nutrition role of the member's location; never trainer, front desk, other org", async () => {
    const m = await newMember();
    await signTriage(m.id);
    for (const c of [
      as("trainer"),
      as("front_desk"),
      as("location_manager"),
      as("owner"),
      m.claims,
      as("nutritionist", t.fx.B),
    ])
      await expect(draft(m.id, "maintenance", "1990-05-01", c)).rejects.toMatchObject({
        code: "42501",
      });
    const far = await newMember(t.fx.A, t.fx.A.locations[1]);
    await signTriage(far.id).catch(() => undefined); // trainer is not at location 1: no triage either way
    await expect(draft(far.id)).rejects.toMatchObject({ code: "42501" });
  });

  it("activity days count logged sets and allowed check-ins; health staff only", async () => {
    const m = await newMember();
    const ex = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.exercise WHERE org_id = $1 LIMIT 1",
      [t.fx.A.orgId],
    );
    await t.admin.query(
      `INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, reps, at)
       SELECT $1, $2, $3, $4, 10, now() - make_interval(days => g) FROM generate_series(1, 6) g`,
      [t.fx.A.orgId, m.id, t.fx.A.locations[0], ex.rows[0]?.id],
    );
    const n = await asCaller(t.api, as("nutritionist"), (tx) =>
      tx.query("SELECT app.coach_activity_days($1, 28) AS n", [m.id]),
    );
    expect(n.rows[0].n).toBe(6);
    await expect(
      asCaller(t.api, as("front_desk"), (tx) =>
        tx.query("SELECT app.coach_activity_days($1, 28)", [m.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("keyword helper", () => {
  it("app.coach_acute_keywords matches ES/EN acute phrases, accents ignored", async () => {
    const { rows } = await t.admin.query(
      "SELECT p, app.coach_acute_keywords(p) AS hit FROM unnest($1::text[]) p",
      [
        [
          "dolor de pecho",
          "Dolor en el pecho",
          "me desmayé",
          "Falta de aire",
          "chest pain",
          "I fainted",
          "can't breathe",
          "me duele la rodilla",
          "dormí mal",
        ],
      ],
    );
    expect(rows.map((r) => r.hit)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
