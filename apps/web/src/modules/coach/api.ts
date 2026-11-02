import type { ApiClient } from "../../api/client";

/** Shapes of the coach endpoints (apps/api/src/modules/coach.ts). Every rule is enforced server-side. */
export const MEMORY_CATEGORIES = [
  "preference",
  "restriction",
  "injury",
  "goal",
  "equipment",
  "schedule",
  "other",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export const BODY_AREAS = [
  "knee",
  "shoulder",
  "lower_back",
  "upper_back",
  "neck",
  "hip",
  "ankle",
  "wrist",
  "elbow",
  "chest",
  "head",
  "other",
] as const;
export type BodyArea = (typeof BODY_AREAS)[number];
export type Band = "baseline" | "above" | "typical" | "below";

export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  topic: string;
  content: string;
  source: "member" | "staff" | "coach";
  updated_at: string;
}
export interface Checkin {
  id: string;
  local_date: string;
  sleep: number;
  energy: number;
  pain: number;
  pain_area: BodyArea | null;
  pain_acute: boolean;
  note: string | null;
  score: number | null;
  baseline_days: number;
  escalated: boolean;
  emergency: boolean;
}
export interface CheckinInput {
  member_id?: string;
  sleep: number;
  energy: number;
  pain: number;
  pain_area?: BodyArea;
  pain_acute?: boolean;
  note?: string;
}
export interface CheckinResult {
  id: string;
  local_date: string;
  baseline_days: number;
  score: number | null;
  band: Band;
  escalated: boolean;
  emergency: boolean;
}
export interface Today {
  member_id: string;
  checkin: Checkin | null;
  band: Band | null;
  baseline_days: number;
  plan: {
    id: string;
    title: string;
    approver_name: string | null;
    body: { sections: Array<{ heading: string; items: string[] }> };
  } | null;
  suggestion:
    | "checkin_first"
    | "emergency"
    | "talk_to_trainer"
    | "no_plan"
    | "lighter_option"
    | "follow_plan";
}
export interface Proposal {
  id: string;
  tool: "log_set" | "add_memory" | "book_class" | "register_checkin";
  summary: string;
}
export interface ChatReply {
  enabled: boolean;
  notice?: "provider_disabled";
  reply: string | null;
  verdict?: "allow" | "blocked" | "emergency" | "human";
  emergency: boolean;
  human_handoff: boolean;
  proposals: Proposal[];
}
export interface Escalation {
  id: string;
  reason: "checkin_pain" | "checkin_acute" | "memory_injury" | "chat_acute" | "human_requested";
  status: "open" | "acknowledged" | "closed";
  created_at: string;
  assigned_to: string | null;
  has_task: boolean;
}
export interface StaffSummary {
  member_id: string;
  memory: MemoryFact[];
  checkins: Checkin[];
  escalations: Escalation[];
}
export interface DraftResult {
  plan_id: string;
  status: "draft";
  active_days_28: number;
  draft: {
    ageYears: number;
    bmr: number;
    factor: number;
    kcalMin: number;
    kcalMax: number;
    proteinMinG: number;
    proteinMaxG: number;
  };
}

const enc = encodeURIComponent;
const q = (memberId?: string) => (memberId ? `?member_id=${enc(memberId)}` : "");

export function coachApi(api: ApiClient) {
  return {
    status: () => api.request<{ provider: string; enabled: boolean }>("GET", "/coach/status"),
    memory: (memberId?: string) =>
      api.request<{ member_id: string; data: MemoryFact[] }>("GET", `/coach/memory${q(memberId)}`),
    addFact: (content: string, category?: MemoryCategory, memberId?: string) =>
      api.request<{ operation: "ADD" | "UPDATE" | "DELETE" | "NOOP"; id: string | null }>(
        "POST",
        "/coach/memory",
        {
          content,
          ...(category ? { category } : {}),
          ...(memberId ? { member_id: memberId } : {}),
        },
      ),
    editFact: (id: string, content: string, category: MemoryCategory) =>
      api.request<{ id: string }>("PATCH", `/coach/memory/${enc(id)}`, { content, category }),
    deleteFact: (id: string) => api.request<{ id: string }>("DELETE", `/coach/memory/${enc(id)}`),
    today: (memberId?: string) => api.request<Today>("GET", `/coach/today${q(memberId)}`),
    checkin: (input: CheckinInput) => api.request<CheckinResult>("POST", "/coach/checkins", input),
    chat: (
      message: string,
      history: Array<{ role: "member" | "coach"; content: string }>,
      lang: "es" | "en",
    ) => api.request<ChatReply>("POST", "/coach/chat", { message, history, lang }),
    confirm: (id: string) =>
      api.request<{ id: string; status: string; error: string | null }>(
        "POST",
        `/coach/actions/${enc(id)}/confirm`,
      ),
    reject: (id: string) =>
      api.request<{ id: string; status: string }>("POST", `/coach/actions/${enc(id)}/reject`),
    summary: (memberId: string) =>
      api.request<StaffSummary>("GET", `/coach/members/${enc(memberId)}/summary`),
    escalation: (id: string, action: "acknowledge" | "close") =>
      api.request<{ id: string; status: string }>(
        "POST",
        `/coach/escalations/${enc(id)}/${action}`,
      ),
    nutritionDraft: (b: {
      member_id: string;
      goal: "maintenance" | "deficit" | "surplus";
      birth_date: string;
      sex: "female" | "male";
    }) => api.request<DraftResult>("POST", "/coach/nutrition-drafts", b),
  };
}
export type CoachApi = ReturnType<typeof coachApi>;
