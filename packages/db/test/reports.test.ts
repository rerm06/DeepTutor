import type { Role } from "@gym/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingFx } from "../src/fixtures/billing.js";
import { bindClaims } from "../src/index.js";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Module reports (E13). Every report is an invoker read model, so each number must equal what the same caller
// counts directly in the module tables. Extra rows are inserted here as the superuser (this file's own database).

let t: TestDb;
const TZ = "America/Puerto_Rico";
const ALL_ROLES: Role[] = [
  "owner",
  "location_manager",
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
  "member",
  "guardian",
];

/** IVU per line, half-up, exactly as billing/store define it (10.5 % state, 1 % municipal). */
const ivu = (amount: number, taxable: boolean) => ({
  st: taxable ? Math.floor((amount * 1050 + 5000) / 10000) : 0,
  mu: taxable ? Math.floor((amount * 100 + 5000) / 10000) : 0,
});

async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await t.admin.query(sql, params);
  return rows[0] as T;
}
async function personOf(org: OrgFixture, tag: string): Promise<string> {
  return (
    await q1<{ id: string }>("INSERT INTO app.person (email) VALUES ($1) RETURNING id", [
      `${tag}.${Math.random().toString(36).slice(2, 8)}@demo.invalid`,
    ])
  ).id;
}
async function newMember(
  org: OrgFixture,
  loc: string,
  name: string,
  status = "active",
): Promise<string> {
  const p = await personOf(org, "rpt");
  return (
    await q1<{ id: string }>(
      "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [org.orgId, p, loc, name, status],
    )
  ).id;
}

let invoiceNo = 1000;
interface Line {
  product: string;
  price: string;
  unit: number;
  qty: number;
  taxable: boolean;
}
/** Insert an invoice with lines (superuser). Totals follow the CHECKs; tax is the generated per-line value. */
async function invoice(
  org: OrgFixture,
  opts: {
    member: string;
    loc: string;
    lines: Line[];
    issuedAt: string; // SQL expression
    dueDate?: string; // SQL expression
    status?: "open" | "paid" | "void";
    municipality?: string | null;
  },
): Promise<{ id: string; total: number }> {
  const le = await q1<{ legal_entity_id: string; municipality: string }>(
    "SELECT legal_entity_id, municipality FROM app.location WHERE id = $1",
    [opts.loc],
  );
  let sub = 0;
  let st = 0;
  let mu = 0;
  for (const l of opts.lines) {
    const a = l.unit * l.qty;
    sub += a;
    st += ivu(a, l.taxable).st;
    mu += ivu(a, l.taxable).mu;
  }
  const total = sub + st + mu;
  const fee = Math.floor((total * 100 + 5000) / 10000);
  const status = opts.status ?? "open";
  const { id } = await q1<{ id: string }>(
    `INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, municipality, subtotal_cents,
       ivu_state_cents, ivu_municipal_cents, total_cents, application_fee_bps, application_fee_cents, status,
       issued_at, due_date, paid_at, voided_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100,$11,$12::app.invoice_status, ${opts.issuedAt},
       ${opts.dueDate ?? "current_date + 3"},
       CASE WHEN $12 = 'paid' THEN now() END, CASE WHEN $12 = 'void' THEN now() END, $13) RETURNING id`,
    [
      org.orgId,
      le.legal_entity_id,
      ++invoiceNo,
      opts.member,
      opts.loc,
      opts.municipality === undefined ? le.municipality : opts.municipality,
      sub,
      st,
      mu,
      total,
      fee,
      status,
      org.people.front_desk,
    ],
  );
  for (const l of opts.lines) {
    await t.admin.query(
      `INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity,
         unit_amount_cents, tax_category)
       VALUES ($1,$2,$3,$4,'Demo línea',$5,$6,$7)`,
      [org.orgId, id, l.product, l.price, l.qty, l.unit, l.taxable ? "taxable" : "exempt"],
    );
  }
  return { id, total };
}

interface StoreLine {
  product: string;
  unit: number;
  qty: number;
  taxable: boolean;
}
async function sale(
  org: OrgFixture,
  opts: { loc: string; lines: StoreLine[]; completedAt: string; refundedAt?: string },
): Promise<string> {
  let sub = 0;
  let st = 0;
  let mu = 0;
  for (const l of opts.lines) {
    const a = l.unit * l.qty;
    sub += a;
    st += ivu(a, l.taxable).st;
    mu += ivu(a, l.taxable).mu;
  }
  const refunded = !!opts.refundedAt;
  const { id } = await q1<{ id: string }>(
    `INSERT INTO app.sale (org_id, location_id, channel, status, subtotal_cents, ivu_state_cents,
       ivu_municipal_cents, total_cents, payment_method, created_by, created_at, completed_by, completed_at,
       refunded_by, refunded_at, refund_reason)
     VALUES ($1,$2,'pos',$3,$4,$5,$6,$7,'cash',$8, ${opts.completedAt}, $8, ${opts.completedAt},
       ${refunded ? "$8" : "NULL"}, ${refunded ? opts.refundedAt : "NULL"}, ${refunded ? "'Demo devolución'" : "NULL"})
     RETURNING id`,
    [
      org.orgId,
      opts.loc,
      refunded ? "refunded" : "completed",
      sub,
      st,
      mu,
      sub + st + mu,
      org.people.front_desk,
    ],
  );
  for (const l of opts.lines) {
    const a = l.unit * l.qty;
    const x = ivu(a, l.taxable);
    await t.admin.query(
      `INSERT INTO app.sale_line (org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
         subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10)`,
      [org.orgId, id, l.product, l.qty, l.unit, l.taxable, a, x.st, x.mu, a + x.st + x.mu],
    );
  }
  return id;
}

async function checkIn(org: OrgFixture, loc: string, member: string, at: string, allowed = true) {
  await t.admin.query(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by, at)
     VALUES ($1,$2,$3,'front_desk',$4,$5,$6, ${at})`,
    [
      org.orgId,
      loc,
      member,
      allowed ? "allowed" : "denied",
      allowed ? "active" : "frozen",
      org.people.front_desk,
    ],
  );
}

/** Run as `role`; expect SQLSTATE `code`. */
async function refused(
  org: OrgFixture,
  role: Role,
  sql: string,
  params: unknown[] = [],
  code = "42501",
) {
  await expect(
    asCaller(t.api, t.claims(org, role), (tx) => tx.query(sql, params)),
  ).rejects.toMatchObject({ code });
}

const SEPT = {
  // San Juan (loc0) and Bayamón (loc1); store products P1 (taxable 2500) and P2 (exempt 1000).
  billing: [] as Array<{
    loc: 0 | 1;
    lines: Array<{ unit: number; qty: number; taxable: boolean }>;
  }>,
};
let P1 = "";
let P2 = "";
let heatDow = 0;
let soldMember = "";

beforeAll(async () => {
  t = await createTestDb();
  const A = t.fx.A;
  const [l0, l1] = A.locations;
  const bfx = billingFx.A;
  if (!bfx) throw new Error("billing fixture missing");
  const pr = bfx.prices;
  const pd = bfx.products;
  const drop = (qty: number): Line => ({
    product: pd.dropIn,
    price: pr.dropIn,
    unit: 1500,
    qty,
    taxable: true,
  });

  // Members: one new active at loc0, one with a subscription cancelled this month, one ending in 3 days.
  soldMember = await newMember(A, l0, "Demo Nueva Socia");
  const cancelled = await newMember(A, l0, "Demo Baja Reciente", "cancelled");
  await t.admin.query(
    `INSERT INTO app.subscription (org_id, member_id, product_id, price_id, location_id, status, billing_interval,
       start_date, current_period_start, current_period_end, cancel_at_period_end, cancel_requested_at,
       cancelled_at, created_by)
     VALUES ($1,$2,$3,$4,$5,'cancelled','month', current_date - 40, current_date - 40, current_date - 10, true,
       now() - interval '20 days', now(), $6)`,
    [A.orgId, cancelled, pd.membership, pr.membership, l0, A.people.front_desk],
  );
  const ending = await newMember(A, l0, "Demo Termina Pronto");
  await t.admin.query(
    `INSERT INTO app.subscription (org_id, member_id, product_id, price_id, location_id, billing_interval,
       start_date, current_period_start, current_period_end, cancel_at_period_end, cancel_requested_at, created_by)
     VALUES ($1,$2,$3,$4,$5,'month', current_date - 27, (now() AT TIME ZONE '${TZ}')::date - 27,
       (now() AT TIME ZONE '${TZ}')::date + 3, true, now(), $6)`,
    [A.orgId, ending, pd.membership, pr.membership, l0, A.people.front_desk],
  );

  // Check-ins: today at both locations (one denied), and a heatmap cell 3 days ago at 06:15 local.
  await checkIn(A, l0, soldMember, "now() - interval '1 minute'");
  await checkIn(A, l1, A.members[1], "now() - interval '1 minute'");
  await checkIn(A, l0, cancelled, "now() - interval '1 minute'", false);
  const cell = `((date_trunc('day', now() AT TIME ZONE '${TZ}') - interval '3 days' + interval '6 hours 15 minutes') AT TIME ZONE '${TZ}')`;
  for (let i = 0; i < 3; i++) await checkIn(A, l0, A.members[0], cell);
  await checkIn(A, l0, A.members[0], cell, false);
  await checkIn(A, l0, A.members[0], `${cell} - interval '6 weeks'`);
  await checkIn(A, l0, A.members[0], `${cell} - interval '10 weeks'`);
  heatDow = (
    await q1<{ d: number }>(
      `SELECT extract(isodow FROM (date_trunc('day', now() AT TIME ZONE '${TZ}') - interval '3 days'))::int AS d`,
    )
  ).d;

  // A class today at loc0 with 3 occupied seats of 10, and one waitlisted.
  const ct = await q1<{ id: string }>("SELECT id FROM app.class_type WHERE org_id = $1 LIMIT 1", [
    A.orgId,
  ]);
  const session = await q1<{ id: string }>(
    `INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by)
     VALUES ($1,$2,$3,'Salon Hoy', now(), now() + interval '45 minutes', 10, $4) RETURNING id`,
    [A.orgId, l0, ct.id, A.people.owner],
  );
  const seat = async (member: string, status: string, pos: number | null = null) =>
    t.admin.query(
      `INSERT INTO app.booking (org_id, session_id, member_id, status, waitlist_position, booked_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [A.orgId, session.id, member, status, pos, A.people.front_desk],
    );
  await seat(A.members[0], "attended");
  await seat(soldMember, "booked");
  await seat(ending, "no_show");
  await seat(cancelled, "waitlisted", 1);

  // Billing today: a sale of 2 sessions at loc0, a void invoice (excluded), an overdue one with a partial payment.
  await invoice(A, { member: soldMember, loc: l0, lines: [drop(2)], issuedAt: "now()" });
  await invoice(A, {
    member: soldMember,
    loc: l0,
    lines: [drop(5)],
    issuedAt: "now()",
    status: "void",
  });
  const overdue = await invoice(A, {
    member: soldMember,
    loc: l0,
    lines: [drop(1)],
    issuedAt: "now() - interval '9 days'",
    dueDate: `(now() AT TIME ZONE '${TZ}')::date - 5`,
  });
  await t.admin.query(
    `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key, recorded_by)
     VALUES ($1,$2,$3,$4,'cash',500,'rpt-partial-1',$5)`,
    [A.orgId, overdue.id, soldMember, l0, A.people.front_desk],
  );
  // Overdue at loc1 too (outside the manager's scope).
  await invoice(A, {
    member: A.members[1],
    loc: l1,
    lines: [drop(1)],
    issuedAt: "now() - interval '9 days'",
    dueDate: `(now() AT TIME ZONE '${TZ}')::date - 2`,
  });

  // Credits expiring in 3 days and a pass expiring tomorrow (loc0).
  await t.admin.query(
    `INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total,
       credits_remaining, expires_at)
     VALUES ($1,$2,$3,$4,$5,10,2, now() + interval '3 days'), ($1,$2,$3,$4,$5,10,0, now() + interval '2 days')`,
    [A.orgId, soldMember, pd.classPack, l0, overdue.id],
  );
  await t.admin.query(
    `INSERT INTO app.access_pass (org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to)
     VALUES ($1,$2,$3,$4,$5, now(), now() + interval '1 day')`,
    [A.orgId, soldMember, l0, pd.dayPass, overdue.id],
  );

  // CRM: an open lead and a won lead this month at loc0.
  await t.admin.query(
    `INSERT INTO app.lead (org_id, location_id, source, stage, full_name, email, created_by)
     VALUES ($1,$2,'web','contacted','Demo Prospecto Abierto','rpt.lead1@demo.invalid',$3)`,
    [A.orgId, l0, A.people.front_desk],
  );
  await t.admin.query(
    `INSERT INTO app.lead (org_id, location_id, source, stage, full_name, email, member_id, created_by)
     VALUES ($1,$2,'walk_in','won','Demo Prospecto Ganado','rpt.lead2@demo.invalid',$3,$4)`,
    [A.orgId, l0, soldMember, A.people.front_desk],
  );

  // Store products for the IVU month (September 2026) and a completed sale today.
  P1 = (
    await q1<{ id: string }>(
      "INSERT INTO app.product (org_id, sku, name, category, taxable, price_cents) VALUES ($1,'RPT-P1','Demo Barra','supplement',true,2500) RETURNING id",
      [A.orgId],
    )
  ).id;
  P2 = (
    await q1<{ id: string }>(
      "INSERT INTO app.product (org_id, sku, name, category, taxable, price_cents) VALUES ($1,'RPT-P2','Demo Botella','accessory',false,1000) RETURNING id",
      [A.orgId],
    )
  ).id;
  await t.admin.query(
    "INSERT INTO app.inventory_level (org_id, product_id, location_id, on_hand, reorder_point) VALUES ($1,$2,$3,1,5)",
    [A.orgId, P1, l0],
  );
  await sale(A, {
    loc: l0,
    lines: [{ product: P1, unit: 2500, qty: 1, taxable: true }],
    completedAt: "now()",
  });

  // ── September 2026 (local): the IVU and sales fixtures.
  const sj = (s: string) => `TIMESTAMPTZ '${s}'`;
  SEPT.billing = [
    {
      loc: 0,
      lines: [
        { unit: 2995, qty: 1, taxable: true },
        { unit: 2500, qty: 1, taxable: false },
      ],
    },
    { loc: 1, lines: [{ unit: 1500, qty: 3, taxable: true }] },
    { loc: 0, lines: [{ unit: 1500, qty: 1, taxable: true }] },
  ];
  await invoice(A, {
    member: A.members[0],
    loc: l0,
    lines: [
      { product: pd.membership, price: pr.membership, unit: 2995, qty: 1, taxable: true },
      { product: pd.enrollment, price: pr.enrollment, unit: 2500, qty: 1, taxable: false },
    ],
    issuedAt: sj("2026-09-10 15:00:00-04"),
  });
  await invoice(A, {
    member: A.members[1],
    loc: l1,
    lines: [drop(3)],
    issuedAt: sj("2026-09-20 10:00:00-04"),
  });
  // 23:30 local on Sept 30 = Oct 1 UTC: belongs to September.
  await invoice(A, {
    member: A.members[0],
    loc: l0,
    lines: [drop(1)],
    issuedAt: sj("2026-10-01 03:30:00+00"),
  });
  // Excluded: void in September; 23:30 local on Aug 31 (Sept 1 UTC); October.
  await invoice(A, {
    member: A.members[0],
    loc: l0,
    lines: [drop(4)],
    issuedAt: sj("2026-09-12 12:00:00-04"),
    status: "void",
  });
  await invoice(A, {
    member: A.members[0],
    loc: l0,
    lines: [drop(6)],
    issuedAt: sj("2026-09-01 03:30:00+00"),
  });
  await invoice(A, {
    member: A.members[0],
    loc: l0,
    lines: [drop(7)],
    issuedAt: sj("2026-10-05 12:00:00-04"),
  });
  // Store: completed at loc0; completed+refunded within September at loc1; August sale refunded in September.
  await sale(A, {
    loc: l0,
    lines: [
      { product: P1, unit: 2500, qty: 2, taxable: true },
      { product: P2, unit: 1000, qty: 1, taxable: false },
    ],
    completedAt: sj("2026-09-15 12:00:00-04"),
  });
  await sale(A, {
    loc: l1,
    lines: [{ product: P1, unit: 2500, qty: 1, taxable: true }],
    completedAt: sj("2026-09-18 12:00:00-04"),
    refundedAt: sj("2026-09-25 12:00:00-04"),
  });
  await sale(A, {
    loc: l0,
    lines: [{ product: P1, unit: 2500, qty: 1, taxable: true }],
    completedAt: sj("2026-08-28 12:00:00-04"),
    refundedAt: sj("2026-09-02 12:00:00-04"),
  });
}, 120_000);
afterAll(async () => {
  await t?.drop();
});

// ── Direct counts, written independently of the migration (all fixture locations are in Puerto Rico time).
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;
const MONTH = `date_trunc('month', now() AT TIME ZONE '${TZ}')`;
const WEEK = `date_trunc('week', now() AT TIME ZONE '${TZ}')`;
const L = (col: string) => `($1::uuid IS NULL OR ${col} = $1)`;

async function directKpis(tx: Tx, loc: string | null, role: Role) {
  const n = async (sql: string) =>
    Number((await tx.query<{ n: string }>(sql, sql.includes("$1") ? [loc] : [])).rows[0]?.n ?? 0);
  const k: Record<string, number | null> = {
    members_active: await n(
      `SELECT count(*) AS n FROM app.member WHERE status = 'active' AND ${L("home_location_id")}`,
    ),
    members_new_month: await n(
      `SELECT count(*) AS n FROM app.member WHERE created_at AT TIME ZONE '${TZ}' >= ${MONTH} AND ${L("home_location_id")}`,
    ),
    members_cancelled_month: await n(
      `SELECT count(DISTINCT member_id) AS n FROM app.subscription
        WHERE status = 'cancelled' AND cancelled_at AT TIME ZONE '${TZ}' >= ${MONTH} AND ${L("location_id")}`,
    ),
    check_ins_today: await n(
      `SELECT count(*) AS n FROM app.check_in WHERE result = 'allowed'
          AND (at AT TIME ZONE '${TZ}')::date = ${TODAY} AND ${L("location_id")}`,
    ),
    check_ins_week: await n(
      `SELECT count(*) AS n FROM app.check_in WHERE result = 'allowed'
          AND at AT TIME ZONE '${TZ}' >= ${WEEK} AND ${L("location_id")}`,
    ),
    class_seats_week: await n(
      `SELECT coalesce(sum(capacity), 0) AS n FROM app.class_session WHERE NOT cancelled
          AND starts_at AT TIME ZONE '${TZ}' >= ${WEEK} AND starts_at AT TIME ZONE '${TZ}' < ${WEEK} + interval '7 days'
          AND ${L("location_id")}`,
    ),
    class_booked_week: await n(
      `SELECT count(*) AS n FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
        WHERE NOT s.cancelled AND b.status IN ('booked','attended','no_show')
          AND s.starts_at AT TIME ZONE '${TZ}' >= ${WEEK} AND s.starts_at AT TIME ZONE '${TZ}' < ${WEEK} + interval '7 days'
          AND ${L("s.location_id")}`,
    ),
    invoiced_today_cents: await n(
      `SELECT coalesce(sum(total_cents), 0) AS n FROM app.invoice WHERE status <> 'void'
          AND (issued_at AT TIME ZONE '${TZ}')::date = ${TODAY} AND ${L("location_id")}`,
    ),
    sessions_sold_today: await n(
      `SELECT coalesce(sum(il.quantity), 0) AS n FROM app.invoice i
         JOIN app.invoice_line il ON il.invoice_id = i.id JOIN app.plan_product p ON p.id = il.product_id
        WHERE i.status <> 'void' AND p.kind IN ('drop_in','day_pass','class_pack','pt_package')
          AND (i.issued_at AT TIME ZONE '${TZ}')::date = ${TODAY} AND ${L("i.location_id")}`,
    ),
    collected_today_cents: await n(
      `SELECT coalesce(sum(amount_cents), 0) AS n FROM app.payment WHERE status = 'succeeded'
          AND (received_at AT TIME ZONE '${TZ}')::date = ${TODAY} AND ${L("location_id")}`,
    ),
    store_sales_today_cents: await n(
      `SELECT coalesce(sum(total_cents), 0) AS n FROM app.sale WHERE status = 'completed'
          AND (completed_at AT TIME ZONE '${TZ}')::date = ${TODAY} AND ${L("location_id")}`,
    ),
    overdue_invoices: await n(
      `SELECT count(*) AS n FROM app.invoice WHERE status = 'open' AND due_date < ${TODAY} AND ${L("location_id")}`,
    ),
    overdue_balance_cents: await n(
      `SELECT coalesce(sum(i.total_cents) - (SELECT coalesce(sum(p.amount_cents), 0) FROM app.payment p
                JOIN app.invoice i2 ON i2.id = p.invoice_id
               WHERE p.status = 'succeeded' AND i2.status = 'open' AND i2.due_date < ${TODAY} AND ${L("i2.location_id")}), 0) AS n
         FROM app.invoice i WHERE i.status = 'open' AND i.due_date < ${TODAY} AND ${L("i.location_id")}`,
    ),
    expiring_credits_7d: await n(
      `SELECT count(*) AS n FROM app.credit_balance WHERE credits_remaining > 0
          AND expires_at BETWEEN now() AND now() + interval '7 days' AND ${L("location_id")}`,
    ),
    expiring_passes_7d: await n(
      `SELECT count(*) AS n FROM app.access_pass
        WHERE valid_to BETWEEN now() AND now() + interval '7 days' AND ${L("location_id")}`,
    ),
    expiring_memberships_7d: await n(
      `SELECT count(*) AS n FROM app.subscription WHERE status <> 'cancelled' AND cancel_at_period_end
          AND current_period_end BETWEEN ${TODAY} AND ${TODAY} + 7 AND ${L("location_id")}`,
    ),
    leads_open: await n(
      `SELECT count(*) AS n FROM app.lead WHERE stage NOT IN ('won','lost') AND ${L("location_id")}`,
    ),
    leads_won_month: await n(
      `SELECT count(*) AS n FROM app.lead WHERE stage = 'won'
          AND stage_changed_at AT TIME ZONE '${TZ}' >= ${MONTH} AND ${L("location_id")}`,
    ),
    low_stock_products: await n(
      `SELECT count(*) AS n FROM app.inventory_level WHERE on_hand - reserved <= reorder_point AND ${L("location_id")}`,
    ),
  };
  if (role === "owner")
    k.points_liability = await n(
      "SELECT coalesce(sum(b), 0) AS n FROM (SELECT greatest(sum(delta), 0) AS b FROM app.points_ledger GROUP BY member_id) s",
    );
  return k;
}

async function dashboard(org: OrgFixture, role: Role, loc: string | null) {
  return asCaller(t.api, t.claims(org, role), async (tx) => {
    const d = (await tx.query("SELECT app.report_dashboard($1) AS d", [loc])).rows[0].d;
    const direct = await directKpis(tx, loc, role);
    return { d, direct };
  });
}

describe("panel KPIs equal direct counts for the same caller", () => {
  it.each([
    ["owner", null],
    ["owner", 0],
    ["owner", 1],
    ["location_manager", null],
    ["location_manager", 0],
  ] as Array<[Role, number | null]>)("%s, location %s", async (role, idx) => {
    const loc = idx === null ? null : t.fx.A.locations[idx];
    const { d, direct } = await dashboard(t.fx.A, role, loc);
    expect(d).toMatchObject(direct);
    const pct = direct.class_seats_week
      ? Math.round((1000 * (direct.class_booked_week ?? 0)) / direct.class_seats_week) / 10
      : null;
    expect(d.class_occupancy_pct).toBe(pct);
  });

  it("the fixtures make every KPI non-trivial (owner, whole org)", async () => {
    const { d } = await dashboard(t.fx.A, "owner", null);
    for (const k of [
      "members_active",
      "members_new_month",
      "members_cancelled_month",
      "check_ins_today",
      "check_ins_week",
      "class_booked_week",
      "invoiced_today_cents",
      "sessions_sold_today",
      "collected_today_cents",
      "store_sales_today_cents",
      "overdue_invoices",
      "overdue_balance_cents",
      "expiring_credits_7d",
      "expiring_passes_7d",
      "expiring_memberships_7d",
      "leads_open",
      "leads_won_month",
      "low_stock_products",
      "points_liability",
    ])
      expect(d[k], k).toBeGreaterThan(0);
    // Known values from this file's fixtures: 2 sessions today at loc0 + 1 from the billing fixture (loc1);
    // the void invoice of 5 sessions is excluded. Overdue: 1673 − 500 at loc0 + 1673 at loc1.
    expect(d.sessions_sold_today).toBe(3);
    expect(d.overdue_balance_cents).toBe(1673 - 500 + 1673);
    expect(d.class_seats_week).toBeGreaterThanOrEqual(10);
    expect(d.members_cancelled_month).toBe(1);
  });

  it("the location manager only counts their location; another location is refused", async () => {
    const lm = await dashboard(t.fx.A, "location_manager", null);
    const own = await dashboard(t.fx.A, "owner", t.fx.A.locations[0]);
    for (const k of [
      "check_ins_today",
      "overdue_invoices",
      "overdue_balance_cents",
      "invoiced_today_cents",
      "members_active",
    ])
      expect(lm.d[k], k).toBe(own.d[k]);
    expect(lm.d.overdue_balance_cents).toBe(1673 - 500);
    expect(lm.d).not.toHaveProperty("points_liability");
    await refused(t.fx.A, "location_manager", "SELECT app.report_dashboard($1)", [
      t.fx.A.locations[1],
    ]);
  });

  it("other organisation: its location is refused and its panel never counts this org's rows", async () => {
    await refused(t.fx.A, "owner", "SELECT app.report_dashboard($1)", [t.fx.B.locations[0]]);
    await refused(t.fx.A, "owner", "SELECT app.report_dashboard($1)", [
      "00000000-0000-4000-8000-000000000000",
    ]);
    const b = await dashboard(t.fx.B, "owner", null);
    expect(b.d).toMatchObject(b.direct);
    expect(b.d.check_ins_today).toBe(1); // B's fixture check-in only
    expect(b.d.sessions_sold_today).toBe(1);
    expect(b.d.overdue_invoices).toBe(0);
  });

  it.each([
    "front_desk",
    "trainer",
    "nutritionist",
    "chef",
    "clinician",
    "accountant",
    "member",
    "guardian",
  ] as Role[])("%s cannot read the panel", async (role) => {
    await refused(t.fx.A, role, "SELECT app.report_dashboard(NULL)");
  });

  it("no claims → refused (fails closed)", async () => {
    const c = await t.api.pool.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE app_authenticated");
      await expect(c.query("SELECT app.report_dashboard(NULL)")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

describe("front desk 'Hoy'", () => {
  it("counts equal direct counts and carry no revenue figures", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      const d = (await tx.query("SELECT app.report_today(NULL) AS d", [])).rows[0].d;
      const n = async (sql: string) => Number((await tx.query(sql)).rows[0].n);
      expect(d.check_ins_today).toBe(
        await n(
          `SELECT count(*) AS n FROM app.check_in WHERE result = 'allowed' AND (at AT TIME ZONE '${TZ}')::date = ${TODAY}`,
        ),
      );
      expect(d.check_ins_denied_today).toBe(
        await n(
          `SELECT count(*) AS n FROM app.check_in WHERE result = 'denied' AND (at AT TIME ZONE '${TZ}')::date = ${TODAY}`,
        ),
      );
      expect(d.overdue_invoices).toBe(
        await n(
          `SELECT count(*) AS n FROM app.invoice WHERE status = 'open' AND due_date < ${TODAY}`,
        ),
      );
      expect(d.overdue_invoices).toBe(1); // loc0 only
      const today = d.classes_today as Array<Record<string, unknown>>;
      const salon = today.find((c) => c.room === "Salon Hoy");
      expect(salon).toMatchObject({ capacity: 10, booked: 3, waitlisted: 1 });
      // No money anywhere in the payload.
      const keys = JSON.stringify(d);
      expect(keys).not.toMatch(/cents|revenue|invoiced|collected|liability|amount|total/);
    });
  });

  it("front desk overdue list is the desk's own location, balance = total − payments", async () => {
    const rows = await asCaller(
      t.api,
      t.claims(t.fx.A, "front_desk"),
      async (tx) => (await tx.query("SELECT * FROM app.report_overdue(NULL)")).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: "Demo Nueva Socia",
      location_id: t.fx.A.locations[0],
      days_overdue: 5,
      balance_cents: "1173",
    });
    await refused(t.fx.A, "front_desk", "SELECT * FROM app.report_overdue($1)", [
      t.fx.A.locations[1],
    ]);
  });

  it.each([
    "trainer",
    "nutritionist",
    "chef",
    "clinician",
    "accountant",
    "member",
    "guardian",
  ] as Role[])("%s cannot read 'Hoy' or the overdue list", async (role) => {
    await refused(t.fx.A, role, "SELECT app.report_today(NULL)");
    await refused(t.fx.A, role, "SELECT * FROM app.report_overdue(NULL)");
  });

  it("front desk cannot read any revenue-bearing report", async () => {
    for (const sql of [
      "SELECT app.report_dashboard(NULL)",
      "SELECT * FROM app.report_ivu('2026-09-01', NULL)",
      "SELECT * FROM app.report_sales('2026-09-01', '2026-09-30', NULL)",
      "SELECT * FROM app.report_heatmap(NULL, 4)",
      "SELECT * FROM app.report_expiring(NULL, 7)",
      "SELECT * FROM app.report_member_status(NULL)",
    ])
      await refused(t.fx.A, "front_desk", sql);
  });
});

describe("expiring list", () => {
  it("matches the panel counts per kind; credits without sessions left are not listed", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      const d = (await tx.query("SELECT app.report_dashboard(NULL) AS d")).rows[0].d;
      const rows = (await tx.query("SELECT * FROM app.report_expiring(NULL, 7)")).rows;
      const count = (k: string) => rows.filter((r) => r.kind === k).length;
      expect(count("credits")).toBe(d.expiring_credits_7d);
      expect(count("pass")).toBe(d.expiring_passes_7d);
      expect(count("membership")).toBe(d.expiring_memberships_7d);
      expect(rows.find((r) => r.kind === "membership")?.full_name).toBe("Demo Termina Pronto");
      expect(rows.every((r) => r.kind !== "credits" || r.credits_remaining > 0)).toBe(true);
    });
    await refused(t.fx.A, "owner", "SELECT * FROM app.report_expiring(NULL, 0)", [], "22023");
    await refused(t.fx.A, "owner", "SELECT * FROM app.report_expiring(NULL, 32)", [], "22023");
  });
});

describe("peak-hours heatmap", () => {
  it("is the full 7 × 24 grid and every cell equals a direct count (4 and 8 weeks)", async () => {
    for (const weeks of [4, 8]) {
      await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
        const grid = (
          await tx.query(
            "SELECT dow, hour, check_ins::int AS n FROM app.report_heatmap(NULL, $1)",
            [weeks],
          )
        ).rows;
        expect(grid).toHaveLength(168);
        const direct = (
          await tx.query(
            `SELECT extract(isodow FROM at AT TIME ZONE '${TZ}')::int AS dow,
                    extract(hour FROM at AT TIME ZONE '${TZ}')::int AS hour, count(*)::int AS n
               FROM app.check_in WHERE result = 'allowed' AND at >= now() - make_interval(weeks => $1)
              GROUP BY 1, 2`,
            [weeks],
          )
        ).rows;
        const key = (r: { dow: number; hour: number }) => `${r.dow}:${r.hour}`;
        const want = new Map(direct.map((r) => [key(r), r.n]));
        for (const cell of grid) expect(cell.n, key(cell)).toBe(want.get(key(cell)) ?? 0);
        // 3 allowed at 06:15 three days ago (the denied one is excluded); +1 six weeks ago within 8 weeks.
        const six = grid.find((c) => c.dow === heatDow && c.hour === 6);
        expect(six?.n).toBe(weeks === 4 ? 3 : 4);
      });
    }
  });

  it("the manager's heatmap is their location only; bad windows and other roles are refused", async () => {
    const lm = await asCaller(t.api, t.claims(t.fx.A, "location_manager"), async (tx) =>
      Number(
        (await tx.query("SELECT sum(check_ins) AS n FROM app.report_heatmap(NULL, 4)")).rows[0].n,
      ),
    );
    const loc0 = await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) =>
      Number(
        (
          await tx.query("SELECT sum(check_ins) AS n FROM app.report_heatmap($1, 4)", [
            t.fx.A.locations[0],
          ])
        ).rows[0].n,
      ),
    );
    expect(lm).toBe(loc0);
    await refused(t.fx.A, "owner", "SELECT * FROM app.report_heatmap(NULL, 5)", [], "22023");
    for (const role of ["front_desk", "trainer", "accountant", "member"] as Role[])
      await refused(t.fx.A, role, "SELECT * FROM app.report_heatmap(NULL, 4)");
  });
});

describe("IVU report (September 2026)", () => {
  function expected() {
    const rows = new Map<string, Record<string, number>>();
    const add = (
      muni: string,
      src: string,
      docs: number,
      lines: Array<{ unit: number; qty: number; taxable: boolean }>,
      sign = 1,
    ) => {
      const k = `${muni}|${src}`;
      const r = rows.get(k) ?? { documents: 0, taxable: 0, exempt: 0, st: 0, mu: 0 };
      r.documents += docs;
      for (const l of lines) {
        const a = l.unit * l.qty;
        const x = ivu(a, l.taxable);
        if (l.taxable) r.taxable += sign * a;
        else r.exempt += sign * a;
        r.st += sign * x.st;
        r.mu += sign * x.mu;
      }
      rows.set(k, r);
    };
    const [b1, b2, b3] = SEPT.billing;
    add("San Juan", "billing", 1, b1?.lines ?? []);
    add("San Juan", "billing", 1, b3?.lines ?? []);
    add("Bayamón", "billing", 1, b2?.lines ?? []);
    add("San Juan", "store", 1, [
      { unit: 2500, qty: 2, taxable: true },
      { unit: 1000, qty: 1, taxable: false },
    ]);
    add("Bayamón", "store", 1, [{ unit: 2500, qty: 1, taxable: true }]);
    add("Bayamón", "store_refund", 1, [{ unit: 2500, qty: 1, taxable: true }], -1);
    add("San Juan", "store_refund", 1, [{ unit: 2500, qty: 1, taxable: true }], -1);
    return rows;
  }
  const read = (role: Role, loc: string | null = null) =>
    asCaller(
      t.api,
      t.claims(t.fx.A, role),
      async (tx) =>
        (
          await tx.query(
            `SELECT municipality, suri_status, source, documents::int, taxable_base_cents::int AS taxable,
                    exempt_base_cents::int AS exempt, ivu_state_cents::int AS st, ivu_municipal_cents::int AS mu
               FROM app.report_ivu('2026-09-17', $1)`,
            [loc],
          )
        ).rows,
    );

  it("totals equal the sum of the month's fixture lines, by municipality and source", async () => {
    const rows = await read("owner");
    const want = expected();
    expect(rows).toHaveLength(want.size);
    for (const r of rows) {
      const w = want.get(`${r.municipality}|${r.source}`);
      expect(w, `${r.municipality}|${r.source}`).toBeDefined();
      expect({
        documents: r.documents,
        taxable: r.taxable,
        exempt: r.exempt,
        st: r.st,
        mu: r.mu,
      }).toEqual(w);
    }
    // San Juan was recorded as a SURI participant by the owner; Bayamón was not → flagged unverified.
    expect(
      new Set(rows.filter((r) => r.municipality === "San Juan").map((r) => r.suri_status)),
    ).toEqual(new Set(["participant"]));
    expect(
      new Set(rows.filter((r) => r.municipality === "Bayamón").map((r) => r.suri_status)),
    ).toEqual(new Set(["unverified"]));
  });

  it("billing IVU equals the issued, non-void invoices of the month (spec E13 acceptance)", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "accountant"), async (tx) => {
      const r = (
        await tx.query(
          `SELECT sum(ivu_state_cents)::int AS st, sum(ivu_municipal_cents)::int AS mu, sum(documents)::int AS docs
             FROM app.report_ivu('2026-09-01', NULL) WHERE source = 'billing'`,
        )
      ).rows[0];
      const inv = (
        await tx.query(
          `SELECT sum(ivu_state_cents)::int AS st, sum(ivu_municipal_cents)::int AS mu, count(*)::int AS docs
             FROM app.invoice WHERE status <> 'void'
              AND (issued_at AT TIME ZONE '${TZ}') >= '2026-09-01' AND (issued_at AT TIME ZONE '${TZ}') < '2026-10-01'`,
        )
      ).rows[0];
      expect(r).toEqual(inv);
      expect(r.docs).toBe(3);
    });
  });

  it("accountant reads the same org-wide report; the manager only their municipality", async () => {
    expect(await read("accountant")).toEqual(await read("owner"));
    const lm = await read("location_manager");
    expect(lm.length).toBeGreaterThan(0);
    expect(lm.every((r) => r.municipality === "San Juan")).toBe(true);
    expect(lm).toEqual(await read("owner", t.fx.A.locations[0]));
  });

  it.each([
    "front_desk",
    "trainer",
    "nutritionist",
    "chef",
    "clinician",
    "member",
    "guardian",
  ] as Role[])("%s cannot read the IVU report", async (role) => {
    await refused(t.fx.A, role, "SELECT * FROM app.report_ivu('2026-09-01', NULL)");
  });

  it("other org sees none of this org's documents; a foreign location is refused", async () => {
    const b = await asCaller(
      t.api,
      t.claims(t.fx.B, "accountant"),
      async (tx) => (await tx.query("SELECT * FROM app.report_ivu('2026-09-01', NULL)")).rows,
    );
    expect(b).toEqual([]);
    await refused(t.fx.B, "accountant", "SELECT * FROM app.report_ivu('2026-09-01', $1)", [
      t.fx.A.locations[0],
    ]);
  });
});

describe("sales report", () => {
  it("sums equal the month's lines; refunded store sales are excluded; seller names resolve", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "accountant"), async (tx) => {
      const rows = (
        await tx.query(
          "SELECT * FROM app.report_sales('2026-09-01', '2026-09-30', NULL) ORDER BY source, product_name",
        )
      ).rows;
      const sum = (src: string, k: string) =>
        rows.filter((r) => r.source === src).reduce((a, r) => a + Number(r[k]), 0);
      expect(sum("billing", "subtotal_cents")).toBe(2995 + 2500 + 4500 + 1500);
      expect(sum("store", "subtotal_cents")).toBe(5000 + 1000);
      expect(sum("store", "units")).toBe(3);
      const membership = rows.find((r) => r.product_kind === "membership");
      expect(membership?.seller_name).toBe("Demo front_desk A");
      for (const r of rows)
        expect(Number(r.total_cents)).toBe(Number(r.subtotal_cents) + Number(r.ivu_cents));
    });
  });

  it("range and role guards", async () => {
    await refused(
      t.fx.A,
      "owner",
      "SELECT * FROM app.report_sales('2025-01-01', '2026-09-30', NULL)",
      [],
      "22023",
    );
    await refused(
      t.fx.A,
      "owner",
      "SELECT * FROM app.report_sales('2026-09-30', '2026-09-01', NULL)",
      [],
      "22023",
    );
    for (const role of ["front_desk", "trainer", "member", "guardian", "chef"] as Role[])
      await refused(
        t.fx.A,
        role,
        "SELECT * FROM app.report_sales('2026-09-01', '2026-09-30', NULL)",
      );
  });
});

describe("members report", () => {
  it("status counts and this month's flow equal direct counts and the panel", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      const status = (
        await tx.query("SELECT status, members::int FROM app.report_member_status(NULL)")
      ).rows;
      const direct = (
        await tx.query("SELECT status::text, count(*)::int AS members FROM app.member GROUP BY 1")
      ).rows;
      for (const s of status)
        expect(s.members, s.status).toBe(direct.find((d) => d.status === s.status)?.members ?? 0);
      expect(status).toHaveLength(6);
      const flow = (
        await tx.query(
          "SELECT month, joins::int, cancellations::int FROM app.report_member_flow(NULL, 3)",
        )
      ).rows;
      expect(flow).toHaveLength(3);
      const d = (await tx.query("SELECT app.report_dashboard(NULL) AS d")).rows[0].d;
      expect(flow[0].joins).toBe(d.members_new_month);
      expect(flow[0].cancellations).toBe(d.members_cancelled_month);
    });
    await refused(t.fx.A, "owner", "SELECT * FROM app.report_member_flow(NULL, 25)", [], "22023");
    for (const role of ["accountant", "front_desk", "trainer", "member"] as Role[])
      await refused(t.fx.A, role, "SELECT * FROM app.report_member_status(NULL)");
  });
});

describe("ivu_municipality (owner records SURI participation)", () => {
  const INSERT =
    "INSERT INTO app.ivu_municipality (municipality, suri_status, note) VALUES ($1, $2, $3) RETURNING id, updated_by";

  it("owner records and changes a municipality; actor is forced and each change is audited", async () => {
    const row = await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      const r = (await tx.query(INSERT, ["Bayamón", "non_participant", "Demo: verificar con CPA"]))
        .rows[0];
      await tx.query("UPDATE app.ivu_municipality SET suri_status = 'participant' WHERE id = $1", [
        r.id,
      ]);
      return r;
    });
    expect(row.updated_by).toBe(t.fx.A.people.owner);
    const audit = await t.admin.query(
      "SELECT action, actor_person_id, actor_role, meta FROM app.audit_log WHERE entity = 'ivu_municipality' AND entity_id = $1 ORDER BY id",
      [row.id],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "ivu_municipality.create",
      "ivu_municipality.update",
    ]);
    expect(audit.rows[1]).toMatchObject({
      actor_person_id: t.fx.A.people.owner,
      actor_role: "owner",
      meta: { municipality: "Bayamón", suri_status: "participant", previous: "non_participant" },
    });
    // The report now shows Bayamón as a participant.
    const ivuRows = await asCaller(
      t.api,
      t.claims(t.fx.A, "owner"),
      async (tx) =>
        (
          await tx.query("SELECT DISTINCT suri_status FROM app.report_ivu('2026-09-01', $1)", [
            t.fx.A.locations[1],
          ])
        ).rows,
    );
    expect(ivuRows).toEqual([{ suri_status: "participant" }]);
  });

  it.each([
    "location_manager",
    "accountant",
    "front_desk",
    "trainer",
    "member",
    "guardian",
  ] as Role[])("%s cannot record or change a municipality", async (role) => {
    await refused(t.fx.A, role, INSERT, ["Caguas", "participant", null]);
    const upd = await asCaller(t.api, t.claims(t.fx.A, role), (tx) =>
      tx.query("UPDATE app.ivu_municipality SET note = 'x' WHERE municipality = 'San Juan'"),
    ).catch((e) => e);
    // Either no UPDATE privilege on the visible row set (0 rows) or refused outright.
    if (upd instanceof Error) expect(upd).toMatchObject({ code: "42501" });
    else expect(upd.rowCount).toBe(0);
  });

  it("only the managers and the accountant can read it; other roles see nothing", async () => {
    for (const role of ALL_ROLES) {
      const n = await asCaller(t.api, t.claims(t.fx.A, role), async (tx) =>
        Number((await tx.query("SELECT count(*) AS n FROM app.ivu_municipality")).rows[0].n),
      );
      if (["owner", "location_manager", "accountant"].includes(role))
        expect(n, role).toBeGreaterThan(0);
      else expect(n, role).toBe(0);
    }
  });

  it("forbidden columns: org_id, updated_by, updated_at and the name are not writable", async () => {
    for (const set of [
      `org_id = '${t.fx.B.orgId}'`,
      `updated_by = '${t.fx.A.people.accountant}'`,
      "updated_at = now() - interval '1 year'",
      "municipality = 'Ponce'",
    ])
      await refused(
        t.fx.A,
        "owner",
        `UPDATE app.ivu_municipality SET ${set} WHERE municipality = 'San Juan'`,
      );
    await refused(
      t.fx.A,
      "owner",
      "INSERT INTO app.ivu_municipality (municipality, suri_status, updated_by) VALUES ('Caguas', 'participant', $1)",
      [t.fx.A.people.accountant],
    );
    await refused(
      t.fx.A,
      "owner",
      "INSERT INTO app.ivu_municipality (org_id, municipality, suri_status) VALUES ($1, 'Caguas', 'participant')",
      [t.fx.B.orgId],
    );
  });

  it("an update re-stamps the actor and time (a stale updated_by cannot survive a change)", async () => {
    await t.admin.query(
      "UPDATE app.ivu_municipality SET updated_by = $2, updated_at = now() - interval '1 year' WHERE org_id = $1 AND municipality = 'San Juan'",
      [t.fx.A.orgId, t.fx.A.people.accountant],
    );
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      tx.query(
        "UPDATE app.ivu_municipality SET note = 'Demo: revisado' WHERE municipality = 'San Juan'",
      ),
    );
    const r = await q1<{ updated_by: string; fresh: boolean }>(
      "SELECT updated_by, updated_at > now() - interval '1 minute' AS fresh FROM app.ivu_municipality WHERE org_id = $1 AND municipality = 'San Juan'",
      [t.fx.A.orgId],
    );
    expect(r).toEqual({ updated_by: t.fx.A.people.owner, fresh: true });
  });

  it("other org's rows are invisible and unchangeable", async () => {
    const upd = await asCaller(t.api, t.claims(t.fx.B, "owner"), (tx) =>
      tx.query(
        "UPDATE app.ivu_municipality SET suri_status = 'non_participant' WHERE org_id = $1",
        [t.fx.A.orgId],
      ),
    );
    expect(upd.rowCount).toBe(0);
    const still = await q1<{ s: string }>(
      "SELECT suri_status AS s FROM app.ivu_municipality WHERE org_id = $1 AND municipality = 'San Juan'",
      [t.fx.A.orgId],
    );
    expect(still.s).toBe("participant");
  });

  it("hostile input: links, digits, control characters, overlong notes are rejected", async () => {
    for (const [name, note] of [
      ["http://evil.example", null],
      ["San Juan 2", null],
      ["Ponce\nX", null],
      ["=HYPERLINK(1)", null],
      ["Caguas", "x".repeat(301)],
      ["Caguas", "línea\u0007"],
    ] as Array<[string, string | null]>)
      await refused(t.fx.A, "owner", INSERT, [name, "participant", note], "23514");
    // Same name in another case → duplicate.
    await refused(t.fx.A, "owner", INSERT, ["SAN JUAN", "participant", null], "23505");
  });

  it("concurrency: two owners recording the same municipality → exactly one row, the second gets 23505", async () => {
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, t.claims(t.fx.A, "owner"));
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, t.claims(t.fx.A, "owner"));
      await c1.query(INSERT, ["Guaynabo", "participant", null]);
      const second = c2.query(INSERT, ["guaynabo", "non_participant", null]).then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
      // c2 waits on c1's unique-index entry; it must not have finished yet.
      const raced = await Promise.race([
        second,
        new Promise((r) => setTimeout(() => r("waiting"), 300)),
      ]);
      expect(raced).toBe("waiting");
      await c1.query("COMMIT");
      expect(await second).toBe("23505");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    const n = await q1<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.ivu_municipality WHERE org_id = $1 AND lower(municipality) = 'guaynabo'",
      [t.fx.A.orgId],
    );
    expect(n.n).toBe(1);
  });
});

const REPORT_FUNCTIONS = [
  "rpt_guard",
  "rpt_local",
  "rpt_invoice_balance",
  "report_dashboard",
  "report_overdue",
  "report_expiring",
  "report_heatmap",
  "report_today",
  "report_ivu",
  "report_sales",
  "report_member_status",
  "report_member_flow",
  "report_log_export",
];

describe("export audit (report_log_export)", () => {
  it("writes report.export with the real actor; the role gate mirrors each report", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "accountant"), (tx) =>
      tx.query("SELECT app.report_log_export('ivu', NULL, $1)", [{ month: "2026-09" }]),
    );
    const a = await q1<{ actor_person_id: string; actor_role: string; meta: unknown }>(
      "SELECT actor_person_id, actor_role, meta FROM app.audit_log WHERE action = 'report.export' AND entity_id = 'ivu' ORDER BY id DESC LIMIT 1",
    );
    expect(a).toMatchObject({
      actor_person_id: t.fx.A.people.accountant,
      actor_role: "accountant",
      meta: { month: "2026-09" },
    });
    await refused(t.fx.A, "front_desk", "SELECT app.report_log_export('ivu', NULL, '{}')");
    await refused(t.fx.A, "accountant", "SELECT app.report_log_export('overdue', NULL, '{}')");
    await refused(t.fx.A, "trainer", "SELECT app.report_log_export('heatmap', NULL, '{}')");
    await refused(
      t.fx.A,
      "owner",
      "SELECT app.report_log_export('payroll', NULL, '{}')",
      [],
      "22023",
    );
    await refused(t.fx.A, "owner", "SELECT app.report_log_export('ivu', $1, '{}')", [
      t.fx.B.locations[0],
    ]);
    await refused(t.fx.A, "location_manager", "SELECT app.report_log_export('ivu', $1, '{}')", [
      t.fx.A.locations[1],
    ]);
  });

  it("request traffic cannot call app.audit directly or the internal trigger function", async () => {
    await refused(t.fx.A, "owner", "SELECT app.audit('x', 'y', NULL, NULL, '{}')");
    await refused(t.fx.A, "owner", "SELECT app.ivu_municipality_audit_trigger()");
  });

  it("the read models are invoker-rights: none of them is SECURITY DEFINER", async () => {
    const r = await t.admin.query(
      "SELECT proname, prosecdef FROM pg_proc WHERE pronamespace = 'app'::regnamespace AND proname = ANY($1)",
      [REPORT_FUNCTIONS],
    );
    expect(r.rows).toHaveLength(REPORT_FUNCTIONS.length);
    for (const f of r.rows) expect(f.prosecdef, f.proname).toBe(f.proname === "report_log_export");
    const pub = await t.admin.query(
      `SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.proname = ANY($1)
          AND has_function_privilege('public', p.oid, 'EXECUTE')`,
      [[...REPORT_FUNCTIONS, "ivu_municipality_stamp", "ivu_municipality_audit_trigger"]],
    );
    expect(pub.rows).toEqual([]);
  });
});

describe("connection-level sanity", () => {
  it("the API login role cannot call a report without switching role", async () => {
    const c = new pg.Client({ connectionString: t.apiUrl });
    await c.connect();
    await expect(c.query("SELECT app.report_dashboard(NULL)")).rejects.toMatchObject({
      code: "42501",
    });
    await c.end();
  });
});
