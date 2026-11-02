import { useMemo } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Tone } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { Lang } from "../types";
import { type BillStatus, type CommissionStatus, financeApi } from "./api";

/** Read finance (managers: their locations only). Mirrors app.fin_reader_at in migration 0013. */
export const FINANCE_READERS = ["owner", "location_manager", "accountant"] as const;
/** Enter bills, expenses, templates and commission proposals. Never the accountant. */
export const FINANCE_WRITERS = ["owner", "location_manager"] as const;
/** Generate and download the journal export. */
export const FINANCE_EXPORTERS = ["owner", "accountant"] as const;

export const isWriter = (role: string | null | undefined) =>
  (FINANCE_WRITERS as readonly string[]).includes(role ?? "");
export const isExporter = (role: string | null | undefined) =>
  (FINANCE_EXPORTERS as readonly string[]).includes(role ?? "");

export function useFin() {
  const { api } = useSession();
  return useMemo(() => financeApi(api), [api]);
}

/** Locations the caller can act on (the server already scopes them by role). */
export function useLocations() {
  const { api } = useSession();
  return useAsync(() => api.locations(), [api]);
}

/** Display only: the amounts come from the server in integer cents. */
export function money(cents: number | null | undefined, lang: Lang): string {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}

/** "YYYY-MM-DD" → localized date, without shifting the day across time zones. */
export function day(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}

/** "1234.5" → 123450. Input parsing only: null when the text is not a valid positive amount. */
export function parseCents(text: string): number | null {
  const m = /^\s*\$?\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** Today in Puerto Rico as YYYY-MM-DD, and the current month as YYYY-MM. */
export function todayPR(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Puerto_Rico",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts.slice(0, 10);
}
export function thisMonth(): string {
  return todayPR().slice(0, 7);
}

export function billTone(status: BillStatus): Tone {
  if (status === "paid") return "ok";
  if (status === "approved") return "neutral";
  if (status === "pending_approval") return "warn";
  return "blocked";
}
export function commissionTone(status: CommissionStatus): Tone {
  if (status === "paid") return "ok";
  if (status === "approved") return "neutral";
  if (status === "pending") return "warn";
  return "blocked";
}

/** Run an action with busy/announce/error state handled by the caller's setters. */
export async function act(
  set: {
    busy: (b: boolean) => void;
    error: (e: ErrorCode | null) => void;
    announce: (s: string | null) => void;
  },
  fn: () => Promise<string>,
): Promise<boolean> {
  set.busy(true);
  set.error(null);
  set.announce(null);
  try {
    set.announce(await fn());
    return true;
  } catch (err) {
    set.error(toErrorCode(err));
    return false;
  } finally {
    set.busy(false);
  }
}

/** Offer the CSV as a file download (browser only; a no-op where object URLs are unavailable). */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
