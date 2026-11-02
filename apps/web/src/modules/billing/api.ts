import type { ApiClient } from "../../api/client";

/** Wire types of the billing endpoints (apps/api/src/modules/billing.ts). Amounts are integer cents from the server. */
export type ProductKind =
  | "membership"
  | "class_pack"
  | "day_pass"
  | "drop_in"
  | "pt_package"
  | "addon"
  | "enrollment_fee";
export type PaymentMethod = "cash" | "card_simulated" | "ach_simulated";
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash",
  "card_simulated",
  "ach_simulated",
];
export const ONE_OFF_KINDS: readonly ProductKind[] = [
  "drop_in",
  "day_pass",
  "class_pack",
  "pt_package",
];
export const PRODUCT_KINDS: readonly ProductKind[] = [
  "drop_in",
  "class_pack",
  "pt_package",
  "day_pass",
  "membership",
  "addon",
  "enrollment_fee",
];

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  description: string | null;
  tax_category: "taxable" | "exempt";
  active: boolean;
}
export interface Price {
  id: string;
  product_id: string;
  location_id: string | null;
  amount_cents: number;
  billing_interval: "month" | "year" | "none";
  credits: number | null;
  validity_days: number | null;
  commitment_months: number;
  active: boolean;
}
export interface Catalog {
  products: Product[];
  prices: Price[];
}
export interface Subscription {
  id: string;
  member_id: string;
  product_id: string;
  product_name: string | null;
  price_id: string;
  amount_cents: number | null;
  location_id: string;
  status: "active" | "frozen" | "past_due" | "cancelled";
  billing_interval: "month" | "year";
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  commitment_end: string | null;
  cancel_at_period_end: boolean;
  ends_on: string;
}
export interface Freeze {
  id: string;
  subscription_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
}
export interface Invoice {
  id: string;
  number: number;
  member_id: string;
  member_name: string | null;
  location_id: string;
  subscription_id: string | null;
  period_start: string | null;
  period_end: string | null;
  subtotal_cents: number;
  ivu_state_cents: number;
  ivu_municipal_cents: number;
  total_cents: number;
  balance_cents: number;
  status: "open" | "paid" | "void";
  overdue: boolean;
  issued_at: string;
  due_date: string;
}
export interface InvoiceLine {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  tax_category: "taxable" | "exempt";
  amount_cents: number;
  ivu_state_cents: number;
  ivu_municipal_cents: number;
}
export interface Payment {
  id: string;
  invoice_id: string;
  method: PaymentMethod;
  amount_cents: number;
  status: string;
  reference: string | null;
  received_at: string;
}
export interface Credit {
  id: string;
  member_id: string;
  product_name: string | null;
  location_id: string;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  live: boolean;
}
export interface Pass {
  id: string;
  member_id: string;
  product_name: string | null;
  location_id: string;
  valid_from: string;
  valid_to: string;
  live: boolean;
}
export interface MemberBilling {
  subscriptions: Subscription[];
  freezes: Freeze[];
  invoices: Invoice[];
  lines: InvoiceLine[];
  payments: Payment[];
  credits: Credit[];
  passes: Pass[];
}
export interface SaleResult {
  invoice_id: string;
  number: number;
  total_cents: number;
  status: string;
}
export interface CycleResult {
  as_of: string;
  renewed: number;
  invoices: number;
  cancelled: number;
  past_due_members: number;
}

const enc = encodeURIComponent;

/** A fresh idempotency key for one attempt of a money-moving action (kept across retries of that attempt). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function billingApi(api: ApiClient) {
  const r = api.request;
  return {
    catalog: () => r<Catalog>("GET", "/billing/catalog"),
    createProduct: (b: {
      kind: ProductKind;
      name: string;
      description?: string;
      tax_category: Product["tax_category"];
    }) => r<{ id: string }>("POST", "/billing/products", b),
    createPrice: (b: {
      product_id: string;
      location_id: string | null;
      amount_cents: number;
      billing_interval: Price["billing_interval"];
      credits: number | null;
      validity_days: number | null;
      commitment_months: number;
    }) => r<{ id: string }>("POST", "/billing/prices", b),
    setPriceActive: (id: string, active: boolean) =>
      r<{ id: string }>("PATCH", `/billing/prices/${enc(id)}`, { active }),
    setProductActive: (id: string, active: boolean) =>
      r<{ id: string }>("PATCH", `/billing/products/${enc(id)}`, { active }),
    memberBilling: (memberId: string) =>
      r<MemberBilling>("GET", `/members/${enc(memberId)}/billing`),
    myBilling: () => r<MemberBilling>("GET", "/billing/me"),
    subscribe: (
      memberId: string,
      b: { price_id: string; start_date?: string; enrollment_price_id?: string },
    ) => r<{ id: string }>("POST", `/members/${enc(memberId)}/subscriptions`, b),
    freeze: (subId: string, b: { start_date: string; end_date: string; reason?: string }) =>
      r<{ id: string; subscription: { current_period_end: string } }>(
        "POST",
        `/subscriptions/${enc(subId)}/freeze`,
        b,
      ),
    cancel: (subId: string) =>
      r<{ effective_date: string }>("POST", `/subscriptions/${enc(subId)}/cancel`, {
        confirm: true,
      }),
    sell: (
      memberId: string,
      b: {
        price_id: string;
        location_id: string;
        quantity: number;
        method: PaymentMethod;
        idempotency_key: string;
      },
    ) => r<SaleResult>("POST", `/members/${enc(memberId)}/sales`, b),
    invoices: (q: { status?: string; overdue?: boolean; location_id?: string }) => {
      const p = new URLSearchParams();
      if (q.status) p.set("status", q.status);
      if (q.overdue) p.set("overdue", "true");
      if (q.location_id) p.set("location_id", q.location_id);
      const s = p.toString();
      return r<{ data: Invoice[] }>("GET", `/invoices${s ? `?${s}` : ""}`);
    },
    pay: (
      invoiceId: string,
      b: {
        method: PaymentMethod;
        amount_cents: number;
        idempotency_key: string;
        reference?: string;
      },
    ) =>
      r<{ id: string; invoice_status: string }>("POST", `/invoices/${enc(invoiceId)}/payments`, b),
    runCycle: (b: { location_id?: string }) => r<CycleResult>("POST", "/billing/cycle", b),
    fees: () =>
      r<{
        data: { invoice_id: string; application_fee_bps: number; application_fee_cents: number }[];
      }>("GET", "/billing/fees"),
  };
}
export type BillingApi = ReturnType<typeof billingApi>;
