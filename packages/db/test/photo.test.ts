import { ROLES, type Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Member photo (0023): written only through app.set_member_photo / app.clear_member_photo, read under RLS.
let t: TestDb;
let ward = "";
beforeAll(async () => {
  t = await createTestDb();
  const r = await t.admin.query<{ member_id: string }>(
    "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
    [t.fx.A.people.guardian],
  );
  ward = r.rows[0]?.member_id as string;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (role: Role, org: OrgFixture = t.fx.A) => t.claims(org, role);
const jpeg = (n = 2048) => {
  const b = Buffer.alloc(n, 7);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
};
const webp = (n = 2048) => {
  const b = Buffer.alloc(n, 1);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return b;
};

async function refused(tx: Tx, sql: string, params: unknown[], pgCode: string, msg?: string) {
  await tx.query("SAVEPOINT r");
  await expect(tx.query(sql, params)).rejects.toMatchObject(
    msg ? { code: pgCode, message: msg } : { code: pgCode },
  );
  await tx.query("ROLLBACK TO SAVEPOINT r");
}
const SET = "SELECT app.set_member_photo($1, $2, $3, $4) AS at";

describe("writes", () => {
  it("a member stores their own photo (NULL = self) and replaces it; audited without the image", async () => {
    await asCaller(t.api, as("member"), async (tx) => {
      await tx.query(SET, [null, "image/jpeg", jpeg(), "photo-v1"]);
      await tx.query(SET, [t.fx.A.members[0], "image/webp", webp(4096), "photo-v1"]);
      const { rows } = await tx.query<{ mime: string; n: number }>(
        "SELECT mime, octet_length(data) AS n FROM app.member_photo WHERE member_id = $1",
        [t.fx.A.members[0]],
      );
      expect(rows).toEqual([{ mime: "image/webp", n: 4096 }]);
    });
    const audit = await t.admin.query<{ action: string; meta: Record<string, unknown> }>(
      "SELECT action, meta FROM app.audit_log WHERE entity = 'member_photo' AND entity_id = $1 ORDER BY id",
      [t.fx.A.members[0]],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["member_photo.set", "member_photo.replace"]);
    expect(Object.keys(audit.rows[1]?.meta ?? {}).sort()).toEqual([
      "bytes",
      "consent_version",
      "mime",
    ]);
  });

  it("a member cannot write someone else's photo", async () => {
    await asCaller(t.api, as("member"), (tx) =>
      refused(tx, SET, [t.fx.A.members[1], "image/jpeg", jpeg(), "photo-v1"], "42501"),
    );
  });

  it("front desk / manager / owner of the home location write; other staff roles never do", async () => {
    for (const role of ["front_desk", "location_manager", "owner"] as Role[])
      await asCaller(t.api, as(role), (tx) =>
        tx.query(SET, [ward, "image/jpeg", jpeg(), "photo-v1"]),
      );
    for (const role of [
      "trainer",
      "nutritionist",
      "clinician",
      "chef",
      "accountant",
      "guardian",
    ] as Role[])
      await asCaller(t.api, as(role), (tx) =>
        refused(tx, SET, [ward, "image/jpeg", jpeg(), "photo-v1"], "42501"),
      );
  });

  it("front desk cannot write a member of another location (owner can, org-wide)", async () => {
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(tx, SET, [t.fx.A.members[1], "image/jpeg", jpeg(), "photo-v1"], "42501"),
    );
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query(SET, [t.fx.A.members[1], "image/jpeg", jpeg(), "photo-v1"]),
    );
  });

  it("nobody writes another organisation's member", async () => {
    await asCaller(t.api, as("owner", t.fx.B), (tx) =>
      refused(tx, SET, [t.fx.A.members[0], "image/jpeg", jpeg(), "photo-v1"], "42501"),
    );
  });

  it("size, type, magic bytes and consent are enforced in the database", async () => {
    await asCaller(t.api, as("member"), async (tx) => {
      await refused(tx, SET, [null, "image/jpeg", jpeg(500), "photo-v1"], "22023", "invalid_photo");
      await refused(
        tx,
        SET,
        [null, "image/jpeg", jpeg(160_000), "photo-v1"],
        "22023",
        "invalid_photo",
      );
      await refused(tx, SET, [null, "image/png", jpeg(), "photo-v1"], "22023", "invalid_photo");
      await refused(tx, SET, [null, "image/jpeg", webp(), "photo-v1"], "22023", "invalid_photo");
      await refused(tx, SET, [null, "image/jpeg", jpeg(), null], "22023", "photo_consent_required");
      await refused(
        tx,
        SET,
        [null, "image/jpeg", jpeg(), "yes"],
        "22023",
        "photo_consent_required",
      );
    });
  });

  it("request traffic cannot write the table directly", async () => {
    await asCaller(t.api, as("owner"), async (tx) => {
      await refused(
        tx,
        "UPDATE app.member_photo SET consent_version = 'photo-v9' WHERE member_id = $1",
        [ward],
        "42501",
      );
      await refused(tx, "DELETE FROM app.member_photo WHERE member_id = $1", [ward], "42501");
    });
  });
});

describe("reads (RLS)", () => {
  const visible = (role: Role, org: OrgFixture = t.fx.A) =>
    asCaller(t.api, as(role, org), async (tx) =>
      (await tx.query<{ member_id: string }>("SELECT member_id FROM app.member_photo")).rows
        .map((r) => r.member_id)
        .sort(),
    );

  it("member: own; guardian: ward; desk roles of the location; owner org-wide; others none", async () => {
    expect(await visible("member")).toEqual([t.fx.A.members[0]]);
    expect(await visible("guardian")).toEqual([ward]);
    const loc0 = [t.fx.A.members[0], ward].sort();
    for (const role of ["front_desk", "location_manager", "trainer"] as Role[])
      expect(await visible(role), role).toEqual(loc0);
    expect(await visible("owner")).toEqual([t.fx.A.members[0], t.fx.A.members[1], ward].sort());
    for (const role of ["accountant", "nutritionist", "clinician", "chef"] as Role[])
      expect(await visible(role), role).toEqual([]);
    // Org B sees only its own fixture photo, never org A's.
    const a = new Set([t.fx.A.members[0], t.fx.A.members[1], ward]);
    for (const role of ROLES)
      expect(
        (await visible(role, t.fx.B)).filter((id) => a.has(id)),
        `B ${role}`,
      ).toEqual([]);
    expect(await visible("owner", t.fx.B)).toEqual([t.fx.B.members[1]]);
  });
});

describe("clear", () => {
  it("the member removes their photo; a second clear reports nothing removed", async () => {
    await asCaller(t.api, as("member"), async (tx) => {
      const a = await tx.query<{ ok: boolean }>("SELECT app.clear_member_photo(NULL) AS ok");
      const b = await tx.query<{ ok: boolean }>("SELECT app.clear_member_photo(NULL) AS ok");
      expect([a.rows[0]?.ok, b.rows[0]?.ok]).toEqual([true, false]);
    });
    const audit = await t.admin.query(
      "SELECT 1 FROM app.audit_log WHERE action = 'member_photo.clear' AND entity_id = $1",
      [t.fx.A.members[0]],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("a trainer cannot clear", async () => {
    await asCaller(t.api, as("trainer"), (tx) =>
      refused(tx, "SELECT app.clear_member_photo($1)", [ward], "42501"),
    );
  });
});
