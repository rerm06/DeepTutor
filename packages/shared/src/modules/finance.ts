/** Shared types and constants for module finance (spec §8). Must match migration 0013. */
export const MODULE_FINANCE = "finance" as const;

export const FINANCE_EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "payroll_export",
  "supplies",
  "maintenance",
  "marketing",
  "other",
] as const;
export type FinanceExpenseCategory = (typeof FINANCE_EXPENSE_CATEGORIES)[number];
export const FINANCE_BILL_STATUSES = ["pending_approval", "approved", "paid", "void"] as const;
export type FinanceBillStatus = (typeof FINANCE_BILL_STATUSES)[number];
export const FINANCE_BILL_DECISIONS = ["approve", "reject"] as const;
export const FINANCE_COMMISSION_SOURCES = ["sale", "membership", "session"] as const;
export const FINANCE_COMMISSION_STATUSES = ["pending", "approved", "paid", "void"] as const;
export type FinanceCommissionStatus = (typeof FINANCE_COMMISSION_STATUSES)[number];

/** Who reads finance (location managers: their locations only) and who writes (never the accountant). */
export const FINANCE_READER_ROLES = ["owner", "location_manager", "accountant"] as const;
export const FINANCE_WRITER_ROLES = ["owner", "location_manager"] as const;
export const FINANCE_EXPORT_ROLES = ["owner", "accountant"] as const;

/** Built-in manager approval threshold when the org has no finance_policy row ($500.00) [P]. */
export const FINANCE_DEFAULT_MANAGER_MAX_CENTS = 50_000;
export const FINANCE_MAX_AMOUNT_CENTS = 100_000_000;
export const FINANCE_MAX_COMMISSION_CENTS = 10_000_000;
/** Vendor invoice numbers and payment references (check no., transfer id). Never a bank account number. */
export const FINANCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$/;
export const FINANCE_SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
export const FINANCE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
