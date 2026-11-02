import { useMemo } from "react";
import { type ApiClient, ApiError } from "../../api/client";
import type { ListOf } from "../../api/types";
import { useSession } from "../../session/SessionContext";
import type { StoreKey } from "./dict";

/** Shapes of the store endpoints (apps/api/src/modules/store.ts). Money is integer cents from the server. */
export type Category = "supplement" | "apparel" | "drink" | "accessory" | "other";
export type PaymentMethod = "cash" | "card_simulated";
export type SaleStatus = "completed" | "pending_pickup" | "refunded" | "cancelled";
export const CATEGORIES: Category[] = ["supplement", "apparel", "drink", "accessory", "other"];
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card_simulated"];
export const SALE_STATUSES: SaleStatus[] = ["completed", "pending_pickup", "refunded", "cancelled"];

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: Category;
  age_restricted: boolean;
  taxable: boolean;
  price_cents: number;
  active: boolean;
}
export interface CatalogueItem {
  product_id: string;
  sku: string;
  name: string;
  category: Category;
  age_restricted: boolean;
  taxable: boolean;
  price_cents: number;
  available: number;
}
export interface CartLine {
  product_id: string;
  qty: number;
}
export interface Money {
  subtotal_cents: number;
  ivu_state_cents: number;
  ivu_municipal_cents: number;
  total_cents: number;
}
export interface QuoteLine extends Money {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price_cents: number;
  taxable: boolean;
  age_restricted: boolean;
}
export interface Quote extends Money {
  lines: QuoteLine[];
  age_restricted: boolean;
}
export interface SaleLine extends Money {
  product_id: string;
  sku: string | null;
  name: string | null;
  category: Category | null;
  qty: number;
  unit_price_cents: number;
  taxable: boolean;
  age_restricted: boolean;
}
export interface SaleSummary extends Money {
  id: string;
  location_id: string;
  channel: "pos" | "online";
  member_id: string | null;
  member_name?: string | null;
  status: SaleStatus;
  payment_method: PaymentMethod | null;
  age_verified: boolean;
  created_at: string;
  units?: number;
}
export interface Sale extends SaleSummary {
  location_name: string | null;
  lines: SaleLine[];
}
export interface InventoryRow {
  product_id: string;
  sku: string;
  name: string;
  category: Category;
  location_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  reorder_point: number;
  low: boolean;
}

const enc = encodeURIComponent;
function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function storeApi(api: ApiClient) {
  const r = api.request;
  return {
    products: (includeInactive = false) =>
      r<ListOf<Product>>(
        "GET",
        `/store/products${qs({ include_inactive: includeInactive ? "true" : undefined })}`,
      ),
    createProduct: (p: Omit<Product, "id">) => r<{ id: string }>("POST", "/store/products", p),
    updateProduct: (id: string, patch: Partial<Omit<Product, "id" | "sku">>) =>
      r<{ id: string }>("PATCH", `/store/products/${enc(id)}`, patch),
    catalogue: (locationId: string) =>
      r<ListOf<CatalogueItem>>("GET", `/store/catalogue${qs({ location_id: locationId })}`),
    quote: (lines: CartLine[]) => r<Quote>("POST", "/store/quote", { lines }),
    inventory: (locationId?: string, low = false) =>
      r<ListOf<InventoryRow>>(
        "GET",
        `/store/inventory${qs({ location_id: locationId, low: low ? "true" : undefined })}`,
      ),
    receive: (b: { location_id: string; product_id: string; qty: number; ref?: string }) =>
      r<{ ok: true }>("POST", "/store/inventory/receive", b),
    adjust: (b: { location_id: string; product_id: string; delta: number; reason: string }) =>
      r<{ ok: true }>("POST", "/store/inventory/adjust", b),
    reorderPoint: (b: { location_id: string; product_id: string; reorder_point: number }) =>
      r<{ ok: true }>("PUT", "/store/inventory/reorder-point", b),
    transfer: (b: {
      from_location_id: string;
      to_location_id: string;
      lines: CartLine[];
      note?: string;
    }) => r<{ id: string }>("POST", "/store/transfers", b),
    sell: (b: {
      location_id: string;
      lines: CartLine[];
      payment_method: PaymentMethod;
      age_verified: boolean;
      member_id?: string;
    }) => r<Sale>("POST", "/store/sales", b),
    sales: (f: { location_id?: string; status?: string; member_id?: string } = {}) =>
      r<ListOf<SaleSummary>>("GET", `/store/sales${qs(f)}`),
    sale: (id: string) => r<Sale>("GET", `/store/sales/${enc(id)}`),
    refund: (id: string, reason: string) =>
      r<Sale>("POST", `/store/sales/${enc(id)}/refund`, { reason }),
    order: (b: { location_id: string; lines: CartLine[] }) => r<Sale>("POST", "/store/orders", b),
    pickup: (id: string, payment_method: PaymentMethod, age_verified: boolean) =>
      r<Sale>("POST", `/store/orders/${enc(id)}/pickup`, { payment_method, age_verified }),
    cancel: (id: string) => r<Sale>("POST", `/store/orders/${enc(id)}/cancel`),
  };
}

export function useStoreApi() {
  const { api } = useSession();
  return useMemo(() => storeApi(api), [api]);
}

/** Map an API failure to a module message: 409 means stock or status changed under us. */
export function errorKey(err: unknown, conflict: StoreKey = "err.stock"): StoreKey {
  if (!(err instanceof ApiError)) return "err.generic";
  if (err.code === "forbidden") return "err.forbidden";
  if (err.code === "conflict") return conflict;
  if (err.code === "invalid_input") return "err.input";
  return "err.generic";
}

export function money(cents: number, lang: "es" | "en"): string {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** "24.99" → 2499. Strict: digits with up to two decimals, at most 1000.00 (DB cap). Null when invalid. */
export function parsePriceCents(input: string): number | null {
  const m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return cents <= 100_000 ? cents : null;
}

export const SELLER_ROLES = ["owner", "location_manager", "front_desk"] as const;
export const MANAGER_ROLES = ["owner", "location_manager"] as const;
export const canSell = (role: string | null) =>
  (SELLER_ROLES as readonly string[]).includes(role ?? "");
export const canManage = (role: string | null) =>
  (MANAGER_ROLES as readonly string[]).includes(role ?? "");
