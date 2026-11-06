# Module store — Tienda, POS e inventario (spec E5, E11, §11 suplementos)

Migration `packages/db/migrations/0009_store.sql` · demo seed `packages/db/seed/0009_store.sql` ·
API `apps/api/src/modules/store.ts` · UI `apps/web/src/modules/store/` · tests `packages/db/test/store.test.ts`,
`apps/api/test/store.test.ts`, `apps/web/test/modules/store.test.tsx`.

## Data model
| Table | Purpose | Key rules |
|---|---|---|
| `product` | Org-wide catalogue | `sku` unique per org (`^[A-Z0-9][A-Z0-9-]{1,31}$`); category supplement·apparel·drink·accessory·other; `age_restricted`, `taxable`, `price_cents` 0–100 000, `active`. Name screened by `app.has_forbidden_terms` (no links, phones, health promises, regulated titles). |
| `inventory_level` | Stock per (product, location) | `on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand`, `reorder_point`. Sellable = on_hand − reserved. |
| `stock_movement` | Append-only ledger | kind receive·sale·return·transfer_out·transfer_in·adjust; signed `qty`; `ref`, `reason` (required for adjust), `by_person_id`, `at`. **on_hand = Σ qty** always. |
| `sale` | POS or online sale | channel pos·online; status completed·pending_pickup·refunded·cancelled; subtotal, `ivu_state_cents`, `ivu_municipal_cents`, total (CHECK sum); payment cash·card_simulated; `age_verified_by` → staff_member. |
| `sale_line` | Lines with price/tax/age snapshot | IVU per line; CHECKs tie qty × unit = subtotal and subtotal + IVU = total. |
| `stock_transfer`, `stock_transfer_line` | Transfers between two locations of the org | status `completed` (atomic). |

All tables: `org_id` + composite FKs `(org_id, …)`, RLS ENABLE + FORCE, `definer_all` policy for `app_definer`.

## Rules
- **IVU** 10.5 % state + 1 % municipal on taxable lines, rounded half-up **per line** (`app.store_line_amounts`).
  The UI never computes money: carts are priced by `POST /store/quote` (`app.store_quote`, invoker rights).
- **Concurrency.** Every stock-changing function locks the affected `inventory_level` rows `FOR UPDATE` in product
  order (transfers: location, product), re-reads them and refuses with `insufficient_stock` (SQLSTATE 23514).
  Sale-level actions (pickup, cancel, refund) lock the sale row first, so double refunds/pickups are impossible.
- **Online orders** reserve stock (`reserved += qty`, no movement). Pickup moves it (`sale` movement, reserved −=
  qty); cancel releases the reservation.
- **Age-restricted** lines need `age_verified = true` at POS sale or at pickup; the caller's `staff_member` row is
  stored in `sale.age_verified_by`. No birth dates are stored; the clerk checks a photo ID.
- **Refunds** are full refunds of completed sales, with a reason (3–200 chars); every unit returns through a
  `return` movement at the sale's location.
- **Audit**: `store.sale.record`, `store.order.place|pickup|cancel`, `store.sale.refund`,
  `store.stock.receive|adjust|transfer|reorder_point`, and `store.product.create|update` (trigger, with old/new price).
- **Supplements**: no "recommended" anywhere; supplement products show the structure/function disclaimer placeholder.

## Roles
| Role | Access |
|---|---|
| owner | Everything, every location of the org. |
| location_manager | Sell, refund, receive, adjust, set reorder points and transfer **from** assigned locations (destination: any location of the org); manage products (org-wide catalogue). |
| front_desk | Sell, hand over and cancel online orders at assigned locations; read inventory there. No refunds, no stock changes. |
| accountant | Read-only: products, sales and sale lines of the whole org. |
| member | Online catalogue (`app.store_catalogue`, active products + sellable units), order for pickup, cancel own pending orders, read own sales. |
| guardian | Catalogue and the ward's sales (read-only); cannot order. |
| trainer, nutritionist, chef, clinician | None. |

## Definer functions (owner `app_definer`, `search_path = app, pg_temp`, claims re-checked, `REVOKE … FROM PUBLIC`)
`record_sale(location, lines jsonb, payment, member?, age_verified)` · `place_online_order(location, lines)` ·
`complete_pickup(sale, payment, age_verified)` · `cancel_online_order(sale)` · `refund_sale(sale, reason)` ·
`receive_stock(location, product, qty, ref)` · `adjust_stock(location, product, delta, reason)` ·
`transfer_stock(from, to, lines, note)` · `set_reorder_point(location, product, point)` · `store_catalogue(location)`.
Internal blocks not executable by request traffic: `store_cart`, `store_lock_available`, `store_insert_sale`,
`store_lock_sale`, `store_caller_staff_id`. Cart JSON: 1–50 `{product_id, qty 1–999}`, no other keys; duplicates merge.

## Endpoints (`/v1`, zod `.strict()`)
| Method | Path | Notes |
|---|---|---|
| GET | `/store/products?include_inactive=` | RLS: members see active only |
| POST / PATCH | `/store/products`, `/store/products/:id` | owner, location_manager; 409 duplicate SKU; PATCH never touches `sku` |
| GET | `/store/catalogue?location_id=` | members and sellers |
| POST | `/store/quote` `{lines}` | server-side IVU, writes nothing |
| GET | `/store/inventory?location_id=&low=` | sellers; `low` = available ≤ reorder point |
| GET | `/store/movements?location_id=&product_id=` | managers |
| POST | `/store/inventory/receive` · `/store/inventory/adjust` · PUT `/store/inventory/reorder-point` | managers |
| POST / GET | `/store/transfers` | managers |
| POST | `/store/sales` `{location_id, lines, payment_method, member_id?, age_verified}` | 201 receipt |
| GET | `/store/sales?location_id=&member_id=&status=` · `/store/sales/:id` | RLS-scoped |
| POST | `/store/sales/:id/refund` `{reason}` | managers |
| POST | `/store/orders` `{location_id, lines}` · `/store/orders/:id/pickup` `{payment_method, age_verified}` · `/store/orders/:id/cancel` | |

Business refusals return `{ error, reason }`: `insufficient_stock`/`invalid_status` → 409 conflict;
`age_verification_required`/`invalid_product`/`invalid_lines`/`same_location` → 400 invalid_input.

## UI
Staff: **Punto de venta** `/staff/store/pos` (search/scan SKU, cart, IVU breakdown, age checkbox only when the
cart has a restricted product, payment method, printable receipt) · **Inventario** `/staff/store/inventory`
(levels, low-stock filter, receive/adjust/transfer/reorder for managers) · **Ventas** `/staff/store/sales` (list,
receipt, refund, pickup/cancel) · **Productos** `/staff/store/products`. Member: **Tienda** `/me/store`.
Member record tab "Compras en tienda". `data-tour-id`: `store-pos-*`, `store-receipt-print`, `store-inv-*`,
`store-sale-refund|pickup|cancel`, `store-product-new|create`, `store-shop-*`, `store-supplement-disclaimer`.

## [VERIFICAR]
- **CPA**: per-line vs per-invoice IVU rounding; municipal rate per municipality; which categories are taxable
  (drinks/food, apparel); whether refunds need a credit-note document.
- **Legal**: which supplement types are age-restricted and the minimum age per state/territory (e.g. 18 in some US
  states; PR rule unknown); final DSHEA/FTC disclaimer wording.
- **[S] Operations**: refunds limited to owner/location manager; full refunds only; online orders paid at pickup;
  location managers may push stock to any org location but only from their own.
