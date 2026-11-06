import type pg from "pg";
import type { OrgFixture } from "../testing.js";

export interface BillingFixture {
  products: {
    membership: string;
    dropIn: string;
    classPack: string;
    dayPass: string;
    enrollment: string;
  };
  prices: {
    membership: string;
    dropIn: string;
    classPack: string;
    dayPassLoc1: string;
    enrollment: string;
  };
  subscription: string;
  /** Paid invoice of members[0] at locations[0]. */
  paidInvoice: string;
  /** Open invoice of members[1] at locations[1]. */
  openInvoice: string;
}

/** Filled by `seed` per org label, so tests can reach the fixture rows by name. */
export const billingFx: Partial<Record<"A" | "B", BillingFixture>> = {};

async function id(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  const v = rows[0]?.id;
  if (!v) throw new Error(`billing fixture failed: ${sql}`);
  return v;
}

/**
 * Test fixtures for module billing: at least one row per org in every table this module adds. Inserted as the
 * superuser (no claims, so no audit rows). Invoice totals are written consistently with the CHECK constraints:
 * one taxable line of 2995 → IVU state 314, municipal 30, total 3339, fee at 100 bps = 33.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const o = org.orgId;
  const [loc0, loc1] = org.locations;
  const [m0, m1] = org.members;
  await c.query(
    "INSERT INTO app.billing_policy (org_id, max_commitment_months, invoice_due_days) VALUES ($1, 0, 3)",
    [o],
  );
  const product = (kind: string, name: string, tax = "taxable") =>
    id(
      c,
      "INSERT INTO app.plan_product (org_id, kind, name, tax_category) VALUES ($1,$2,$3,$4) RETURNING id",
      [o, kind, name, tax],
    );
  const products = {
    membership: await product("membership", `Demo Mensual ${label}`),
    dropIn: await product("drop_in", `Demo Sesión ${label}`),
    classPack: await product("class_pack", `Demo Paquete 10 ${label}`),
    dayPass: await product("day_pass", `Demo Pase diario ${label}`),
    enrollment: await product("enrollment_fee", `Demo Inscripción ${label}`, "exempt"),
  };
  const price = (
    product: string,
    amount: number,
    opts: { loc?: string; interval?: string; credits?: number; validity?: number } = {},
  ) =>
    id(
      c,
      `INSERT INTO app.price (org_id, product_id, location_id, amount_cents, billing_interval, credits, validity_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        o,
        product,
        opts.loc ?? null,
        amount,
        opts.interval ?? "none",
        opts.credits ?? null,
        opts.validity ?? null,
      ],
    );
  const prices = {
    membership: await price(products.membership, 2995, { interval: "month" }),
    dropIn: await price(products.dropIn, 1500, { validity: 1 }),
    classPack: await price(products.classPack, 12000, { credits: 10, validity: 90 }),
    dayPassLoc1: await price(products.dayPass, 1000, { loc: loc1, validity: 1 }),
    enrollment: await price(products.enrollment, 2500),
  };
  const subscription = await id(
    c,
    `INSERT INTO app.subscription (org_id, member_id, product_id, price_id, location_id, billing_interval, start_date,
       current_period_start, current_period_end, created_by)
     VALUES ($1,$2,$3,$4,$5,'month', current_date, current_date, (current_date + interval '1 month')::date, $6) RETURNING id`,
    [o, m0, products.membership, prices.membership, loc0, org.people.front_desk],
  );
  await c.query(
    `INSERT INTO app.subscription_freeze (org_id, subscription_id, member_id, location_id, start_date, end_date, reason, created_by)
     VALUES ($1,$2,$3,$4, current_date - 60, current_date - 50, 'Demo viaje', $5)`,
    [o, subscription, m0, loc0, org.people.front_desk],
  );
  const { rows: le } = await c.query<{ legal_entity_id: string }>(
    "SELECT legal_entity_id FROM app.location WHERE id = $1",
    [loc0],
  );
  const legalEntity = le[0]?.legal_entity_id;
  await c.query(
    "INSERT INTO app.invoice_counter (org_id, legal_entity_id, next_no) VALUES ($1,$2,3)",
    [o, legalEntity],
  );
  const invoice = (
    no: number,
    member: string,
    loc: string,
    status: "open" | "paid",
    sub: string | null,
  ) =>
    id(
      c,
      `INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, municipality, subscription_id,
         period_start, period_end, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents,
         application_fee_bps, application_fee_cents, status, due_date, paid_at, created_by)
       VALUES ($1,$2,$3,$4,$5,'San Juan',$6,
         CASE WHEN $6::uuid IS NULL THEN NULL ELSE current_date END,
         CASE WHEN $6::uuid IS NULL THEN NULL ELSE (current_date + interval '1 month')::date END,
         2995, 314, 30, 3339, 100, 33, $7::app.invoice_status, current_date + 3,
         CASE WHEN $7 = 'paid' THEN now() END, $8) RETURNING id`,
      [o, legalEntity, no, member, loc, sub, status, org.people.front_desk],
    );
  const paidInvoice = await invoice(1, m0, loc0, "paid", subscription);
  const openInvoice = await invoice(2, m1, loc1, "open", null);
  for (const [inv, product, pr] of [
    [paidInvoice, products.membership, prices.membership],
    [openInvoice, products.dropIn, prices.dropIn],
  ] as const) {
    await c.query(
      `INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents, tax_category)
       VALUES ($1,$2,$3,$4,'Demo línea',1,2995,'taxable')`,
      [o, inv, product, pr],
    );
  }
  await c.query(
    `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key, recorded_by)
     VALUES ($1,$2,$3,$4,'cash',3339,$5,$6)`,
    [o, paidInvoice, m0, loc0, `fixture-pay-${label}`, org.people.front_desk],
  );
  await c.query(
    `INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total, credits_remaining, expires_at)
     VALUES ($1,$2,$3,$4,$5,10,7, now() + interval '90 days')`,
    [o, m0, products.classPack, loc0, paidInvoice],
  );
  await c.query(
    `INSERT INTO app.access_pass (org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to)
     VALUES ($1,$2,$3,$4,$5, now(), now() + interval '1 day')`,
    [o, m1, loc1, products.dropIn, openInvoice],
  );
  billingFx[label] = { products, prices, subscription, paidInvoice, openInvoice };
}
