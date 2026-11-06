/** Shared types and constants for module crm. Must match the enums in packages/db/migrations/0008_crm.sql. */
export const MODULE_CRM = "crm" as const;

export const LEAD_SOURCES = [
  "web",
  "whatsapp",
  "instagram",
  "referral",
  "walk_in",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STAGES = ["new", "contacted", "tour_booked", "trial", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
/** Stages a person can move a lead to by hand; 'won' happens only through conversion. */
export const LEAD_MANUAL_STAGES = ["new", "contacted", "tour_booked", "trial", "lost"] as const;

/** Activity kinds request traffic may log; 'stage_change' is written by the database only. */
export const LEAD_ACTIVITY_KINDS = ["call", "message", "tour", "note"] as const;

export const CRM_TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];
