import type { Tx } from "@gym/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveProvider } from "./coach.js";

/**
 * Module portal (member portal) · HTTP routes under /v1. Every query runs as the caller (app.asCaller → RLS).
 * The member the caller acts for comes from app.portal_acting_member(): a member gets their own row, a guardian
 * their ward (`?member_id=`, or the first ward); staff get 403 and a member_id the caller may not act for gets 404.
 * The portal only READS other modules' tables (schedule, billing, floor, health, engagement, signup, messaging);
 * its own writes are the weekly goal (app.set_member_goal, members only) and challenge perks (owner / manager).
 * Local dates are the member's home location time zone. No health data is ever returned to staff here.
 */

// ── Pure helpers (exported for tests) ─────────────────────────────────────────────────────────────────────
/** Default weekly goal when the member has not set one. */
export const DEFAULT_WEEKLY_GOAL = 4;
/** Estimated minutes for a visit without an attended class (the UI labels the total as an estimate). */
export const MINUTES_PER_VISIT = 60;
/** Streaks are looked up this far back. */
export const STREAK_LOOKBACK_DAYS = 400;
export const PROGRESS_WEEKS = 12;
export const RECENT_EVENTS = 20;

/** `YYYY-MM-DD` + n days (calendar arithmetic, no time zone involved). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the ISO week that contains `iso`. */
export function isoWeekStart(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Consecutive local days with an allowed check-in, ending today or yesterday; plus the last 7 days (oldest first). */
export function computeStreak(
  days: ReadonlySet<string>,
  today: string,
): { days: number; last7: boolean[] } {
  const yesterday = addDays(today, -1);
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  let n = 0;
  while (cursor && days.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  const last7 = Array.from({ length: 7 }, (_, i) => days.has(addDays(today, i - 6)));
  return { days: n, last7 };
}

export interface DayStat {
  d: string;
  checkin: boolean;
  classes: number;
  minutes: number;
}
/**
 * Totals for the local week starting at `weekStart`: trainings = days with an allowed check-in; classes attended;
 * active minutes = attended class durations, or MINUTES_PER_VISIT for a check-in day without an attended class.
 */
export function weekTotals(rows: readonly DayStat[], weekStart: string) {
  const end = addDays(weekStart, 7);
  let trainings = 0;
  let classes_attended = 0;
  let active_minutes = 0;
  for (const r of rows) {
    if (r.d < weekStart || r.d >= end) continue;
    if (r.checkin) trainings += 1;
    classes_attended += r.classes;
    active_minutes += r.classes > 0 ? r.minutes : r.checkin ? MINUTES_PER_VISIT : 0;
  }
  return { trainings, classes_attended, active_minutes };
}

export function goalPct(trainings: number, goal: number): number {
  return Math.min(100, Math.round((trainings / goal) * 100));
}

/** Weeks of a training plan, read from its section headings ("Semanas 7 y 8", "Week 4"): the highest week number. */
export function planWeeks(body: unknown): number | null {
  const sections = (body as { sections?: Array<{ heading?: unknown }> } | null)?.sections;
  if (!Array.isArray(sections)) return null;
  let max = 0;
  for (const s of sections) {
    const h = typeof s?.heading === "string" ? s.heading : "";
    if (!/^\s*(semanas?|weeks?)\b/i.test(h)) continue;
    for (const m of h.match(/\d{1,2}/g) ?? []) max = Math.max(max, Number(m));
  }
  return max > 0 ? Math.min(max, 52) : null;
}
/** Current week (1-based) since publication and the share of the plan's days already elapsed. */
export function planProgress(publishedOn: string, today: string, weeks: number | null) {
  if (!weeks) return { week: null, weeks: null, pct: 0 };
  const elapsed = Math.max(0, daysBetween(publishedOn, today));
  return {
    week: Math.min(weeks, Math.floor(elapsed / 7) + 1),
    weeks,
    pct: Math.min(100, Math.round((elapsed / (weeks * 7)) * 100)),
  };
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

// ── Schemas ────────────────────────────────────────────────────────────────────────────────────────────────
const ActingQuery = z.object({ member_id: z.string().uuid().optional() }).strict();
const GoalBody = z.object({ weekly_trainings: z.number().int().min(1).max(14) }).strict();
const IdParams = z.object({ id: z.string().uuid() }).strict();
const PerksBody = z
  .object({
    perks: z
      .array(
        z
          .string()
          .trim()
          .min(2)
          .max(80)
          .regex(/^[^\r\n<>{}]*$/),
      )
      .max(8),
  })
  .strict();

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Data helpers (inside the caller's transaction) ─────────────────────────────────────────────────────────
async function actingMember(tx: Tx, memberId?: string): Promise<string> {
  const { rows } = await tx.query<{ id: string | null }>(
    "SELECT app.portal_acting_member($1) AS id",
    [memberId ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new HttpError(404, "not_found");
  return id;
}

interface MemberRow {
  id: string;
  full_name: string;
  member_no: string | null;
  location_name: string | null;
  tz: string;
  today: string;
}
async function memberRow(tx: Tx, member: string): Promise<MemberRow> {
  const { rows } = await tx.query<MemberRow>(
    `SELECT m.id, m.full_name, m.member_no, l.name AS location_name,
            coalesce(l.timezone, 'America/Puerto_Rico') AS tz,
            to_char((now() AT TIME ZONE coalesce(l.timezone, 'America/Puerto_Rico'))::date, 'YYYY-MM-DD') AS today
       FROM app.member m LEFT JOIN app.location l ON l.id = m.home_location_id
      WHERE m.id = $1`,
    [member],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

/** Per local day since `from`: allowed check-in, attended classes and their minutes. */
async function dayStats(tx: Tx, member: string, tz: string, from: string): Promise<DayStat[]> {
  const { rows } = await tx.query<DayStat>(
    `WITH ci AS (
       SELECT DISTINCT (c.at AT TIME ZONE $2)::date AS d FROM app.check_in c
        WHERE c.member_id = $1 AND c.result = 'allowed' AND c.at >= ($3::date::timestamp AT TIME ZONE $2)),
     cl AS (
       SELECT (s.starts_at AT TIME ZONE $2)::date AS d, count(*)::int AS n,
              sum(round(extract(epoch FROM s.ends_at - s.starts_at) / 60))::int AS mins
         FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
        WHERE b.member_id = $1 AND b.status = 'attended' AND s.starts_at >= ($3::date::timestamp AT TIME ZONE $2)
        GROUP BY 1)
     SELECT to_char(coalesce(ci.d, cl.d), 'YYYY-MM-DD') AS d, ci.d IS NOT NULL AS checkin,
            coalesce(cl.n, 0) AS classes, coalesce(cl.mins, 0) AS minutes
       FROM ci FULL JOIN cl ON cl.d = ci.d`,
    [member, tz, from],
  );
  return rows;
}

async function checkinDays(tx: Tx, member: string, tz: string, from: string): Promise<Set<string>> {
  const { rows } = await tx.query<{ d: string }>(
    `SELECT DISTINCT to_char((c.at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d FROM app.check_in c
      WHERE c.member_id = $1 AND c.result = 'allowed' AND c.at >= ($3::date::timestamp AT TIME ZONE $2)`,
    [member, tz, from],
  );
  return new Set(rows.map((r) => r.d));
}

async function weeklyGoal(tx: Tx, member: string): Promise<number> {
  const { rows } = await tx.query<{ g: number }>(
    "SELECT weekly_trainings AS g FROM app.member_goal WHERE member_id = $1",
    [member],
  );
  return rows[0]?.g ?? DEFAULT_WEEKLY_GOAL;
}

type MembershipStatus = "active" | "frozen" | "past_due" | "expired" | "none";
interface Membership {
  kind: "subscription" | "credits" | "none";
  name: string | null;
  status: MembershipStatus;
  renews_on: string | null;
  credits_left: number | null;
  expires_on: string | null;
}
/**
 * Live subscription first (monthly clubs); otherwise the session credits (packs: class packs before personal
 * training, earliest expiry first) or an unexpired pass (pay-per-session clubs); otherwise the last one, expired.
 */
async function membership(tx: Tx, member: string, tz: string): Promise<Membership> {
  const sub = await tx.query<{
    status: "active" | "frozen" | "past_due" | "cancelled";
    cancel_at_period_end: boolean;
    period_end: string;
    name: string;
  }>(
    `SELECT s.status, s.cancel_at_period_end, to_char(s.current_period_end, 'YYYY-MM-DD') AS period_end, p.name
       FROM app.subscription s JOIN app.plan_product p ON p.id = s.product_id
      WHERE s.member_id = $1
      ORDER BY (s.status <> 'cancelled') DESC, s.created_at DESC LIMIT 1`,
    [member],
  );
  const s = sub.rows[0];
  if (s && s.status !== "cancelled")
    return {
      kind: "subscription",
      name: s.name,
      status: s.status,
      renews_on: s.cancel_at_period_end ? null : s.period_end,
      credits_left: null,
      expires_on: s.cancel_at_period_end ? s.period_end : null,
    };

  const credit = await tx.query<{
    name: string;
    left: number;
    expires_on: string | null;
    live: boolean;
  }>(
    `SELECT p.name, cb.credits_remaining AS left,
            to_char((cb.expires_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS expires_on,
            (cb.credits_remaining > 0 AND (cb.expires_at IS NULL OR cb.expires_at > now())) AS live
       FROM app.credit_balance cb JOIN app.plan_product p ON p.id = cb.product_id
      WHERE cb.member_id = $1
      ORDER BY 4 DESC, (p.kind = 'class_pack') DESC, cb.expires_at ASC NULLS LAST, cb.created_at DESC LIMIT 1`,
    [member, tz],
  );
  const pass = await tx.query<{ name: string; expires_on: string; live: boolean }>(
    `SELECT p.name, to_char((ap.valid_to AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS expires_on, ap.valid_to > now() AS live
       FROM app.access_pass ap JOIN app.plan_product p ON p.id = ap.product_id
      WHERE ap.member_id = $1 ORDER BY ap.valid_to DESC LIMIT 1`,
    [member, tz],
  );
  const c = credit.rows[0];
  const p = pass.rows[0];
  if (c?.live)
    return {
      kind: "credits",
      name: c.name,
      status: "active",
      renews_on: null,
      credits_left: c.left,
      expires_on: c.expires_on,
    };
  if (p?.live)
    return {
      kind: "credits",
      name: p.name,
      status: "active",
      renews_on: null,
      credits_left: null,
      expires_on: p.expires_on,
    };
  if (c || p) {
    const useCredit = c && (!p || (c.expires_on ?? "") >= p.expires_on);
    return useCredit && c
      ? {
          kind: "credits",
          name: c.name,
          status: "expired",
          renews_on: null,
          credits_left: c.left,
          expires_on: c.expires_on,
        }
      : {
          kind: "credits",
          name: p?.name ?? null,
          status: "expired",
          renews_on: null,
          credits_left: null,
          expires_on: p?.expires_on ?? null,
        };
  }
  if (s)
    return {
      kind: "subscription",
      name: s.name,
      status: "expired",
      renews_on: null,
      credits_left: null,
      expires_on: s.period_end,
    };
  return {
    kind: "none",
    name: null,
    status: "none",
    renews_on: null,
    credits_left: null,
    expires_on: null,
  };
}

interface Program {
  id: string;
  kind: "circuit" | "training_plan";
  name: string;
  week: number | null;
  weeks: number | null;
  pct: number;
  href: string;
}
/** Circuit runs in progress (sets logged / sets planned) and published training plans (week since publication). */
async function programs(tx: Tx, member: string, tz: string, today: string): Promise<Program[]> {
  const circuits = await tx.query<{ id: string; name: string; done: number; total: number }>(
    `SELECT c.id, c.name,
            (SELECT count(*)::int FROM app.set_log sl WHERE sl.circuit_run_id = r.id) AS done,
            (SELECT coalesce(sum(cs.sets), 0)::int FROM app.circuit_step cs WHERE cs.circuit_id = c.id) AS total
       FROM app.circuit_run r JOIN app.circuit c ON c.id = r.circuit_id
      WHERE r.member_id = $1 AND r.finished_at IS NULL
      ORDER BY r.started_at DESC`,
    [member],
  );
  const plans = await tx.query<{ id: string; title: string; body: unknown; published_on: string }>(
    `SELECT p.id, p.title, p.body, to_char((p.published_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS published_on
       FROM app.care_plan p
      WHERE p.member_id = $1 AND p.kind = 'training' AND p.status = 'published'
      ORDER BY p.published_at DESC`,
    [member, tz],
  );
  return [
    ...circuits.rows.map(
      (c): Program => ({
        id: c.id,
        kind: "circuit",
        name: c.name,
        week: null,
        weeks: null,
        pct: c.total > 0 ? Math.min(100, Math.round((c.done / c.total) * 100)) : 0,
        href: "/me/circuits",
      }),
    ),
    ...plans.rows.map(
      (p): Program => ({
        id: p.id,
        kind: "training_plan",
        name: p.title,
        ...planProgress(p.published_on, today, planWeeks(p.body)),
        href: "/me/health/plan",
      }),
    ),
  ];
}

/**
 * The challenge to feature: running today (member's local date), org-wide or at the member's home location;
 * those with perks first, then the most recent start.
 */
async function featuredChallenge(tx: Tx, member: string, today: string) {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    joined: boolean;
    ends_on: string;
    perks: string[];
  }>(
    `SELECT c.id, c.name, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
            EXISTS (SELECT 1 FROM app.challenge_participant cp WHERE cp.challenge_id = c.id AND cp.member_id = $1) AS joined,
            coalesce(array(SELECT k.label FROM app.challenge_perk k WHERE k.challenge_id = c.id ORDER BY k.position),
                     '{}'::text[]) AS perks
       FROM app.challenge c JOIN app.member m ON m.id = $1
      WHERE $2::date BETWEEN c.starts_on AND c.ends_on
        AND (c.location_id IS NULL OR c.location_id = m.home_location_id)
      ORDER BY EXISTS (SELECT 1 FROM app.challenge_perk k WHERE k.challenge_id = c.id) DESC,
               c.starts_on DESC, c.id
      LIMIT 1`,
    [member, today],
  );
  const c = rows[0];
  return c
    ? { id: c.id, name: c.name, joined: c.joined, ends_on: c.ends_on, perks: c.perks }
    : null;
}

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function routes(app: FastifyInstance): Promise<void> {
  const role = (req: FastifyRequest) => req.claims.app_role;

  // A · Member home (the contract the home screen is built against; keys are fixed).
  app.get("/me/home", async (req) => {
    const q = ActingQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, q.member_id);
      const m = await memberRow(tx, member);
      const weekStart = isoWeekStart(m.today);
      const next = await tx.query<{
        booking_id: string;
        class_name: string;
        room: string | null;
        starts_at: Date;
      }>(
        `SELECT b.id AS booking_id, ct.name AS class_name, s.room, s.starts_at
           FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
           JOIN app.class_type ct ON ct.id = s.class_type_id
          WHERE b.member_id = $1 AND b.status = 'booked' AND NOT s.cancelled AND s.starts_at > now()
          ORDER BY s.starts_at, b.id LIMIT 1`,
        [member],
      );
      const booked = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
          WHERE b.member_id = $1 AND b.status IN ('booked', 'attended', 'no_show') AND NOT s.cancelled
            AND s.starts_at >= ($2::date::timestamp AT TIME ZONE $3)
            AND s.starts_at < (($2::date + 7)::timestamp AT TIME ZONE $3)`,
        [member, weekStart, m.tz],
      );
      const days = await checkinDays(tx, member, m.tz, addDays(m.today, -STREAK_LOOKBACK_DAYS));
      const stats = await dayStats(tx, member, m.tz, weekStart);
      const goal = await weeklyGoal(tx, member);
      const totals = weekTotals(stats, weekStart);
      const docs = await tx.query<{ n: number }>(
        `SELECT ((SELECT count(*) FROM app.member_agreement a WHERE a.member_id = $1)
               + (SELECT count(*) FROM app.invoice i WHERE i.member_id = $1 AND i.status <> 'void'))::int AS n`,
        [member],
      );
      const nextRow = next.rows[0];
      return {
        member: {
          id: m.id,
          first_name: firstName(m.full_name),
          member_no: m.member_no,
          location_name: m.location_name,
        },
        membership: await membership(tx, member, m.tz),
        next_class: nextRow
          ? {
              booking_id: nextRow.booking_id,
              class_name: nextRow.class_name,
              room: nextRow.room,
              starts_at: nextRow.starts_at.toISOString(),
            }
          : null,
        streak: computeStreak(days, m.today),
        week: {
          goal,
          trainings: totals.trainings,
          classes_booked: booked.rows[0]?.n ?? 0,
          classes_attended: totals.classes_attended,
          active_minutes: totals.active_minutes,
          pct: goalPct(totals.trainings, goal),
        },
        programs: await programs(tx, member, m.tz, m.today),
        challenge: await featuredChallenge(tx, member, m.today),
        coach: { enabled: role(req) === "member" && resolveProvider().enabled },
        documents: docs.rows[0]?.n ?? 0,
      };
    });
  });

  // B · Progress: the last 12 local ISO weeks (oldest first) and the 20 most recent events.
  app.get("/me/progress", async (req) => {
    const q = ActingQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, q.member_id);
      const m = await memberRow(tx, member);
      const current = isoWeekStart(m.today);
      const first = addDays(current, -7 * (PROGRESS_WEEKS - 1));
      const stats = await dayStats(tx, member, m.tz, first);
      const weeks = Array.from({ length: PROGRESS_WEEKS }, (_, i) => {
        const week_start = addDays(first, 7 * i);
        return { week_start, ...weekTotals(stats, week_start) };
      });
      const recent = await tx.query<{ at: Date; kind: string; label: string }>(
        `SELECT at, kind, label FROM (
           (SELECT c.at, 'check_in' AS kind, l.name AS label
              FROM app.check_in c JOIN app.location l ON l.id = c.location_id
             WHERE c.member_id = $1 AND c.result = 'allowed' ORDER BY c.at DESC LIMIT $2)
           UNION ALL
           (SELECT s.starts_at, 'class', ct.name
              FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
              JOIN app.class_type ct ON ct.id = s.class_type_id
             WHERE b.member_id = $1 AND b.status = 'attended' ORDER BY s.starts_at DESC LIMIT $2)
           UNION ALL
           (SELECT r.started_at, 'circuit', ci.name
              FROM app.circuit_run r JOIN app.circuit ci ON ci.id = r.circuit_id
             WHERE r.member_id = $1 ORDER BY r.started_at DESC LIMIT $2)
         ) e ORDER BY at DESC, kind LIMIT $2`,
        [member, RECENT_EVENTS],
      );
      return {
        member_id: member,
        goal: await weeklyGoal(tx, member),
        weeks,
        recent: recent.rows.map((r) => ({ at: r.at.toISOString(), kind: r.kind, label: r.label })),
      };
    });
  });

  // Weekly goal: the member only (guardians read it, never set it). Rule and audit live in app.set_member_goal().
  app.put("/me/goal", async (req) => {
    const b = GoalBody.parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ g: number }>("SELECT app.set_member_goal($1) AS g", [
        b.weekly_trainings,
      ]);
      return { weekly_trainings: rows[0]?.g ?? b.weekly_trainings };
    });
  });

  // C · Documents: signed agreements, current consent status per channel/purpose, invoices (read-only).
  app.get("/me/documents", async (req) => {
    const q = ActingQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, q.member_id);
      const m = await memberRow(tx, member);
      const agreements = await tx.query(
        `SELECT a.id, a.kind, a.version, a.locale, a.source, a.accepted_at, t.title
           FROM app.member_agreement a
           LEFT JOIN app.agreement_text t ON t.kind = a.kind::text AND t.version = a.version AND t.locale = a.locale
          WHERE a.member_id = $1 ORDER BY a.accepted_at DESC, a.kind`,
        [member],
      );
      const consents = await tx.query(
        `SELECT c.id, c.brand_id, b.name AS brand_name, c.channel, c.purpose, c.status,
                CASE WHEN c.status = 'granted' THEN c.granted_at ELSE c.revoked_at END AS since
           FROM app.consent c JOIN app.brand b ON b.id = c.brand_id
          WHERE c.member_id = $1 ORDER BY b.name, c.channel, c.purpose`,
        [member],
      );
      // Explicit columns: the platform fee columns are not granted to request traffic.
      const invoices = await tx.query(
        `SELECT i.id, i.number::int AS number,
                to_char((i.issued_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS issued_on,
                i.total_cents, i.status, '/me/membership' AS href
           FROM app.invoice i WHERE i.member_id = $1 ORDER BY i.issued_at DESC, i.number DESC LIMIT 100`,
        [member, m.tz],
      );
      return {
        member_id: member,
        agreements: agreements.rows,
        consents: consents.rows,
        invoices: invoices.rows,
      };
    });
  });

  // Nutrition: the member's PUBLISHED nutrition care plan (approved by the licensed professional, whose name and
  // licence are the approval snapshot) and the next nutrition appointment. Never generated advice.
  app.get("/me/nutrition", async (req) => {
    const q = ActingQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, q.member_id);
      const plan = await tx.query(
        `SELECT p.id, p.title, p.body, p.approver_name, p.approver_license_no, p.approved_at, p.published_at
           FROM app.care_plan p
          WHERE p.member_id = $1 AND p.kind = 'nutrition' AND p.status = 'published'
            AND p.approver_name IS NOT NULL AND p.approver_license_no IS NOT NULL
          ORDER BY p.published_at DESC LIMIT 1`,
        [member],
      );
      const appt = await tx.query(
        `SELECT a.id, a.starts_at, l.name AS location_name
           FROM app.appointment a JOIN app.location l ON l.id = a.location_id
          WHERE a.member_id = $1 AND a.kind = 'nutrition' AND a.status = 'scheduled' AND a.starts_at > now()
          ORDER BY a.starts_at LIMIT 1`,
        [member],
      );
      return { member_id: member, plan: plan.rows[0] ?? null, appointment: appt.rows[0] ?? null };
    });
  });

  // Challenge perks (staff): read under the challenge's visibility; replace as owner / location manager.
  app.get("/portal/challenges/:id/perks", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id, position, label FROM app.challenge_perk WHERE challenge_id = $1 ORDER BY position",
        [id],
      );
      return { data: rows };
    });
  });

  app.put("/portal/challenges/:id/perks", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = PerksBody.parse(req.body);
    return app.asCaller(req, async (tx) => {
      const seen = await tx.query("SELECT 1 FROM app.challenge WHERE id = $1", [id]);
      if (!seen.rowCount) throw new HttpError(404, "not_found");
      const before = await tx.query("SELECT 1 FROM app.challenge_perk WHERE challenge_id = $1", [
        id,
      ]);
      const del = await tx.query("DELETE FROM app.challenge_perk WHERE challenge_id = $1", [id]);
      // RLS hides nothing here that the caller could see, so a short delete means the caller may not edit perks.
      if ((del.rowCount ?? 0) < (before.rowCount ?? 0)) throw new HttpError(403, "forbidden");
      for (const [i, label] of b.perks.entries()) {
        await tx.query(
          "INSERT INTO app.challenge_perk (challenge_id, position, label) VALUES ($1, $2, $3)",
          [id, i + 1, label],
        );
      }
      const { rows } = await tx.query(
        "SELECT id, position, label FROM app.challenge_perk WHERE challenge_id = $1 ORDER BY position",
        [id],
      );
      return { data: rows };
    });
  });
}
