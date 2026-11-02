import type { ApiClient } from "../../api/client";

// Mirrors packages/shared/src/modules/crm.ts (the web app does not depend on @gym/shared).
export const LEAD_SOURCES = [
  "web",
  "whatsapp",
  "instagram",
  "referral",
  "walk_in",
  "other",
] as const;
export const LEAD_STAGES = ["new", "contacted", "tour_booked", "trial", "won", "lost"] as const;
/** Stages a person can pick; 'won' happens only through conversion. */
export const MANUAL_STAGES = ["new", "contacted", "tour_booked", "trial", "lost"] as const;
export const ACTIVITY_KINDS = ["call", "message", "tour", "note"] as const;
export const TASK_STATUSES = ["open", "done", "cancelled"] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number] | "stage_change";
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Lead {
  id: string;
  location_id: string;
  source: LeadSource;
  stage: LeadStage;
  lost_reason: string | null;
  owner_staff_id: string | null;
  owner_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  member_id: string | null;
  created_at: string;
  stage_changed_at: string;
}
export interface Activity {
  id: string;
  kind: ActivityKind;
  body: string | null;
  from_stage: LeadStage | null;
  to_stage: LeadStage | null;
  at: string;
  by_name: string | null;
}
export interface LeadDetail extends Lead {
  activities: Activity[];
}
export interface NewLead {
  location_id: string;
  source: LeadSource;
  full_name: string;
  email?: string;
  phone?: string;
  notes?: string;
  owner_staff_id?: string;
}
export interface LeadPatch {
  stage?: Exclude<LeadStage, "won">;
  lost_reason?: string;
  owner_staff_id?: string | null;
}
export interface Task {
  id: string;
  location_id: string;
  title: string;
  due_at: string;
  status: TaskStatus;
  assigned_staff_id: string;
  assignee_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  member_id: string | null;
  member_name: string | null;
}
export interface NewTask {
  location_id: string;
  title: string;
  due_at: string;
  assigned_staff_id: string;
  lead_id?: string;
  member_id?: string;
}
export interface FunnelRow {
  location_id: string;
  source: LeadSource;
  total: number;
  new: number;
  contacted: number;
  tour_booked: number;
  trial: number;
  won: number;
  lost: number;
  conversion_pct: number;
}
export interface StaffOption {
  id: string;
  display_name: string;
  role: string;
}
interface ListOf<T> {
  data: T[];
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
const enc = encodeURIComponent;

/** Typed calls for /v1/crm/*. Business rules live in the API and the database; this is transport only. */
export function crmApi(api: ApiClient) {
  return {
    leads: (locationId?: string) =>
      api.request<ListOf<Lead>>("GET", `/crm/leads${qs({ location_id: locationId })}`),
    lead: (id: string) => api.request<LeadDetail>("GET", `/crm/leads/${enc(id)}`),
    createLead: (l: NewLead) => api.request<{ id: string }>("POST", "/crm/leads", l),
    updateLead: (id: string, p: LeadPatch) =>
      api.request<{ id: string; stage: LeadStage }>("PATCH", `/crm/leads/${enc(id)}`, p),
    addActivity: (id: string, kind: (typeof ACTIVITY_KINDS)[number], body: string) =>
      api.request<{ id: string }>("POST", `/crm/leads/${enc(id)}/activities`, { kind, body }),
    convert: (id: string) =>
      api.request<{ member_id: string }>("POST", `/crm/leads/${enc(id)}/convert`),
    tasks: (f: { mine?: boolean; memberId?: string; leadId?: string } = {}) =>
      api.request<ListOf<Task>>(
        "GET",
        `/crm/tasks${qs({ mine: f.mine ? "true" : undefined, member_id: f.memberId, lead_id: f.leadId })}`,
      ),
    createTask: (task: NewTask) => api.request<{ id: string }>("POST", "/crm/tasks", task),
    setTaskStatus: (id: string, status: TaskStatus) =>
      api.request<{ id: string; status: TaskStatus }>("PATCH", `/crm/tasks/${enc(id)}`, { status }),
    funnel: (from: string, to: string, locationId?: string) =>
      api.request<ListOf<FunnelRow>>(
        "GET",
        `/crm/funnel${qs({ from, to, location_id: locationId })}`,
      ),
    staff: (locationId: string, purpose: "lead" | "task") =>
      api.request<ListOf<StaffOption>>(
        "GET",
        `/crm/staff${qs({ location_id: locationId, purpose })}`,
      ),
  };
}

export const MANAGER_ROLES = ["owner", "location_manager", "front_desk"] as const;
export const TASK_ROLES = [...MANAGER_ROLES, "trainer"] as const;
export const FUNNEL_ROLES = ["owner", "location_manager"] as const;
export function isManager(role: string | null | undefined): boolean {
  return !!role && (MANAGER_ROLES as readonly string[]).includes(role);
}

/** Bucket a task for the "Tareas" screen: closed, overdue, due today (PR time) or upcoming. */
export function taskBucket(
  task: Pick<Task, "status" | "due_at">,
  now: Date,
): "closed" | "overdue" | "today" | "upcoming" {
  if (task.status !== "open") return "closed";
  const due = new Date(task.due_at);
  if (due.getTime() < now.getTime()) return "overdue";
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(d);
  return day(due) === day(now) ? "today" : "upcoming";
}

/** Local date (PR) as YYYY-MM-DD, `offsetDays` from `now`. */
export function isoDay(now: Date, offsetDays = 0): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(d);
}
