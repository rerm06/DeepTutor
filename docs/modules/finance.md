# Module finance — Finanzas, gastos y cuentas por pagar (spec §8)

Migration `packages/db/migrations/0013_finance.sql` · seed `packages/db/seed/0013_finance.sql` ·
API `apps/api/src/modules/finance.ts` · UI `apps/web/src/modules/finance/` (route `/staff/finance`) · tests
`packages/db/test/finance.test.ts`, `apps/api/test/finance.test.ts`, `apps/web/test/modules/finance.test.tsx`.

Accrual basis [P], with a cash view for reconciliation. **Nothing here moves money**: vendor bills are paid outside
the platform (we record the payment), payroll is only an export (never processed), receipts are a text note (no file
upload, no AI extraction yet).

## Data model (all `org_id`-scoped, RLS ENABLE + FORCE, composite FKs, `definer_all` for `app_definer`)
| Table | Notes |
|---|---|
| `finance_policy` | one row per org: `manager_approval_max_cents` (default 50 000 = $500.00 when no row) [P] |
| `vendor` | `name` (unique per org, case-insensitive, no control chars), `contact_email`, `active` |
| `bill` | vendor, location, `number` (unique per vendor while not void), `category`, `memo`, `issued_on`, `due_on` (≥ issued, ≤ +366 d), `amount_cents`, `status pending_approval → approved → paid`, or `→ void`; `approved_by/at`, `paid_on`, `payment_ref`, `paid_recorded_by`, `voided_at`, `void_reason` |
| `bill_approval` | append-only decision: approver, role, `approve|reject`, amount and threshold at decision time, note. **One per bill** (unique) |
| `recurring_expense` | template: location, category, description, amount, `interval_months` 1–12, `next_on`, `active` |
| `expense` | location, category (`rent, utilities, payroll_export, supplies, maintenance, marketing, other`), amount, `spent_on`, `receipt_note`, `recorded_by`, optional `recurring_id` (unique per template + date), void columns |
| `commission` | staff member (must be assigned to the location), `source sale|membership|session`, `source_ref` (unique per staff + source), amount, `earned_on`, `status pending → approved → paid`, or `→ void` |
| `journal_export` | append-only: period (first of month), line count, debit = credit totals, CSV text, `generated_by` |

## Rules (enforced in SQL; the UI only mirrors them)
- **Approval by amount and role.** Owner: any bill. Location manager: bills of assigned locations with
  `amount_cents ≤ manager_approval_max_cents`; above it → `above_threshold`. Same authority to record payment or void.
- **Segregation of duties.** The approver is never the person who entered the bill (`approver_is_creator`; also a
  table CHECK `approved_by <> created_by`, so not even a definer path can bypass it). Consequence: a bill the owner
  enters must be decided by a manager (within the threshold) — in a single-owner org, the owner should not enter
  bills above the threshold themself [P · decide whether a second owner/approver role is needed].
- **Immutability.** Trigger `bill_guard` (every role, the schema owner included): paid/void bills never change or get
  deleted; commercial fields never change after entry; only `pending → approved|void` and `approved → paid|void`.
  Expenses only accept a single void; commissions keep amount and attribution; decisions and exports are append-only.
- **Concurrency.** `decide_bill`/`pay_bill`/`void_bill` lock the bill `FOR UPDATE`; a second concurrent decision gets
  `invalid_status` (tested with two connections). `run_recurring_expenses` locks templates and inserts with
  `ON CONFLICT DO NOTHING` on (template, date), so racing runs never duplicate.
- **Accountant**: reads everything in finance, P&L, liabilities, points liability; generates exports. No other write.
  Location managers read their locations only and never export. Every other role: nothing (RLS + function checks).
- **Hostile input**: control characters refused in every text column; refs `^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$`
  (never an account number); CSV cells always quoted, `"` doubled, and a leading `= + - @ TAB CR` neutralised with `'`.
- **Audit** (trigger `fin_audit_trigger`, actor/time from claims): `bill.insert|approved|paid|void`, `bill.decision`,
  `expense.insert|void`, `recurring_expense.insert|update`, `commission.insert|approved|paid|void`,
  `vendor.insert|update`, `finance_policy.insert|update`, plus `expense.recurring_run` and `journal.export`.

## Read models (functions, not views, so the isolation matrix keeps covering every `org_id` relation)
- `finance_pnl(month)` — per location the caller may read: membership revenue (linear by day over the invoice period,
  cumulative rounding so months add up exactly), other billing revenue (packs, passes, fees: at issue), store revenue
  (subtotal of completed sales minus refunds in the month they happen; IVU excluded), expenses, approved/paid bills
  (by issue date), approved/paid commissions, platform fee, net; plus `cash_in` (payments + store totals − refunds) and
  `cash_out` (expenses + bills paid in the month). Local dates use each location's time zone.
- `finance_deferred()` — today: unearned membership periods; remaining value of live credit packs (informational).
- `app.points_liability()` (engagement) — outstanding points, owner/accountant only.
- `generate_journal_export(month)` — owner/accountant; past or current month only.

## Journal CSV (QuickBooks Online journal import layout) [VERIFICAR · CPA chart of accounts]
Header `JournalNo,JournalDate,Account,Debits,Credits,Description,Location`; one balanced entry per location
(`GYM-YYYYMM-NN`, dated the last day of the month, `MM/DD/YYYY`). Accounts: Accounts Receivable, Membership Revenue,
Deferred Revenue, Packs and Passes Revenue, IVU Payable, Undeposited Funds, Store Sales, Platform Fees, Commissions
Expense/Payable, Accounts Payable, Bank, and one expense account per category. Debits = credits is checked before
the row is stored. QBO Location/Class tracking needs Plus or Advanced; Xero allows at most **2 tracking categories**
(we use one: location).

## Endpoints (`/v1/finance/*`, zod `.strict()`, every query via `app.asCaller`)
| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/finance/policy` | threshold; PUT owner only |
| GET/POST/PATCH | `/finance/vendors`, `/finance/vendors/:id` | owner/manager create; owner edits |
| GET/POST | `/finance/bills?status=&location_id=` | create → `pending_approval` |
| POST | `/finance/bills/:id/decision` `{decision, note?}` · `/pay` `{paid_on, payment_ref}` · `/void` `{reason}` | refusals: 403 `above_threshold` / `approver_is_creator`, 409 `invalid_status` / `bill_immutable`, 400 `invalid_date` / `invalid_reference` |
| GET | `/finance/bills/:id/approvals` | decision history |
| GET/POST | `/finance/expenses?month=YYYY-MM&location_id=` · POST `/finance/expenses/:id/void` | |
| GET/POST/PATCH | `/finance/recurring`, `/finance/recurring/:id` · POST `/finance/recurring/run` `{as_of?}` | |
| GET | `/finance/staff?location_id=` | staff assigned to a location (commission picker) |
| GET/POST | `/finance/commissions` · POST `/finance/commissions/:id/status` `{status, paid_on?}` | status: owner only |
| GET | `/finance/pnl?month=YYYY-MM` | `{month, basis, locations[], consolidated}` |
| GET | `/finance/liabilities` | deferred per location + totals; `points` for owner/accountant, else `null` |
| GET/POST | `/finance/exports` `{month}` · GET `/finance/exports/:id` | POST returns the CSV and `filename` |

## UI
"Finanzas" (owner, location manager, accountant) with tabs P&L (month picker, by location + consolidated, cash view,
liabilities), Cuentas por pagar (approvals queue, register with pay/void, bill entry, quick vendor), Gastos (month
list, record, void, recurring templates + "Generar gastos vencidos"), Comisiones (propose; owner approves/pays/voids),
Exportar (owner/accountant: generate + download CSV, history). Keyboard tabs (arrows/Home/End), ES/EN dictionary,
`data-tour-id` on month picker, approve, pay, create and export controls.

## [VERIFICAR] / [P]
- [VERIFICAR · CPA] Chart of accounts and account names; QBO date format and Location vs Class mapping.
- [VERIFICAR · CPA] Packs/credits recognised at sale (session usage has no dates yet); unused credits shown as
  informational deferred revenue. Value per loyalty point.
- [VERIFICAR · CPA] Voided invoices are excluded from every month (no reversal entry in the month of the void).
- [VERIFICAR · CPA] Platform fee booked against Undeposited Funds; commissions settled via payroll (no cash entry).
- [P] Manager threshold $500.00 default, per org; one decision per bill (no multi-step approval yet).
- [P] Commissions: managers propose, only the owner approves/pays; staff do not see their own commissions yet.
- Recurring dates use calendar-month steps (Jan 31 → Feb 28 → Mar 28 drift); pick day ≤ 28 for templates.
