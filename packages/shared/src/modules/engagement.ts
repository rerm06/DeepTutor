/** Shared types and constants for module engagement (spec §9). Must match migration 0012. */
export const MODULE_ENGAGEMENT = "engagement" as const;

export const POINTS_EVENTS = [
  "visit",
  "class",
  "purchase",
  "challenge_goal",
  "referral",
  "comeback_bonus",
] as const;
export type PointsEvent = (typeof POINTS_EVENTS)[number];
/** Events front-of-house staff can award by hand; the rest are credited by the system paths. */
export const AWARDABLE_EVENTS = ["visit", "class", "purchase"] as const;
export type AwardableEvent = (typeof AWARDABLE_EVENTS)[number];

export const LEDGER_REASONS = [
  ...POINTS_EVENTS,
  "manual",
  "redemption",
  "redemption_refund",
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const CHALLENGE_KINDS = ["individual", "team", "location"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const CHALLENGE_METRICS = ["visits", "classes", "points"] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];
export const COMPARE_MODES = ["self", "ranked"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const REDEMPTION_STATUSES = ["requested", "fulfilled", "cancelled"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
export const REFERRAL_STATUSES = ["pending", "joined", "credited"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const POST_STATUSES = ["pending", "approved", "rejected"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const ACHIEVEMENT_CODES = [
  "first_visit",
  "streak_4",
  "streak_12",
  "comeback",
  "challenge_goal",
  "first_referral",
] as const;
export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];

/** Limits mirrored from the database (the database is authoritative). */
export const POST_MAX_LENGTH = 500;
export const MANUAL_POINTS_MAX = 10_000;
/** Days without a visit after which the next visit earns the comeback bonus [P]. */
export const COMEBACK_DAYS = 14;
