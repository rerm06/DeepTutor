import type { ApiClient } from "../../api/client";
import type { ListOf } from "../../api/types";

// Mirrors packages/shared/src/modules/finance.ts (the web app does not depend on @gym/shared).
export const EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "payroll_export",
  "supplies",
  "maintenance",
  "marketing",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type BillStatus = "pending_approval" | "approved" | "paid" | "void";
export const BILL_STATUSES: readonly BillStatus[] = [
  "pending_approval",
  "approved",
  "paid",
  "void",
];
export const COMMISSION_SOURCES = ["sale", "membership", "session"] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];
export type CommissionStatus = "pending" | "approved" | "paid" | "void";
export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$/;
export const SOURCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export interface Policy {
  manager_approval_max_cents: number;
  updated_at: string | null;
}
export interface Vendor {
  id: string;
  name: string;
  contact_email: string | null;
  active: boolean;
}
export interface Bill {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  location_id: string;
  location_name: string | null;
  number: string;
  category: ExpenseCategory;
  memo: string | null;
  issued_on: string;
  due_on: string;
  amount_cents: number;
  status: BillStatus;
  created_by_me: boolean;
  approved_at: string | null;
  paid_on: string | null;
  payment_ref: string | null;
  void_reason: string | null;
}
export interface Expense {
  id: string;
  location_id: string;
  location_name: string | null;
  vendor_name: string | null;
  recurring_id: string | null;
  category: ExpenseCategory;
  amount_cents: number;
  spent_on: string;
  receipt_note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}
export interface Recurring {
  id: string;
  location_id: string;
  location_name: string | null;
  category: ExpenseCategory;
  description: string;
  amount_cents: number;
  interval_months: number;
  next_on: string;
  active: boolean;
}
export interface StaffOption {
  id: string;
  display_name: string;
  role: string;
  location_id: string;
}
export interface Commission {
  id: string;
  staff_member_id: string;
  staff_name: string | null;
  location_id: string;
  location_name: string | null;
  source: CommissionSource;
  source_ref: string;
  amount_cents: number;
  earned_on: string;
  status: CommissionStatus;
  note: string | null;
  paid_on: string | null;
}
export interface PnlRow {
  location_id?: string;
  location_name?: string;
  membership_revenue_cents: number;
  other_billing_revenue_cents: number;
  store_revenue_cents: number;
  revenue_cents: number;
  expenses_cents: number;
  bills_cents: number;
  commissions_cents: number;
  platform_fees_cents: number;
  costs_cents: number;
  net_cents: number;
  cash_in_cents: number;
  cash_out_cents: number;
}
export interface Pnl {
  month: string;
  basis: "accrual";
  locations: PnlRow[];
  consolidated: PnlRow;
}
export interface Liabilities {
  deferred: {
    location_id: string;
    location_name: string;
    prepaid_periods_cents: number;
    unused_credits_cents: number;
  }[];
  totals: { prepaid_periods_cents: number; unused_credits_cents: number };
  points: { outstanding_points: number; members_with_balance: number } | null;
}
export interface JournalExport {
  id: string;
  period: string;
  line_count: number;
  debit_total_cents: number;
  generated_at: string;
  filename: string;
  csv?: string;
}

const enc = encodeURIComponent;
function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function financeApi(api: ApiClient) {
  const r = api.request;
  return {
    policy: () => r<Policy>("GET", "/finance/policy"),
    setPolicy: (cents: number) =>
      r<Policy>("PUT", "/finance/policy", { manager_approval_max_cents: cents }),
    vendors: () => r<ListOf<Vendor>>("GET", "/finance/vendors"),
    createVendor: (b: { name: string; contact_email?: string }) =>
      r<{ id: string }>("POST", "/finance/vendors", b),
    bills: (q: { status?: BillStatus; location_id?: string } = {}) =>
      r<ListOf<Bill>>("GET", `/finance/bills${qs(q)}`),
    createBill: (b: {
      vendor_id: string;
      location_id: string;
      number: string;
      category: ExpenseCategory;
      memo?: string;
      issued_on: string;
      due_on: string;
      amount_cents: number;
    }) => r<{ id: string; status: BillStatus }>("POST", "/finance/bills", b),
    decide: (id: string, decision: "approve" | "reject", note?: string) =>
      r<Bill>(
        "POST",
        `/finance/bills/${enc(id)}/decision`,
        note ? { decision, note } : { decision },
      ),
    pay: (id: string, paid_on: string, payment_ref: string) =>
      r<Bill>("POST", `/finance/bills/${enc(id)}/pay`, { paid_on, payment_ref }),
    voidBill: (id: string, reason: string) =>
      r<Bill>("POST", `/finance/bills/${enc(id)}/void`, { reason }),
    expenses: (q: { month?: string; location_id?: string } = {}) =>
      r<ListOf<Expense>>("GET", `/finance/expenses${qs(q)}`),
    createExpense: (b: {
      location_id: string;
      category: ExpenseCategory;
      amount_cents: number;
      spent_on: string;
      receipt_note?: string;
    }) => r<{ id: string }>("POST", "/finance/expenses", b),
    voidExpense: (id: string, reason: string) =>
      r<{ id: string }>("POST", `/finance/expenses/${enc(id)}/void`, { reason }),
    recurring: () => r<ListOf<Recurring>>("GET", "/finance/recurring"),
    createRecurring: (b: {
      location_id: string;
      category: ExpenseCategory;
      description: string;
      amount_cents: number;
      interval_months: number;
      next_on: string;
    }) => r<{ id: string }>("POST", "/finance/recurring", b),
    setRecurringActive: (id: string, active: boolean) =>
      r<{ id: string }>("PATCH", `/finance/recurring/${enc(id)}`, { active }),
    runRecurring: () => r<{ created: number }>("POST", "/finance/recurring/run", {}),
    staff: (locationId?: string) =>
      r<ListOf<StaffOption>>("GET", `/finance/staff${qs({ location_id: locationId })}`),
    commissions: () => r<ListOf<Commission>>("GET", "/finance/commissions"),
    createCommission: (b: {
      staff_member_id: string;
      location_id: string;
      source: CommissionSource;
      source_ref: string;
      amount_cents: number;
      earned_on: string;
    }) => r<{ id: string }>("POST", "/finance/commissions", b),
    setCommission: (id: string, status: "approved" | "paid" | "void", paid_on?: string) =>
      r<{ id: string; status: string }>(
        "POST",
        `/finance/commissions/${enc(id)}/status`,
        paid_on ? { status, paid_on } : { status },
      ),
    pnl: (month: string) => r<Pnl>("GET", `/finance/pnl${qs({ month })}`),
    liabilities: () => r<Liabilities>("GET", "/finance/liabilities"),
    exports: () => r<ListOf<JournalExport>>("GET", "/finance/exports"),
    generateExport: (month: string) => r<JournalExport>("POST", "/finance/exports", { month }),
    getExport: (id: string) => r<JournalExport>("GET", `/finance/exports/${enc(id)}`),
  };
}
export type FinanceApi = ReturnType<typeof financeApi>;
