import { ORG_WIDE_ROLES, ROLES, type Role, STAFF_ROLES } from "@gym/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signClaims, withClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

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
  "consent",
  "message_policy",
  "outbound_message",
  "inbound_message",
];

function orgs(): Array<[string, OrgFixture, OrgFixture]> {
  return [
    ["A", t.fx.A, t.fx.B],
    ["B", t.fx.B, t.fx.A],
  ];
}

describe("connection hardening", () => {
  it("withClaims refuses to report success when the transaction was silently rolled back", async () => {
    await expect(
      withClaims(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
        await tx.query("SELECT 1/0").catch(() => undefined); // error swallowed by the caller
        return "looks fine";
      }),
    ).rejects.toThrow(/transaction aborted/);
  });

  it("request traffic runs as app_authenticated without BYPASSRLS", async () => {
    const r = await asCaller(
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
    const c = await t.api.pool.connect();
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
    await asCaller(t.api, t.claims(mine, role), async (tx) => {
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
    await asCaller(t.api, t.claims(mine, role), async (tx) => {
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
      await asCaller(t.api, t.claims(A, role as Role), async (tx) => {
        const locs = await tx.query("SELECT id FROM app.location");
        expect(locs.rows.map((r) => r.id)).toEqual([A.locations[0]]);
        const members = await tx.query("SELECT home_location_id FROM app.member");
        expect(members.rowCount).toBeGreaterThan(0);
        for (const m of members.rows) expect(m.home_location_id).toBe(A.locations[0]);
      });
    },
  );

  it.each(ORG_WIDE_ROLES.map((r) => [r]))("%s sees every location of the org", async (role) => {
    await asCaller(t.api, t.claims(t.fx.A, role as Role), async (tx) => {
      expect((await tx.query("SELECT id FROM app.location")).rowCount).toBe(2);
    });
  });

  it("front desk cannot register a member at an unassigned location of its own org", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
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
      await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
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
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const { rows } = await tx.query("SELECT id FROM app.member");
      expect(rows.map((r) => r.id)).toEqual([t.fx.A.members[0]]);
    });
  });

  it("a guardian sees only their ward", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "guardian"), async (tx) => {
      const { rows } = await tx.query(
        "SELECT m.full_name FROM app.member m JOIN app.person p ON p.id = m.person_id",
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
      await asCaller(t.api, t.claims(org, "member", sharedPersonId), async (tx) => {
        const { rows } = await tx.query("SELECT id, org_id FROM app.member");
        expect(rows).toEqual([{ id: expected, org_id: org.orgId }]);
      });
    }
  });

  it("registering an email that exists in another org links the person without exposing the other org", async () => {
    const id = await asCaller(t.api, t.claims(t.fx.B, "front_desk"), async (tx) => {
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
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), (tx) =>
      tx.query("SELECT app.register_member('audited@demo.invalid', 'Audited', NULL, $1)", [
        t.fx.A.locations[0],
      ]),
    );
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
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
    await asCaller(t.api, t.claims(t.fx.A, "trainer"), async (tx) => {
      await expect(
        tx.query(
          "INSERT INTO app.audit_log (action, entity, actor_role) VALUES ('x', 'y', 'owner')",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

// Regression tests for the independent security review of cycle 1 (findings HIGH-1 … LOW-8).
describe("security review regressions", () => {
  it("HIGH-1: registering another org's email exposes and changes none of that org's data", async () => {
    await asCaller(t.api, t.claims(t.fx.B, "front_desk"), async (tx) => {
      await tx.query(
        "SELECT app.register_member('member.a@demo.invalid', 'Planted by B', '+1-000', $1)",
        [t.fx.B.locations[0]],
      );
      const leaked = await tx.query(
        "SELECT full_name, phone FROM app.member WHERE full_name = 'Demo member A'",
      );
      expect(leaked.rowCount).toBe(0);
      const cols = await tx.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='person'",
      );
      expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["email", "id"]);
    });
    const a = await t.admin.query("SELECT full_name, phone FROM app.member WHERE id = $1", [
      t.fx.A.members[0],
    ]);
    expect(a.rows[0]).toEqual({ full_name: "Demo member A", phone: "+1-787-555-0101" });
  });

  it("HIGH-2: nobody can repoint member.person_id or member.org_id", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query("UPDATE app.member SET person_id = $1 WHERE id = $2", [
          t.fx.B.people.owner,
          t.fx.A.members[0],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        tx.query("UPDATE app.member SET org_id = $1 WHERE id = $2", [
          t.fx.B.orgId,
          t.fx.A.members[0],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("HIGH-3: an owner cannot change the SaaS plan, Stripe account or licence verification", async () => {
    for (const sql of [
      "UPDATE app.organization SET saas_plan = 'elite'",
      "UPDATE app.legal_entity SET stripe_account_id = 'acct_x'",
      "UPDATE app.staff_member SET license_verified_at = now()",
    ]) {
      await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
        await expect(tx.query(sql)).rejects.toMatchObject({ code: "42501" });
      });
    }
  });

  it("HIGH-4: rewriting the claims from SQL yields nothing", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      const forged = JSON.stringify({
        sub: t.fx.B.people.owner,
        org_id: t.fx.B.orgId,
        app_role: "owner",
        location_ids: [],
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [forged]);
      expect((await tx.query("SELECT app.org_id() AS o")).rows[0].o).toBeNull();
      expect((await tx.query("SELECT 1 FROM app.member")).rowCount).toBe(0);
      // A signature made with a wrong key is rejected as well.
      await tx.query("SELECT set_config('request.jwt.claims_sig', $1, true)", [
        signClaims(forged, Buffer.alloc(32, 1), 0, "0"),
      ]);
      expect((await tx.query("SELECT 1 FROM app.organization")).rowCount).toBe(0);
    });
  });

  it("HIGH-4: request traffic cannot read the claims key", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(tx.query("SELECT key FROM app_private.claims_key")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("MEDIUM-5 / N3: audit rows cannot be inserted, backdated or forged by request traffic", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query("INSERT INTO app.audit_log (action, entity, at) VALUES ('x', 'y', '2001-01-01')"),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        tx.query("SELECT app.audit('member.status', 'member', NULL, $1, '{}')", [
          t.fx.A.locations[1],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("member changes are audited by trigger with the real actor and time", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), (tx) =>
      tx.query("UPDATE app.member SET status = 'frozen' WHERE id = $1", [t.fx.A.members[0]]),
    );
    const r = await t.admin.query(
      "SELECT actor_role, meta, at > now() - interval '1 minute' AS fresh FROM app.audit_log WHERE action = 'member.update' AND entity_id = $1",
      [t.fx.A.members[0]],
    );
    expect(r.rows[0]).toEqual({
      actor_role: "front_desk",
      meta: { status: "frozen" },
      fresh: true,
    });
  });

  it("N1: a captured claims/signature pair cannot be replayed in another transaction", async () => {
    const captured = await asCaller(t.api, t.claims(t.fx.B, "owner"), async (tx) => {
      const r = await tx.query(
        "SELECT current_setting('request.jwt.claims') AS c, current_setting('request.jwt.claims_sig') AS s",
      );
      return r.rows[0] as { c: string; s: string };
    });
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      await tx.query(
        "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claims_sig', $2, true)",
        [captured.c, captured.s],
      );
      expect((await tx.query("SELECT app.org_id() AS o")).rows[0].o).toBeNull();
      expect((await tx.query("SELECT 1 FROM app.member")).rowCount).toBe(0);
    });
  });

  it("N1: expired claims are rejected inside Postgres even with a valid signature", async () => {
    const expired = { ...t.claims(t.fx.A, "owner"), exp: Math.floor(Date.now() / 1000) - 1 };
    await asCaller(t.api, expired, async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.organization")).rowCount).toBe(0);
    });
  });

  it("N2: staff rows are created only through add_staff, which exposes nothing", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await expect(
        tx.query(
          "INSERT INTO app.staff_member (person_id, role, display_name) VALUES ($1, 'trainer', 'x')",
          [t.fx.B.people.owner],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await tx.query(
        "SELECT app.add_staff('new.coach@demo.invalid', 'Demo Coach', 'trainer', NULL)",
      );
      const names = await tx.query(
        "SELECT display_name FROM app.staff_member WHERE display_name = 'Demo Coach'",
      );
      expect(names.rowCount).toBe(1);
    });
    await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) => {
      await expect(
        tx.query("SELECT app.add_staff('x@demo.invalid', 'X', 'trainer', NULL)"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("person.created_at is not readable by request traffic", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(tx.query("SELECT created_at FROM app.person")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("MEDIUM-6: front desk cannot link a guardian to a member outside its locations", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      await expect(
        tx.query("INSERT INTO app.guardian_link (guardian_person_id, member_id) VALUES ($1, $2)", [
          t.fx.A.people.guardian,
          t.fx.A.members[1],
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("LOW-8: scoped staff see only staff assignments of their own locations", async () => {
    // Add a trainer assigned only to location 2.
    const p = await t.admin.query(
      "INSERT INTO app.person (email) VALUES ('trainer2.a@demo.invalid') RETURNING id",
    );
    const sm = await t.admin.query(
      "INSERT INTO app.staff_member (org_id, person_id, role, display_name) VALUES ($1,$2,'trainer','Demo trainer2 A') RETURNING id",
      [t.fx.A.orgId, p.rows[0].id],
    );
    await t.admin.query(
      "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1,$2,$3)",
      [t.fx.A.orgId, sm.rows[0].id, t.fx.A.locations[1]],
    );
    await asCaller(t.api, t.claims(t.fx.A, "trainer"), async (tx) => {
      const locs = await tx.query("SELECT DISTINCT location_id FROM app.staff_location");
      expect(locs.rows.map((r) => r.location_id)).toEqual([t.fx.A.locations[0]]);
      const names = await tx.query("SELECT display_name FROM app.staff_member");
      expect(names.rows.map((r) => r.display_name)).not.toContain("Demo trainer2 A");
      const emails = await tx.query("SELECT email FROM app.person");
      expect(emails.rows.map((r) => r.email)).not.toContain("trainer2.a@demo.invalid");
    });
  });

  it("people cannot change their global email from request traffic", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      await expect(
        tx.query("UPDATE app.person SET email = 'x@demo.invalid'"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
