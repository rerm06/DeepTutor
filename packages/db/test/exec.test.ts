import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billingFx } from "../src/fixtures/billing.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Module exec (executive dashboard, migration 0019). One invoker read model; every figure must equal what the same
// caller can count in the module tables, and agree with the reports (0014) and finance (0013) read models.
// Extra rows are inserted here as the superuser in this file's own database. Two extra organisations:
// C stays empty (zeros, never nulls) and D carries hand-built renewal / class / member-history scenarios.

let t: TestDb;
const TZ = "America/Puerto_Rico";
const OTHER: Role[] = [
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
  "member",
  "guardian",
];

type Kpi = { value: number | null; prev: number | null; series: Array<number | null> };
interface Exec {
  as_of: string;
  currency: string;
  months: string[];
  kpis: Record<string, Kpi>;
  revenue_vs_expenses: Array<{ month: string; revenue_cents: number; expenses_cents: number }>;
  new_members: Array<{ month: string; joins: number; cancellations: number }>;
  member_status: Record<string, number>;
  sales_mix: Array<{
    kind: string;
    label_es: string;
    label_en: string;
    units: number;
    revenue_cents: number;
  }>;
}

async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await t.admin.query(sql, params);
  return rows[0] as T;
}
const rnd = () => Math.random().toString(36).slice(2, 8);

async function run<T>(
  org: OrgFixture,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asCaller(
    t.api,
    t.claims(org, role),
    async (tx) => (await tx.query(sql, params)).rows as T[],
  );
}
async function exec(org: OrgFixture, role: Role, loc: string | null = null): Promise<Exec> {
  const rows = await run<{ r: Exec }>(org, role, "SELECT app.report_executive($1) AS r", [loc]);
  return rows[0]?.r as Exec;
}
async function refused(org: OrgFixture, role: Role, sql: string, params: unknown[] = []) {
  await expect(
    asCaller(t.api, t.claims(org, role), (tx) => tx.query(sql, params)),
  ).rejects.toMatchObject({ code: "42501" });
}

/** A bare organisation (one location, an owner person) that the fixtures never touched. */
async function bareOrg(label: string): Promise<OrgFixture> {
  const org = await q1<{ id: string }>(
    "INSERT INTO app.organization (name) VALUES ($1) RETURNING id",
    [`Demo ${label}`],
  );
  const le = await q1<{ id: string }>(
    "INSERT INTO app.legal_entity (org_id, legal_name) VALUES ($1, $2) RETURNING id",
    [org.id, `Demo ${label} LLC`],
  );
  const brand = await q1<{ id: string }>(
    "INSERT INTO app.brand (org_id, legal_entity_id, name) VALUES ($1,$2,$3) RETURNING id",
    [org.id, le.id, `Demo ${label}`],
  );
  const loc = await q1<{ id: string }>(
    "INSERT INTO app.location (org_id, brand_id, legal_entity_id, name, municipality) VALUES ($1,$2,$3,$4,'Ponce') RETURNING id",
    [org.id, brand.id, le.id, `Demo ${label} Sede`],
  );
  const people = {} as Record<Role, string>;
  for (const role of ["owner", "location_manager", "front_desk"] as Role[]) {
    people[role] = (
      await q1<{ id: string }>("INSERT INTO app.person (email) VALUES ($1) RETURNING id", [
        `${role}.${label.toLowerCase()}.${rnd()}@demo.invalid`,
      ])
    ).id;
  }
  return {
    orgId: org.id,
    brandId: brand.id,
    locations: [loc.id, loc.id],
    people,
    members: ["", ""],
  } as OrgFixture;
}
async function memberOf(org: OrgFixture, status: string, createdAt = "now()"): Promise<string> {
  const p = await q1<{ id: string }>("INSERT INTO app.person (email) VALUES ($1) RETURNING id", [
    `exec.${rnd()}@demo.invalid`,
  ]);
  return (
    await q1<{ id: string }>(
      `INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status, created_at)
       VALUES ($1,$2,$3,$4,$5, ${createdAt}) RETURNING id`,
      [org.orgId, p.id, org.locations[0], `Demo Exec ${rnd()}`, status],
    )
  ).id;
}

let C: OrgFixture; // empty
let D: OrgFixture; // scenarios
const D_ = { dropIn: "", dropPrice: "", pack: "", packPrice: "", plan: "", planPrice: "", ct: "" };

/** Zero-total paid invoice in org D (an entitlement needs one). */
async function dInvoice(member: string, issued: string): Promise<string> {
  const le = await q1<{ legal_entity_id: string }>(
    "SELECT legal_entity_id FROM app.location WHERE id = $1",
    [D.locations[0]],
  );
  const no = await q1<{ n: number }>(
    "SELECT coalesce(max(number), 0) + 1 AS n FROM app.invoice WHERE legal_entity_id = $1",
    [le.legal_entity_id],
  );
  return (
    await q1<{ id: string }>(
      `INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, subtotal_cents,
         ivu_state_cents, ivu_municipal_cents, total_cents, application_fee_bps, application_fee_cents, status,
         issued_at, due_date, paid_at, created_by)
       VALUES ($1,$2,$3,$4,$5,0,0,0,0,100,0,'paid', ${issued}, current_date, ${issued}, $6) RETURNING id`,
      [D.orgId, le.legal_entity_id, no.n, member, D.locations[0], D.people.front_desk],
    )
  ).id;
}
/** Session pass [from, to) — SQL expressions. */
async function pass(member: string, from: string, to: string) {
  const inv = await dInvoice(member, from);
  await t.admin.query(
    `INSERT INTO app.access_pass (org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to, created_at)
     VALUES ($1,$2,$3,$4,$5, ${from}, ${to}, ${from})`,
    [D.orgId, member, D.locations[0], D_.dropIn, inv],
  );
}
async function credits(
  member: string,
  bought: string,
  total: number,
  left: number,
  expires: string,
) {
  const inv = await dInvoice(member, bought);
  await t.admin.query(
    `INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total,
       credits_remaining, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, ${expires}, ${bought})`,
    [D.orgId, member, D_.pack, D.locations[0], inv, total, left],
  );
}
async function visit(org: OrgFixture, member: string, at: string) {
  await t.admin.query(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by, at)
     VALUES ($1,$2,$3,'front_desk','allowed','active',$4, ${at})`,
    [org.orgId, org.locations[0], member, org.people.front_desk],
  );
}

// Local month boundaries (Puerto Rico): start of this month and of month index k of the 12-month grid.
const CUR = `(date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;
const GRID = (k: number) =>
  `((date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '${11 - k} months') AT TIME ZONE '${TZ}')`;

beforeAll(async () => {
  t = await createTestDb();
  C = await bareOrg("C");
  D = await bareOrg("D");

  // ── Org D catalogue
  const prod = async (kind: string, name: string) =>
    (
      await q1<{ id: string }>(
        "INSERT INTO app.plan_product (org_id, kind, name) VALUES ($1,$2,$3) RETURNING id",
        [D.orgId, kind, name],
      )
    ).id;
  D_.dropIn = await prod("drop_in", "Demo sesión");
  D_.pack = await prod("class_pack", "Demo paquete");
  D_.plan = await prod("membership", "Demo plan");
  D_.dropPrice = (
    await q1<{ id: string }>(
      "INSERT INTO app.price (org_id, product_id, amount_cents) VALUES ($1,$2,1500) RETURNING id",
      [D.orgId, D_.dropIn],
    )
  ).id;
  D_.planPrice = (
    await q1<{ id: string }>(
      "INSERT INTO app.price (org_id, product_id, amount_cents, billing_interval) VALUES ($1,$2,4000,'month') RETURNING id",
      [D.orgId, D_.plan],
    )
  ).id;

  // ── Org D renewal scenarios (relative to now()). Members created at the start of grid month 5 + 1 day.
  const created = `${GRID(5)} + interval '1 day'`;
  const m = async () => memberOf(D, "active", created);
  const ago = (d: number) => `now() - interval '${d} days'`;
  // m1: ran out 35 d ago, bought again 25 d ago → renewed (decided 25 d ago); the new pass is still pending.
  const m1 = await m();
  await pass(m1, ago(36), ago(35));
  await pass(m1, ago(25), ago(24));
  // m2: ran out 45 d ago, nothing since → not renewed (decided 15 d ago).
  const m2 = await m();
  await pass(m2, ago(46), ago(45));
  // m3: 2-credit pack used up by its 2nd check-in 38 d ago; a pass 10 d ago → renewed (decided 10 d ago).
  const m3 = await m();
  await credits(m3, ago(40), 2, 0, "now() + interval '80 days'");
  await visit(D, m3, ago(39));
  await visit(D, m3, ago(38));
  await pass(m3, ago(10), ago(9));
  // m4: a pass that ends while a live pack covers it → never "ran out".
  const m4 = await m();
  await credits(m4, ago(21), 5, 3, "now() + interval '30 days'");
  await pass(m4, ago(20), ago(19));
  // m5: ran out 70 d ago, nothing → not renewed (decided 40 d ago: previous period).
  const m5 = await m();
  await pass(m5, ago(71), ago(70));
  // m6: ran out 79 d ago, a live pack bought 55 d ago → renewed (decided 55 d ago: previous period).
  const m6 = await m();
  await pass(m6, ago(80), ago(79));
  await credits(m6, ago(55), 10, 4, "now() + interval '60 days'");
  // m7: ran out 4 d ago → still pending, not counted.
  const m7 = await m();
  await pass(m7, ago(5), ago(4));

  // ── Org D member history: J joined this month; K cancelled 10 days before this month; F frozen across the
  // last day of last month; L is a lead.
  await memberOf(D, "active", `least(${CUR} + interval '1 hour', now())`);
  await memberOf(D, "lead", created);
  const K = await memberOf(D, "cancelled", created);
  const F = await memberOf(D, "frozen", created);
  const sub = async (member: string, status: string, cancelled: string | null) =>
    (
      await q1<{ id: string }>(
        `INSERT INTO app.subscription (org_id, member_id, product_id, price_id, location_id, status, billing_interval,
           start_date, current_period_start, current_period_end, cancel_at_period_end, cancel_requested_at,
           cancelled_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'month', current_date - 120, current_date - 20, current_date + 10,
           ${cancelled ? "true" : "false"}, ${cancelled ? `${cancelled} - interval '3 days'` : "NULL"},
           ${cancelled ?? "NULL"}, $7) RETURNING id`,
        [D.orgId, member, D_.plan, D_.planPrice, D.locations[0], status, D.people.front_desk],
      )
    ).id;
  await sub(K, "cancelled", `${CUR} - interval '10 days'`);
  const fs = await sub(F, "frozen", null);
  await t.admin.query(
    `INSERT INTO app.subscription_freeze (org_id, subscription_id, member_id, location_id, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4, (${CUR} AT TIME ZONE '${TZ}')::date - 5, (${CUR} AT TIME ZONE '${TZ}')::date + 20, $5)`,
    [D.orgId, fs, F, D.locations[0], D.people.front_desk],
  );

  // ── Org D classes: today 2 (one cancelled), 7 days ago 3, 13 days ago 1, 14 days ago 1 (outside the series).
  D_.ct = (
    await q1<{ id: string }>(
      "INSERT INTO app.class_type (org_id, name) VALUES ($1, 'Demo Spinning') RETURNING id",
      [D.orgId],
    )
  ).id;
  const cls = async (daysAgo: number, hour: number, cancelled = false) =>
    t.admin.query(
      `INSERT INTO app.class_session (org_id, location_id, class_type_id, starts_at, ends_at, capacity, cancelled, created_by)
       VALUES ($1,$2,$3, (((now() AT TIME ZONE '${TZ}')::date - ${daysAgo}) + time '${hour}:00') AT TIME ZONE '${TZ}',
               (((now() AT TIME ZONE '${TZ}')::date - ${daysAgo}) + time '${hour}:45') AT TIME ZONE '${TZ}',
               10, $4, $5)`,
      [D.orgId, D.locations[0], D_.ct, cancelled, D.people.owner],
    );
  await cls(0, 6);
  await cls(0, 18, true);
  for (const h of [6, 12, 18]) await cls(7, h);
  await cls(13, 7);
  await cls(14, 7);
}, 120_000);

afterAll(async () => {
  await t?.drop();
});

// ── Direct counts as the same caller ──────────────────────────────────────────────────────────────────────
const LOC_FILTER = "($1::uuid IS NULL OR x.location_id = $1)";
async function directRevenue(org: OrgFixture, role: Role, loc: string | null) {
  const rows = await run<{ month: string; c: string }>(
    org,
    role,
    `SELECT to_char(x.m, 'YYYY-MM') AS month, sum(x.c)::bigint AS c FROM (
       SELECT p.location_id, date_trunc('month', p.received_at AT TIME ZONE l.timezone) AS m, p.amount_cents AS c
         FROM app.payment p JOIN app.location l ON l.id = p.location_id WHERE p.status = 'succeeded'
       UNION ALL
       SELECT s.location_id, date_trunc('month', s.completed_at AT TIME ZONE l.timezone), s.total_cents
         FROM app.sale s JOIN app.location l ON l.id = s.location_id WHERE s.status IN ('completed', 'refunded')
       UNION ALL
       SELECT s.location_id, date_trunc('month', s.refunded_at AT TIME ZONE l.timezone), -s.total_cents
         FROM app.sale s JOIN app.location l ON l.id = s.location_id WHERE s.status = 'refunded') x
      WHERE ${LOC_FILTER} GROUP BY 1`,
    [loc],
  );
  return new Map(rows.map((r) => [r.month, Number(r.c)]));
}
async function directExpenses(org: OrgFixture, role: Role, loc: string | null) {
  const rows = await run<{ month: string; c: string }>(
    org,
    role,
    `SELECT to_char(x.m, 'YYYY-MM') AS month, sum(x.c)::bigint AS c FROM (
       SELECT e.location_id, date_trunc('month', e.spent_on) AS m, e.amount_cents AS c FROM app.expense e
        WHERE e.voided_at IS NULL
       UNION ALL
       SELECT b.location_id, date_trunc('month', b.issued_on), b.amount_cents FROM app.bill b
        WHERE b.status IN ('approved', 'paid')) x
      WHERE ${LOC_FILTER} GROUP BY 1`,
    [loc],
  );
  return new Map(rows.map((r) => [r.month, Number(r.c)]));
}
async function expectedMonths(): Promise<string[]> {
  const { rows } = await t.admin.query(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE '${TZ}') - make_interval(months => 11 - k), 'YYYY-MM') AS m
       FROM generate_series(0, 11) AS k ORDER BY k`,
  );
  return rows.map((r) => r.m as string);
}

describe("shape", () => {
  it("returns exactly the contract keys, 12 months ending this month (PR time), no nulls", async () => {
    const r = await exec(t.fx.A, "owner");
    expect(Object.keys(r).sort()).toEqual(
      [
        "as_of",
        "currency",
        "kpis",
        "member_status",
        "months",
        "new_members",
        "revenue_vs_expenses",
        "sales_mix",
      ].sort(),
    );
    expect(r.currency).toBe("USD");
    expect(new Date(r.as_of).toISOString()).toBe(r.as_of);
    expect(r.months).toEqual(await expectedMonths());
    expect(Object.keys(r.kpis).sort()).toEqual(
      [
        "active_members",
        "checkins_today",
        "classes_today",
        "net_profit_month_cents",
        "renewal_rate_pct",
        "revenue_month_cents",
      ].sort(),
    );
    for (const [k, v] of Object.entries(r.kpis)) {
      expect(Object.keys(v).sort(), k).toEqual(["prev", "series", "value"]);
      const n = ["checkins_today", "classes_today"].includes(k) ? 14 : 12;
      expect(v.series, k).toHaveLength(n);
      if (k !== "renewal_rate_pct") {
        for (const x of [v.value, v.prev, ...v.series]) expect(Number.isInteger(x), k).toBe(true);
        expect(v.value, k).toBe(v.series[n - 1]);
        // Money KPIs compare month-to-date with the same days last month (tested below), not the full month.
        if (!["revenue_month_cents", "net_profit_month_cents"].includes(k))
          expect(v.prev, k).toBe(v.series[n === 14 ? 6 : 10]);
      }
    }
    expect(r.revenue_vs_expenses.map((x) => x.month)).toEqual(r.months);
    expect(r.new_members.map((x) => x.month)).toEqual(r.months);
    expect(Object.keys(r.member_status).sort()).toEqual(["active", "expired", "frozen", "other"]);
    expect(r.sales_mix.length).toBeLessThanOrEqual(7);
    for (const s of r.sales_mix)
      expect(Object.keys(s).sort()).toEqual([
        "kind",
        "label_en",
        "label_es",
        "revenue_cents",
        "units",
      ]);
  });

  it("an empty organisation gets zeros everywhere (never nulls), an empty mix and a null renewal rate", async () => {
    const r = await exec(C, "owner");
    for (const [k, v] of Object.entries(r.kpis)) {
      if (k === "renewal_rate_pct") {
        expect(v).toEqual({ value: null, prev: null, series: Array(12).fill(null) });
      } else {
        expect(v.value, k).toBe(0);
        expect(v.prev, k).toBe(0);
        expect(
          v.series.every((x) => x === 0),
          k,
        ).toBe(true);
      }
    }
    expect(
      r.revenue_vs_expenses.every((x) => x.revenue_cents === 0 && x.expenses_cents === 0),
    ).toBe(true);
    expect(r.new_members.every((x) => x.joins === 0 && x.cancellations === 0)).toBe(true);
    expect(r.member_status).toEqual({ active: 0, expired: 0, frozen: 0, other: 0 });
    expect(r.sales_mix).toEqual([]);
  });
});

describe("math: every figure equals the underlying rows and the other read models", () => {
  it.each([
    ["owner", null],
    ["owner", 0],
    ["owner", 1],
    ["location_manager", null],
    ["location_manager", 0],
  ] as Array<[Role, number | null]>)(
    "revenue, expenses, net — %s, location %s",
    async (role, idx) => {
      const loc = idx === null ? null : t.fx.A.locations[idx];
      const r = await exec(t.fx.A, role, loc);
      const rev = await directRevenue(t.fx.A, role, loc);
      const exp = await directExpenses(t.fx.A, role, loc);
      r.months.forEach((m, i) => {
        const e = r.revenue_vs_expenses[i];
        expect(e?.revenue_cents, m).toBe(rev.get(m) ?? 0);
        expect(e?.expenses_cents, m).toBe(exp.get(m) ?? 0);
        expect(r.kpis.revenue_month_cents?.series[i], m).toBe(e?.revenue_cents);
        expect(r.kpis.net_profit_month_cents?.series[i], m).toBe(
          (e?.revenue_cents ?? 0) - (e?.expenses_cents ?? 0),
        );
      });
    },
  );

  it("revenue = finance P&L cash in; expenses = finance expenses + bills, for every month (owner)", async () => {
    const r = await exec(t.fx.A, "owner");
    let nonZero = 0;
    for (const [i, m] of r.months.entries()) {
      const rows = await run<{ cash: string; exp: string }>(
        t.fx.A,
        "owner",
        "SELECT sum(cash_in_cents) AS cash, sum(expenses_cents + bills_cents) AS exp FROM app.finance_pnl($1::date)",
        [`${m}-01`],
      );
      expect(r.revenue_vs_expenses[i]?.revenue_cents, m).toBe(Number(rows[0]?.cash ?? 0));
      expect(r.revenue_vs_expenses[i]?.expenses_cents, m).toBe(Number(rows[0]?.exp ?? 0));
      if (Number(rows[0]?.cash ?? 0) !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it("active members, check-ins today, joins/cancellations and status agree with the panel and members report", async () => {
    for (const [role, loc] of [
      ["owner", null],
      ["owner", t.fx.A.locations[1]],
      ["location_manager", null],
    ] as Array<[Role, string | null]>) {
      const r = await exec(t.fx.A, role, loc);
      const [d] = await run<{ d: Record<string, number> }>(
        t.fx.A,
        role,
        "SELECT app.report_dashboard($1) AS d",
        [loc],
      );
      expect(r.kpis.active_members?.value).toBe(d?.d.members_active);
      expect(r.kpis.checkins_today?.value).toBe(d?.d.check_ins_today);
      const flow = await run<{ month: string; joins: string; cancellations: string }>(
        t.fx.A,
        role,
        "SELECT to_char(month, 'YYYY-MM') AS month, joins, cancellations FROM app.report_member_flow($1, 12) ORDER BY month",
        [loc],
      );
      expect(r.new_members).toEqual(
        flow.map((f) => ({
          month: f.month,
          joins: Number(f.joins),
          cancellations: Number(f.cancellations),
        })),
      );
      const st = await run<{ status: string; members: string }>(
        t.fx.A,
        role,
        "SELECT status, members FROM app.report_member_status($1)",
        [loc],
      );
      const by = (s: string[]) =>
        st.filter((x) => s.includes(x.status)).reduce((a, x) => a + Number(x.members), 0);
      expect(r.member_status).toEqual({
        active: by(["active"]),
        expired: by(["cancelled"]),
        frozen: by(["frozen"]),
        other: by(["lead", "trial", "past_due"]),
      });
    }
  });

  it("check-ins: each of the 14 days equals the allowed check-ins of that local day", async () => {
    const r = await exec(t.fx.A, "owner");
    const rows = await run<{ k: number; n: string }>(
      t.fx.A,
      "owner",
      `SELECT g.k, (SELECT count(*) FROM app.check_in c JOIN app.location l ON l.id = c.location_id
                     WHERE c.result = 'allowed'
                       AND (c.at AT TIME ZONE l.timezone)::date = (now() AT TIME ZONE '${TZ}')::date - 13 + g.k) AS n
         FROM generate_series(0, 13) AS g(k) ORDER BY g.k`,
    );
    expect(r.kpis.checkins_today?.series).toEqual(rows.map((x) => Number(x.n)));
  });

  it("sales mix = report_sales of the last 30 local days, per kind, top 6 + other", async () => {
    for (const loc of [null, t.fx.A.locations[0]]) {
      const r = await exec(t.fx.A, "owner", loc);
      const rows = await run<{
        source: string;
        product_kind: string;
        units: string;
        total_cents: string;
      }>(
        t.fx.A,
        "owner",
        `SELECT source, product_kind, units, total_cents FROM app.report_sales(
           (now() AT TIME ZONE '${TZ}')::date - 29, (now() AT TIME ZONE '${TZ}')::date, $1)`,
        [loc],
      );
      const kinds = new Map<string, { units: number; rev: number }>();
      for (const x of rows) {
        const k = x.source === "store" ? `store_${x.product_kind}` : x.product_kind;
        const cur = kinds.get(k) ?? { units: 0, rev: 0 };
        kinds.set(k, { units: cur.units + Number(x.units), rev: cur.rev + Number(x.total_cents) });
      }
      const sorted = [...kinds.entries()].sort(
        (a, b) => b[1].rev - a[1].rev || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      );
      const top = sorted
        .slice(0, 6)
        .map(([kind, v]) => ({ kind, units: v.units, revenue_cents: v.rev }));
      const rest = sorted.slice(6);
      if (rest.length)
        top.push({
          kind: "other",
          units: rest.reduce((a, [, v]) => a + v.units, 0),
          revenue_cents: rest.reduce((a, [, v]) => a + v.rev, 0),
        });
      expect(
        r.sales_mix.map(({ kind, units, revenue_cents }) => ({ kind, units, revenue_cents })),
      ).toEqual(top);
      expect(rows.length).toBeGreaterThan(0);
    }
    const r = await exec(t.fx.A, "owner");
    for (const s of r.sales_mix) {
      expect(s.label_es.length).toBeGreaterThan(0);
      expect(s.label_en.length).toBeGreaterThan(0);
    }
  });
});

describe("month boundaries are local (America/Puerto_Rico)", () => {
  it("23:30 on the last day of last month counts last month; 00:30 on the 1st counts this month", async () => {
    const A = t.fx.A;
    const inv = billingFx.A?.paidInvoice;
    const before = await exec(A, "owner");
    const pay = (at: string, amount: number) =>
      t.admin.query(
        `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key,
           recorded_by, received_at)
         SELECT i.org_id, i.id, i.member_id, i.location_id, 'cash', $2, $3, $4, ${at} FROM app.invoice i WHERE i.id = $1`,
        [inv, amount, `exec-boundary-${rnd()}`, A.people.front_desk],
      );
    // Both instants fall on the 1st in UTC (PR is UTC−4): only local bucketing separates them.
    await pay(`${CUR} - interval '30 minutes'`, 70001);
    await pay(`${CUR} + interval '30 minutes'`, 90001);
    const prod = await q1<{ id: string; price_cents: number }>(
      "SELECT id, price_cents FROM app.product WHERE org_id = $1 LIMIT 1",
      [A.orgId],
    );
    // A store sale completed at 23:50 last month and refunded at 00:20 this month.
    const total = 1000 + 105 + 10;
    const s = await q1<{ id: string }>(
      `INSERT INTO app.sale (org_id, location_id, channel, status, subtotal_cents, ivu_state_cents, ivu_municipal_cents,
         total_cents, payment_method, created_by, created_at, completed_by, completed_at, refunded_by, refunded_at,
         refund_reason)
       VALUES ($1,$2,'pos','refunded',1000,105,10,$3,'cash',$4, ${CUR} - interval '10 minutes', $4,
         ${CUR} - interval '10 minutes', $4, ${CUR} + interval '20 minutes', 'Demo devolución') RETURNING id`,
      [A.orgId, A.locations[0], total, A.people.front_desk],
    );
    await t.admin.query(
      `INSERT INTO app.sale_line (org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
         subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
       VALUES ($1,$2,$3,1,1000,true,false,1000,105,10,$4)`,
      [A.orgId, s.id, prod.id, total],
    );
    const after = await exec(A, "owner");
    const d = (i: number) =>
      (after.kpis.revenue_month_cents?.series[i] ?? 0) -
      (before.kpis.revenue_month_cents?.series[i] ?? 0);
    expect(d(10)).toBe(70001 + total);
    expect(d(11)).toBe(90001 - total);
    // Both boundary instants are on last month's last day: inside the month-to-date comparison only when today is
    // itself the last day of the month (then the window covers the whole of last month).
    const lastDay = await q1<{ is_last: boolean }>(
      `SELECT (now() AT TIME ZONE 'America/Puerto_Rico')::date
              = (date_trunc('month', now() AT TIME ZONE 'America/Puerto_Rico') + interval '1 month - 1 day')::date
              AS is_last`,
      [],
    );
    const dPrev =
      (after.kpis.revenue_month_cents?.prev ?? 0) - (before.kpis.revenue_month_cents?.prev ?? 0);
    expect(dPrev).toBe(lastDay?.is_last ? 70001 + total : 0);
  });

  it("revenue and profit 'prev' = last month over the same days as this month-to-date", async () => {
    const A = t.fx.A;
    const inv = billingFx.A?.paidInvoice;
    const before = await exec(A, "owner");
    // Local noon on last month's 1st (always inside the window) and on the day after today's day-of-month last
    // month (outside the window), when that day exists.
    const days = await q1<{ inside: string; outside: string | null }>(
      `WITH t AS (SELECT (now() AT TIME ZONE 'America/Puerto_Rico')::date AS today),
            p AS (SELECT (date_trunc('month', today) - interval '1 month')::date AS pm,
                         (today - date_trunc('month', today)::date) AS off FROM t)
       SELECT ((pm + time '12:00') AT TIME ZONE 'America/Puerto_Rico')::text AS inside,
              CASE WHEN pm + off + 1 < (pm + interval '1 month')::date
                   THEN ((pm + off + 1 + time '12:00') AT TIME ZONE 'America/Puerto_Rico')::text END AS outside
         FROM p`,
      [],
    );
    const pay = (at: string, amount: number) =>
      t.admin.query(
        `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key,
           recorded_by, received_at)
         SELECT i.org_id, i.id, i.member_id, i.location_id, 'cash', $2, $3, $4, $5::timestamptz
           FROM app.invoice i WHERE i.id = $1`,
        [inv, amount, `exec-mtd-${rnd()}`, A.people.front_desk, at],
      );
    await pay(days?.inside as string, 4321);
    if (days?.outside) await pay(days.outside, 8765);
    const after = await exec(A, "owner");
    const dPrev = (k: "revenue_month_cents" | "net_profit_month_cents") =>
      (after.kpis[k]?.prev ?? 0) - (before.kpis[k]?.prev ?? 0);
    expect(dPrev("revenue_month_cents")).toBe(4321);
    expect(dPrev("net_profit_month_cents")).toBe(4321);
    // The full-month series still counts both.
    expect(
      (after.kpis.revenue_month_cents?.series[10] ?? 0) -
        (before.kpis.revenue_month_cents?.series[10] ?? 0),
    ).toBe(4321 + (days?.outside ? 8765 : 0));
  });

  it("active members are reconstructed at each local month end (joins, cancellations, freezes, leads)", async () => {
    const r = await exec(D, "owner");
    // 7 renewal members + K + F joined in grid month 5; K cancelled during month 10; F frozen across its last day;
    // J joined this month; the lead never counts.
    expect(r.kpis.active_members?.series).toEqual([0, 0, 0, 0, 0, 9, 9, 9, 9, 9, 7, 8]);
    expect(r.kpis.active_members?.value).toBe(8);
    expect(r.kpis.active_members?.prev).toBe(7);
    expect(r.member_status).toEqual({ active: 8, expired: 1, frozen: 1, other: 1 });
  });
});

describe("classes today", () => {
  it("counts non-cancelled sessions per local day; prev is the same weekday last week", async () => {
    const r = await exec(D, "owner");
    const series = Array(14).fill(0);
    series[0] = 1; // 13 days ago
    series[6] = 3; // 7 days ago
    series[13] = 1; // today: the cancelled class does not count
    expect(r.kpis.classes_today).toEqual({ value: 1, prev: 3, series });
    const [direct] = await run<{ n: string }>(
      D,
      "owner",
      `SELECT count(*) AS n FROM app.class_session
        WHERE NOT cancelled AND (starts_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date`,
    );
    expect(r.kpis.classes_today?.value).toBe(Number(direct?.n));
  });
});

describe("renewal rate (repurchase within 30 days of running out)", () => {
  it("outcomes follow the rows: run-out = end of the last live entitlement; pending windows are left out", async () => {
    const rows = await run<{ ago: number; decided_ago: number; renewed: boolean }>(
      D,
      "owner",
      `SELECT round(extract(epoch FROM now() - ran_out_at) / 86400)::integer AS ago,
              round(extract(epoch FROM now() - decided_at) / 86400)::integer AS decided_ago, renewed
         FROM app.exec_renewal_outcomes(NULL) ORDER BY ran_out_at`,
    );
    expect(rows).toEqual([
      { ago: 79, decided_ago: 55, renewed: true }, // m6
      { ago: 70, decided_ago: 40, renewed: false }, // m5
      { ago: 45, decided_ago: 15, renewed: false }, // m2
      { ago: 38, decided_ago: 10, renewed: true }, // m3: 2nd check-in used up the pack
      { ago: 35, decided_ago: 25, renewed: true }, // m1
    ]);
  });

  it("value / prev / series = renewed ÷ decided per period, one decimal", async () => {
    const r = await exec(D, "owner");
    expect(r.kpis.renewal_rate_pct?.value).toBe(66.7); // m1, m3 renewed; m2 not
    expect(r.kpis.renewal_rate_pct?.prev).toBe(50); // m6 renewed; m5 not
    const months = await run<{ m: string; renewed: boolean }>(
      D,
      "owner",
      `SELECT to_char(decided_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS m, renewed FROM app.exec_renewal_outcomes(NULL)`,
    );
    const expected = r.months.map((m) => {
      const xs = months.filter((x) => x.m === m);
      return xs.length
        ? Math.round((1000 * xs.filter((x) => x.renewed).length) / xs.length) / 10
        : null;
    });
    expect(r.kpis.renewal_rate_pct?.series).toEqual(expected);
    expect(expected.some((x) => x !== null)).toBe(true);
  });

  it("other organisations never see these outcomes, and their own rate ignores org D", async () => {
    for (const org of [t.fx.A, t.fx.B, C]) {
      const rows = await run<{ member_id: string }>(
        org,
        "owner",
        "SELECT member_id FROM app.exec_renewal_outcomes(NULL)",
      );
      const ids = await q1<{ ids: string[] }>(
        "SELECT array_agg(id::text) AS ids FROM app.member WHERE org_id = $1",
        [D.orgId],
      );
      expect(rows.some((x) => ids.ids.includes(x.member_id))).toBe(false);
    }
    expect((await exec(C, "owner")).kpis.renewal_rate_pct?.value).toBeNull();
    await refused(t.fx.A, "owner", "SELECT * FROM app.exec_renewal_outcomes($1)", [D.locations[0]]);
    await refused(D, "front_desk", "SELECT * FROM app.exec_renewal_outcomes(NULL)");
  });
});

describe("scope and denials", () => {
  it("the location manager sees exactly their location; another location is refused", async () => {
    const lm = await exec(t.fx.A, "location_manager");
    const own = await exec(t.fx.A, "owner", t.fx.A.locations[0]);
    const { as_of: _a, ...a } = lm;
    const { as_of: _b, ...b } = own;
    expect(a).toEqual(b);
    await refused(t.fx.A, "location_manager", "SELECT app.report_executive($1)", [
      t.fx.A.locations[1],
    ]);
  });

  it("owner: the two locations add up to the whole organisation", async () => {
    const all = await exec(t.fx.A, "owner");
    const l0 = await exec(t.fx.A, "owner", t.fx.A.locations[0]);
    const l1 = await exec(t.fx.A, "owner", t.fx.A.locations[1]);
    all.revenue_vs_expenses.forEach((x, i) => {
      expect(x.revenue_cents).toBe(
        (l0.revenue_vs_expenses[i]?.revenue_cents ?? 0) +
          (l1.revenue_vs_expenses[i]?.revenue_cents ?? 0),
      );
      expect(x.expenses_cents).toBe(
        (l0.revenue_vs_expenses[i]?.expenses_cents ?? 0) +
          (l1.revenue_vs_expenses[i]?.expenses_cents ?? 0),
      );
    });
    expect(all.kpis.checkins_today?.series).toEqual(
      l0.kpis.checkins_today?.series.map(
        (x, i) => (x ?? 0) + (l1.kpis.checkins_today?.series[i] ?? 0),
      ),
    );
  });

  it.each(OTHER)("%s is refused (42501)", async (role) => {
    await refused(t.fx.A, role, "SELECT app.report_executive(NULL)");
    await refused(t.fx.A, role, "SELECT app.report_executive($1)", [t.fx.A.locations[0]]);
  });

  it("other organisation: a foreign or unknown location is refused, and A's rows never reach B", async () => {
    await refused(t.fx.B, "owner", "SELECT app.report_executive($1)", [t.fx.A.locations[0]]);
    await refused(t.fx.A, "owner", "SELECT app.report_executive($1)", [
      "00000000-0000-4000-8000-000000000000",
    ]);
    const before = await exec(t.fx.B, "owner");
    const inv = billingFx.A?.paidInvoice;
    await t.admin.query(
      `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key, recorded_by)
       SELECT i.org_id, i.id, i.member_id, i.location_id, 'cash', 5000000, $2, $3 FROM app.invoice i WHERE i.id = $1`,
      [inv, `exec-iso-${rnd()}`, t.fx.A.people.front_desk],
    );
    const after = await exec(t.fx.B, "owner");
    expect(after.kpis.revenue_month_cents).toEqual(before.kpis.revenue_month_cents);
    expect((await exec(t.fx.A, "owner")).kpis.revenue_month_cents?.value).toBeGreaterThanOrEqual(
      5000000,
    );
  });

  it("no claims → refused (fails closed)", async () => {
    const c = await t.api.pool.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE app_authenticated");
      await expect(c.query("SELECT app.report_executive(NULL)")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("each read model gates the caller itself, first thing (not only through the reports it composes)", async () => {
    // Behaviourally the outer gate is backstopped by the guarded 0014 read models and exec_renewal_outcomes that
    // report_executive calls; this pins the gate in place so removing or widening it is caught on its own.
    for (const fn of ["report_executive(uuid)", "exec_renewal_outcomes(uuid)"]) {
      const { rows } = await t.admin.query("SELECT pg_get_functiondef($1::regprocedure) AS src", [
        `app.${fn}`,
      ]);
      const body = (rows[0].src as string).split("BEGIN")[1] ?? "";
      const first = body.split(";")[0]?.trim();
      expect(first, fn).toBe(
        "PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location)",
      );
    }
  });

  it("invoker rights only, nothing for PUBLIC, and the seed helper is not left behind", async () => {
    const { rows } = await t.admin.query(
      `SELECT p.proname, p.prosecdef, has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('app_authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' AND p.proname IN ('report_executive', 'exec_renewal_outcomes', 'exec_kind_label',
                                                  'exec_seed_u')
        ORDER BY 1`,
    );
    expect(rows).toEqual([
      { proname: "exec_kind_label", prosecdef: false, pub: false, auth: true },
      { proname: "exec_renewal_outcomes", prosecdef: false, pub: false, auth: true },
      { proname: "report_executive", prosecdef: false, pub: false, auth: true },
    ]);
  });
});
