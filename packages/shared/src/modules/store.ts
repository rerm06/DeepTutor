/** Shared types and constants for module store (Tienda, POS e inventario). Rules live in migration 0009. */
export const MODULE_STORE = "store" as const;

export const STORE_CATEGORIES = ["supplement", "apparel", "drink", "accessory", "other"] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];
export const STORE_PAYMENT_METHODS = ["cash", "card_simulated"] as const;
export type StorePaymentMethod = (typeof STORE_PAYMENT_METHODS)[number];
export const STORE_SALE_STATUSES = [
  "completed",
  "pending_pickup",
  "refunded",
  "cancelled",
] as const;
export type StoreSaleStatus = (typeof STORE_SALE_STATUSES)[number];
export const STORE_SALE_CHANNELS = ["pos", "online"] as const;
export const STORE_MOVEMENT_KINDS = [
  "receive",
  "sale",
  "return",
  "transfer_out",
  "transfer_in",
  "adjust",
] as const;

/** Sell at their locations (owner: all). */
export const STORE_SELLER_ROLES = ["owner", "location_manager", "front_desk"] as const;
/** Maintain products, receive, adjust, transfer and refund (location_manager: assigned locations). */
export const STORE_MANAGER_ROLES = ["owner", "location_manager"] as const;

/** SKU format enforced by the database (product.sku CHECK). */
export const STORE_SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const STORE_MAX_PRICE_CENTS = 100_000;
export const STORE_MAX_LINES = 50;
export const STORE_MAX_LINE_QTY = 999;

/**
 * PR IVU in basis points, for documentation and display only: amounts are always computed in SQL
 * (app.store_line_amounts), rounded half-up per line. [VERIFICAR · CPA]
 */
export const STORE_IVU_STATE_BPS = 1050;
export const STORE_IVU_MUNICIPAL_BPS = 100;
