import { useMemo } from "react";
import type { ApiClient } from "../../api/client";
import { useSession } from "../../session/SessionContext";

/** Wire types of the portal endpoints (apps/api/src/modules/portal.ts). Amounts are integer cents. */
export interface Program {
  id: string;
  kind: "circuit" | "training_plan";
  name: string;
  week: number | null;
  weeks: number | null;
  pct: number;
  href: string;
}
export interface Home {
  member: {
    id: string;
    first_name: string;
    member_no: string | null;
    location_name: string | null;
  };
  membership: {
    kind: "subscription" | "credits" | "none";
    name: string | null;
    status: "active" | "frozen" | "past_due" | "expired" | "none";
    renews_on: string | null;
    credits_left: number | null;
    expires_on: string | null;
  };
  next_class: {
    booking_id: string;
    class_name: string;
    room: string | null;
    starts_at: string;
  } | null;
  streak: { days: number; last7: boolean[] };
  week: {
    goal: number;
    trainings: number;
    classes_booked: number;
    classes_attended: number;
    active_minutes: number;
    pct: number;
  };
  programs: Program[];
  challenge: { id: string; name: string; joined: boolean; ends_on: string; perks: string[] } | null;
  coach: { enabled: boolean };
  documents: number;
}
export interface ProgressWeek {
  week_start: string;
  trainings: number;
  classes_attended: number;
  active_minutes: number;
}
export interface Progress {
  member_id: string;
  goal: number;
  weeks: ProgressWeek[];
  recent: Array<{ at: string; kind: "check_in" | "class" | "circuit"; label: string }>;
}
export interface PlanSection {
  heading: string;
  items: string[];
}
export interface Nutrition {
  member_id: string;
  plan: {
    id: string;
    title: string;
    body: { sections: PlanSection[] };
    approver_name: string;
    approver_license_no: string;
    approved_at: string;
    published_at: string;
  } | null;
  appointment: { id: string; starts_at: string; location_name: string } | null;
}
export interface Documents {
  member_id: string;
  agreements: Array<{
    id: string;
    kind: "terms" | "waiver";
    version: string;
    locale: string;
    source: string;
    accepted_at: string;
    title: string | null;
  }>;
  consents: Array<{
    id: string;
    brand_id: string;
    brand_name: string;
    channel: "whatsapp" | "sms" | "email";
    purpose: "transactional" | "reminder" | "marketing";
    status: "granted" | "revoked";
    since: string | null;
  }>;
  invoices: Array<{
    id: string;
    number: number;
    issued_on: string;
    total_cents: number;
    status: "open" | "paid" | "void";
    href: string;
  }>;
}

/** Goal bounds, mirrored from app.set_member_goal() (the database is the authority). */
export const GOAL_MIN = 1;
export const GOAL_MAX = 14;
/** Parse the goal field: a whole number in range, or null. */
export function parseGoal(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= GOAL_MIN && n <= GOAL_MAX ? n : null;
}

export function portalApi(api: ApiClient) {
  const r = api.request;
  return {
    home: () => r<Home>("GET", "/me/home"),
    progress: () => r<Progress>("GET", "/me/progress"),
    documents: () => r<Documents>("GET", "/me/documents"),
    nutrition: () => r<Nutrition>("GET", "/me/nutrition"),
    setGoal: (weekly_trainings: number) =>
      r<{ weekly_trainings: number }>("PUT", "/me/goal", { weekly_trainings }),
  };
}
export type PortalApi = ReturnType<typeof portalApi>;

export function usePortalApi(): PortalApi {
  const { api } = useSession();
  return useMemo(() => portalApi(api), [api]);
}

/** A `YYYY-MM-DD` local date for display (no time-zone shift: it is already the member's local date). */
export function localDay(iso: string | null | undefined, lang: "es" | "en"): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}
export function money(cents: number, lang: "es" | "en"): string {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
