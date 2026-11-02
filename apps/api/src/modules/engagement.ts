import {
  AWARDABLE_EVENTS,
  CHALLENGE_KINDS,
  CHALLENGE_METRICS,
  COMPARE_MODES,
  MANUAL_POINTS_MAX,
  POINTS_EVENTS,
  POST_MAX_LENGTH,
  POST_STATUSES,
} from "@gym/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

// Module engagement (spec §9). Every rule (who, which location, minors, balance, moderation) lives in the SQL
// definer functions and RLS policies of migration 0012; this layer validates shape and maps known refusals.

const IdParams = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Mirrors the database patterns (the database re-checks).
const safeName = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.,()%+-]+$/);
const ref = z
  .string()
  .max(80)
  .regex(/^[A-Za-z0-9_.:-]+$/);

const RuleBody = z
  .object({
    event: z.enum(POINTS_EVENTS),
    points: z.number().int().min(1).max(10_000),
    active: z.boolean().optional(),
  })
  .strict();
const RulePatch = z
  .object({
    points: z.number().int().min(1).max(10_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const RewardBody = z
  .object({
    name: safeName,
    description: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .regex(/^[^{}<>]+$/)
      .optional(),
    points_cost: z.number().int().min(1).max(1_000_000),
    restricted_for_minors: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const RewardPatch = RewardBody.partial().strict();
const AwardBody = z.object({ event: z.enum(AWARDABLE_EVENTS), ref: ref.optional() }).strict();
const ManualBody = z
  .object({
    delta: z
      .number()
      .int()
      .min(-MANUAL_POINTS_MAX)
      .max(MANUAL_POINTS_MAX)
      .refine((n) => n !== 0),
    note: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[^{}<>\r\n]+$/),
  })
  .strict();
const RedeemBody = z.object({ member_id: uuid, reward_id: uuid }).strict();
const RedemptionPatch = z.object({ status: z.enum(["fulfilled", "cancelled"]) }).strict();
const ChallengeBody = z
  .object({
    name: safeName,
    kind: z.enum(CHALLENGE_KINDS),
    metric: z.enum(CHALLENGE_METRICS),
    location_id: uuid.nullable().optional(),
    starts_on: day,
    ends_on: day,
    goal: z.number().int().min(1).max(100_000),
    leaderboard_opt_in_default: z.boolean().optional(),
  })
  .strict();
const TeamBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.-]+$/),
  })
  .strict();
const JoinBody = z
  .object({
    member_id: uuid,
    team_id: uuid.nullable().optional(),
    show_on_leaderboard: z.boolean().optional(),
  })
  .strict();
const PrefsBody = z
  .object({
    member_id: uuid,
    show_on_leaderboard: z.boolean(),
    compare_mode: z.enum(COMPARE_MODES),
  })
  .strict();
const ReferralBody = z.object({ member_id: uuid, email: z.string().trim().max(254) }).strict();
const PostBody = z.object({ member_id: uuid, body: z.string().max(POST_MAX_LENGTH * 2) }).strict();
const ModerateBody = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
const MemberQuery = z.object({ member_id: uuid.optional() }).strict();
const LedgerQuery = z
  .object({
    member_id: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
const PostsQuery = z.object({ status: z.enum(POST_STATUSES).optional() }).strict();
const RedemptionsQuery = z
  .object({
    member_id: uuid.optional(),
    status: z.enum(["requested", "fulfilled", "cancelled"]).optional(),
  })
  .strict();

/**
 * Domain refusals raised by the definer functions, by exception message. Only these are named to the client (as
 * `reason`); anything else falls through to the generic mapping in errors.ts.
 */
const REASONS: Record<string, { status: number; error: string }> = {
  insufficient_points: { status: 409, error: "conflict" },
  already_awarded: { status: 409, error: "conflict" },
  already_credited: { status: 409, error: "conflict" },
  referral_not_joined: { status: 409, error: "conflict" },
  referral_limit: { status: 409, error: "conflict" },
  post_limit: { status: 409, error: "conflict" },
  no_active_rule: { status: 409, error: "conflict" },
  reward_unavailable: { status: 409, error: "conflict" },
  challenge_closed: { status: 409, error: "conflict" },
  invalid_transition: { status: 409, error: "conflict" },
  not_participant: { status: 409, error: "conflict" },
  restricted_for_minors: { status: 403, error: "forbidden" },
  minor_cannot_post: { status: 403, error: "forbidden" },
  minor_not_listed: { status: 403, error: "forbidden" },
  minor_not_allowed: { status: 403, error: "forbidden" },
  forbidden_content: { status: 400, error: "invalid_input" },
  invalid_email: { status: 400, error: "invalid_input" },
  invalid_team: { status: 400, error: "invalid_input" },
};

async function domain<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? "";
    const known = Object.hasOwn(REASONS, msg) ? REASONS[msg] : undefined;
    if (known) return reply.code(known.status).send({ error: known.error, reason: msg });
    throw err;
  }
}

const CHALLENGE_COLS = `id, name, kind, metric, location_id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(ends_on, 'YYYY-MM-DD') AS ends_on, goal, leaderboard_opt_in_default`;

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Rules
  app.get("/engagement/rules", async (req) =>
    app.asCaller(req, async (tx) => ({
      data: (await tx.query("SELECT id, event, points, active FROM app.points_rule ORDER BY event"))
        .rows,
    })),
  );
  app.post("/engagement/rules", async (req, reply) => {
    const b = RuleBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.points_rule (event, points, active) VALUES ($1, $2, $3) RETURNING id",
        [b.event, b.points, b.active ?? true],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });
  app.patch("/engagement/rules/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = RulePatch.parse(req.body);
    const n = await app.asCaller(req, async (tx) => {
      const r = await tx.query(
        "UPDATE app.points_rule SET points = coalesce($2, points), active = coalesce($3, active) WHERE id = $1",
        [id, b.points ?? null, b.active ?? null],
      );
      return r.rowCount;
    });
    if (!n) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  // ── Rewards
  app.get("/engagement/rewards", async (req) =>
    app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          "SELECT id, name, description, points_cost, restricted_for_minors, active FROM app.reward ORDER BY points_cost, name",
        )
      ).rows,
    })),
  );
  app.post("/engagement/rewards", async (req, reply) => {
    const b = RewardBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.reward (name, description, points_cost, restricted_for_minors, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          b.name,
          b.description ?? null,
          b.points_cost,
          b.restricted_for_minors ?? false,
          b.active ?? true,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });
  app.patch("/engagement/rewards/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = RewardPatch.parse(req.body);
    const n = await app.asCaller(req, async (tx) => {
      const r = await tx.query(
        `UPDATE app.reward SET name = coalesce($2, name), description = coalesce($3, description),
                points_cost = coalesce($4, points_cost), restricted_for_minors = coalesce($5, restricted_for_minors),
                active = coalesce($6, active)
          WHERE id = $1`,
        [
          id,
          b.name ?? null,
          b.description ?? null,
          b.points_cost ?? null,
          b.restricted_for_minors ?? null,
          b.active ?? null,
        ],
      );
      return r.rowCount;
    });
    if (!n) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  // ── Points of one member (member, guardian, front-of-house staff of the location)
  app.get("/engagement/members/:id/points", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const head = await tx.query<{ balance: number; weekly_streak: number }>(
        "SELECT app.points_balance($1)::int AS balance, app.weekly_streak($1) AS weekly_streak",
        [id],
      );
      const history = await tx.query(
        "SELECT id, delta, reason, ref, note, at FROM app.points_ledger WHERE member_id = $1 ORDER BY at DESC, id LIMIT 100",
        [id],
      );
      const achievements = await tx.query(
        "SELECT code, ref, earned_at FROM app.achievement WHERE member_id = $1 ORDER BY earned_at DESC",
        [id],
      );
      return {
        member_id: id,
        ...head.rows[0],
        history: history.rows,
        achievements: achievements.rows,
      };
    });
  });
  app.post("/engagement/members/:id/award", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = AwardBody.parse(req.body);
    return domain(reply, async () => {
      const points = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ points: number }>(
          "SELECT app.award_points($1, $2::app.eng_event, $3) AS points",
          [id, b.event, b.ref ?? null],
        );
        return rows[0]?.points;
      });
      return { points };
    });
  });
  app.post("/engagement/members/:id/manual", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ManualBody.parse(req.body);
    return domain(reply, async () => {
      const row = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.award_manual_points($1, $2, $3) AS id",
          [id, b.delta, b.note],
        );
        return rows[0]?.id;
      });
      return reply.code(201).send({ id: row });
    });
  });
  app.get("/engagement/ledger", async (req) => {
    const q = LedgerQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          `SELECT l.id, l.member_id, m.full_name AS member_name, l.delta, l.reason, l.ref, l.note, l.at
             FROM app.points_ledger l LEFT JOIN app.member m ON m.id = l.member_id
            WHERE ($1::uuid IS NULL OR l.member_id = $1)
            ORDER BY l.at DESC, l.id LIMIT $2`,
          [q.member_id ?? null, q.limit],
        )
      ).rows,
    }));
  });
  app.get("/engagement/liability", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT outstanding_points::int AS outstanding_points, members_with_balance FROM app.points_liability()",
      );
      return rows[0];
    }),
  );

  // ── Redemptions
  app.post("/engagement/redemptions", async (req, reply) => {
    const b = RedeemBody.parse(req.body);
    return domain(reply, async () => {
      const id = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT app.redeem_reward($1, $2) AS id", [
          b.member_id,
          b.reward_id,
        ]);
        return rows[0]?.id;
      });
      return reply.code(201).send({ id });
    });
  });
  app.get("/engagement/redemptions", async (req) => {
    const q = RedemptionsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          `SELECT d.id, d.member_id, m.full_name AS member_name, d.reward_id, r.name AS reward_name, d.points, d.status,
                  d.created_at, d.handled_at
             FROM app.redemption d
             LEFT JOIN app.member m ON m.id = d.member_id
             LEFT JOIN app.reward r ON r.id = d.reward_id
            WHERE ($1::uuid IS NULL OR d.member_id = $1) AND ($2::app.eng_redemption_status IS NULL OR d.status = $2)
            ORDER BY d.created_at DESC LIMIT 200`,
          [q.member_id ?? null, q.status ?? null],
        )
      ).rows,
    }));
  });
  app.patch("/engagement/redemptions/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = RedemptionPatch.parse(req.body);
    return domain(reply, async () => {
      await app.asCaller(req, (tx) =>
        tx.query("SELECT app.set_redemption_status($1, $2)", [id, b.status]),
      );
      return { id, status: b.status };
    });
  });

  // ── Challenges
  app.get("/engagement/challenges", async (req) =>
    app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(`SELECT ${CHALLENGE_COLS} FROM app.challenge ORDER BY ends_on DESC, name`)
      ).rows,
    })),
  );
  app.post("/engagement/challenges", async (req, reply) => {
    const b = ChallengeBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.challenge (name, kind, metric, location_id, starts_on, ends_on, goal, leaderboard_opt_in_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          b.name,
          b.kind,
          b.metric,
          b.location_id ?? null,
          b.starts_on,
          b.ends_on,
          b.goal,
          b.leaderboard_opt_in_default ?? false,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });
  app.get("/engagement/challenges/:id/teams", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          "SELECT id, name FROM app.challenge_team WHERE challenge_id = $1 ORDER BY name",
          [id],
        )
      ).rows,
    }));
  });
  app.post("/engagement/challenges/:id/teams", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = TeamBody.parse(req.body);
    const teamId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.challenge_team (challenge_id, name) VALUES ($1, $2) RETURNING id",
        [id, b.name],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id: teamId });
  });
  app.get("/engagement/challenges/:id/participants", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          `SELECT p.id, p.member_id, m.full_name AS member_name, p.team_id, p.show_on_leaderboard, p.compare_mode,
                  p.progress, p.goal_reached_at
             FROM app.challenge_participant p LEFT JOIN app.member m ON m.id = p.member_id
            WHERE p.challenge_id = $1 ORDER BY p.progress DESC, m.full_name`,
          [id],
        )
      ).rows,
    }));
  });
  app.post("/engagement/challenges/:id/join", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = JoinBody.parse(req.body);
    return domain(reply, async () => {
      const pid = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.join_challenge($1, $2, $3, $4) AS id",
          [id, b.member_id, b.team_id ?? null, b.show_on_leaderboard ?? null],
        );
        return rows[0]?.id;
      });
      return reply.code(201).send({ id: pid });
    });
  });
  app.put("/engagement/challenges/:id/preferences", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PrefsBody.parse(req.body);
    return domain(reply, async () => {
      await app.asCaller(req, (tx) =>
        tx.query("SELECT app.set_challenge_preferences($1, $2, $3, $4)", [
          id,
          b.member_id,
          b.show_on_leaderboard,
          b.compare_mode,
        ]),
      );
      return {
        challenge_id: id,
        member_id: b.member_id,
        show_on_leaderboard: b.show_on_leaderboard,
        compare_mode: b.compare_mode,
      };
    });
  });
  app.get("/engagement/challenges/:id/leaderboard", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          "SELECT division, rank, label, progress, goal, is_me FROM app.leaderboard($1)",
          [id],
        )
      ).rows,
    }));
  });

  // ── Referrals (no message is ever sent from here)
  app.get("/engagement/referrals", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          `SELECT f.id, f.referrer_member_id, m.full_name AS referrer_name, f.referred_email, f.status, f.credit_points,
                  f.created_at
             FROM app.referral f LEFT JOIN app.member m ON m.id = f.referrer_member_id
            WHERE ($1::uuid IS NULL OR f.referrer_member_id = $1)
            ORDER BY f.created_at DESC LIMIT 200`,
          [q.member_id ?? null],
        )
      ).rows,
    }));
  });
  app.post("/engagement/referrals", async (req, reply) => {
    const b = ReferralBody.parse(req.body);
    return domain(reply, async () => {
      const id = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.create_referral($1, $2) AS id",
          [b.member_id, b.email],
        );
        return rows[0]?.id;
      });
      return reply.code(201).send({ id });
    });
  });
  app.post("/engagement/referrals/:id/credit", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return domain(reply, async () => {
      const status = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ status: string }>(
          "SELECT app.credit_referral($1) AS status",
          [id],
        );
        return rows[0]?.status;
      });
      return { id, status };
    });
  });

  // ── Community wall
  app.get("/engagement/posts", async (req) => {
    const q = PostsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          `SELECT id, author_member_id, author_label, body, status, location_id, created_at, moderated_at
             FROM app.community_post WHERE ($1::app.eng_post_status IS NULL OR status = $1)
            ORDER BY created_at DESC LIMIT 200`,
          [q.status ?? null],
        )
      ).rows,
    }));
  });
  app.post("/engagement/posts", async (req, reply) => {
    const b = PostBody.parse(req.body);
    return domain(reply, async () => {
      const id = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT app.create_post($1, $2) AS id", [
          b.member_id,
          b.body,
        ]);
        return rows[0]?.id;
      });
      return reply.code(201).send({ id, status: "pending" });
    });
  });
  app.post("/engagement/posts/:id/moderate", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ModerateBody.parse(req.body);
    return domain(reply, async () => {
      const status = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ status: string }>(
          "SELECT app.moderate_post($1, $2) AS status",
          [id, b.decision],
        );
        return rows[0]?.status;
      });
      return { id, status };
    });
  });
}
