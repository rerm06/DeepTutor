# Module reports — Panel y reportes (spec E13 + v0.5 panel details)

Migration `packages/db/migrations/0014_reports.sql` · demo seed `packages/db/seed/0014_reports.sql` ·
API `apps/api/src/modules/reports.ts` · UI `apps/web/src/modules/reports/` · tests `packages/db/test/reports.test.ts`,
`apps/api/test/reports.test.ts`, `apps/web/test/modules/reports.test.tsx`.

## Model

Reports are **read models**, not copies: every figure is computed on request by a `SECURITY INVOKER` function that
runs under the caller's RLS on the module tables (billing 0006, schedule 0007, crm 0008, store 0009, engagement 0012).
A panel number is therefore exactly what the same caller would count directly in those tables (the DB tests assert
this KPI by KPI). Nothing here widens visibility; finance (0013) is not referenced.

| Object | Kind | Purpose |
|---|---|---|
| `ivu_municipality` | table | Owner's record of whether a municipality files municipal IVU with the state return in SURI (SC 2915): `participant` / `non_participant`. No row = **unverified**. `org_id`, `UNIQUE (org_id, lower(municipality))`, RLS ENABLE + FORCE, `definer_all`, column grants, actor stamp + audit triggers. |
| `rpt_guard(roles, location)` | invoker | Role gate + location gate (location probed under RLS: other org, unassigned and non-existent all give the same 42501). |
| `report_dashboard(location)` | invoker → jsonb | Panel KPIs (owner, location_manager). |
| `report_today(location)` | invoker → jsonb | Front-desk "Hoy" (owner, LM, front_desk). **No money keys.** |
| `report_overdue(location)` | invoker | Open invoices past due with member and balance (owner, LM, front_desk). |
| `report_expiring(location, days 1–31)` | invoker | Credits with sessions left, passes, memberships ending (owner, LM). |
| `report_heatmap(location, weeks 4\|8)` | invoker | Full 7 × 24 grid of allowed check-ins (ISO weekday × local hour). |
| `report_ivu(month, location)` | invoker | Per municipality × source: documents, taxable/exempt base, state and municipal IVU, SURI status. |
| `report_sales(from, to, location)` | invoker | Per source × location × product × seller (≤ 366 days). |
| `report_member_status(location)`, `report_member_flow(location, months 1–24)` | invoker | Members by status; joins/cancellations by month. |
| `report_log_export(report, location, params)` | **definer** (app_definer, pinned search_path, claims re-checked) | Audits every CSV export (`report.export`) with the report's own role/location gate. |

## Definitions (local date/time of each row's location)

- **Active members**: `member.status = 'active'` (home location in scope). **New this month**: members created this
  month (any status). **Cancelled this month**: distinct members with a subscription cancelled this month.
- **Check-ins**: `result = 'allowed'`; today / ISO week (Monday start). Heatmap: last 4 or 8 weeks, allowed only.
- **Class occupancy (week)**: booked + attended + no-show seats ÷ capacity of non-cancelled sessions this ISO week.
- **Sessions sold today**: units on non-void invoices issued today for `drop_in`, `day_pass`, `class_pack`,
  `pt_package` products. **Invoiced today**: totals of those invoices (IVU included). **Collected today**: succeeded
  payments received today. **Store today**: completed sales.
- **Overdue**: `invoice.status = 'open'` and `due_date < today`; balance = total − succeeded payments.
- **Expiring (7 days)**: credits with `credits_remaining > 0` and `expires_at` in [now, now + 7 d); passes whose
  `valid_to` falls in that window; subscriptions with `cancel_at_period_end` ending (greatest of period end and
  commitment end) between today and today + 7.
- **Leads**: open = not won/lost; conversion this month = won ÷ created this month (same cohort rule as `crm_funnel`).
- **Low stock**: `on_hand − reserved ≤ reorder_point` (same predicate as the store module).
- **Points liability**: `app.points_liability()` (owner only on the panel; org-wide).
- **IVU (month)**: `billing` = non-void invoices **issued** in the month (municipality copied at issue);
  `store` = sales completed in the month (refunded later or not); `store_refund` = refunds made in the month, negative.
  Tax amounts are the per-line values billing/store already computed; nothing is recomputed here.
- **Sales**: billing lines of non-void invoices issued in range (seller = issuer); store lines of **completed** (not
  refunded) sales completed in range (seller = who completed it).

## Roles

| Role | Access |
|---|---|
| owner | Panel (incl. points liability), Hoy, all reports and CSVs, org-wide; records SURI participation |
| location_manager | Panel, Hoy, IVU, Ventas, Socios — their locations only (RLS + explicit location gate) |
| accountant | IVU and Ventas, org-wide, read-only (and their CSVs); reads `ivu_municipality` |
| front_desk | "Hoy" and the overdue list for their locations (balance owed, no revenue); overdue CSV |
| trainer, nutritionist, chef, clinician, member, guardian | nothing (42501 → 403) |

## Endpoints (`/api/v1`, zod `.strict()`, every query via `app.asCaller`)

| Method | Path | Query / body |
|---|---|---|
| GET | `/reports/dashboard` · `/reports/today` · `/reports/overdue` | `location_id?` |
| GET | `/reports/expiring` | `location_id?, days=7 (1–31)` |
| GET | `/reports/heatmap` | `location_id?, weeks=4\|8` → `{ weeks, data: [{dow, hour, check_ins}] }` |
| GET | `/reports/ivu` | `month=YYYY-MM, location_id?` |
| GET | `/reports/sales` | `from, to (YYYY-MM-DD), location_id?` |
| GET | `/reports/members` | `location_id?, months=12` → `{ status, flow }` |
| GET | `/reports/{overdue,expiring,heatmap,ivu,sales,members}.csv` | same + `lang=es\|en`, `envelope=json` (→ `{filename, csv}` for the web client); otherwise `text/csv` attachment with BOM. Audited before any row is read. |
| GET / PUT | `/reports/ivu-municipalities` | PUT `{ municipality, suri_status, note? }` (owner; upsert, audited) |

CSV safety: RFC 4180 quoting; text cells beginning with `= + - @` or a tab are prefixed with `'` (no formula
injection from member or product names); money as dollars with two decimals.

## UI

- **Panel** `/staff/panel` (owner, LM): location filter; quick check-in bar (search → one tap "Entrada", calls the
  schedule module's `POST /schedule/check-ins`; links "Nuevo socio", "Pase diario"); KPI rows in plain HTML/CSS
  (`<dl>`); overdue and expiring tables; peak-hours heatmap as a data table with caption, row headers, a number in
  every cell, a 5-level colour scale with a text legend and a "hora pico" sentence; CSV and print on each block.
- **Hoy** `/staff/today` (front desk; also LM/owner): check-ins, distinct members, denied entries, members with an
  overdue balance, today's classes (booked/capacity, waitlist), overdue list, quick check-in. No revenue figures.
- **Reportes** `/staff/reports/{ivu,sales,members}` (IVU and Ventas also for the accountant; Socios owner/LM):
  filters, tables with totals, CSV download, print-friendly view (`@media print` hides navigation and controls).
  IVU shows the SURI status as text plates and the [VERIFICAR · CPA] note; owners record SURI participation there.
- `data-tour-id`: `rpt-location`, `rpt-quick-checkin`, `rpt-quick-enter`, `rpt-quick-new-member`, `rpt-quick-day-pass`,
  `rpt-kpis`, `rpt-heatmap`, `rpt-heatmap-weeks-4|8`, `rpt-{overdue,expiring,heatmap,ivu,sales,members}-csv`,
  `rpt-print`, `rpt-ivu-apply`, `rpt-ivu-table`, `rpt-ivu-municipality-save`, `rpt-sales-apply`, `rpt-sales-group`,
  `rpt-sales-table`, `rpt-members-flow`, `rpt-today-location`, `rpt-today-classes`.

## [VERIFICAR]

- **[VERIFICAR · SC 2915 format, CPA]** Which municipalities do not participate in SURI since July 2026, and whether
  the platform must produce the SC 2915 file itself. Until the owner records a municipality it is flagged
  "sin verificar"; demo values are synthetic.
- **[VERIFICAR · CPA]** IVU basis: accrual by invoice **issue** date (spec E13: "coincide con las facturas emitidas")
  vs. cash basis; invoices voided after the month was filed (currently excluded entirely); store refunds reported as
  negative lines in the refund month (credit-note document?).
- **[VERIFICAR · CPA]** Per-line rounding comes from billing/store; non-PR (US) locations have no IVU and show their
  municipality text as entered.
- **[S]** "Cancelled this month" = members with a subscription cancelled this month (pay-per-session members never
  "cancel"). "New this month" counts every member created, including leads converted to members.
- **[S]** Sales by **trainer** needs commission attribution (finance module, wave B); the report groups by the
  seller who issued the invoice or completed the sale.
- **[S]** The front desk sees the balance owed per overdue member (needed to collect) but no revenue totals.
- **[S]** Member-flow month buckets are generated in Puerto Rico time; rows are bucketed in their location's zone.
- Shared change needed: making **Panel** the default landing for owner/location_manager requires `homeFor()` in
  `apps/web/src/lib/roles.ts` (core, not owned by this module) to return `/staff/panel` for those roles.
