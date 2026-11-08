import { ROLES, type Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Module portal (member portal): member_goal (weekly training goal) and challenge_perk, plus the acting-member helper.
let t: TestDb;
const wards: Record<"A" | "B", string> = { A: "", B: "" };
beforeAll(async () => {
  t = await createTestDb();
  for (const k of ["A", "B"] as const) {
    const r = await t.admin.query<{ member_id: string }>(
      "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
      [t.fx[k].people.guardian],
    );
    wards[k] = r.rows[0]?.member_id as string;
  }
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const as = (role: Role, org: OrgFixture = t.fx.A) => t.claims(org, role);

async function refused(tx: Tx, sql: string, params: unknown[], pgCode: string) {
  await tx.query("SAVEPOINT r");
  await expect(tx.query(sql, params)).rejects.toMatchObject({ code: pgCode });
  await tx.query("ROLLBACK TO SAVEPOINT r");
}

async function goalsVisible(role: Role, org: OrgFixture = t.fx.A): Promise<string[]> {
  return asCaller(t.api, as(role, org), async (tx) =>
    (await tx.query<{ member_id: string }>("SELECT member_id FROM app.member_goal")).rows.map(
      (r) => r.member_id,
    ),
  );
}

describe("member_goal visibility (RLS)", () => {
  beforeAll(async () => {
    // A goal for the guardian's ward and for members[1] (other location) in both orgs.
    for (const k of ["A", "B"] as const) {
      await t.admin.query(
        `INSERT INTO app.member_goal (org_id, member_id, weekly_trainings, updated_by)
         VALUES ($1, $2, 2, $3), ($1, $4, 5, $5)`,
        [
          t.fx[k].orgId,
          wards[k],
          t.fx[k].people.guardian,
          t.fx[k].members[1],
          t.fx[k].people.owner,
        ],
      );
    }
  });

  it("the member sees only their own goal", async () => {
    expect(await goalsVisible("member")).toEqual([t.fx.A.members[0]]);
  });

  it("the guardian sees only the ward's goal", async () => {
    expect(await goalsVisible("guardian")).toEqual([wards.A]);
  });

  it("staff of the home location read; org-wide roles read the whole org; nobody reads the other org", async () => {
    const all = [t.fx.A.members[0], t.fx.A.members[1], wards.A].sort();
    const loc0 = [t.fx.A.members[0], wards.A].sort();
    expect((await goalsVisible("owner")).sort()).toEqual(all);
    expect((await goalsVisible("accountant")).sort()).toEqual(all);
    for (const role of [
      "location_manager",
      "front_desk",
      "trainer",
      "nutritionist",
      "clinician",
      "chef",
    ] as Role[])
      expect((await goalsVisible(role)).sort(), role).toEqual(loc0);
    for (const role of ROLES) {
      const rows = await goalsVisible(role, t.fx.B);
      for (const id of all) expect(rows, `${role} of B`).not.toContain(id);
    }
  });

  it("a member of the same org at another location cannot read members[0]'s goal", async () => {
    const other = await asCaller(
      t.api,
      t.claims(t.fx.A, "member", t.fx.A.people.member),
      async (tx) =>
        (await tx.query("SELECT 1 FROM app.member_goal WHERE member_id = $1", [t.fx.A.members[1]]))
          .rowCount,
    );
    expect(other).toBe(0);
  });

  it("no claims → no rows", async () => {
    const c = await t.api.pool.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE app_authenticated");
      expect((await c.query("SELECT * FROM app.member_goal")).rowCount).toBe(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

describe("member_goal writes", () => {
  it("request traffic cannot write the table directly (no grants), not even the member", async () => {
    for (const role of ["member", "owner", "front_desk"] as Role[]) {
      await asCaller(t.api, as(role), async (tx) => {
        await refused(
          tx,
          "INSERT INTO app.member_goal (member_id, weekly_trainings, updated_by) VALUES ($1, 3, $2)",
          [t.fx.A.members[0], t.fx.A.people.member],
          "42501",
        );
        await refused(tx, "UPDATE app.member_goal SET weekly_trainings = 14", [], "42501");
        await refused(tx, "DELETE FROM app.member_goal", [], "42501");
      });
    }
  });

  it("the member sets their goal (insert, then update) and each change is audited", async () => {
    const m = t.fx.B.members[0];
    await t.admin.query("DELETE FROM app.member_goal WHERE member_id = $1", [m]);
    const r1 = await asCaller(
      t.api,
      as("member", t.fx.B),
      async (tx) =>
        (await tx.query<{ g: number }>("SELECT app.set_member_goal(6) AS g")).rows[0]?.g,
    );
    expect(r1).toBe(6);
    await asCaller(t.api, as("member", t.fx.B), (tx) => tx.query("SELECT app.set_member_goal(9)"));
    const row = await t.admin.query(
      "SELECT org_id, weekly_trainings, updated_by FROM app.member_goal WHERE member_id = $1",
      [m],
    );
    expect(row.rows).toEqual([
      { org_id: t.fx.B.orgId, weekly_trainings: 9, updated_by: t.fx.B.people.member },
    ]);
    const audit = await t.admin.query(
      `SELECT actor_person_id, actor_role, meta FROM app.audit_log
        WHERE action = 'member_goal.set' AND entity_id = $1 ORDER BY id`,
      [m],
    );
    expect(audit.rows).toEqual([
      {
        actor_person_id: t.fx.B.people.member,
        actor_role: "member",
        meta: { weekly_trainings: 6, from: null },
      },
      {
        actor_person_id: t.fx.B.people.member,
        actor_role: "member",
        meta: { weekly_trainings: 9, from: 6 },
      },
    ]);
  });

  it("bounds: 1..14 only (function and CHECK)", async () => {
    for (const bad of [0, 15, -1, 1000, null]) {
      await expect(
        asCaller(t.api, as("member"), (tx) => tx.query("SELECT app.set_member_goal($1)", [bad])),
      ).rejects.toMatchObject({ code: "22023", message: "invalid_goal" });
    }
    for (const ok of [1, 14]) {
      await asCaller(t.api, as("member"), (tx) => tx.query("SELECT app.set_member_goal($1)", [ok]));
    }
    // The CHECK holds even for the table owner path.
    await expect(
      t.admin.query("UPDATE app.member_goal SET weekly_trainings = 15 WHERE member_id = $1", [
        t.fx.A.members[0],
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      t.admin.query("UPDATE app.member_goal SET weekly_trainings = 0 WHERE member_id = $1", [
        t.fx.A.members[0],
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("hostile input: a non-integer goal is refused before it reaches the row", async () => {
    await expect(
      asCaller(t.api, as("member"), (tx) =>
        tx.query("SELECT app.set_member_goal($1)", ["4; DROP TABLE x"]),
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("only the member: guardian, every staff role and a caller without claims are refused", async () => {
    for (const role of ROLES.filter((r) => r !== "member")) {
      await expect(
        asCaller(t.api, as(role), (tx) => tx.query("SELECT app.set_member_goal(5)")),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
    const c = await t.api.pool.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE app_authenticated");
      await expect(c.query("SELECT app.set_member_goal(5)")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    // The ward's goal is untouched by the guardian's attempt.
    const w = await t.admin.query(
      "SELECT weekly_trainings FROM app.member_goal WHERE member_id = $1",
      [wards.A],
    );
    expect(w.rows[0]?.weekly_trainings).toBe(2);
  });

  it("a person with no member row in the org (staff person forging role member) is refused", async () => {
    const forged = t.claims(t.fx.A, "member", t.fx.A.people.owner);
    await expect(
      asCaller(t.api, forged, (tx) => tx.query("SELECT app.set_member_goal(5)")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the member's own person under a non-member role (staff or guardian claim) cannot set the goal", async () => {
    for (const role of ["front_desk", "owner", "guardian"] as Role[]) {
      const claims = t.claims(t.fx.A, role, t.fx.A.people.member);
      await expect(
        asCaller(t.api, claims, (tx) => tx.query("SELECT app.set_member_goal(11)")),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("CONCURRENCY: two saves of the same member's goal queue on the row; one row, last write wins", async () => {
    const m = t.fx.A.members[0];
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, as("member"));
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as("member"));
      await c1.query("SELECT app.set_member_goal(7)");
      let settled = false;
      const second = c2.query("SELECT app.set_member_goal(8)").finally(() => {
        settled = true;
      });
      await sleep(300);
      expect(settled, "the second save must wait for the first").toBe(false);
      await c1.query("COMMIT");
      await second;
      await c2.query("COMMIT");
    } finally {
      await c1.query("ROLLBACK").catch(() => undefined);
      await c2.query("ROLLBACK").catch(() => undefined);
      c1.release();
      c2.release();
    }
    const r = await t.admin.query(
      "SELECT weekly_trainings FROM app.member_goal WHERE member_id = $1",
      [m],
    );
    expect(r.rows).toEqual([{ weekly_trainings: 8 }]);
    const audit = await t.admin.query(
      `SELECT meta FROM app.audit_log WHERE action = 'member_goal.set' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
      [m],
    );
    expect(audit.rows[0]?.meta).toEqual({ weekly_trainings: 8, from: 7 });
  });
});

describe("app.portal_acting_member", () => {
  const acting = (claims: ReturnType<typeof as>, id: string | null) =>
    asCaller(
      t.api,
      claims,
      async (tx) =>
        (await tx.query<{ m: string | null }>("SELECT app.portal_acting_member($1) AS m", [id]))
          .rows[0]?.m,
    );

  it("member: own row with or without member_id; anyone else → NULL", async () => {
    expect(await acting(as("member"), null)).toBe(t.fx.A.members[0]);
    expect(await acting(as("member"), t.fx.A.members[0])).toBe(t.fx.A.members[0]);
    expect(await acting(as("member"), t.fx.A.members[1])).toBeNull();
    expect(await acting(as("member"), wards.A)).toBeNull();
    expect(await acting(as("member"), t.fx.B.members[0])).toBeNull();
  });

  it("guardian: the ward (default or named); a non-ward → NULL", async () => {
    expect(await acting(as("guardian"), null)).toBe(wards.A);
    expect(await acting(as("guardian"), wards.A)).toBe(wards.A);
    expect(await acting(as("guardian"), t.fx.A.members[0])).toBeNull();
    expect(await acting(as("guardian"), wards.B)).toBeNull();
  });

  it("a guardian claim cannot act as the member role and vice versa (role is part of the rule)", async () => {
    // The ward's guardian person presenting role=member gets no member row of their own.
    await expect(
      acting(t.claims(t.fx.A, "member", t.fx.A.people.guardian), null),
    ).rejects.toMatchObject({
      code: "42501",
    });
    expect(await acting(t.claims(t.fx.A, "member", t.fx.A.people.guardian), wards.A)).toBeNull();
  });

  it("every staff role is refused", async () => {
    for (const role of ROLES.filter((r) => r !== "member" && r !== "guardian")) {
      await expect(acting(as(role), null), role).rejects.toMatchObject({ code: "42501" });
      await expect(acting(as(role), t.fx.A.members[0]), role).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
});

describe("challenge_perk", () => {
  let chOrgWide: string;
  let chLoc0: string;
  let chB: string;
  beforeAll(async () => {
    const mk = async (org: OrgFixture, name: string, loc: string | null) =>
      (
        await t.admin.query<{ id: string }>(
          `INSERT INTO app.challenge (org_id, name, kind, metric, location_id, starts_on, ends_on, goal, created_by)
           VALUES ($1, $2, 'individual', 'visits', $3, current_date, current_date + 30, 10, $4) RETURNING id`,
          [org.orgId, name, loc, org.people.owner],
        )
      ).rows[0]?.id as string;
    chOrgWide = await mk(t.fx.A, "Reto Perks Org", null);
    chLoc0 = await mk(t.fx.A, "Reto Perks Sede", t.fx.A.locations[0]);
    chB = await mk(t.fx.B, "Reto Perks B", null);
  });
  const add = (role: Role, challenge: string, position: number, label: string, org = t.fx.A) =>
    asCaller(t.api, as(role, org), (tx) =>
      tx.query(
        "INSERT INTO app.challenge_perk (challenge_id, position, label) VALUES ($1, $2, $3)",
        [challenge, position, label],
      ),
    );

  it("owner adds perks to any challenge; created_by and org are forced from the claims", async () => {
    await add("owner", chOrgWide, 1, "Entrenamiento guiado");
    await add("owner", chOrgWide, 2, "Nutrición sugerida por especialista con licencia");
    const r = await t.admin.query(
      "SELECT org_id, created_by, label FROM app.challenge_perk WHERE challenge_id = $1 ORDER BY position",
      [chOrgWide],
    );
    expect(r.rows.map((x) => x.label)).toEqual([
      "Entrenamiento guiado",
      "Nutrición sugerida por especialista con licencia",
    ]);
    for (const x of r.rows)
      expect(x).toMatchObject({ org_id: t.fx.A.orgId, created_by: t.fx.A.people.owner });
  });

  it("location manager: own location's challenge yes; org-wide challenge no", async () => {
    await add("location_manager", chLoc0, 1, "Seguimiento de progreso");
    await expect(
      add("location_manager", chOrgWide, 3, "Reconocimiento y premios"),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("every other role, and the other org, cannot add perks", async () => {
    for (const role of [
      "front_desk",
      "trainer",
      "nutritionist",
      "chef",
      "clinician",
      "accountant",
      "member",
      "guardian",
    ] as Role[])
      await expect(add(role, chLoc0, 5, "Reconocimiento y premios"), role).rejects.toMatchObject({
        code: "42501",
      });
    await expect(
      add("owner", chOrgWide, 6, "Reconocimiento y premios", t.fx.B),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("forbidden columns: created_by / org_id / id cannot be written", async () => {
    await asCaller(t.api, as("owner"), async (tx) => {
      await refused(
        tx,
        "INSERT INTO app.challenge_perk (challenge_id, position, label, created_by) VALUES ($1, 4, 'Premios', $2)",
        [chOrgWide, t.fx.A.people.member],
        "42501",
      );
      // Even the caller's own person id: the column is not grantable at all.
      await refused(
        tx,
        "INSERT INTO app.challenge_perk (challenge_id, position, label, created_by) VALUES ($1, 4, 'Premios', $2)",
        [chOrgWide, t.fx.A.people.owner],
        "42501",
      );
      await refused(
        tx,
        "INSERT INTO app.challenge_perk (org_id, challenge_id, position, label) VALUES ($1, $2, 4, 'Premios')",
        [t.fx.A.orgId, chOrgWide],
        "42501",
      );
      await refused(tx, "UPDATE app.challenge_perk SET label = 'Otro'", [], "42501");
    });
  });

  it("hostile content is refused by the CHECK (links, phones, regulated titles, markup, homoglyphs)", async () => {
    const title = `${"nutri"}${"cionista"}`;
    for (const bad of [
      "Visita https://x.example",
      "Llama al 787-555-0101",
      `Plan con ${title}`,
      "Pierde 10 libras",
      "<b>Premio</b>",
      "Prеmios",
      "x",
    ])
      await expect(add("owner", chOrgWide, 7, bad), bad).rejects.toMatchObject({ code: "23514" });
    await expect(add("owner", chOrgWide, 9, "Fuera de rango")).rejects.toMatchObject({
      code: "23514",
    });
    await expect(add("owner", chOrgWide, 1, "Duplicada")).rejects.toMatchObject({ code: "23505" });
  });

  it("visibility follows the challenge: members see perks; chef/clinical roles and the other org do not", async () => {
    const seen = (role: Role, org = t.fx.A) =>
      asCaller(
        t.api,
        as(role, org),
        async (tx) =>
          (
            await tx.query("SELECT label FROM app.challenge_perk WHERE challenge_id = $1", [
              chOrgWide,
            ])
          ).rowCount,
      );
    expect(await seen("member")).toBe(2);
    expect(await seen("guardian")).toBe(2);
    expect(await seen("front_desk")).toBe(2);
    for (const role of ["chef", "nutritionist", "clinician", "accountant"] as Role[])
      expect(await seen(role), role).toBe(0);
    for (const role of ROLES) expect(await seen(role, t.fx.B), role).toBe(0);
    const bSees = await asCaller(
      t.api,
      as("member", t.fx.B),
      async (tx) =>
        (await tx.query("SELECT 1 FROM app.challenge_perk WHERE challenge_id = $1", [chB]))
          .rowCount,
    );
    expect(bSees).toBe(0);
  });

  it("delete: owner yes; trainer and member delete nothing", async () => {
    for (const role of ["trainer", "member"] as Role[]) {
      const n = await asCaller(t.api, as(role), async (tx) => {
        await tx.query("SAVEPOINT d");
        try {
          return (
            await tx.query("DELETE FROM app.challenge_perk WHERE challenge_id = $1", [chOrgWide])
          ).rowCount;
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT d");
          return (e as { code?: string }).code;
        }
      });
      expect([0, "42501"], role).toContain(n);
    }
    const n = await asCaller(
      t.api,
      as("owner"),
      async (tx) =>
        (await tx.query("DELETE FROM app.challenge_perk WHERE challenge_id = $1", [chOrgWide]))
          .rowCount,
    );
    expect(n).toBe(2);
  });
});
