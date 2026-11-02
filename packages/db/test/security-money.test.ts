/**
 * Regression tests for the independent security review of the money modules (billing, store, engagement).
 * Each test fails if its fix is undone (mutation-checked when added).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingFx } from "../src/fixtures/billing.js";
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

describe("H1 — org-wide catalogue and loyalty config are owner-only", () => {
  it("a location manager changes no product, price list, rule or reward", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) => {
      for (const sql of [
        "UPDATE app.plan_product SET tax_category = 'exempt', active = false",
        "UPDATE app.product SET taxable = false, price_cents = 0",
        "UPDATE app.points_rule SET points = 10000",
        "UPDATE app.reward SET points_cost = 1",
      ]) {
        expect((await tx.query(sql)).rowCount, sql).toBe(0);
      }
    });
  });
});

describe("M2 — referrals only pay for people who joined after the referral", () => {
  it("referring someone who is already a member is never credited", async () => {
    const existing = await t.admin.query<{ email: string }>(
      "SELECT p.email FROM app.member m JOIN app.person p ON p.id = m.person_id WHERE m.id = $1",
      [t.fx.A.members[0]],
    );
    // The referrer is another member of org A (the fixture's second member).
    const ref = await t.admin.query<{ person_id: string }>(
      "SELECT person_id FROM app.member WHERE id = $1",
      [t.fx.A.members[1]],
    );
    const referral = await asCaller(
      t.api,
      t.claims(t.fx.A, "member", ref.rows[0]?.person_id),
      (tx) =>
        tx.query("SELECT app.create_referral($1, $2) AS id", [
          t.fx.A.members[1],
          existing.rows[0]?.email,
        ]),
    );
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await rejects(
        tx.query("SELECT app.credit_referral($1)", [referral.rows[0].id]),
        "22023",
        /referral_not_joined/,
      );
    });
  });
});

describe("M3 — class and purchase points need a reference", () => {
  it("front desk cannot award class points without naming the booking", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      await rejects(
        tx.query("SELECT app.award_points($1, 'class', NULL)", [t.fx.A.members[0]]),
        "22023",
        /ref_required/,
      );
    });
  });
});

describe("M4 — one member cannot reserve a location's stock", () => {
  it("caps quantity per order, per product across open orders, and the number of open orders", async () => {
    const loc = t.fx.A.locations[0];
    const p = await t.admin.query<{ id: string }>(
      `SELECT pr.id FROM app.product pr JOIN app.inventory_level i ON i.product_id = pr.id
        WHERE pr.org_id = $1 AND i.location_id = $2 AND pr.active AND NOT pr.age_restricted LIMIT 1`,
      [t.fx.A.orgId, loc],
    );
    const pid = p.rows[0]?.id as string;
    await t.admin.query(
      "UPDATE app.inventory_level SET on_hand = 500 WHERE product_id = $1 AND location_id = $2",
      [pid, loc],
    );
    const person = await t.admin.query<{ id: string }>(
      "INSERT INTO app.person (email) VALUES ('m4@demo.invalid') RETURNING id",
    );
    await t.admin.query(
      "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,'Demo M4','active')",
      [t.fx.A.orgId, person.rows[0]?.id, loc],
    );
    const me = t.claims(t.fx.A, "member", person.rows[0]?.id);
    const order = (qty: number) =>
      asCaller(t.api, me, (tx) =>
        tx.query("SELECT app.place_online_order($1, $2::jsonb)", [
          loc,
          JSON.stringify([{ product_id: pid, qty }]),
        ]),
      );
    await rejects(order(6), "22023", /quantity_limit/);
    await order(5);
    await order(5);
    await rejects(order(1), "22023", /quantity_limit/); // 11 units of one product across open orders
  });
});

describe("L5 — freezes are limited cumulatively, not per freeze", () => {
  it("two short freezes cannot add up past the policy limit", async () => {
    const A = t.fx.A;
    const sub = billingFx.A?.subscription as string;
    // Policy: 20 days. The fixture already holds a 10-day freeze 50–60 days ago (inside the 365-day window).
    await t.admin.query("UPDATE app.billing_policy SET max_freeze_days = 20 WHERE org_id = $1", [
      A.orgId,
    ]);
    await t.admin.query(
      `INSERT INTO app.billing_policy (org_id, location_id, max_freeze_days)
       SELECT $1, NULL, 20 WHERE NOT EXISTS (SELECT 1 FROM app.billing_policy WHERE org_id = $1)`,
      [A.orgId],
    );
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      tx.query("SELECT app.freeze_subscription($1, current_date + 1, current_date + 6, 'Demo')", [
        sub,
      ]),
    );
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      await rejects(
        tx.query(
          "SELECT app.freeze_subscription($1, current_date + 8, current_date + 14, 'Demo')",
          [sub],
        ),
        "22023",
        /freeze_limit_reached/,
      );
    });
  });
});

describe("L6 — members cannot read the SaaS plan", () => {
  it("the column is not readable; the function answers staff only", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "member"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await rejects(tx.query("SELECT saas_plan FROM app.organization"), "42501");
      await tx.query("ROLLBACK TO SAVEPOINT s");
      expect((await tx.query("SELECT app.org_saas_plan() AS p")).rows[0].p).toBeNull();
    });
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      expect((await tx.query("SELECT app.org_saas_plan() AS p")).rows[0].p).toBeTruthy();
    });
  });
});
