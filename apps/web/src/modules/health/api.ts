import type { ApiClient } from "../../api/client";

/** Shapes of the health endpoints (apps/api/src/modules/health.ts). All rules are enforced server-side. */
export const PARQ_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"] as const;
export type ParqKey = (typeof PARQ_KEYS)[number];
export type Parq = Record<ParqKey, boolean>;
export const CONDITIONS = [
  "diabetes",
  "ckd",
  "cvd",
  "pregnancy",
  "lactation",
  "glp1",
  "eating_disorder_screen_positive",
  "advanced_ckd",
  "active_ed",
  "high_risk_pregnancy",
] as const;
export type Condition = (typeof CONDITIONS)[number];
export type Level = "green" | "amber" | "red";
export const PLAN_KINDS = ["training", "nutrition", "treatment"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export type PlanStatus = "draft" | "review" | "approved" | "published" | "archived";

export interface Triage {
  id?: string;
  rule_version: string;
  exercise_level: Level;
  nutrition_level: Level;
  requires_medical_referral: boolean;
  emergency: boolean;
  no_calorie_counting: boolean;
  reasons: string[];
  computed_at?: string;
}

export interface Assessment {
  id: string;
  member_id: string;
  member_name: string;
  evaluator_name: string | null;
  taken_at: string;
  parq: Parq;
  parq_followup_resolved: boolean;
  declared_conditions: Condition[];
  resting_hr: number | null;
  bp_sys: number | null;
  bp_dia: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  fitness_tests: Record<string, number>;
  acute_symptoms: boolean;
  status: "draft" | "signed";
  signed_by_name: string | null;
  signed_at: string | null;
  triage: Triage | null;
}

export interface AssessmentInput {
  parq: Parq;
  parq_followup_resolved: boolean;
  declared_conditions: Condition[];
  resting_hr: number | null;
  bp_sys: number | null;
  bp_dia: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  fitness_tests: Record<string, number>;
  acute_symptoms: boolean;
}

export interface PlanSection {
  heading: string;
  items: string[];
}
export interface Plan {
  id: string;
  member_id: string;
  member_name: string;
  series_id: string;
  kind: PlanKind;
  version: number;
  status: PlanStatus;
  title: string;
  body: { sections: PlanSection[] };
  rationale: string | null;
  created_by_name: string | null;
  approver_name: string | null;
  approver_license_no: string | null;
  approved_at: string | null;
  published_at: string | null;
}

export interface HealthWhoami {
  role: string;
  staff: {
    staff_id: string;
    role: string;
    display_name: string;
    license_no: string | null;
    license_verified: boolean;
  } | null;
}

const enc = encodeURIComponent;
const q = (memberId?: string) => (memberId ? `?member_id=${enc(memberId)}` : "");

export function healthApi(api: ApiClient) {
  return {
    whoami: () => api.request<HealthWhoami>("GET", "/health/whoami"),
    assessments: (memberId?: string) =>
      api.request<{ data: Assessment[] }>("GET", `/health/assessments${q(memberId)}`),
    createAssessment: (memberId: string, input: AssessmentInput) =>
      api.request<{ id: string }>("POST", "/health/assessments", { member_id: memberId, ...input }),
    updateAssessment: (id: string, input: AssessmentInput) =>
      api.request<{ id: string }>("PATCH", `/health/assessments/${enc(id)}`, input),
    signAssessment: (id: string) =>
      api.request<{ id: string; status: string; triage: Triage }>(
        "POST",
        `/health/assessments/${enc(id)}/sign`,
      ),
    preview: (input: {
      member_id?: string;
      parq: Parq;
      parq_followup_resolved: boolean;
      declared_conditions: Condition[];
      acute_symptoms: boolean;
    }) => api.request<Triage>("POST", "/health/triage-preview", input),
    plans: (memberId?: string) =>
      api.request<{ data: Plan[] }>("GET", `/health/plans${q(memberId)}`),
    createPlan: (p: {
      member_id: string;
      kind: PlanKind;
      title: string;
      body: { sections: PlanSection[] };
      rationale?: string;
    }) => api.request<{ id: string }>("POST", "/health/plans", p),
    updatePlan: (id: string, p: { title?: string; body?: { sections: PlanSection[] } }) =>
      api.request<{ id: string }>("PATCH", `/health/plans/${enc(id)}`, p),
    transition: (
      id: string,
      action: "submit" | "return" | "approve" | "publish" | "archive",
      referralAcknowledged?: boolean,
    ) =>
      api.request<{ id: string; status: PlanStatus }>(
        "POST",
        `/health/plans/${enc(id)}/${action}`,
        action === "approve" ? { referral_acknowledged: referralAcknowledged ?? false } : undefined,
      ),
    newVersion: (id: string) =>
      api.request<{ id: string }>("POST", `/health/plans/${enc(id)}/new-version`),
  };
}

/** Health data is shown only to these staff roles (the server enforces it; this only shapes navigation). */
export const HEALTH_STAFF = ["owner", "location_manager", "trainer", "nutritionist", "clinician"];
export const AUTHORS: Record<PlanKind, string[]> = {
  training: ["trainer", "location_manager"],
  nutrition: ["nutritionist"],
  treatment: ["clinician"],
};
export const APPROVERS = AUTHORS;
export const PUBLISHERS = (kind: PlanKind) => [...APPROVERS[kind], "owner", "location_manager"];

/** Latest signed triage of a member (assessments arrive newest first). */
export function latestTriage(list: Assessment[]): Triage | null {
  return list.find((a) => a.status === "signed" && a.triage)?.triage ?? null;
}

/** "## Heading" lines start sections; other non-empty lines are items. */
export function parseBody(text: string): { sections: PlanSection[] } {
  const sections: PlanSection[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) sections.push({ heading: line.slice(3).trim(), items: [] });
    else {
      if (sections.length === 0) sections.push({ heading: "—", items: [] });
      sections[sections.length - 1]?.items.push(line);
    }
  }
  return { sections };
}
export function formatBody(body: { sections: PlanSection[] }): string {
  return body.sections.map((s) => [`## ${s.heading}`, ...s.items].join("\n")).join("\n\n");
}
