import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_SECRET, deviceIdFor } from "../src/fixtures/access.js";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Access (0024): door QR entry/exit, check-out, sign-in codes, opt-in face access through camera gateways.
let t: TestDb;
let member2Person = "";
let optedOutMember = "";
beforeAll(async () => {
  t = await createTestDb();
  const r = await t.admin.query<{ person_id: string }>(
    "SELECT person_id FROM app.member WHERE id = $1",
    [t.fx.A.members[1]],
  );
  member2Person = r.rows[0]?.person_id as string;
  const o = await t.admin.query<{ id: string }>(
    "SELECT id FROM app.member WHERE org_id = $1 AND full_name LIKE 'Demo optedout%'",
    [t.fx.A.orgId],
  );
  optedOutMember = o.rows[0]?.id as string;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (role: Role, org: OrgFixture = t.fx.A) => t.claims(org, role);
async function refused(tx: Tx, sql: string, params: unknown[], code: string, msg?: string) {
  await tx.query("SAVEPOINT r");
  await expect(tx.query(sql, params)).rejects.toMatchObject(
    msg ? { code, message: msg } : { code },
  );
  await tx.query("ROLLBACK TO SAVEPOINT r");
}
const kiosk = async (role: Role, loc: string, org: OrgFixture = t.fx.A) =>
  asCaller(t.api, as(role, org), async (tx) =>
    Object.fromEntries(
      (
        await tx.query<{ direction: string; token: string }>(
          "SELECT direction, token FROM app.door_kiosk($1)",
          [loc],
        )
      ).rows.map((r) => [r.direction, r.token]),
    ),
  );
const pass = async (token: string, claims = as("member")) =>
  asCaller(t.api, claims, async (tx) => {
    const { rows } = await tx.query<{
      result: string;
      direction: string | null;
      full_name: string;
    }>("SELECT result, direction, full_name FROM app.door_pass($1)", [token]);
    return rows[0];
  });

describe("door QR", () => {
  it("front of house of the location gets an entry and an exit code; others are refused", async () => {
    const k = await kiosk("front_desk", t.fx.A.locations[0]);
    expect(k.in).toMatch(/^d1\..+\.i\.\d+\.[0-9a-f]{32}$/);
    expect(k.out).toMatch(/\.o\./);
    for (const [role, loc] of [
      ["trainer", t.fx.A.locations[0]],
      ["member", t.fx.A.locations[0]],
      ["front_desk", t.fx.A.locations[1]],
    ] as [Role, string][])
      await asCaller(t.api, as(role), (tx) =>
        refused(tx, "SELECT * FROM app.door_kiosk($1)", [loc], "42501"),
      );
  });

  it("member: enter → already in → exit → not inside; the visit shows in 'inside' meanwhile", async () => {
    const k = await kiosk("front_desk", t.fx.A.locations[0]);
    expect(await pass(k.in as string)).toMatchObject({ result: "allowed", direction: "in" });
    const inside = await asCaller(t.api, as("front_desk"), async (tx) =>
      (
        await tx.query<{ member_id: string }>("SELECT member_id FROM app.location_inside($1)", [
          t.fx.A.locations[0],
        ])
      ).rows.map((r) => r.member_id),
    );
    expect(inside).toContain(t.fx.A.members[0]);
    expect((await pass(k.in as string))?.result).toBe("already_in");
    expect((await pass(k.out as string))?.result).toBe("checked_out");
    expect((await pass(k.out as string))?.result).toBe("not_in");
  });

  it("forged, other-org and expired codes are rejected; staff cannot pass", async () => {
    const k = await kiosk("front_desk", t.fx.A.locations[0]);
    const forged = `${(k.in as string).slice(0, -1)}${(k.in as string).endsWith("0") ? "1" : "0"}`;
    expect((await pass(forged))?.result).toBe("invalid");
    const kb = await kiosk("front_desk", t.fx.B.locations[0], t.fx.B);
    expect((await pass(kb.in as string))?.result).toBe("invalid");
    const old = await t.admin.query<{ tok: string }>(
      "SELECT app.door_token_for($1, $2, 'i', app.qr_window(now()) - 3) AS tok",
      [t.fx.A.orgId, t.fx.A.locations[0]],
    );
    expect((await pass(old.rows[0]?.tok as string))?.result).toBe("expired");
    expect((await pass("not a token"))?.result).toBe("invalid");
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(tx, "SELECT * FROM app.door_pass($1)", [k.in], "42501"),
    );
  });

  it("front desk closes a visit by hand; the check-out is visible to the member", async () => {
    const k = await kiosk("front_desk", t.fx.A.locations[0]);
    await pass(k.in as string);
    const id = await asCaller(
      t.api,
      as("front_desk"),
      async (tx) =>
        (
          await tx.query<{ id: string }>("SELECT app.check_out_member($1, $2) AS id", [
            t.fx.A.locations[0],
            t.fx.A.members[0],
          ])
        ).rows[0]?.id,
    );
    expect(id).toBeTruthy();
    const mine = await asCaller(
      t.api,
      as("member"),
      async (tx) => (await tx.query("SELECT 1 FROM app.check_out WHERE id = $1", [id])).rowCount,
    );
    expect(mine).toBe(1);
  });
});

describe("sign-in code", () => {
  const email = async (member: string) =>
    (
      await t.admin.query<{ email: string }>(
        "SELECT p.email FROM app.person p JOIN app.member m ON m.person_id = p.id WHERE m.id = $1",
        [member],
      )
    ).rows[0]?.email as string;

  it("issues a code for a member e-mail, accepts it once, counts wrong attempts", async () => {
    const e = await email(t.fx.A.members[0]);
    const s = await t.api.pool.query<{ r: { sent: boolean; code: string } }>(
      "SELECT app_public.login_start($1, $2) AS r",
      [t.fx.A.orgId, e.toUpperCase()],
    );
    expect(s.rows[0]?.r.sent).toBe(true);
    const code = s.rows[0]?.r.code as string;
    const wrong = code === "000000" ? "000001" : "000000";
    const v = (c: string) =>
      t.api.pool.query<{ r: { ok: boolean; member_id?: string } }>(
        "SELECT app_public.login_verify($1, $2, $3) AS r",
        [t.fx.A.orgId, e, c],
      );
    expect((await v(wrong)).rows[0]?.r.ok).toBe(false);
    const ok = (await v(code)).rows[0]?.r;
    expect(ok).toMatchObject({ ok: true, member_id: t.fx.A.members[0] });
    expect((await v(code)).rows[0]?.r.ok).toBe(false); // single use
    // The code is for org A only.
    expect(
      (
        await t.api.pool.query<{ r: { ok: boolean } }>(
          "SELECT app_public.login_verify($1, $2, $3) AS r",
          [t.fx.B.orgId, e, code],
        )
      ).rows[0]?.r.ok,
    ).toBe(false);
  });

  it("unknown e-mail or another org's member → not sent; five codes per 15 minutes", async () => {
    const s = await t.api.pool.query<{ r: { sent: boolean } }>(
      "SELECT app_public.login_start($1, $2) AS r",
      [t.fx.A.orgId, "nobody@demo.invalid"],
    );
    expect(s.rows[0]?.r.sent).toBe(false);
    const eb = await email(t.fx.B.members[0]);
    expect(
      (
        await t.api.pool.query<{ r: { sent: boolean } }>(
          "SELECT app_public.login_start($1, $2) AS r",
          [t.fx.A.orgId, eb],
        )
      ).rows[0]?.r.sent,
    ).toBe(false);
    const e = await email(t.fx.A.members[1]);
    for (let i = 0; i < 5; i++)
      await t.api.pool.query("SELECT app_public.login_start($1, $2)", [t.fx.A.orgId, e]);
    await expect(
      t.api.pool.query("SELECT app_public.login_start($1, $2)", [t.fx.A.orgId, e]),
    ).rejects.toMatchObject({ code: "54000" });
  });

  it("request traffic cannot read the codes", async () => {
    await asCaller(t.api, as("owner"), (tx) =>
      refused(tx, "SELECT * FROM app_private.login_code", [], "42501"),
    );
  });
});

describe("face access", () => {
  const dev = deviceIdFor("A");
  const enrol = (secret = DEVICE_SECRET) =>
    t.api.pool.query<{ r: { enabled: boolean; members: { member_id: string; photo: string }[] } }>(
      "SELECT app_public.device_enrolment($1, $2) AS r",
      [dev, secret],
    );
  const recog = (member: string, score: number, secret = DEVICE_SECRET) =>
    t.api.pool.query<{ r: { outcome: string } }>(
      "SELECT app_public.device_recognition($1, $2, $3, $4, 'in') AS r",
      [dev, secret, member, score],
    );

  it("off by default: the device gets nothing and its reports are refused", async () => {
    expect((await enrol()).rows[0]?.r).toMatchObject({ enabled: false, members: [] });
    expect((await recog(t.fx.A.members[1], 0.9)).rows[0]?.r.outcome).toBe("refused");
  });

  it("only the owner switches it on; a wrong secret is refused", async () => {
    await asCaller(t.api, as("location_manager"), (tx) =>
      refused(tx, "SELECT app.set_face_access($1, true)", [t.fx.A.locations[1]], "42501"),
    );
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.set_face_access($1, true)", [t.fx.A.locations[1]]),
    );
    await expect(enrol("b2".repeat(24))).rejects.toMatchObject({ code: "42501" });
  });

  it("enrolment lists only consenting members of the device's location, with their photo", async () => {
    const r = (await enrol()).rows[0]?.r;
    expect(r?.enabled).toBe(true);
    expect(r?.members.map((m) => m.member_id)).toEqual([t.fx.A.members[1]]);
    expect(r?.members[0]?.photo.length).toBeGreaterThan(100);
  });

  it("high score enters automatically; the same face within 60 s is one event; others are refused", async () => {
    expect((await recog(t.fx.A.members[1], 0.8)).rows[0]?.r.outcome).toBe("checked_in");
    expect((await recog(t.fx.A.members[1], 0.8)).rows[0]?.r.outcome).toBe("duplicate");
    expect((await recog(optedOutMember, 0.95)).rows[0]?.r.outcome).toBe("refused"); // no consent
    expect((await recog(t.fx.A.members[0], 0.95)).rows[0]?.r.outcome).toBe("refused"); // other location
    expect((await recog(t.fx.B.members[1], 0.95)).rows[0]?.r.outcome).toBe("refused"); // other org
    const ci = await t.admin.query(
      "SELECT 1 FROM app.check_in WHERE member_id = $1 AND source = 'door' AND result = 'allowed'",
      [t.fx.A.members[1]],
    );
    expect(ci.rowCount).toBe(1);
  });

  it("front of house reviews a doubtful event; the member's withdrawal stops the device at once", async () => {
    const ev = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.face_event WHERE org_id = $1 AND outcome = 'review'",
      [t.fx.A.orgId],
    );
    await asCaller(
      t.api,
      as("front_desk"),
      (tx) => refused(tx, "SELECT app.review_face_event($1, true)", [ev.rows[0]?.id], "42501"), // other location
    );
    await asCaller(t.api, as("owner"), async (tx) => {
      const r = await tx.query<{ r: string }>("SELECT app.review_face_event($1, false) AS r", [
        ev.rows[0]?.id,
      ]);
      expect(r.rows[0]?.r).toBe("dismissed");
      await refused(
        tx,
        "SELECT app.review_face_event($1, true)",
        [ev.rows[0]?.id],
        "22023",
        "already_reviewed",
      );
    });
    const m2 = t.claims(t.fx.A, "member", member2Person);
    await asCaller(t.api, m2, (tx) => tx.query("SELECT app.set_biometric_consent(false, NULL)"));
    expect((await enrol()).rows[0]?.r.members).toEqual([]);
    await asCaller(t.api, m2, (tx) =>
      tx.query("SELECT app.set_biometric_consent(true, 'face-v1')"),
    );
    expect((await enrol()).rows[0]?.r.members.length).toBe(1);
  });

  it("only the member gives consent; staff never can", async () => {
    for (const role of ["owner", "front_desk", "guardian"] as Role[])
      await asCaller(t.api, as(role), (tx) =>
        refused(tx, "SELECT app.set_biometric_consent(true, 'face-v1')", [], "42501"),
      );
  });

  it("devices: the secret is shown once and its hash is never readable", async () => {
    const created = await asCaller(
      t.api,
      as("owner"),
      async (tx) =>
        (
          await tx.query<{ id: string; secret: string }>(
            "SELECT * FROM app.create_door_device($1, 'Cámara salida', 'out')",
            [t.fx.A.locations[1]],
          )
        ).rows[0],
    );
    expect(created?.secret).toMatch(/^[0-9a-f]{48}$/);
    await asCaller(t.api, as("owner"), (tx) =>
      refused(tx, "SELECT secret_hash FROM app.door_device", [], "42501"),
    );
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(
        tx,
        "SELECT * FROM app.create_door_device($1, 'x camera', 'in')",
        [t.fx.A.locations[0]],
        "42501",
      ),
    );
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.revoke_door_device($1)", [created?.id]),
    );
    await expect(
      t.api.pool.query("SELECT app_public.device_enrolment($1, $2)", [
        created?.id,
        created?.secret,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("devices that always need front-desk confirmation (0025)", () => {
  it("a review-only camera never records automatically, whatever the score", async () => {
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.set_face_access($1, true)", [t.fx.A.locations[1]]),
    );
    const d = await asCaller(
      t.api,
      as("owner"),
      async (tx) =>
        (
          await tx.query<{ id: string; secret: string }>(
            "SELECT * FROM app.create_door_device($1, 'Wyze puerta', 'in', true)",
            [t.fx.A.locations[1]],
          )
        ).rows[0],
    );
    const enr = await t.api.pool.query<{ r: { requires_review: boolean } }>(
      "SELECT app_public.device_enrolment($1, $2) AS r",
      [d?.id, d?.secret],
    );
    expect(enr.rows[0]?.r.requires_review).toBe(true);
    // members[1] may already be inside from earlier tests: close the visit first.
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.check_out_member($1, $2)", [t.fx.A.locations[1], t.fx.A.members[1]]),
    );
    const r = await t.api.pool.query<{ r: { outcome: string } }>(
      "SELECT app_public.device_recognition($1, $2, $3, 0.99, 'in') AS r",
      [d?.id, d?.secret, t.fx.A.members[1]],
    );
    expect(r.rows[0]?.r.outcome).toBe("review");
    const open = await t.admin.query("SELECT app.access_open_visit($1, $2, $3) AS v", [
      t.fx.A.orgId,
      t.fx.A.locations[1],
      t.fx.A.members[1],
    ]);
    expect(open.rows[0]?.v).toBeNull();
  });

  it("owner / manager switch the policy; front desk cannot", async () => {
    const dev = deviceIdFor("A");
    await asCaller(t.api, as("front_desk"), (tx) =>
      refused(tx, "SELECT app.set_device_review($1, true)", [dev], "42501"),
    );
    await asCaller(t.api, as("owner"), (tx) =>
      tx.query("SELECT app.set_device_review($1, true)", [dev]),
    );
    const row = await t.admin.query<{ requires_review: boolean }>(
      "SELECT requires_review FROM app.door_device WHERE id = $1",
      [dev],
    );
    expect(row.rows[0]?.requires_review).toBe(true);
  });
});
