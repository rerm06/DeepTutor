import { CARE_PLAN_KINDS, CARE_PLAN_STATUSES, HEALTH_CONDITIONS, PARQ_KEYS } from "@gym/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

/**
 * HTTP routes for module health (spec §6.1–6.2, §6.6–6.7). Registered under /v1 by modules/index.ts.
 * Every rule (visibility, roles, licence, triage, state machine, immutability, audit) lives in SQL (migration
 * 0010); this layer validates shape and returns rows visible under the caller's RLS. Draft workflow only: no AI,
 * no health claims, no diagnosis.
 */

const IdParams = z.object({ id: z.string().uuid() });
const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const nullableNum = (min: number, max: number) => z.number().min(min).max(max).nullable();

const Parq = z
  .object(
    Object.fromEntries(PARQ_KEYS.map((k) => [k, z.boolean()])) as Record<
      (typeof PARQ_KEYS)[number],
      z.ZodBoolean
    >,
  )
  .strict();
const FitnessTests = z
  .object({
    pushups: z.number().min(0).max(10000),
    plank_seconds: z.number().min(0).max(10000),
    sit_reach_cm: z.number().min(0).max(10000),
    chair_stand_30s: z.number().min(0).max(10000),
    step_test_hr: z.number().min(0).max(10000),
    walk_6min_m: z.number().min(0).max(10000),
  })
  .partial()
  .strict();
const notFuture = (s: string | undefined) => !s || Date.parse(s) <= Date.now() + 5 * 60_000;

const AssessmentFields = {
  taken_at: z.string().datetime({ offset: true }).refine(notFuture, "future").optional(),
  parq: Parq,
  parq_followup_resolved: z.boolean().default(false),
  declared_conditions: z.array(z.enum(HEALTH_CONDITIONS)).max(10).default([]),
  resting_hr: nullableInt(25, 250).optional(),
  bp_sys: nullableInt(60, 260).optional(),
  bp_dia: nullableInt(30, 160).optional(),
  height_cm: nullableNum(50, 250).optional(),
  weight_kg: nullableNum(20, 350).optional(),
  waist_cm: nullableNum(30, 250).optional(),
  fitness_tests: FitnessTests.default({}),
  acute_symptoms: z.boolean().default(false),
};
const AssessmentBody = z.object({ member_id: z.string().uuid(), ...AssessmentFields }).strict();
const AssessmentPatch = z
  .object({
    taken_at: AssessmentFields.taken_at,
    parq: Parq.optional(),
    parq_followup_resolved: z.boolean().optional(),
    declared_conditions: z.array(z.enum(HEALTH_CONDITIONS)).max(10).optional(),
    resting_hr: AssessmentFields.resting_hr,
    bp_sys: AssessmentFields.bp_sys,
    bp_dia: AssessmentFields.bp_dia,
    height_cm: AssessmentFields.height_cm,
    weight_kg: AssessmentFields.weight_kg,
    waist_cm: AssessmentFields.waist_cm,
    fitness_tests: FitnessTests.optional(),
    acute_symptoms: z.boolean().optional(),
  })
  .strict();
const PreviewBody = z
  .object({
    member_id: z.string().uuid().optional(),
    parq: Parq,
    parq_followup_resolved: z.boolean().default(false),
    declared_conditions: z.array(z.enum(HEALTH_CONDITIONS)).max(10).default([]),
    acute_symptoms: z.boolean().default(false),
  })
  .strict();

/** No markup, no placeholders, no control characters (the SQL CHECK re-validates and adds the term screen). */
const isSafe = (s: string) =>
  !/[<>{}]/.test(s) && ![...s].some((ch) => ch.charCodeAt(0) < 32 && ch !== "\n");
const SafeText = (max: number) => z.string().trim().min(1).max(max).refine(isSafe, "unsafe_text");
const PlanBodyJson = z
  .object({
    sections: z
      .array(z.object({ heading: SafeText(120), items: z.array(SafeText(500)).max(30) }).strict())
      .max(20),
  })
  .strict();
const PlanCreate = z
  .object({
    member_id: z.string().uuid(),
    kind: z.enum(CARE_PLAN_KINDS),
    title: SafeText(120),
    body: PlanBodyJson,
    rationale: z.string().max(2000).refine(isSafe, "unsafe_text").optional(),
  })
  .strict();
const PlanPatch = z
  .object({
    title: SafeText(120).optional(),
    body: PlanBodyJson.optional(),
    rationale: z.string().max(2000).refine(isSafe, "unsafe_text").nullable().optional(),
  })
  .strict();
const ApproveBody = z.object({ referral_acknowledged: z.boolean().default(false) }).strict();
const EmptyBody = z.object({}).strict();

const ListQuery = z
  .object({
    member_id: z.string().uuid().optional(),
    kind: z.enum(CARE_PLAN_KINDS).optional(),
    status: z.enum(CARE_PLAN_STATUSES).optional(),
  })
  .strict();

/** Reasons the SQL layer raises on purpose; only these are echoed to clients (never SQL details). */
const REASONS = new Set([
  "forbidden",
  "license_not_verified",
  "triage_red_blocks_nutrition",
  "triage_red_blocks_training",
  "triage_required",
  "referral_ack_required",
  "invalid_transition",
  "plan_immutable",
  "assessment_signed_immutable",
  "open_version_exists",
  "approver_role",
]);
function sendReason(err: unknown, reply: FastifyReply): FastifyReply | null {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42501" && e.message && REASONS.has(e.message))
    return reply.code(403).send({ error: "forbidden", reason: e.message });
  if (e?.code === "23505" && e.message === "open_version_exists")
    return reply.code(409).send({ error: "conflict", reason: e.message });
  return null;
}

const ASSESSMENT_COLS = `a.id, a.member_id, m.full_name AS member_name, a.evaluator_staff_id,
  ev.display_name AS evaluator_name, a.taken_at, a.parq, a.parq_followup_resolved, a.declared_conditions,
  a.resting_hr, a.bp_sys, a.bp_dia, a.height_cm::float8 AS height_cm, a.weight_kg::float8 AS weight_kg,
  a.waist_cm::float8 AS waist_cm, a.fitness_tests, a.acute_symptoms, a.status, a.signed_by,
  sg.display_name AS signed_by_name, a.signed_at, a.created_at, a.updated_at,
  CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', t.id, 'rule_version', t.rule_version, 'exercise_level', t.exercise_level,
    'nutrition_level', t.nutrition_level, 'requires_medical_referral', t.requires_medical_referral,
    'emergency', t.emergency, 'no_calorie_counting', t.no_calorie_counting, 'reasons', t.reasons,
    'computed_at', t.computed_at) END AS triage`;
const ASSESSMENT_FROM = `FROM app.assessment a
  JOIN app.member m ON m.id = a.member_id
  LEFT JOIN app.staff_member ev ON ev.id = a.evaluator_staff_id
  LEFT JOIN app.staff_member sg ON sg.id = a.signed_by
  LEFT JOIN app.triage_result t ON t.assessment_id = a.id`;

const PLAN_COLS = `p.id, p.member_id, m.full_name AS member_name, p.series_id, p.kind, p.version, p.status, p.title,
  p.body, p.rationale, p.created_by, cb.display_name AS created_by_name, p.created_at, p.submitted_at,
  p.approved_by, p.approved_at, p.approver_name, p.approver_license_no, p.referral_acknowledged,
  p.published_at, p.archived_at, p.updated_at`;
const PLAN_FROM = `FROM app.care_plan p
  JOIN app.member m ON m.id = p.member_id
  LEFT JOIN app.staff_member cb ON cb.id = p.created_by`;

const ASSESSMENT_WRITABLE = [
  "taken_at",
  "parq",
  "parq_followup_resolved",
  "declared_conditions",
  "resting_hr",
  "bp_sys",
  "bp_dia",
  "height_cm",
  "weight_kg",
  "waist_cm",
  "fitness_tests",
  "acute_symptoms",
] as const;
const JSON_COLS = new Set(["parq", "fitness_tests", "body"]);
const toParam = (k: string, v: unknown) => (JSON_COLS.has(k) && v !== null ? JSON.stringify(v) : v);

export async function routes(app: FastifyInstance): Promise<void> {
  /** Who am I for health purposes: role, staff row, licence state (drives which buttons the UI offers). */
  app.get("/health/whoami", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id AS staff_id, s.role, s.display_name, s.license_no,
                (s.license_verified_at IS NOT NULL AND s.license_no IS NOT NULL) AS license_verified
           FROM app.staff_member s WHERE s.id = app.health_staff_id()`,
      );
      return { role: req.claims.app_role, staff: rows[0] ?? null };
    }),
  );

  /** Pure triage preview (same SQL function as signing). The minor flag comes from guardian links the caller can see. */
  app.post("/health/triage-preview", async (req) => {
    const b = PreviewBody.parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT * FROM app.health_triage($1, $2, $3, $4,
           $5::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = $5::uuid))`,
        [
          JSON.stringify(b.parq),
          b.parq_followup_resolved,
          b.declared_conditions,
          b.acute_symptoms,
          b.member_id ?? null,
        ],
      );
      return { rule_version: "v0-propuesta", ...rows[0] };
    });
  });

  app.get("/health/assessments", async (req) => {
    const q = ListQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${ASSESSMENT_COLS} ${ASSESSMENT_FROM}
          WHERE ($1::uuid IS NULL OR a.member_id = $1)
          ORDER BY coalesce(a.signed_at, a.created_at) DESC LIMIT 200`,
        [q.member_id ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/health/assessments/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${ASSESSMENT_COLS} ${ASSESSMENT_FROM} WHERE a.id = $1`,
        [id],
      );
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.post("/health/assessments", async (req, reply) => {
    const b = AssessmentBody.parse(req.body);
    const cols = ["member_id", ...ASSESSMENT_WRITABLE.filter((k) => b[k] !== undefined)];
    const vals = cols.map((k) => toParam(k, (b as Record<string, unknown>)[k]));
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.assessment (${cols.join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        vals,
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/health/assessments/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = AssessmentPatch.parse(req.body);
    const cols = ASSESSMENT_WRITABLE.filter((k) => b[k] !== undefined);
    if (cols.length === 0) return reply.code(400).send({ error: "invalid_input" });
    const updated = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE app.assessment SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}
          WHERE id = $1 RETURNING id`,
        [id, ...cols.map((k) => toParam(k, (b as Record<string, unknown>)[k]))],
      );
      return rows[0];
    });
    // RLS: a signed, foreign or invisible assessment is indistinguishable from a missing one.
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  app.post("/health/assessments/:id/sign", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    EmptyBody.parse(req.body ?? {});
    try {
      const triage = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT app.sign_assessment($1) AS id", [
          id,
        ]);
        const t = await tx.query(
          `SELECT id, rule_version, exercise_level, nutrition_level, requires_medical_referral, emergency,
                  no_calorie_counting, reasons, computed_at FROM app.triage_result WHERE id = $1`,
          [rows[0]?.id],
        );
        return t.rows[0];
      });
      return { id, status: "signed", triage };
    } catch (err) {
      const sent = sendReason(err, reply);
      if (sent) return sent;
      throw err;
    }
  });

  app.get("/health/plans", async (req) => {
    const q = ListQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${PLAN_COLS} ${PLAN_FROM}
          WHERE ($1::uuid IS NULL OR p.member_id = $1)
            AND ($2::app.care_plan_kind IS NULL OR p.kind = $2)
            AND ($3::app.care_plan_status IS NULL OR p.status = $3)
          ORDER BY p.member_id, p.kind, p.series_id, p.version DESC LIMIT 300`,
        [q.member_id ?? null, q.kind ?? null, q.status ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/health/plans/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(`SELECT ${PLAN_COLS} ${PLAN_FROM} WHERE p.id = $1`, [id]);
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.post("/health/plans", async (req, reply) => {
    const b = PlanCreate.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.care_plan (member_id, kind, title, body, rationale)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [b.member_id, b.kind, b.title, JSON.stringify(b.body), b.rationale ?? null],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id, status: "draft" });
  });

  app.patch("/health/plans/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PlanPatch.parse(req.body);
    const cols = (["title", "body", "rationale"] as const).filter((k) => b[k] !== undefined);
    if (cols.length === 0) return reply.code(400).send({ error: "invalid_input" });
    const updated = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE app.care_plan SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}
          WHERE id = $1 RETURNING id`,
        [id, ...cols.map((k) => toParam(k, b[k]))],
      );
      return rows[0];
    });
    // Only drafts are editable (RLS); anything else looks missing.
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  const transition = (path: string, fn: string, withAck = false) =>
    app.post(`/health/plans/:id/${path}`, async (req, reply) => {
      const { id } = IdParams.parse(req.params);
      const ack = withAck ? ApproveBody.parse(req.body ?? {}).referral_acknowledged : null;
      if (!withAck) EmptyBody.parse(req.body ?? {});
      try {
        const status = await app.asCaller(req, async (tx) => {
          const { rows } = await tx.query<{ s: string }>(
            withAck ? `SELECT app.${fn}($1, $2) AS s` : `SELECT app.${fn}($1) AS s`,
            withAck ? [id, ack] : [id],
          );
          return rows[0]?.s;
        });
        return { id, status };
      } catch (err) {
        const sent = sendReason(err, reply);
        if (sent) return sent;
        throw err;
      }
    });
  transition("submit", "submit_care_plan");
  transition("return", "return_care_plan");
  transition("approve", "approve_care_plan", true);
  transition("publish", "publish_care_plan");
  transition("archive", "archive_care_plan");

  app.post("/health/plans/:id/new-version", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    EmptyBody.parse(req.body ?? {});
    try {
      const newId = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.new_care_plan_version($1) AS id",
          [id],
        );
        return rows[0]?.id;
      });
      return reply.code(201).send({ id: newId, status: "draft" });
    } catch (err) {
      const sent = sendReason(err, reply);
      if (sent) return sent;
      throw err;
    }
  });
}
