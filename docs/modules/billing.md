# Module billing — catálogo, membresías, facturación (spec §5, E3, E4)

Internal billing engine. Stripe is **not** called: `apps/api/src/modules/billing.ts` defines a `PaymentGateway`
interface and an offline `simulatedGateway` (card/ACH payments are `*_simulated`). A real adapter would create the
PaymentIntent on the connected account with the same idempotency key, `metadata.location_id` and the
`application_fee_amount` the database computed.

Pay per session is first-class (product input for demo org A): a member can pay only for each training session
(`drop_in`) or buy an optional session pack (`class_pack` / `pt_package` with credits and an expiry). They need no
membership, no contract and no enrollment fee. Monthly memberships are still supported (demo org B).

## Data model (migration `0006_billing.sql`)

| Table | Purpose |
|---|---|
| `billing_policy` | Org default (location NULL) plus per-location override: `max_commitment_months` (default **0**), `invoice_due_days` (3), `max_freeze_days` (90) |
| `plan_product` | `kind` membership · class_pack · day_pass · drop_in · pt_package · addon · enrollment_fee; `tax_category` taxable/exempt; name screened like rendered messages |
| `price` | product, optional location (NULL = every location), `amount_cents`, `billing_interval` month/year/none, `credits`, `validity_days`, `commitment_months`. Only `active` is updatable: a new amount means a new price, so active subscriptions keep theirs |
| `subscription` | member, product, price, location (= member's home), status active/frozen/past_due/cancelled, `current_period_start/end` (end exclusive), `commitment_end`, `cancel_at_period_end` |
| `subscription_freeze` | `[start_date, end_date)`; generated `days` |
| `invoice_counter` | one row per legal entity, `next_no`, taken `FOR UPDATE` |
| `invoice` | gapless `number` per legal entity, member, location, municipality, period (renewals), subtotal, `ivu_state_cents`, `ivu_municipal_cents`, total, `application_fee_bps/cents`, status open/paid/void, due date, idempotency key |
| `invoice_line` | quantity × unit; **generated** `amount_cents`, `ivu_state_cents` (10.5 %), `ivu_municipal_cents` (1 %) rounded half-up per taxable line |
| `payment` | method cash/card_simulated/ach_simulated, amount, idempotency key, reference with ≤ 6 digits (no card numbers can be stored), provider ref |
| `credit_balance` | session credits (`credits_remaining ≤ credits_total`, `expires_at`) |
| `access_pass` | day pass / single session window `valid_from`–`valid_to` |

All tables have `org_id`, `UNIQUE (org_id, id)`, composite FKs, RLS ENABLE + FORCE, a `definer_all` policy and fixtures in both orgs.

## Rules

- **IVU**: 10.5 % state + 1 % municipal on taxable lines, rounded half-up **per line** by generated columns. Nobody can write a line's tax, the owner role included. Invoice totals are the sums of the lines.
- **Platform fee**: `round(total × bps / 10 000)` with bps from `organization.saas_plan` (esencial 100, pro 75, elite 50). It is computed in SQL at issue time and pinned by a CHECK. The base includes IVU (spec §5.1). The fee columns are **not granted** to request traffic. Owner, accountant and location managers read them through `app.invoice_fees()`.
- **Gapless numbering**: `billing_issue_invoice` locks the legal entity's counter row. A concurrent invoice waits for it, and a rolled-back invoice rolls its number back. Voided invoices keep their number.
- **Freeze** extends `current_period_end` **and** `commitment_end` by its length. It must start today or later, inside the current period, must not overlap another freeze, and may last at most `max_freeze_days`. There is no "pause collection".
- **Cancel** sets `cancel_at_period_end`. The subscription ends at `greatest(current_period_end, commitment_end)`. The member or guardian can do it online with one confirmed call. The UI takes 3 steps: ask, confirm with the date, then show the confirmation.
- **Commitment** is allowed only up to the effective policy maximum (default 0 months).
- **Renewal cycle** `run_billing_cycle(as_of, location)`: owner (all or one location) and location managers (their locations). It handles each live subscription whose period ended. If cancellation was requested and the commitment is met, the subscription is cancelled. Otherwise the period rolls forward and its invoice is issued, at most once per `(subscription, period_start)`. `as_of` cannot be in the future.
- **Status sync** (`billing_refresh`):
  - Subscription: frozen inside a freeze window, past_due with an overdue open invoice, otherwise active.
  - Member: past_due if any invoice is overdue, else active, frozen or cancelled from their subscriptions. A lead or trial member with a valid pass or credits becomes active.
  - Billing **never denies access**: passes and credits are never touched.
- **Idempotency**: sales are keyed per invoice and payments per payment key (`UNIQUE (org_id, key)`). A retry returns the first result. Reusing a key for something else returns 409.
- **Audit**: every definer function writes to `app.audit()`. Triggers audit product, price and policy writes, subscription status, period and cancel changes, and invoice status changes. Member status changes are audited by the core `member_audit` trigger.

## Roles

| Role | Access |
|---|---|
| owner | everything, all locations; catalogue; cycle; void; fees |
| location_manager | catalogue (products; prices only for assigned locations), sell/subscribe/freeze/cancel/pay, cycle and void at assigned locations, fees there |
| front_desk | sell, subscribe, freeze, cancel and record payments at assigned locations |
| accountant | read-only invoices, lines, payments and fees, org-wide; catalogue read |
| member / guardian | own (or ward's) subscription, invoices, payments, credits, passes; catalogue read; cancel own subscription |
| trainer, nutritionist, chef, clinician | no billing access |

## Definer functions

`create_subscription(member, price, start, enrollment_price)`, `freeze_subscription(sub, start, end, reason)`,
`cancel_subscription(sub) → date`, `record_payment(invoice, method, amount, key, reference, provider_ref)`,
`sell_one_off(member, price, location, quantity, method, key, provider_ref) → invoice`, `void_invoice(invoice, reason)`,
`run_billing_cycle(as_of, location) → jsonb`, `invoice_fees(location)`.
Internal-only (no EXECUTE for request traffic): `billing_issue_invoice`, `billing_apply_payment`, `billing_refresh`,
`billing_policy_for`, `billing_today`.

## Endpoints (`/api/v1`)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/billing/catalog` | | `{ products, prices }` |
| POST | `/billing/products` | `{ kind, name, description?, tax_category }` | owner, location_manager |
| PATCH | `/billing/products/:id` | `{ name?, description?, tax_category?, active? }` | |
| POST | `/billing/prices` | `{ product_id, location_id?, amount_cents, billing_interval, credits?, validity_days?, commitment_months }` | |
| PATCH | `/billing/prices/:id` | `{ active }` | |
| GET | `/billing/policy` | | |
| GET | `/members/:id/billing` | | `{ subscriptions, freezes, invoices, lines, payments, credits, passes }` |
| GET | `/billing/me` | | same shape, caller's own (member/guardian) |
| POST | `/members/:id/subscriptions` | `{ price_id, start_date?, enrollment_price_id? }` | 201 `{ id }` |
| POST | `/subscriptions/:id/freeze` | `{ start_date, end_date, reason? }` | 201 `{ id, subscription: { current_period_end, status } }` |
| POST | `/subscriptions/:id/cancel` | `{ confirm: true }` | `{ effective_date }` |
| POST | `/members/:id/sales` | `{ price_id, location_id, quantity, method, idempotency_key }` | "Cobrar sesión"; 201 `{ invoice_id, number, total_cents, status }`; 402 if the gateway declines (all rolled back) |
| GET | `/invoices` | `status?, overdue?, location_id?, member_id?` | includes `balance_cents`, `overdue`; never the fee |
| GET | `/invoices/:id` | | with `lines`, `payments`; 404 when invisible |
| POST | `/invoices/:id/payments` | `{ method, amount_cents, idempotency_key, reference? }` | 201 `{ id, invoice_status }` |
| POST | `/invoices/:id/void` | `{ reason }` | owner, location_manager |
| POST | `/billing/cycle` | `{ as_of?, location_id? }` | `{ as_of, renewed, invoices, cancelled, past_due_members }` |
| GET | `/billing/fees` | `location_id?` | owner, accountant, location_manager |

## UI (`apps/web/src/modules/billing`)

- **Facturación** (`/staff/billing`; owner, LM, FD, accountant): a highlighted "Cobrar sesión" block (pick a member, then charge), open/overdue/paid invoices with IVU columns and inline "Registrar pago", the platform fee column for fee readers, and the renewal cycle with a confirmation step (owner, LM).
- **Catálogo** (`/staff/billing/catalog`; owner, LM): products with prices, activate/deactivate, new product, new price.
- **Membresía y pagos** (member record tab): "Cobrar sesión" first, then sessions and credits, memberships (freeze with dates, cancel at period end, subscribe), and invoices with per-line IVU detail and payment.
- **Mi membresía** (`/me/membership`; member, guardian): "Mis sesiones y créditos" first, then the plan with next renewal and the 3-step online cancellation, then invoices with the IVU breakdown.
- `data-tour-id`: `billing-charge-session`, `billing-quick-member`, `billing-quick-charge`, `billing-record-payment`, `billing-freeze`, `billing-freeze-submit`, `billing-cancel`, `billing-subscribe`, `billing-subscribe-submit`, `billing-cycle`, `billing-cycle-confirm`, `billing-filter`, `billing-product-create`, `billing-price-create`, `my-credits`, `my-cancel`, `my-cancel-confirm`.

## [VERIFICAR]

- **CPA**: IVU 10.5 % + 1 % rounded half-up per line. Does personal training count as taxable? Is the enrollment fee taxable? Is there a small-provider exemption (≤ USD 50 000)? Do non-participating municipalities need different handling? Is the municipality taken from the location of sale?
- **DACO / state gym-contract laws**: maximum commitment (default 0), cancellation windows, notice before auto-renewal.
- **[P] fee basis points** (100 / 75 / 50). The fee is computed on the total **including** IVU.
- **[S] Defaults**: invoice due in 3 days, maximum freeze 90 days, and a monthly period that adds one calendar month (Jan 31 → Feb 28 drifts the anchor).
- **[S]** A lead or trial member becomes active after the first paid session or pack. Members without subscriptions are never set to cancelled automatically.
- Credit consumption at check-in belongs to the schedule module (wave B wiring). The billing module only grants credits and passes.
- Demo org A is meant to carry the client's real brand. Renaming it is a core/shared change: `seed/demo.sql` and `packages/shared/src/demo.ts` are not owned by this module, and the synthetic-data rule keeps "Demo" names.
