import type { ApiClient } from "../../api/client";
import type { ListOf } from "../../api/types";

// Mirrors packages/shared/src/modules/engagement.ts (the web app does not depend on @gym/shared).
export const AWARDABLE_EVENTS = ["visit", "class", "purchase"] as const;
export type AwardableEvent = (typeof AWARDABLE_EVENTS)[number];
export type PointsEvent = AwardableEvent | "challenge_goal" | "referral" | "comeback_bonus";
export const CHALLENGE_KINDS = ["individual", "team", "location"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const CHALLENGE_METRICS = ["visits", "classes", "points"] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];
export type CompareMode = "self" | "ranked";
export type RedemptionStatus = "requested" | "fulfilled" | "cancelled";
export type ReferralStatus = "pending" | "joined" | "credited";
export type PostStatus = "pending" | "approved" | "rejected";
export const POST_MAX_LENGTH = 500;

export interface Rule {
  id: string;
  event: PointsEvent;
  points: number;
  active: boolean;
}
export interface Reward {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  restricted_for_minors: boolean;
  active: boolean;
}
export interface LedgerRow {
  id: string;
  member_id?: string;
  member_name?: string | null;
  delta: number;
  reason: string;
  ref: string | null;
  note: string | null;
  at: string;
}
export interface MemberPoints {
  member_id: string;
  balance: number;
  weekly_streak: number;
  history: LedgerRow[];
  achievements: { code: string; ref: string | null; earned_at: string }[];
}
export interface Redemption {
  id: string;
  member_id: string;
  member_name: string | null;
  reward_id: string;
  reward_name: string | null;
  points: number;
  status: RedemptionStatus;
  created_at: string;
  handled_at: string | null;
}
export interface Challenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  metric: ChallengeMetric;
  location_id: string | null;
  starts_on: string;
  ends_on: string;
  goal: number;
  leaderboard_opt_in_default: boolean;
}
export interface NewChallenge {
  name: string;
  kind: ChallengeKind;
  metric: ChallengeMetric;
  location_id: string | null;
  starts_on: string;
  ends_on: string;
  goal: number;
  leaderboard_opt_in_default: boolean;
}
export interface Participant {
  id: string;
  member_id: string;
  member_name: string | null;
  team_id: string | null;
  show_on_leaderboard: boolean;
  compare_mode: CompareMode;
  progress: number;
  goal_reached_at: string | null;
}
export interface BoardRow {
  division: "self" | ChallengeKind;
  rank: number | null;
  label: string;
  progress: number;
  goal: number;
  is_me: boolean;
}
export interface Referral {
  id: string;
  referrer_member_id: string;
  referrer_name: string | null;
  referred_email: string;
  status: ReferralStatus;
  credit_points: number;
  created_at: string;
}
export interface Post {
  id: string;
  author_member_id: string;
  author_label: string;
  body: string;
  status: PostStatus;
  location_id: string;
  created_at: string;
  moderated_at: string | null;
}

const enc = encodeURIComponent;
function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Typed wrappers over the generic client for /v1/engagement/* (see docs/modules/engagement.md). */
export function engagementApi(api: ApiClient) {
  const r = api.request;
  return {
    rules: () => r<ListOf<Rule>>("GET", "/engagement/rules"),
    updateRule: (id: string, patch: { points?: number; active?: boolean }) =>
      r<{ id: string }>("PATCH", `/engagement/rules/${enc(id)}`, patch),
    rewards: () => r<ListOf<Reward>>("GET", "/engagement/rewards"),
    createReward: (b: {
      name: string;
      description?: string;
      points_cost: number;
      restricted_for_minors: boolean;
    }) => r<{ id: string }>("POST", "/engagement/rewards", b),
    updateReward: (id: string, patch: { active?: boolean }) =>
      r<{ id: string }>("PATCH", `/engagement/rewards/${enc(id)}`, patch),
    memberPoints: (memberId: string) =>
      r<MemberPoints>("GET", `/engagement/members/${enc(memberId)}/points`),
    award: (memberId: string, event: AwardableEvent) =>
      r<{ points: number }>("POST", `/engagement/members/${enc(memberId)}/award`, { event }),
    manual: (memberId: string, delta: number, note: string) =>
      r<{ id: string }>("POST", `/engagement/members/${enc(memberId)}/manual`, { delta, note }),
    ledger: (memberId?: string) =>
      r<ListOf<LedgerRow>>("GET", `/engagement/ledger${qs({ member_id: memberId })}`),
    liability: () =>
      r<{ outstanding_points: number; members_with_balance: number }>(
        "GET",
        "/engagement/liability",
      ),
    redeem: (memberId: string, rewardId: string) =>
      r<{ id: string }>("POST", "/engagement/redemptions", {
        member_id: memberId,
        reward_id: rewardId,
      }),
    redemptions: (q: { member_id?: string; status?: RedemptionStatus } = {}) =>
      r<ListOf<Redemption>>("GET", `/engagement/redemptions${qs(q)}`),
    setRedemption: (id: string, status: "fulfilled" | "cancelled") =>
      r<{ id: string }>("PATCH", `/engagement/redemptions/${enc(id)}`, { status }),
    challenges: () => r<ListOf<Challenge>>("GET", "/engagement/challenges"),
    createChallenge: (b: NewChallenge) => r<{ id: string }>("POST", "/engagement/challenges", b),
    teams: (challengeId: string) =>
      r<ListOf<{ id: string; name: string }>>(
        "GET",
        `/engagement/challenges/${enc(challengeId)}/teams`,
      ),
    addTeam: (challengeId: string, name: string) =>
      r<{ id: string }>("POST", `/engagement/challenges/${enc(challengeId)}/teams`, { name }),
    participants: (challengeId: string) =>
      r<ListOf<Participant>>("GET", `/engagement/challenges/${enc(challengeId)}/participants`),
    join: (challengeId: string, memberId: string, teamId: string | null, show: boolean) =>
      r<{ id: string }>("POST", `/engagement/challenges/${enc(challengeId)}/join`, {
        member_id: memberId,
        team_id: teamId,
        show_on_leaderboard: show,
      }),
    preferences: (challengeId: string, memberId: string, show: boolean, mode: CompareMode) =>
      r<unknown>("PUT", `/engagement/challenges/${enc(challengeId)}/preferences`, {
        member_id: memberId,
        show_on_leaderboard: show,
        compare_mode: mode,
      }),
    leaderboard: (challengeId: string) =>
      r<ListOf<BoardRow>>("GET", `/engagement/challenges/${enc(challengeId)}/leaderboard`),
    referrals: (memberId?: string) =>
      r<ListOf<Referral>>("GET", `/engagement/referrals${qs({ member_id: memberId })}`),
    refer: (memberId: string, email: string) =>
      r<{ id: string }>("POST", "/engagement/referrals", { member_id: memberId, email }),
    creditReferral: (id: string) =>
      r<{ status: ReferralStatus }>("POST", `/engagement/referrals/${enc(id)}/credit`),
    posts: (status?: PostStatus) => r<ListOf<Post>>("GET", `/engagement/posts${qs({ status })}`),
    post: (memberId: string, body: string) =>
      r<{ id: string; status: "pending" }>("POST", "/engagement/posts", {
        member_id: memberId,
        body,
      }),
    moderate: (id: string, decision: "approve" | "reject") =>
      r<{ status: PostStatus }>("POST", `/engagement/posts/${enc(id)}/moderate`, { decision }),
  };
}
export type EngagementApi = ReturnType<typeof engagementApi>;
