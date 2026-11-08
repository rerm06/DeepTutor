/** Shared types and constants for module billing. Must match the enums in packages/db/migrations/0006_billing.sql. */
export const MODULE_BILLING = "billing" as const;

export const PRODUCT_KINDS = [
  "membership",
  "class_pack",
  "day_pass",
  "drop_in",
  "pt_package",
  "addon",
  "enrollment_fee",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
/** Kinds sold once at the desk (single session, day pass, packs). */
export const ONE_OFF_KINDS = ["drop_in", "day_pass", "class_pack", "pt_package"] as const;
/** Kinds billed by subscription. */
export const RECURRING_KINDS = ["membership", "addon"] as const;

export const TAX_CATEGORIES = ["taxable", "exempt"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];
export const BILLING_INTERVALS = ["month", "year", "none"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const SUBSCRIPTION_STATUSES = ["active", "frozen", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const INVOICE_STATUSES = ["open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** Simulated methods only: no card data ever reaches this system. */
export const PAYMENT_METHODS = ["cash", "card_simulated", "ach_simulated"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** IVU (Puerto Rico) in basis points, applied per taxable line in SQL [VERIFICAR · CPA]. Display/reference only. */
export const IVU_STATE_BPS = 1050;
export const IVU_MUNICIPAL_BPS = 100;

/** Roles that sell, subscribe and record payments (at their locations). */
export const BILLING_SELLERS = ["owner", "location_manager", "front_desk"] as const;
/** Roles that manage the catalogue. */
export const CATALOG_MANAGERS = ["owner", "location_manager"] as const;
/** Roles that run the renewal cycle and void invoices. */
export const BILLING_MANAGERS = ["owner", "location_manager"] as const;
/** Roles that read the platform fee per invoice. */
export const FEE_READERS = ["owner", "accountant", "location_manager"] as const;
