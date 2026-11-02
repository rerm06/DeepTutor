/**
 * Shared types and constants for module health (spec §6.1–6.2, §6.6–6.7). Must match migration 0010.
 * The triage itself lives ONLY in SQL (app.health_triage); nothing here re-implements it.
 */
export const MODULE_HEALTH = "health" as const;

/** The 7 general PAR-Q+ yes/no questions, keyed q1..q7. [VERIFICAR · texto oficial PAR-Q+ y licencia de uso] */
export const PARQ_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"] as const;
export type ParqKey = (typeof PARQ_KEYS)[number];

/** Fixed list of declarable conditions (no free text). */
export const HEALTH_CONDITIONS = [
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
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];

export const FITNESS_TEST_KEYS = [
  "pushups",
  "plank_seconds",
  "sit_reach_cm",
  "chair_stand_30s",
  "step_test_hr",
  "walk_6min_m",
] as const;

export const TRIAGE_LEVELS = ["green", "amber", "red"] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];
/** Proposal pending clinical review [VERIFICAR · equipo clínico]. */
export const TRIAGE_RULE_VERSION = "v0-propuesta" as const;

export const CARE_PLAN_KINDS = ["training", "nutrition", "treatment"] as const;
export type CarePlanKind = (typeof CARE_PLAN_KINDS)[number];
export const CARE_PLAN_STATUSES = ["draft", "review", "approved", "published", "archived"] as const;
export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number];

/** Roles that see health data (member's location; owner org-wide). Never front_desk, chef or accountant. */
export const HEALTH_STAFF_ROLES = [
  "owner",
  "location_manager",
  "trainer",
  "nutritionist",
  "clinician",
] as const;
