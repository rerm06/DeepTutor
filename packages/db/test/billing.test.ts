import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingFx } from "../src/fixtures/billing.js";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
let today: string;
beforeAll(async () => {
  t = await createTestDb();
  today = (
    await t.admin.query("SELECT ((now() AT TIME ZONE 'America/Puerto_Rico')::date)::text AS d")
  ).rows[0].d;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const A = () => t.fx.A;
const B = () => t.fx.B;
const bfx = (label: "A" | "B") => {
  const f = billingFx[label];
  if (!f) throw new Error("billing fixture missing");
  return f;
};
const as = (role: Role, org: OrgFixture = A()) => t.claims(org, role);

let seq = 0;
/** A fresh member (status lead) owned by one test, so tests never share mutable state. */
async function newMember(org: OrgFixture, locIdx: 0 | 1 = 0): Promise<string> {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`billing.${seq}.${Date.now()}@demo.invalid`],
  );
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,'lead') RETURNING id",
    [org.orgId, p.rows[0]?.id, org.locations[locIdx], `Demo Billing ${seq}`],
  );
  return m.rows[0]?.id as string;
}
/** Claims of the person behind a member row (role member). */
async function memberClaims(org: OrgFixture, memberId: string) {
  const r = await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [memberId]);
  return t.claims(org, "member", r.rows[0].person_id);
}

async function one<T = Record<string, unknown>>(
  claims: ReturnType<typeof as>,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return asCaller(t.api, claims, async (tx) => (await tx.query(sql, params)).rows[0] as T);
}
async function rows(claims: ReturnType<typeof as>, sql: string, params: unknown[] = []) {
  return asCaller(t.api, claims, async (tx) => (await tx.query(sql, params)).rows);
}
async function denied(
  claims: ReturnType<typeof as>,
  sql: string,
  params: unknown[] = [],
  code = "42501",
) {
  await expect(asCaller(t.api, claims, (tx) => tx.query(sql, params))).rejects.toMatchObject({
    code,
  });
}
const adminRow = async (sql: string, params: unknown[] = []) =>
  (await t.admin.query(sql, params)).rows[0];

const SUBSCRIBE = "SELECT app.create_subscription($1, $2, $3, $4) AS id";
const SELL = "SELECT app.sell_one_off($1, $2, $3, $4, $5, $6, NULL) AS id";
const PAY = "SELECT app.record_payment($1, $2, $3, $4, $5, NULL) AS id";
let keyN = 0;
const key = () => `test-key-${Date.now()}-${++keyN}`;

async function subscribe(
  org: OrgFixture,
  member: string,
  price: string,
  role: Role = "front_desk",
) {
  const r = await one<{ id: string }>(as(role, org), SUBSCRIBE, [member, price, null, null]);
  return r.id;
}
async function invoiceOf(sub: string) {
  return adminRow(
    "SELECT * , period_start::text AS ps, period_end::text AS pe, due_date::text AS dd FROM app.invoice WHERE subscription_id = $1 ORDER BY number DESC LIMIT 1",
    [sub],
  );
}

describe("catalogue (E3)", () => {
  it("owner creates products and org-wide prices; a location manager only prices of an assigned location", async () => {
    const product = await one<{ id: string }>(
      as("owner"),
      "INSERT INTO app.plan_product (kind, name) VALUES ('drop_in', 'Sesión funcional') RETURNING id",
    );
    await one(
      as("owner"),
      "INSERT INTO app.price (product_id, amount_cents) VALUES ($1, 1800) RETURNING id",
      [product.id],
    );
    const lm = await one<{ id: string }>(
      as("location_manager"),
      "INSERT INTO app.price (product_id, location_id, amount_cents) VALUES ($1, $2, 1700) RETURNING id",
      [product.id, A().locations[0]],
    );
    expect(lm.id).toBeTruthy();
    // Org-wide or another location: refused by the WITH CHECK of the policy.
    await denied(
      as("location_manager"),
      "INSERT INTO app.price (product_id, amount_cents) VALUES ($1, 1700)",
      [product.id],
    );
    await denied(
      as("location_manager"),
      "INSERT INTO app.price (product_id, location_id, amount_cents) VALUES ($1, $2, 1700)",
      [product.id, A().locations[1]],
    );
    // An audit row with the real actor.
    const audit = await adminRow(
      "SELECT actor_role, actor_person_id FROM app.audit_log WHERE entity = 'plan_product' AND entity_id = $1",
      [product.id],
    );
    expect(audit).toEqual({ actor_role: "owner", actor_person_id: A().people.owner });
  });

  it("front desk, trainer, accountant and members cannot write the catalogue", async () => {
    for (const role of ["front_desk", "trainer", "accountant", "member", "chef"] as Role[]) {
      await denied(as(role), "INSERT INTO app.plan_product (kind, name) VALUES ('drop_in', 'X')");
    }
  });

  it("trainers, chef and clinical roles see no billing rows at all; members see the catalogue", async () => {
    const tables = [
      "plan_product",
      "price",
      "subscription",
      "subscription_freeze",
      "invoice",
      "invoice_line",
      "payment",
      "credit_balance",
      "access_pass",
      "billing_policy",
      "invoice_counter",
    ];
    for (const role of ["trainer", "nutritionist", "chef", "clinician"] as Role[]) {
      for (const table of tables) {
        const r = await rows(as(role), `SELECT 1 FROM app.${table}`);
        expect(r.length, `${role} ${table}`).toBe(0);
      }
    }
    expect((await rows(as("member"), "SELECT id FROM app.plan_product")).length).toBeGreaterThan(0);
  });

  it("a price must fit its product kind, and a price amount or a product kind is never editable", async () => {
    const f = bfx("A");
    await denied(
      as("owner"),
      "INSERT INTO app.price (product_id, amount_cents, billing_interval) VALUES ($1, 100, 'none')",
      [f.products.membership],
      "22023",
    );
    await denied(
      as("owner"),
      "INSERT INTO app.price (product_id, amount_cents) VALUES ($1, 100)",
      [f.products.classPack],
      "22023",
    );
    await denied(as("owner"), "UPDATE app.price SET amount_cents = 1 WHERE id = $1", [
      f.prices.dropIn,
    ]);
    await denied(as("owner"), "UPDATE app.plan_product SET kind = 'addon' WHERE id = $1", [
      f.products.dropIn,
    ]);
    const off = await rows(
      as("owner"),
      "UPDATE app.price SET active = active WHERE id = $1 RETURNING id",
      [f.prices.dropIn],
    );
    expect(off.length).toBe(1);
  });

  it("hostile product names are refused (links, phones, regulated titles, health promises, markup)", async () => {
    for (const name of [
      "Visita gymbarato.com",
      "Llama 787 555 0101",
      "Plan con nutricionista",
      "Garantizado bajar 10 libras",
      "<script>x</script>",
      "Sesión {{brand}}",
      "",
    ]) {
      await denied(
        as("owner"),
        "INSERT INTO app.plan_product (kind, name) VALUES ('drop_in', $1)",
        [name],
        "23514",
      );
    }
  });
});

describe("subscriptions (E4)", () => {
  it("front desk subscribes a member at its location: first invoice with IVU, member becomes active, audited", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    const s = await adminRow(
      "SELECT status, current_period_start::text AS ps, current_period_end::text AS pe, commitment_end FROM app.subscription WHERE id = $1",
      [sub],
    );
    expect(s.status).toBe("active");
    expect(s.ps).toBe(today);
    expect(s.commitment_end).toBeNull();
    const inv = await invoiceOf(sub);
    expect(inv).toMatchObject({
      subtotal_cents: 2995,
      ivu_state_cents: 314,
      ivu_municipal_cents: 30,
      total_cents: 3339,
      status: "open",
      ps: today,
      pe: s.pe,
    });
    expect((await adminRow("SELECT status FROM app.member WHERE id = $1", [m])).status).toBe(
      "active",
    );
    const audit = await t.admin.query(
      "SELECT action, actor_role, actor_person_id FROM app.audit_log WHERE entity_id IN ($1, $2) ORDER BY id",
      [sub, inv.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["invoice.issue", "subscription.create"]),
    );
    for (const r of audit.rows) {
      expect(r.actor_role).toBe("front_desk");
      expect(r.actor_person_id).toBe(A().people.front_desk);
    }
  });

  it("a second live subscription to the same product is a conflict", async () => {
    const m = await newMember(A());
    await subscribe(A(), m, bfx("A").prices.membership);
    await denied(as("front_desk"), SUBSCRIBE, [m, bfx("A").prices.membership, null, null], "23505");
  });

  it("only front of house at the member's location may subscribe", async () => {
    const atLoc1 = await newMember(A(), 1);
    await denied(as("front_desk"), SUBSCRIBE, [atLoc1, bfx("A").prices.membership, null, null]);
    await denied(as("location_manager"), SUBSCRIBE, [
      atLoc1,
      bfx("A").prices.membership,
      null,
      null,
    ]);
    const m = await newMember(A());
    for (const role of ["trainer", "accountant", "member", "guardian", "clinician"] as Role[]) {
      await denied(as(role), SUBSCRIBE, [m, bfx("A").prices.membership, null, null]);
    }
    // Other organisation: its member is invisible (forbidden), its price is not ours (invalid, no oracle).
    await denied(as("owner"), SUBSCRIBE, [B().members[0], bfx("A").prices.membership, null, null]);
    await denied(as("owner"), SUBSCRIBE, [m, bfx("B").prices.membership, null, null], "22023");
    expect(
      (await adminRow("SELECT count(*)::int AS n FROM app.subscription WHERE member_id = $1", [m]))
        .n,
    ).toBe(0);
  });

  it("one-off products cannot be subscribed and start dates are bounded", async () => {
    const m = await newMember(A());
    await denied(as("front_desk"), SUBSCRIBE, [m, bfx("A").prices.dropIn, null, null], "22023");
    await denied(
      as("front_desk"),
      SUBSCRIBE,
      [m, bfx("A").prices.membership, "2020-01-01", null],
      "22023",
    );
  });

  it("commitment is allowed only up to the policy maximum (default 0 months)", async () => {
    const price = await adminRow(
      "INSERT INTO app.price (org_id, product_id, amount_cents, billing_interval, commitment_months) VALUES ($1,$2,3995,'month',6) RETURNING id",
      [B().orgId, bfx("B").products.membership],
    );
    const m = await newMember(B());
    await denied(as("owner", B()), SUBSCRIBE, [m, price.id, null, null], "22023");
    await t.admin.query(
      "UPDATE app.billing_policy SET max_commitment_months = 12 WHERE org_id = $1 AND location_id IS NULL",
      [B().orgId],
    );
    try {
      const sub = await subscribe(B(), m, price.id, "owner");
      const s = await adminRow(
        "SELECT commitment_end::text AS ce, ((start_date + interval '6 months')::date)::text AS expected FROM app.subscription WHERE id = $1",
        [sub],
      );
      expect(s.ce).toBe(s.expected);
    } finally {
      await t.admin.query(
        "UPDATE app.billing_policy SET max_commitment_months = 0 WHERE org_id = $1 AND location_id IS NULL",
        [B().orgId],
      );
    }
  });
});

describe("IVU per line and the platform fee", () => {
  it("IVU is 10.5 % + 1 % rounded per line on taxable lines; exempt lines carry none", async () => {
    const f = bfx("A");
    const taxableFee = await adminRow(
      `WITH p AS (INSERT INTO app.plan_product (org_id, kind, name, tax_category) VALUES ($1,'enrollment_fee','Demo Cuota tributable','taxable') RETURNING id)
       INSERT INTO app.price (org_id, product_id, amount_cents) SELECT $1, id, 2995 FROM p RETURNING id`,
      [A().orgId],
    );
    const m = await newMember(A());
    const sub = await one<{ id: string }>(as("front_desk"), SUBSCRIBE, [
      m,
      f.prices.membership,
      null,
      taxableFee.id,
    ]);
    const inv = await invoiceOf(sub.id);
    // Per line: 2 × round(29.95 × 10.5 %) = 2 × 314 = 628. On the total it would be round(59.90 × 10.5 %) = 629.
    expect(inv).toMatchObject({
      subtotal_cents: 5990,
      ivu_state_cents: 628,
      ivu_municipal_cents: 60,
      total_cents: 6678,
    });
    const lines = await rows(
      as("front_desk"),
      "SELECT amount_cents, ivu_state_cents, ivu_municipal_cents FROM app.invoice_line WHERE invoice_id = $1",
      [inv.id],
    );
    expect(lines).toEqual([
      { amount_cents: 2995, ivu_state_cents: 314, ivu_municipal_cents: 30 },
      { amount_cents: 2995, ivu_state_cents: 314, ivu_municipal_cents: 30 },
    ]);

    const m2 = await newMember(A());
    const sub2 = await one<{ id: string }>(as("front_desk"), SUBSCRIBE, [
      m2,
      f.prices.membership,
      null,
      f.prices.enrollment, // exempt
    ]);
    const inv2 = await invoiceOf(sub2.id);
    expect(inv2).toMatchObject({
      subtotal_cents: 5495,
      ivu_state_cents: 314,
      ivu_municipal_cents: 30,
      total_cents: 5839,
    });
  });

  it("line tax cannot be forged, not even by a privileged writer (generated columns)", async () => {
    const f = bfx("A");
    await expect(
      t.admin.query(
        `INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents, tax_category, ivu_state_cents)
         VALUES ($1,$2,$3,$4,'x',1,1000,'taxable',0)`,
        [A().orgId, f.paidInvoice, f.products.dropIn, f.prices.dropIn],
      ),
    ).rejects.toMatchObject({ code: "428C9" });
  });

  it.each([
    ["esencial", 100],
    ["pro", 75],
    ["elite", 50],
  ] as const)(
    "plan %s: application fee = round(total × %i bps / 10 000), computed in SQL",
    async (plan, bps) => {
      const { rows: before } = await t.admin.query(
        "SELECT saas_plan FROM app.organization WHERE id = $1",
        [B().orgId],
      );
      await t.admin.query("UPDATE app.organization SET saas_plan = $2 WHERE id = $1", [
        B().orgId,
        plan,
      ]);
      try {
        const m = await newMember(B());
        const inv = await one<{ id: string }>(as("owner", B()), SELL, [
          m,
          bfx("B").prices.dropIn,
          B().locations[0],
          1,
          "cash",
          key(),
        ]);
        const total = (
          await adminRow("SELECT total_cents FROM app.invoice WHERE id = $1", [inv.id])
        ).total_cents as number;
        expect(total).toBe(1500 + 158 + 15);
        for (const role of ["owner", "accountant"] as Role[]) {
          const fee = await one(
            as(role, B()),
            "SELECT application_fee_bps, application_fee_cents FROM app.invoice_fees(NULL) WHERE invoice_id = $1",
            [inv.id],
          );
          expect(fee).toEqual({
            application_fee_bps: bps,
            application_fee_cents: Math.round((total * bps) / 10_000),
          });
        }
      } finally {
        await t.admin.query("UPDATE app.organization SET saas_plan = $2 WHERE id = $1", [
          B().orgId,
          before[0].saas_plan,
        ]);
      }
    },
  );

  it("members and front desk never read the platform fee", async () => {
    await denied(as("member"), "SELECT application_fee_cents FROM app.invoice");
    await denied(as("front_desk"), "SELECT application_fee_bps FROM app.invoice");
    await denied(as("front_desk"), "SELECT * FROM app.invoice_fees(NULL)");
    await denied(as("member"), "SELECT * FROM app.invoice_fees(NULL)");
  });
});

describe("freezes extend the period (never pause collection)", () => {
  it("a freeze moves current_period_end and commitment_end forward by its length", async () => {
    await t.admin.query(
      "UPDATE app.billing_policy SET max_commitment_months = 12 WHERE org_id = $1 AND location_id IS NULL",
      [A().orgId],
    );
    try {
      const price = await adminRow(
        "INSERT INTO app.price (org_id, product_id, amount_cents, billing_interval, commitment_months) VALUES ($1,$2,2995,'month',3) RETURNING id",
        [A().orgId, bfx("A").products.membership],
      );
      const m = await newMember(A());
      const sub = await subscribe(A(), m, price.id);
      const before = await adminRow(
        "SELECT current_period_end AS pe, commitment_end AS ce FROM app.subscription WHERE id = $1",
        [sub],
      );
      await one(
        as("front_desk"),
        "SELECT app.freeze_subscription($1, ($2::date + 2), ($2::date + 12), 'Demo viaje') AS id",
        [sub, today],
      );
      const after = await adminRow(
        `SELECT (current_period_end - $2::date) AS dpe, (commitment_end - $3::date) AS dce, status
           FROM app.subscription WHERE id = $1`,
        [sub, before.pe, before.ce],
      );
      expect(after).toEqual({ dpe: 10, dce: 10, status: "active" });
      // The invoice of the period is untouched: nothing is "paused".
      expect((await invoiceOf(sub)).status).toBe("open");
      // Overlapping, past, too long, or outside the current period: refused.
      for (const [s, e] of [
        [5, 8],
        [-1, 3],
        [3, 200],
        [80, 85],
      ]) {
        await denied(
          as("front_desk"),
          "SELECT app.freeze_subscription($1, ($2::date + $3::int), ($2::date + $4::int), NULL)",
          [sub, today, s, e],
          "22023",
        );
      }
    } finally {
      await t.admin.query(
        "UPDATE app.billing_policy SET max_commitment_months = 0 WHERE org_id = $1 AND location_id IS NULL",
        [A().orgId],
      );
    }
  });

  it("a freeze that starts today freezes the subscription and the member at once", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    await one(
      as("front_desk"),
      "SELECT app.freeze_subscription($1, $2::date, ($2::date + 7), NULL)",
      [sub, today],
    );
    expect(
      (await adminRow("SELECT status FROM app.subscription WHERE id = $1", [sub])).status,
    ).toBe("frozen");
    expect((await adminRow("SELECT status FROM app.member WHERE id = $1", [m])).status).toBe(
      "frozen",
    );
  });

  it("only front of house at the subscription's location can freeze", async () => {
    const m = await newMember(A(), 1);
    const sub = await subscribe(A(), m, bfx("A").prices.membership, "owner");
    for (const role of [
      "front_desk",
      "location_manager",
      "accountant",
      "trainer",
      "member",
    ] as Role[]) {
      await denied(as(role), "SELECT app.freeze_subscription($1, $2::date, ($2::date + 7), NULL)", [
        sub,
        today,
      ]);
    }
    await denied(
      as("owner", B()),
      "SELECT app.freeze_subscription($1, $2::date, ($2::date + 7), NULL)",
      [sub, today],
    );
  });
});

describe("cancellation at period end and the renewal cycle", () => {
  /** Move a subscription's current period into the past so that it ends today. */
  async function endsToday(sub: string) {
    await t.admin.query(
      `UPDATE app.subscription SET start_date = $2::date - 30, current_period_start = $2::date - 30, current_period_end = $2::date
        WHERE id = $1`,
      [sub, today],
    );
    // Its first invoice covered that (shifted) period.
    await t.admin.query(
      "UPDATE app.invoice SET period_start = $2::date - 30, period_end = $2::date WHERE subscription_id = $1",
      [sub, today],
    );
  }

  it("the member cancels online; it stays active until the period ends, then the cycle cancels it", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    const mc = await memberClaims(A(), m);
    const r = await one<{ d: string }>(mc, "SELECT app.cancel_subscription($1)::text AS d", [sub]);
    const s = await adminRow(
      "SELECT status, cancel_at_period_end, current_period_end::text AS pe FROM app.subscription WHERE id = $1",
      [sub],
    );
    expect(s).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(r.d).toBe(s.pe);
    // Idempotent.
    expect(
      (await one<{ d: string }>(mc, "SELECT app.cancel_subscription($1)::text AS d", [sub])).d,
    ).toBe(s.pe);

    await endsToday(sub);
    const invoicesBefore = (
      await adminRow("SELECT count(*)::int AS n FROM app.invoice WHERE subscription_id = $1", [sub])
    ).n;
    const res = await one<{ r: Record<string, number> }>(
      as("owner"),
      "SELECT app.run_billing_cycle($1::date, NULL) AS r",
      [today],
    );
    expect(res.r.cancelled).toBeGreaterThanOrEqual(1);
    expect(
      (await adminRow("SELECT status FROM app.subscription WHERE id = $1", [sub])).status,
    ).toBe("cancelled");
    expect(
      (
        await adminRow("SELECT count(*)::int AS n FROM app.invoice WHERE subscription_id = $1", [
          sub,
        ])
      ).n,
    ).toBe(invoicesBefore);
  });

  it("a member cannot cancel someone else's subscription; staff of another location cannot either", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    await denied(as("member"), "SELECT app.cancel_subscription($1)", [sub]); // fixture member, not the owner of sub
    await denied(as("guardian"), "SELECT app.cancel_subscription($1)", [sub]);
    await denied(as("trainer"), "SELECT app.cancel_subscription($1)", [sub]);
    await denied(as("owner", B()), "SELECT app.cancel_subscription($1)", [sub]);
    const atLoc1 = await newMember(A(), 1);
    const sub1 = await subscribe(A(), atLoc1, bfx("A").prices.membership, "owner");
    await denied(as("front_desk"), "SELECT app.cancel_subscription($1)", [sub1]);
  });

  it("the cycle renews due subscriptions once per period (idempotent) with a new numbered invoice", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    const first = await invoiceOf(sub);
    await endsToday(sub);
    await one(as("location_manager"), "SELECT app.run_billing_cycle($1::date, $2) AS r", [
      today,
      A().locations[0],
    ]);
    const renewal = await invoiceOf(sub);
    expect(renewal.id).not.toBe(first.id);
    expect(renewal.ps).toBe(today);
    expect(Number(renewal.number)).toBeGreaterThan(Number(first.number));
    await one(as("owner"), "SELECT app.run_billing_cycle($1::date, NULL) AS r", [today]);
    expect(
      (
        await adminRow("SELECT count(*)::int AS n FROM app.invoice WHERE subscription_id = $1", [
          sub,
        ])
      ).n,
    ).toBe(2);
  });

  it("a cancellation inside a commitment renews until the commitment ends", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    await one(as("front_desk"), "SELECT app.cancel_subscription($1)", [sub]);
    await endsToday(sub);
    await t.admin.query(
      "UPDATE app.subscription SET commitment_end = ($2::date + 31) WHERE id = $1",
      [sub, today],
    );
    await one(as("owner"), "SELECT app.run_billing_cycle($1::date, NULL)", [today]);
    expect(
      (await adminRow("SELECT status FROM app.subscription WHERE id = $1", [sub])).status,
    ).not.toBe("cancelled");
  });

  it("only the owner and location managers (their locations) run the cycle, never for the future", async () => {
    for (const role of ["front_desk", "accountant", "trainer", "member"] as Role[]) {
      await denied(as(role), "SELECT app.run_billing_cycle(NULL, NULL)");
    }
    await denied(as("location_manager"), "SELECT app.run_billing_cycle(NULL, $1)", [
      A().locations[1],
    ]);
    await denied(as("owner"), "SELECT app.run_billing_cycle(NULL, $1)", [B().locations[0]]);
    await denied(
      as("owner"),
      "SELECT app.run_billing_cycle(($1::date + 30), NULL)",
      [today],
      "22023",
    );
  });

  it("an overdue invoice marks the member past_due but never denies access; paying restores active", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    const pass = await one<{ id: string }>(as("front_desk"), SELL, [
      m,
      bfx("A").prices.dropIn,
      A().locations[0],
      1,
      "cash",
      key(),
    ]);
    const inv = await invoiceOf(sub);
    await t.admin.query("UPDATE app.invoice SET due_date = $2::date - 1 WHERE id = $1", [
      inv.id,
      today,
    ]);
    const passBefore = await adminRow(
      "SELECT valid_to FROM app.access_pass WHERE invoice_id = $1",
      [pass.id],
    );
    await one(as("owner"), "SELECT app.run_billing_cycle($1::date, NULL)", [today]);
    expect((await adminRow("SELECT status FROM app.member WHERE id = $1", [m])).status).toBe(
      "past_due",
    );
    expect(
      (await adminRow("SELECT status FROM app.subscription WHERE id = $1", [sub])).status,
    ).toBe("past_due");
    const passAfter = await adminRow("SELECT valid_to FROM app.access_pass WHERE invoice_id = $1", [
      pass.id,
    ]);
    expect(passAfter.valid_to).toEqual(passBefore.valid_to);

    await one(as("front_desk"), PAY, [inv.id, "cash", inv.total_cents, key(), "Recibo 12"]);
    expect((await adminRow("SELECT status FROM app.member WHERE id = $1", [m])).status).toBe(
      "active",
    );
    expect(
      (await adminRow("SELECT status FROM app.subscription WHERE id = $1", [sub])).status,
    ).toBe("active");
  });
});

describe("payments", () => {
  it("partial then full payment settles the invoice; overpayment is refused; retries are idempotent", async () => {
    const m = await newMember(A());
    const sub = await subscribe(A(), m, bfx("A").prices.membership);
    const inv = await invoiceOf(sub);
    const k1 = key();
    const p1 = await one<{ id: string }>(as("front_desk"), PAY, [inv.id, "cash", 1000, k1, null]);
    const again = await one<{ id: string }>(as("front_desk"), PAY, [
      inv.id,
      "cash",
      1000,
      k1,
      null,
    ]);
    expect(again.id).toBe(p1.id);
    await denied(as("front_desk"), PAY, [inv.id, "cash", 9999, key(), null], "22023");
    await one(as("front_desk"), PAY, [inv.id, "card_simulated", 2339, key(), null]);
    const after = await adminRow("SELECT status, paid_at FROM app.invoice WHERE id = $1", [inv.id]);
    expect(after.status).toBe("paid");
    expect(after.paid_at).not.toBeNull();
    expect(
      (await adminRow("SELECT count(*)::int AS n FROM app.payment WHERE invoice_id = $1", [inv.id]))
        .n,
    ).toBe(2);
    await denied(as("front_desk"), PAY, [inv.id, "cash", 1, key(), null], "22023"); // not open any more
    // Same idempotency key for another invoice: conflict, not a silent reuse.
    await denied(as("owner"), PAY, [bfx("A").openInvoice, "cash", 100, k1, null], "23505");
  });

  it("front desk of another location, accountant and other org cannot record payments", async () => {
    const open = bfx("A").openInvoice; // members[1] at locations[1]
    await denied(as("front_desk"), PAY, [open, "cash", 100, key(), null]);
    await denied(as("location_manager"), PAY, [open, "cash", 100, key(), null]);
    for (const role of ["accountant", "trainer", "member", "guardian"] as Role[]) {
      await denied(as(role), PAY, [open, "cash", 100, key(), null]);
    }
    await denied(as("owner", B()), PAY, [open, "cash", 100, key(), null]);
    expect(
      (await adminRow("SELECT count(*)::int AS n FROM app.payment WHERE invoice_id = $1", [open]))
        .n,
    ).toBe(0);
  });

  it("card numbers can never be stored in a payment reference", async () => {
    const m = await newMember(A());
    const inv = await invoiceOf(await subscribe(A(), m, bfx("A").prices.membership));
    for (const ref of ["4242424242424242", "4242 4242 4242 4242", "tarjeta 4111-1111-1111-1111"]) {
      await denied(as("front_desk"), PAY, [inv.id, "card_simulated", 100, key(), ref], "23514");
    }
    await denied(
      as("front_desk"),
      PAY,
      [inv.id, "cash", 100, "bad key with spaces", null],
      "23514",
    );
  });

  it("request traffic cannot write billing rows directly", async () => {
    const f = bfx("A");
    await denied(as("owner"), "UPDATE app.invoice SET status = 'paid' WHERE id = $1", [
      f.openInvoice,
    ]);
    await denied(as("owner"), "UPDATE app.subscription SET current_period_end = '2099-01-01'");
    await denied(
      as("front_desk"),
      "INSERT INTO app.payment (invoice_id, member_id, location_id, method, amount_cents, idempotency_key, recorded_by) VALUES ($1,$2,$3,'cash',1,'abcdefgh',$4)",
      [f.paidInvoice, A().members[0], A().locations[0], A().people.front_desk],
    );
    await denied(as("owner"), "UPDATE app.credit_balance SET credits_remaining = 999");
    await denied(as("owner"), "UPDATE app.invoice_counter SET next_no = 1");
    await denied(as("owner"), "SELECT app.billing_refresh($1, current_date)", [A().members[0]]);
    await denied(
      as("owner"),
      "SELECT app.billing_issue_invoice($1, $2, NULL, NULL, NULL, ARRAY[$3]::uuid[], ARRAY[1], NULL)",
      [A().members[0], A().locations[0], f.prices.dropIn],
    );
  });

  it("void: owner or manager, open invoices without payments only, reason required; the number stays used", async () => {
    const m = await newMember(A());
    const inv = await invoiceOf(await subscribe(A(), m, bfx("A").prices.membership));
    await denied(as("front_desk"), "SELECT app.void_invoice($1, 'error')", [inv.id]);
    await denied(as("location_manager"), "SELECT app.void_invoice($1, '  ')", [inv.id], "22023");
    await one(as("location_manager"), "SELECT app.void_invoice($1, 'Alta duplicada')", [inv.id]);
    const v = await adminRow("SELECT status, number FROM app.invoice WHERE id = $1", [inv.id]);
    expect(v.status).toBe("void");
    expect(v.number).toBe(inv.number);
    await denied(
      as("owner"),
      "SELECT app.void_invoice($1, 'otra vez')",
      [bfx("A").paidInvoice],
      "22023",
    );
  });
});

describe("one-off sales: single sessions, day passes and session packs", () => {
  it("a single session is invoiced with IVU, paid in full and grants a same-day pass; the lead becomes active", async () => {
    const m = await newMember(A());
    const k = key();
    const inv = await one<{ id: string }>(as("front_desk"), SELL, [
      m,
      bfx("A").prices.dropIn,
      A().locations[0],
      1,
      "cash",
      k,
    ]);
    const i = await adminRow(
      "SELECT status, total_cents, ivu_state_cents FROM app.invoice WHERE id = $1",
      [inv.id],
    );
    expect(i).toEqual({ status: "paid", total_cents: 1673, ivu_state_cents: 158 });
    const pass = await adminRow(
      "SELECT (valid_to - valid_from) = interval '1 day' AS one_day FROM app.access_pass WHERE invoice_id = $1",
      [inv.id],
    );
    expect(pass.one_day).toBe(true);
    expect((await adminRow("SELECT status FROM app.member WHERE id = $1", [m])).status).toBe(
      "active",
    );
    // A retry with the same key returns the same sale; nothing is charged twice.
    const again = await one<{ id: string }>(as("front_desk"), SELL, [
      m,
      bfx("A").prices.dropIn,
      A().locations[0],
      1,
      "cash",
      k,
    ]);
    expect(again.id).toBe(inv.id);
    expect(
      (await adminRow("SELECT count(*)::int AS n FROM app.payment WHERE invoice_id = $1", [inv.id]))
        .n,
    ).toBe(1);
  });

  it("a session pack grants credits × quantity with an expiry", async () => {
    const m = await newMember(A());
    const inv = await one<{ id: string }>(as("location_manager"), SELL, [
      m,
      bfx("A").prices.classPack,
      A().locations[0],
      2,
      "card_simulated",
      key(),
    ]);
    const c = await adminRow(
      "SELECT credits_total, credits_remaining, expires_at > now() + interval '89 days' AS later FROM app.credit_balance WHERE invoice_id = $1",
      [inv.id],
    );
    expect(c).toEqual({ credits_total: 20, credits_remaining: 20, later: true });
  });

  it("refuses wrong kinds, quantities and locations; other locations and orgs are forbidden", async () => {
    const m = await newMember(A());
    const f = bfx("A");
    await denied(
      as("front_desk"),
      SELL,
      [m, f.prices.membership, A().locations[0], 1, "cash", key()],
      "22023",
    );
    await denied(
      as("front_desk"),
      SELL,
      [m, f.prices.dropIn, A().locations[0], 2, "cash", key()],
      "22023",
    );
    // The day pass price belongs to locations[1].
    await denied(
      as("owner"),
      SELL,
      [m, f.prices.dayPassLoc1, A().locations[0], 1, "cash", key()],
      "22023",
    );
    // Front desk of locations[0] selling at locations[1], or to a member it cannot see.
    await denied(as("front_desk"), SELL, [m, f.prices.dropIn, A().locations[1], 1, "cash", key()]);
    await denied(as("front_desk"), SELL, [
      A().members[1],
      f.prices.dropIn,
      A().locations[0],
      1,
      "cash",
      key(),
    ]);
    for (const role of ["accountant", "trainer", "chef", "member"] as Role[]) {
      await denied(as(role), SELL, [m, f.prices.dropIn, A().locations[0], 1, "cash", key()]);
    }
    await denied(as("owner", B()), SELL, [
      m,
      bfx("B").prices.dropIn,
      B().locations[0],
      1,
      "cash",
      key(),
    ]);
  });
});

describe("visibility", () => {
  it("a member sees only their own subscription, invoices, payments, credits and passes", async () => {
    const f = bfx("A");
    const mc = as("member"); // person of members[0]
    expect((await rows(mc, "SELECT id FROM app.invoice")).map((r) => r.id)).toEqual([
      f.paidInvoice,
    ]);
    expect(
      (await rows(mc, "SELECT id FROM app.invoice WHERE id = $1", [f.openInvoice])).length,
    ).toBe(0);
    expect(
      (await rows(mc, "SELECT 1 FROM app.invoice_line WHERE invoice_id = $1", [f.openInvoice]))
        .length,
    ).toBe(0);
    for (const table of ["subscription", "payment", "credit_balance", "subscription_freeze"]) {
      const r = await rows(mc, `SELECT DISTINCT member_id FROM app.${table}`);
      expect(
        r.map((x) => x.member_id),
        table,
      ).toEqual([A().members[0]]);
    }
    expect((await rows(mc, "SELECT 1 FROM app.access_pass")).length).toBe(0); // the fixture pass is members[1]'s
    expect((await rows(mc, "SELECT 1 FROM app.invoice_counter")).length).toBe(0);
  });

  it("front desk sees billing rows only at its location; the accountant reads invoices and payments org-wide", async () => {
    const fd = await rows(as("front_desk"), "SELECT DISTINCT location_id FROM app.invoice");
    expect(fd.map((r) => r.location_id)).toEqual([A().locations[0]]);
    const acc = await rows(
      as("accountant"),
      "SELECT DISTINCT location_id FROM app.invoice ORDER BY 1",
    );
    expect(acc.length).toBe(2);
    expect((await rows(as("accountant"), "SELECT 1 FROM app.payment")).length).toBeGreaterThan(0);
    expect((await rows(as("accountant"), "SELECT 1 FROM app.subscription")).length).toBe(0);
    expect((await rows(as("accountant"), "SELECT 1 FROM app.credit_balance")).length).toBe(0);
  });
});

describe("gapless invoice numbering", () => {
  async function txAs(claims: ReturnType<typeof as>) {
    const c = await t.api.pool.connect();
    await c.query("BEGIN");
    await bindClaims(c as Tx, t.api, claims);
    return c;
  }
  const numberOf = async (id: string) =>
    Number((await adminRow("SELECT number FROM app.invoice WHERE id = $1", [id])).number);

  it("two concurrent sales get consecutive numbers: the second waits on the counter row", async () => {
    const m1 = await newMember(B());
    const m2 = await newMember(B());
    const c1 = await txAs(as("owner", B()));
    const c2 = await txAs(as("owner", B()));
    try {
      const r1 = await c1.query(SELL, [
        m1,
        bfx("B").prices.dropIn,
        B().locations[0],
        1,
        "cash",
        key(),
      ]);
      const pending = c2.query(SELL, [
        m2,
        bfx("B").prices.dropIn,
        B().locations[0],
        1,
        "cash",
        key(),
      ]);
      // The second transaction is blocked on the counter lock held by the first.
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        const w = await t.admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        waiting = (w.rowCount ?? 0) > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      await c1.query("COMMIT");
      const r2 = await pending;
      await c2.query("COMMIT");
      const n1 = await numberOf(r1.rows[0].id);
      const n2 = await numberOf(r2.rows[0].id);
      expect(n2).toBe(n1 + 1);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it("a rolled-back invoice does not burn its number", async () => {
    const m = await newMember(B());
    const c = await txAs(as("owner", B()));
    const r = await c.query(SELL, [m, bfx("B").prices.dropIn, B().locations[0], 1, "cash", key()]);
    const lost = (await c.query("SELECT number FROM app.invoice WHERE id = $1", [r.rows[0].id]))
      .rows[0].number;
    await c.query("ROLLBACK");
    c.release();
    const next = await one<{ id: string }>(as("owner", B()), SELL, [
      m,
      bfx("B").prices.dropIn,
      B().locations[0],
      1,
      "cash",
      key(),
    ]);
    expect(await numberOf(next.id)).toBe(Number(lost));
    // Numbers of the legal entity have no holes.
    const { rows: nums } = await t.admin.query(
      "SELECT number FROM app.invoice WHERE org_id = $1 ORDER BY number",
      [B().orgId],
    );
    nums.forEach((r, i) => expect(Number(r.number)).toBe(i + 1));
  });
});
