/**
 * Regression tests for the independent security review of schedule, health and finance. Each test fails if its fix
 * is undone (mutation-checked when added).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  expect(p).rejects.toMatchObject(msg ? { code, message: expect.stringMatching(msg) } : { code });

let splitVendor: string | undefined;
async function bill(amount: number, n: string): Promise<string> {
  const A = t.fx.A;
  splitVendor ??= (
    await t.admin.query<{ id: string }>(
      "INSERT INTO app.vendor (org_id, name, created_by) VALUES ($1, 'Demo Split', $2) RETURNING id",
      [A.orgId, A.people.owner],
    )
  ).rows[0]?.id;
  const v = { rows: [{ id: splitVendor }] };
  const r = await t.admin.query<{ id: string }>(
    `INSERT INTO app.bill (org_id, vendor_id, location_id, number, issued_on, due_on, amount_cents, created_by)
     VALUES ($1, $2, $3, $4, current_date, current_date + 30, $5, $6) RETURNING id`,
    [A.orgId, v.rows[0]?.id, A.locations[0], n, amount, A.people.owner],
  );
  return r.rows[0]?.id as string;
}

describe("finance M1 — a bill cannot be split under the manager threshold", () => {
  it("the second $300 bill from the same vendor exceeds the $500 manager limit", async () => {
    const b1 = await bill(30000, "SPLIT-1");
    const b2 = await bill(30000, "SPLIT-2");
    const mgr = t.claims(t.fx.A, "location_manager");
    await asCaller(t.api, mgr, (tx) =>
      tx.query("SELECT app.decide_bill($1, 'approve', NULL)", [b1]),
    );
    await asCaller(t.api, mgr, async (tx) => {
      await rejects(
        tx.query("SELECT app.decide_bill($1, 'approve', NULL)", [b2]),
        "42501",
        /above_threshold/,
      );
    });
  });
});

describe("finance M2 — expenses above the threshold are owner-only", () => {
  it("a manager cannot record a $600 expense or a $600 recurring template; the owner can", async () => {
    const A = t.fx.A;
    await asCaller(t.api, t.claims(A, "location_manager"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await rejects(
        tx.query(
          "INSERT INTO app.expense (location_id, category, amount_cents, spent_on) VALUES ($1, 'other', 60000, current_date)",
          [A.locations[0]],
        ),
        "42501",
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      const u = await tx.query("UPDATE app.recurring_expense SET amount_cents = 60000");
      expect(u.rowCount).toBe(0);
    });
    await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      tx.query(
        "INSERT INTO app.expense (location_id, category, amount_cents, spent_on) VALUES ($1, 'other', 60000, current_date)",
        [A.locations[0]],
      ),
    );
  });
});

describe("health M3 — changing a licence number drops its verification", () => {
  it("an owner editing a verified licence leaves it unverified", async () => {
    const A = t.fx.A;
    await t.admin.query(
      "UPDATE app.staff_member SET license_no = 'DEMO-N-9', license_verified_at = now() WHERE org_id = $1 AND role = 'nutritionist'",
      [A.orgId],
    );
    await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      tx.query("UPDATE app.staff_member SET license_no = 'FAKE-999' WHERE role = 'nutritionist'"),
    );
    const r = await t.admin.query(
      "SELECT license_no, license_verified_at FROM app.staff_member WHERE org_id = $1 AND role = 'nutritionist'",
      [A.orgId],
    );
    expect(r.rows[0]).toEqual({ license_no: "FAKE-999", license_verified_at: null });
  });
});

describe("schedule L1 — a QR token admits one check-in", () => {
  it("the same token scanned twice is refused the second time", async () => {
    const A = t.fx.A;
    const p = await t.admin.query<{ id: string }>(
      "INSERT INTO app.person (email) VALUES ('qr.once@demo.invalid') RETURNING id",
    );
    const m = await t.admin.query<{ id: string }>(
      "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,'Demo QR','active') RETURNING id",
      [A.orgId, p.rows[0]?.id, A.locations[0]],
    );
    const tok = await asCaller(
      t.api,
      t.claims(A, "member", p.rows[0]?.id),
      async (tx) =>
        (await tx.query("SELECT token FROM app.my_qr_token($1)", [m.rows[0]?.id])).rows[0]
          .token as string,
    );
    const scan = () =>
      asCaller(
        t.api,
        t.claims(A, "front_desk"),
        async (tx) =>
          (
            await tx.query("SELECT result, reason FROM app.check_in($1, NULL, $2)", [
              A.locations[0],
              tok,
            ])
          ).rows[0],
      );
    expect(await scan()).toMatchObject({ result: "allowed" });
    expect(await scan()).toEqual({ result: "denied", reason: "token_used" });
  });
});
