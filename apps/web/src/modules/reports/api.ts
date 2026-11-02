import type { ApiClient } from "../../api/client";

/** Who sees what (mirrors the role gates in migration 0014; the database is the authority). */
export const PANEL_ROLES = ["owner", "location_manager"] as const;
export const TODAY_ROLES = ["owner", "location_manager", "front_desk"] as const;
export const FINANCE_ROLES = ["owner", "location_manager", "accountant"] as const;
export const MEMBERS_REPORT_ROLES = PANEL_ROLES;
export const REPORT_ROLES = FINANCE_ROLES;

export const REPORTS_ROUTES = {
  panel: "/staff/panel",
  today: "/staff/today",
  reports: "/staff/reports",
  ivu: "/staff/reports/ivu",
  sales: "/staff/reports/sales",
  members: "/staff/reports/members",
} as const;

export interface Dashboard {
  location_id: string | null;
  generated_at: string;
  members_active: number;
  members_new_month: number;
  members_cancelled_month: number;
  check_ins_today: number;
  check_ins_members_today: number;
  check_ins_week: number;
  classes_week: number;
  class_seats_week: number;
  class_booked_week: number;
  class_occupancy_pct: number | null;
  invoices_today: number;
  invoiced_today_cents: number;
  sessions_sold_today: number;
  collected_today_cents: number;
  store_sales_today: number;
  store_sales_today_cents: number;
  overdue_invoices: number;
  overdue_members: number;
  overdue_balance_cents: number;
  expiring_credits_7d: number;
  expiring_passes_7d: number;
  expiring_memberships_7d: number;
  leads_open: number;
  leads_new_month: number;
  leads_won_month: number;
  lead_conversion_pct_month: number | null;
  low_stock_products: number;
  /** Owner only. */
  points_liability?: number;
  points_members_with_balance?: number;
}
export interface TodayClass {
  session_id: string;
  location_id: string;
  class_name: string;
  room: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  waitlisted: number;
}
export interface Today {
  check_ins_today: number;
  check_ins_members_today: number;
  check_ins_denied_today: number;
  overdue_members: number;
  overdue_invoices: number;
  classes_today: TodayClass[];
}
export interface OverdueRow {
  invoice_id: string;
  number: number;
  member_id: string;
  full_name: string | null;
  member_no: string | null;
  location_id: string;
  location_name: string | null;
  due_date: string;
  days_overdue: number;
  balance_cents: number;
}
export interface ExpiringRow {
  kind: "credits" | "pass" | "membership";
  ref_id: string;
  member_id: string;
  full_name: string | null;
  location_id: string;
  location_name: string | null;
  expires_at: string;
  credits_remaining: number | null;
}
export interface HeatCell {
  dow: number;
  hour: number;
  check_ins: number;
}
export type SuriStatus = "participant" | "non_participant" | "unverified";
export interface IvuRow {
  municipality: string;
  suri_status: SuriStatus;
  source: "billing" | "store" | "store_refund";
  documents: number;
  taxable_base_cents: number;
  exempt_base_cents: number;
  ivu_state_cents: number;
  ivu_municipal_cents: number;
}
export interface SalesRow {
  source: "billing" | "store";
  location_id: string;
  location_name: string | null;
  product_id: string;
  product_name: string;
  product_kind: string;
  seller_person_id: string | null;
  seller_name: string | null;
  documents: number;
  units: number;
  subtotal_cents: number;
  ivu_cents: number;
  total_cents: number;
}
export interface MembersReport {
  status: Array<{ status: string; members: number }>;
  flow: Array<{ month: string; joins: number; cancellations: number }>;
}
export interface Municipality {
  id: string;
  municipality: string;
  suri_status: "participant" | "non_participant";
  note: string | null;
}
export interface CheckInResult {
  id: string;
  result: "allowed" | "denied";
  reason: string;
  member_id: string | null;
  full_name: string | null;
}
/** GET /v1/reports/executive — 12 months ending with the current month (America/Puerto_Rico). Money in cents. */
export interface ExecKpi {
  value: number;
  prev: number;
  series: number[];
}
export interface Executive {
  as_of: string;
  currency: string;
  months: string[];
  kpis: {
    revenue_month_cents: ExecKpi;
    active_members: ExecKpi;
    net_profit_month_cents: ExecKpi;
    checkins_today: ExecKpi;
  };
  revenue_vs_expenses: Array<{ month: string; revenue_cents: number; expenses_cents: number }>;
  new_members: Array<{ month: string; joins: number; cancellations: number }>;
  member_status: { active: number; expired: number; frozen: number; other: number };
  sales_mix: Array<{
    kind: string;
    label_es: string;
    label_en: string;
    units: number;
    revenue_cents: number;
  }>;
}
export type CsvReport = "overdue" | "expiring" | "heatmap" | "ivu" | "sales" | "members";

interface ListOf<T> {
  data: T[];
}
function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Typed calls for /v1/reports/*. Every number is computed by the database under the caller's RLS. */
export function reportsApi(api: ApiClient) {
  return {
    executive: (locationId?: string) =>
      api.request<Executive>("GET", `/reports/executive${qs({ location_id: locationId })}`),
    dashboard: (locationId?: string) =>
      api.request<Dashboard>("GET", `/reports/dashboard${qs({ location_id: locationId })}`),
    today: (locationId?: string) =>
      api.request<Today>("GET", `/reports/today${qs({ location_id: locationId })}`),
    overdue: (locationId?: string) =>
      api.request<ListOf<OverdueRow>>("GET", `/reports/overdue${qs({ location_id: locationId })}`),
    expiring: (locationId?: string, days = 7) =>
      api.request<ListOf<ExpiringRow>>(
        "GET",
        `/reports/expiring${qs({ location_id: locationId, days })}`,
      ),
    heatmap: (locationId: string | undefined, weeks: 4 | 8) =>
      api.request<{ weeks: number; data: HeatCell[] }>(
        "GET",
        `/reports/heatmap${qs({ location_id: locationId, weeks })}`,
      ),
    ivu: (month: string, locationId?: string) =>
      api.request<{ month: string; data: IvuRow[] }>(
        "GET",
        `/reports/ivu${qs({ month, location_id: locationId })}`,
      ),
    sales: (from: string, to: string, locationId?: string) =>
      api.request<ListOf<SalesRow>>(
        "GET",
        `/reports/sales${qs({ from, to, location_id: locationId })}`,
      ),
    members: (locationId?: string, months = 12) =>
      api.request<MembersReport>(
        "GET",
        `/reports/members${qs({ location_id: locationId, months })}`,
      ),
    municipalities: () => api.request<ListOf<Municipality>>("GET", "/reports/ivu-municipalities"),
    setMunicipality: (m: {
      municipality: string;
      suri_status: "participant" | "non_participant";
      note?: string;
    }) => api.request<Municipality>("PUT", "/reports/ivu-municipalities", m),
    /** CSV through the JSON client: the server wraps the file as { filename, csv } (audited export). */
    csv: (report: CsvReport, params: Record<string, string | number | undefined>, lang: string) =>
      api.request<{ filename: string; csv: string }>(
        "GET",
        `/reports/${report}.csv${qs({ ...params, lang, envelope: "json" })}`,
      ),
    members_list: (locationId?: string) => api.members(locationId),
    checkIn: (locationId: string, memberId: string) =>
      api.request<CheckInResult>("POST", "/schedule/check-ins", {
        location_id: locationId,
        member_id: memberId,
      }),
  };
}

export function money(cents: number | null | undefined, lang: "es" | "en"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
export function count(n: number | null | undefined, lang: "es" | "en"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US").format(n);
}
export function pct(n: number | null | undefined, lang: "es" | "en"): string {
  if (n === null || n === undefined) return "—";
  return `${new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", { maximumFractionDigits: 1 }).format(n)} %`;
}

/** Local (Puerto Rico) date as YYYY-MM-DD, `offsetDays` from `now`. */
export function isoDay(now: Date, offsetDays = 0): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(d);
}
/** Previous calendar month (Puerto Rico) as YYYY-MM — the month an IVU return is usually prepared for. */
export function previousMonth(now: Date): string {
  const [y, m] = isoDay(now).split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Heat level 0–4 for a cell, relative to the busiest cell (0 only when there were no check-ins). */
export function heatLevel(n: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * n) / max))) as 1 | 2 | 3 | 4;
}

/** Save a CSV string as a file (no-op where the browser lacks object URLs, e.g. tests). */
export function saveFile(filename: string, csv: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
