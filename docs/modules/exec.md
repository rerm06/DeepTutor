# Module exec — Panel ejecutivo (executive dashboard data)

Migration `packages/db/migrations/0019_exec_dashboard.sql` · demo seed `packages/db/seed/0019_exec_dashboard.sql` ·
API `GET /v1/reports/executive` in `apps/api/src/modules/reports.ts` · tests `packages/db/test/exec.test.ts`,
`apps/api/test/exec.test.ts`. The web UI is built separately against the contract below.

## Model

No tables. Two `SECURITY INVOKER` read models plus a label helper, in the same style as the reports module (0014):
they run under the caller's RLS on billing (0006), schedule (0007), store (0009) and finance (0013), re-check the
caller with `app.rpt_guard` (owner / location_manager; location probed under RLS), and reuse 0014's own
`report_member_flow` and `report_member_status`, so the same figure is the same number on every screen. Nothing
here widens visibility or writes anything, so there is no definer function and nothing to audit.

| Object | Kind | Purpose |
|---|---|---|
| `report_executive(location)` | invoker → jsonb | The whole contract below. |
| `exec_renewal_outcomes(location)` | invoker → rows | Renewal outcome per member run-out (member, location, ran_out_at, decided_at, renewed). |
| `exec_kind_label(kind, lang)` | immutable | ES/EN label of a sales-mix kind. |

All three: `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_authenticated`.

## Contract — `GET /v1/reports/executive?location_id=<uuid optional>`

```
{ "as_of": "2026-11-02T22:41:39.559Z", "currency": "USD", "months": ["2025-12", …, "2026-11"],   // 12, PR time
  "kpis": {
    "revenue_month_cents":    { "value": int, "prev": int, "series": [12 ints] },
    "active_members":         { "value": int, "prev": int, "series": [12 ints] },
    "net_profit_month_cents": { "value": int, "prev": int, "series": [12 ints] },
    "checkins_today":         { "value": int, "prev": int, "series": [14 ints] },
    "classes_today":          { "value": int, "prev": int, "series": [14 ints] },
    "renewal_rate_pct":       { "value": number|null, "prev": number|null, "series": [12 numbers|null] } },
  "revenue_vs_expenses": [ { "month", "revenue_cents", "expenses_cents" } ×12 ],
  "new_members":         [ { "month", "joins", "cancellations" } ×12 ],
  "member_status":       { "active", "expired", "frozen", "other" },
  "sales_mix":           [ { "kind", "label_es", "label_en", "units", "revenue_cents" } ≤ 7 ] }
```

Monthly KPIs: `value` = this month **to date**, `prev` = last month (full), `series[11]` = `value`. Daily KPIs:
`series` = last 14 local days ending today, `prev` = same weekday last week (`series[6]`). Every integer is an
integer (cents or a count) and never null; an empty organisation returns zeros, `sales_mix: []` and
`renewal_rate_pct` all null. `zod .strict()` query (unknown parameter → 400), 42501 → 403.

## Definitions

Rows are bucketed in their own location's local time; the 12-month grid is in Puerto Rico time (same as 0014).

- **Revenue (cash, net of refunds)** = succeeded billing payments by `received_at` + store sales completed (or later
  refunded) by `completed_at` − refunded store sales by `refunded_at`. Equals `finance_pnl().cash_in_cents` for the
  same month and scope (tested). IVU collected is included because it is cash received [VERIFICAR · CPA].
- **Expenses** = non-void finance expenses by `spent_on` + approved or paid bills by `issued_on`
  (= `finance_pnl().expenses_cents + bills_cents`, tested). Commissions and platform fees are **not** included, so
  this is not the accrual P&L's "costs".
- **Net profit** = revenue − expenses (cash view). The current month is month-to-date: early in a month it is
  usually negative because rent is booked on the 1st.
- **Active members**: `value` = `member.status = 'active'` now (= panel `members_active`). Earlier points are
  reconstructed at each local month end [S]: joined before the month end, not a lead/trial today, not cancelled
  by then (the latest cancelled subscription's `cancelled_at`; a member cancelled today without any cancelled
  subscription never counts), and not inside a subscription freeze on the month's last day. There is no member
  status history table, so past statuses such as past_due are not reconstructed.
- **Check-ins**: allowed check-ins per local day (= panel `check_ins_today`).
- **Classes**: non-cancelled class sessions starting on each local day.
- **Joins / cancellations**: `report_member_flow` (members created; distinct members with a subscription cancelled).
- **Member status**: `report_member_status`; `expired` = cancelled, `other` = lead + trial + past_due.
- **Sales mix**: last 30 local days (today − 29 … today), the same lines as `report_sales`: non-void invoice lines
  by `plan_product.kind` and completed (not refunded) store lines as `store_<category>`; units and line totals
  with IVU. Top 6 by revenue (ties by kind), the rest summed as `other`.
- **Renewal rate** (pay per session, so a renewal is a repurchase): entitlements are session passes
  (`access_pass`, `[valid_from, valid_to)`) and session credits (`credit_balance`, from `created_at` until it runs
  out: at `expires_at` when credits were left; when exhausted, at the earlier of `expires_at` and the member's
  `credits_total`-th allowed check-in since purchase [S: credit use carries no date yet]). A member's overlapping
  entitlements merge; the moment the **last** one runs out is a run-out. Renewed = the member bought another
  session product within 30 days (decided at that purchase); not renewed = 30 days passed without one (decided at
  run-out + 30 days); otherwise pending and not counted. Rate = renewed ÷ decided × 100, one decimal, each member
  once per period (their latest outcome in it), **null** when nobody was decided.
  - **Period attribution [S · coordinator to confirm]**: periods take the outcomes **decided** in them
    (`value` = last 30 days, `prev` = the 30 days before, `series` = local calendar month of the decision). The
    literal reading ("run-outs during the trailing 30 days") cannot produce a meaningful current value: no run-out
    of the last 30 days can have a closed 30-day window, so only repurchasers would be counted and the value
    would sit at ~100 % by construction. Deciding by decision date keeps the 30-day window, the null rule and the
    member-level count, and gives every period a complete, unbiased denominator.
  - Monthly memberships (org B) are not entitlements here; their churn shows as cancellations.

## Roles

| Role | Access |
|---|---|
| owner | Whole organisation or any one of its locations |
| location_manager | Their locations only (no location = all of theirs); another location → 403 |
| everyone else | 403 (`rpt_guard`, 42501) |

## Demo seed (`0019_exec_dashboard.sql`)

Twelve months of synthetic history ("… Demo", `@demo.invalid`), deterministic (md5 of stable keys, no
`random()`), idempotent (marker: org A's plan product), relative to the day it runs. Org A (pay per session, two
locations): ≈ 300 members, ≈ 230 active today, cash revenue ≈ USD 18–28k a month with a January peak and growth,
expenses ≈ 60–80 % of revenue, renewal rate ≈ 91–97 % (≈ 94 % over the last 30 days); an optional monthly "Plan ilimitado" (commitment 0) held by
a third of members is where cancellations (geometric churn ≈ 10 %/month) and freezes come from; pay-per-visit
and pack members take occasional breaks and some stop coming. Org B (monthly membership, Ponce): a lighter
history. Rows go through the real tables with the rules the definer functions apply: IVU from the generated
per-line columns, totals and platform fee from the lines, gapless chronological invoice numbers per legal entity
(the billing demo invoices are renumbered with them), passes and credits for one-off sales, freezes extending
their period (≤ 90 days a year), cancellations at period end, store amounts via `store_line_amounts` with a
balanced stock ledger (`on_hand` unchanged), bills entered by the San Juan manager and approved by the owner,
classes for the two weeks before the schedule seed's window. FORCE RLS is lifted only on the tables written and
restored; a seed-only helper function is created and dropped inside the block.

## [VERIFICAR] / [S]

- **[VERIFICAR · CPA]** Revenue includes IVU collected (cash basis). Should the executive "net profit" exclude IVU
  (a liability) or use the accrual P&L (`finance_pnl().net_cents`) instead?
- **[S]** Renewal period attribution by decision date (see above) — confirm with the product owner.
- **[S]** Exhausted packs: run-out estimated from check-ins until credit consumption is dated.
- **[S]** Active-member history is a reconstruction (no status history table).
- **[S]** Cost: one call scans a year of payments, check-ins and entitlements under RLS (≈ 0.7 s owner / 1.5 s
  location manager on the demo data). A materialised monthly roll-up would be the next step if it grows.
- Seed file name follows `scripts/sync-netlify-migrations.sh` (`seed/00NN_<migration slug>.sql`), so it is
  `0019_exec_dashboard.sql`, not `0019_exec_history.sql`: any other name is not mirrored to Netlify.
