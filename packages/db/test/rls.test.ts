import { ORG_WIDE_ROLES, ROLES, type Role, STAFF_ROLES } from "@gym/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const ORG_SCOPED_TABLES = [
  "legal_entity",
  "brand",
  "location",
  "member",
  "staff_member",
  "staff_location",
  "guardian_link",
  "audit_log",
];

function orgs(): Array<[string, OrgFixture, OrgFixture]> {
  return [
    ["A", t.fx.A, t.fx.B],
    ["B", t.fx.B, t.fx.A],
  ];
}

describe("connection hardening", () => {
  it("request traffic runs as app_authenticated without BYPASSRLS", async () => {
    const r = await withClaims(
      t.api,
      t.claims(t.fx.A, "owner"),
      async (tx) =>
        (
          await tx.query(
            "SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS b",
          )
        ).rows[0],
    );
    expect(r).toEqual({ u: "app_authenticated", b: false });
  });

  it("the API login role cannot read tables without switching role (fails closed)", async () => {
    const c = new pg.Client({ connectionString: t.apiUrl });
    await c.connect();
    await expect(c.query("SELECT * FROM app.member")).rejects.toMatchObject({ code: "42501" });
    await c.end();
  });

  it("no claims means no rows", async () => {
    const c = await t.api.connect();
    await c.query("BEGIN; SET LOCAL ROLE app_authenticated");
    for (const table of ["organization", ...ORG_SCOPED_TABLES, "person"]) {
      const { rowCount } = await c.query(`SELECT 1 FROM app.${table}`);
      expect(rowCount, table).toBe(0);
    }
    await c.query("ROLLBACK");
    c.release();
  });
});

// Matrix: 2 organisations × 10 roles. Every role must see only its own organisation.
describe.each(ROLES.map((r) => [r] as [Role]))("role %s", (role) => {
  it.each(["A", "B"])("org %s: sees only its own organisation in every table", async (label) => {
    const [, mine] = orgs().find(([l]) => l === label) as [string, OrgFixture, OrgFixture];
    await withClaims(t.api, t.claims(mine, role), async (tx) => {
      const org = await tx.query("SELECT id FROM app.organization");
      expect(org.rows.map((r) => r.id)).toEqual([mine.orgId]);
      for (const table of ORG_SCOPED_TABLES) {
        const { rows } = await tx.query(`SELECT DISTINCT org_id FROM app.${table}`);
        for (const r of rows) expect(r.org_id, `${role} ${table}`).toBe(mine.orgId);
      }
    });
  });

  it.each(["A", "B"])("org %s: cannot write into the other organisation", async (label) => {
    const [, mine, other] = orgs().find(([l]) => l === label) as [string, OrgFixture, OrgFixture];
    await withClaims(t.api, t.claims(mine, role), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query("SELECT app.register_member($1, 'X', NULL, $2)", [
          `x-${role}@demo.invalid`,
          other.locations[0],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      const upd = await tx.query("UPDATE app.member SET status = 'cancelled' WHERE id = ANY($1)", [
        other.members,
      ]);
      expect(upd.rowCount).toBe(0);
      const updOrg = await tx.query("UPDATE app.organization SET name = 'pwned' WHERE id = $1", [
        other.orgId,
      ]);
      expect(updOrg.rowCount).toBe(0);
      await expect(
        tx.query(
          "INSERT INTO app.brand (org_id, legal_entity_id, name) VALUES ($1, gen_random_uuid(), 'x')",
          [other.orgId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("location scope", () => {
  const scoped = STAFF_ROLES.filter((r) => !ORG_WIDE_ROLES.includes(r));
  it.each(scoped.map((r) => [r]))(
    "%s sees members and locations only of assigned locations",
    async (role) => {
      const A = t.fx.A;
      await withClaims(t.api, t.claims(A, role as Role), async (tx) => {
        const locs = await tx.query("SELECT id FROM app.location");
        expect(locs.rows.map((r) => r.id)).toEqual([A.locations[0]]);
        const members = await tx.query("SELECT home_location_id FROM app.member");
        expect(members.rowCount).toBeGreaterThan(0);
        for (const m of members.rows) expect(m.home_location_id).toBe(A.locations[0]);
      });
    },
  );

  it.each(ORG_WIDE_ROLES.map((r) => [r]))("%s sees every location of the org", async (role) => {
    await withClaims(t.api, t.claims(t.fx.A, role as Role), async (tx) => {
      expect((await tx.query("SELECT id FROM app.location")).rowCount).toBe(2);
    });
  });

  it("front desk cannot register a member at an unassigned location of its own org", async () => {
    await withClaims(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      await expect(
        tx.query("SELECT app.register_member('loc2@demo.invalid', 'X', NULL, $1)", [
          t.fx.A.locations[1],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("roles outside front of house cannot register members", async () => {
    for (const role of [
      "trainer",
      "nutritionist",
      "chef",
      "clinician",
      "accountant",
      "member",
      "guardian",
    ] as Role[]) {
      await withClaims(t.api, t.claims(t.fx.A, role), async (tx) => {
        await expect(
          tx.query("SELECT app.register_member($1, 'X', NULL, $2)", [
            `no-${role}@demo.invalid`,
            t.fx.A.locations[0],
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    }
  });
});

describe("members, guardians and the global person", () => {
  it("a member sees only their own member row", async () => {
    await withClaims(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const { rows } = await tx.query("SELECT id FROM app.member");
      expect(rows.map((r) => r.id)).toEqual([t.fx.A.members[0]]);
    });
  });

  it("a guardian sees only their ward", async () => {
    await withClaims(t.api, t.claims(t.fx.A, "guardian"), async (tx) => {
      const { rows } = await tx.query(
        "SELECT p.full_name FROM app.member m JOIN app.person p ON p.id = m.person_id",
      );
      expect(rows.map((r) => r.full_name)).toEqual(["Demo ward A"]);
    });
  });

  it("a person who belongs to two orgs sees only the org of the current token", async () => {
    const { A, B, sharedPersonId, sharedMemberIds } = t.fx;
    for (const [org, expected] of [
      [A, sharedMemberIds.A],
      [B, sharedMemberIds.B],
    ] as const) {
      await withClaims(t.api, t.claims(org, "member", sharedPersonId), async (tx) => {
        const { rows } = await tx.query("SELECT id, org_id FROM app.member");
        expect(rows).toEqual([{ id: expected, org_id: org.orgId }]);
      });
    }
  });

  it("registering an email that exists in another org links the person without exposing the other org", async () => {
    const id = await withClaims(t.api, t.claims(t.fx.B, "front_desk"), async (tx) => {
      const r = await tx.query(
        "SELECT app.register_member('member2.a@demo.invalid', 'Ignored', NULL, $1) AS id",
        [t.fx.B.locations[0]],
      );
      const seen = await tx.query("SELECT DISTINCT org_id FROM app.member");
      expect(seen.rows.map((x) => x.org_id)).toEqual([t.fx.B.orgId]);
      return r.rows[0]?.id as string;
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const check = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.person WHERE lower(email) = 'member2.a@demo.invalid'",
    );
    expect(check.rows[0].n).toBe(1);
  });
});

describe("audit log", () => {
  it("register_member writes an audit row the owner can read and nobody can alter", async () => {
    await withClaims(t.api, t.claims(t.fx.A, "front_desk"), (tx) =>
      tx.query("SELECT app.register_member('audited@demo.invalid', 'Audited', NULL, $1)", [
        t.fx.A.locations[0],
      ]),
    );
    await withClaims(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      const { rows } = await tx.query(
        "SELECT action, actor_role FROM app.audit_log WHERE action = 'member.register'",
      );
      expect(rows).toContainEqual({ action: "member.register", actor_role: "front_desk" });
      await tx.query("SAVEPOINT s");
      await expect(tx.query("UPDATE app.audit_log SET action = 'x'")).rejects.toMatchObject({
        code: "42501",
      });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(tx.query("DELETE FROM app.audit_log")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("nobody can forge an audit row for another person or role", async () => {
    await withClaims(t.api, t.claims(t.fx.A, "trainer"), async (tx) => {
      await expect(
        tx.query(
          "INSERT INTO app.audit_log (action, entity, actor_role) VALUES ('x', 'y', 'owner')",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
