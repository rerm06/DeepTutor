import type { Tx } from "@gym/db";
/*
 * Adapted from ZeroCoach (https://github.com/ntsd/zerocoach) src/services/agent/agentHarness.ts and
 * src/services/llm/openAICompatibleEngine.ts (provider idea only), Apache-2.0.
 * Changes: server-side only; every database access runs under the caller's JWT (app.asCaller → RLS); write tools
 * become coach_action PROPOSALS executed only after the member confirms, through the owning module's SQL function;
 * providers are adapters behind one interface, `disabled` by default, keys read from env at runtime; no on-device
 * or Gemini/cloud-vision code; deterministic guardian before and after every model turn (packages/shared).
 */
import {
  ACTION_TOOLS,
  type ActionTool,
  BODY_AREAS,
  COACH_COPY,
  COACH_TOOL_BY_NAME,
  type CoachProvider,
  MEMORY_CATEGORIES,
  type MemoryFact,
  NUTRITION_GOALS,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResponse,
  type ToolCall,
  ageOn,
  coachTextSafe,
  computeEnergyDraft,
  computeReadiness,
  energyDraftPlan,
  guardianPre,
  inferMemoryTopic,
  normalizeMemoryCategory,
  nutritionDraftRefusal,
  readinessBand,
  reconcileMemory,
  runCoachTurn,
} from "@gym/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * HTTP routes for module coach (spec §6.3, §6.7, §7.1–7.2). Registered under /v1 by modules/index.ts.
 * Visibility and every write rule live in SQL (migration 0016 + health 0010); this layer validates shape,
 * runs the pure TypeScript logic (memory reconciliation, readiness vs own baseline, energy-range draft, guardian,
 * agent harness) and calls the definer functions as the caller.
 */

// ── Providers ──────────────────────────────────────────────────────────────────────────────────────────────────
export const DISABLED_PROVIDER: CoachProvider = {
  id: "disabled",
  enabled: false,
  async complete() {
    throw new Error("provider_disabled");
  },
};

const PROVIDER_TIMEOUT_MS = 20_000;

/** OpenAI-compatible chat completions (also local gateways). Never called in tests. */
export class OpenAICompatibleProvider implements CoachProvider {
  readonly id = "openai";
  readonly enabled = true;
  constructor(
    private readonly cfg: { apiKey: string; model: string; baseUrl: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: unknown[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      if (m.role === "tool")
        messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      else if (m.role === "assistant" && m.toolCalls?.length)
        messages.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
          })),
        });
      else messages.push({ role: m.role, content: m.content });
    }
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        tools: req.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const msg = j.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((c) => {
      let args: unknown = {};
      try {
        args = JSON.parse(c.function?.arguments ?? "{}");
      } catch {
        args = { __invalid: true };
      }
      return { id: c.id, name: c.function?.name ?? "", arguments: args };
    });
    return { text: msg?.content ?? "", toolCalls };
  }
}

/** Anthropic Messages API adapter. Never called in tests. */
export class AnthropicProvider implements CoachProvider {
  readonly id = "anthropic";
  readonly enabled = true;
  constructor(
    private readonly cfg: { apiKey: string; model: string; baseUrl: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const messages: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
    const push = (role: "user" | "assistant", block: unknown) => {
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content.push(block);
      else messages.push({ role, content: [block] });
    };
    for (const m of req.messages as ProviderMessage[]) {
      if (m.role === "tool")
        push("user", { type: "tool_result", tool_use_id: m.toolCallId, content: m.content });
      else if (m.role === "assistant") {
        if (m.content) push("assistant", { type: "text", text: m.content });
        for (const c of m.toolCalls ?? [])
          push("assistant", { type: "tool_use", id: c.id, name: c.name, input: c.arguments ?? {} });
      } else push("user", { type: "text", text: m.content });
    }
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        system: req.system,
        max_tokens: 600,
        messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const j = (await res.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    };
    const blocks = j.content ?? [];
    return {
      text: blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n"),
      toolCalls: blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id ?? "", name: b.name ?? "", arguments: b.input ?? {} })),
    };
  }
}

/**
 * Pick the provider from the environment at request time: COACH_AI_PROVIDER = disabled (default) | openai |
 * anthropic, COACH_AI_API_KEY, COACH_AI_MODEL, optional COACH_AI_BASE_URL. Missing key or model → disabled.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): CoachProvider {
  const kind = (env.COACH_AI_PROVIDER ?? "disabled").trim().toLowerCase();
  const apiKey = env.COACH_AI_API_KEY?.trim();
  const model = env.COACH_AI_MODEL?.trim();
  if (!apiKey || !model) return DISABLED_PROVIDER;
  if (kind === "openai")
    return new OpenAICompatibleProvider({
      apiKey,
      model,
      baseUrl: env.COACH_AI_BASE_URL || "https://api.openai.com/v1",
    });
  if (kind === "anthropic")
    return new AnthropicProvider({
      apiKey,
      model,
      baseUrl: env.COACH_AI_BASE_URL || "https://api.anthropic.com",
    });
  return DISABLED_PROVIDER;
}

let providerOverride: CoachProvider | null = null;
/** Tests only: install a scripted fake provider (null restores env resolution). */
export function setCoachProviderForTests(p: CoachProvider | null): void {
  providerOverride = p;
}
const currentProvider = () => providerOverride ?? resolveProvider();

// ── Schemas ────────────────────────────────────────────────────────────────────────────────────────────────────
const IdParams = z.object({ id: z.string().uuid() });
const MemberQuery = z.object({ member_id: z.string().uuid().optional() }).strict();
const SafeFact = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .refine((s) => coachTextSafe(s, 280), "unsafe_text");
const MemoryCreate = z
  .object({
    member_id: z.string().uuid().optional(),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    content: SafeFact,
  })
  .strict();
const MemoryPatch = z
  .object({ content: SafeFact, category: z.enum(MEMORY_CATEGORIES).optional() })
  .strict();
const CheckinFields = {
  sleep: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  pain: z.number().int().min(0).max(10),
  pain_area: z.enum(BODY_AREAS).optional(),
  pain_acute: z.boolean().optional(),
  note: z
    .string()
    .max(280)
    .refine((s) => s.trim() === "" || coachTextSafe(s, 280), "unsafe_text")
    .optional(),
};
const CheckinBody = z
  .object({ member_id: z.string().uuid().optional(), ...CheckinFields })
  .strict()
  .refine((b) => (b.pain === 0) === (b.pain_area === undefined), {
    message: "pain_area",
    path: ["pain_area"],
  });
const ChatBody = z
  .object({
    message: z.string().trim().min(1).max(1000),
    history: z
      .array(
        z.object({ role: z.enum(["member", "coach"]), content: z.string().max(1000) }).strict(),
      )
      .max(8)
      .default([]),
    lang: z.enum(["es", "en"]).default("es"),
  })
  .strict();
const DraftBody = z
  .object({
    member_id: z.string().uuid(),
    goal: z.enum(NUTRITION_GOALS),
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`))),
    sex: z.enum(["female", "male"]),
  })
  .strict();
const EmptyBody = z.object({}).strict().optional();

/** Reasons raised on purpose by the SQL layer; only these are echoed (never SQL details). */
const REASONS_403 = new Set([
  "forbidden",
  "invalid_transition",
  "action_expired",
  "triage_required",
  "triage_red_blocks_nutrition",
  "minor_no_calorie_counting",
  "deficit_not_allowed",
]);
const REASONS_400 = new Set([
  "memory_full",
  "too_many_proposals",
  "invalid_source",
  "invalid_birth_date",
]);
function sendReason(err: unknown, reply: FastifyReply): FastifyReply | null {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42501" && e.message && REASONS_403.has(e.message))
    return reply.code(403).send({ error: "forbidden", reason: e.message });
  if (e?.code === "22023" && e.message && REASONS_400.has(e.message))
    return reply.code(400).send({ error: "invalid_input", reason: e.message });
  return null;
}
async function guarded<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    const sent = sendReason(err, reply);
    if (sent) return sent;
    throw err;
  }
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Data helpers (all run inside the caller's transaction) ──────────────────────────────────────────────────────
/** The member the caller acts for: their own row (member) or a ward (guardian, member_id required). */
async function actingMember(tx: Tx, role: string, memberId?: string): Promise<string> {
  if (role !== "member" && role !== "guardian") throw new HttpError(403, "forbidden");
  const { rows } = await tx.query<{ id: string }>(
    `SELECT m.id FROM app.member m
      WHERE ($1::uuid IS NULL OR m.id = $1) AND app.health_self_or_guardian(m.id)
      ORDER BY (m.person_id = app.person_id()) DESC, m.created_at LIMIT 1`,
    [memberId ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new HttpError(memberId ? 404 : 403, memberId ? "not_found" : "forbidden");
  return id;
}

async function liveFacts(tx: Tx, member: string): Promise<MemoryFact[]> {
  const { rows } = await tx.query<MemoryFact>(
    `SELECT id, category, topic, content FROM app.member_memory
      WHERE member_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [member],
  );
  return rows;
}

/** Reconcile a candidate fact and apply the decision through the definer function. */
async function rememberFact(
  tx: Tx,
  member: string,
  candidate: { category?: string; content: string },
  source: "member" | "coach",
) {
  await tx.query("SELECT app.coach_memory_lock($1)", [member]);
  const decision = reconcileMemory(await liveFacts(tx, member), candidate);
  if (decision.op === "NOOP")
    return { operation: "NOOP" as const, reason: decision.reason, id: decision.targetId ?? null };
  const { rows } = await tx.query<{ id: string }>(
    "SELECT app.coach_memory_write($1, $2, $3, $4, $5, $6, $7) AS id",
    [
      member,
      decision.op,
      decision.op === "ADD" ? null : decision.targetId,
      decision.category,
      decision.op === "DELETE" ? "deleted" : decision.topic,
      decision.op === "DELETE" ? "(borrado)" : decision.content,
      source,
    ],
  );
  return { operation: decision.op, id: rows[0]?.id ?? null, category: decision.category };
}

interface CheckinInput {
  sleep: number;
  energy: number;
  pain: number;
  pain_area?: string;
  pain_acute?: boolean;
  note?: string;
}
/** Today's check-in: score vs the member's own prior 28 days (computed here, stored only after 7 days in SQL). */
async function registerCheckin(tx: Tx, member: string, a: CheckinInput) {
  const hist = await tx.query<{ sleep: number; energy: number; pain: number }>(
    `SELECT c.sleep, c.energy, c.pain FROM app.daily_checkin c
       JOIN app.member m ON m.id = c.member_id JOIN app.location l ON l.id = m.home_location_id
      WHERE c.member_id = $1
        AND c.local_date >= (now() AT TIME ZONE l.timezone)::date - 28
        AND c.local_date < (now() AT TIME ZONE l.timezone)::date
      ORDER BY c.local_date DESC`,
    [member],
  );
  const r = computeReadiness({ sleep: a.sleep, energy: a.energy, pain: a.pain }, hist.rows);
  const { rows } = await tx.query<{
    id: string;
    local_date: string;
    baseline_days: number;
    score: number | null;
    escalated: boolean;
    emergency: boolean;
  }>(
    `SELECT id, to_char(local_date, 'YYYY-MM-DD') AS local_date, baseline_days, score, escalated, emergency
       FROM app.coach_register_checkin($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      member,
      a.sleep,
      a.energy,
      a.pain,
      a.pain_area ?? null,
      a.pain_acute ?? false,
      a.note?.trim() || null,
      r.score,
    ],
  );
  const row = rows[0] as NonNullable<(typeof rows)[0]>;
  return { ...row, band: readinessBand(row.score) };
}

const CHECKIN_COLS = `c.id, to_char(c.local_date, 'YYYY-MM-DD') AS local_date, c.sleep, c.energy, c.pain, c.pain_area,
  c.pain_acute, c.note, c.score, c.baseline_days, c.escalated, c.emergency, c.created_at`;

async function publishedTrainingPlan(tx: Tx, member: string) {
  const { rows } = await tx.query<{
    id: string;
    title: string;
    approver_name: string | null;
    body: unknown;
  }>(
    `SELECT p.id, p.title, p.approver_name, p.body FROM app.care_plan p
      WHERE p.member_id = $1 AND p.kind = 'training' AND p.status = 'published'
      ORDER BY p.published_at DESC LIMIT 1`,
    [member],
  );
  return rows[0] ?? null;
}

const sanitizeSummary = (s: string) =>
  s
    .replace(/[<>{}`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** Execute a CONFIRMED action through the owning module's SQL function (caller's JWT). */
async function executeAction(tx: Tx, a: { tool: ActionTool; args: unknown; member_id: string }) {
  const def = COACH_TOOL_BY_NAME.get(a.tool);
  if (!def) throw new HttpError(400, "invalid_input");
  const args = def.args.parse(a.args) as Record<string, unknown>;
  switch (a.tool) {
    case "log_set": {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.log_set($1, $2, NULL, NULL, $3, $4) AS id",
        [args.exercise_id, args.location_id, args.reps, args.weight_kg ?? 0],
      );
      return { set_log_id: rows[0]?.id };
    }
    case "book_class": {
      const { rows } = await tx.query<{ id: string }>("SELECT app.book_class($1, $2) AS id", [
        args.session_id,
        a.member_id,
      ]);
      return { booking_id: rows[0]?.id };
    }
    case "add_memory": {
      const r = await rememberFact(
        tx,
        a.member_id,
        args as { category?: string; content: string },
        "coach",
      );
      return { memory_id: r.id, operation: r.operation };
    }
    case "register_checkin": {
      const r = await registerCheckin(tx, a.member_id, args as unknown as CheckinInput);
      return { checkin_id: r.id, escalated: r.escalated, emergency: r.emergency };
    }
  }
}

const errorCode = (err: unknown) => {
  const m = (err as { message?: string })?.message ?? "";
  return /^[a-z_]{1,60}$/.test(m) ? m : "failed";
};

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function routes(app: FastifyInstance): Promise<void> {
  const role = (req: FastifyRequest) => req.claims.app_role;

  app.get("/coach/status", async () => {
    const p = currentProvider();
    return { provider: p.id, enabled: p.enabled };
  });

  // Memory ------------------------------------------------------------------------------------------------------
  app.get("/coach/memory", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, role(req), q.member_id);
      const { rows } = await tx.query(
        `SELECT id, category, topic, content, source, created_at, updated_at FROM app.member_memory
          WHERE member_id = $1 AND deleted_at IS NULL ORDER BY category, updated_at DESC`,
        [member],
      );
      return { member_id: member, data: rows };
    });
  });

  app.post("/coach/memory", async (req, reply) => {
    const b = MemoryCreate.parse(req.body);
    return guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        const member = await actingMember(tx, role(req), b.member_id);
        return rememberFact(tx, member, { category: b.category, content: b.content }, "member");
      }),
    );
  });

  app.patch("/coach/memory/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = MemoryPatch.parse(req.body);
    return guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        if (role(req) !== "member" && role(req) !== "guardian")
          throw new HttpError(403, "forbidden");
        const { rows } = await tx.query<{ member_id: string }>(
          "SELECT member_id FROM app.member_memory WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        const fact = rows[0];
        if (!fact) throw new HttpError(404, "not_found");
        const category = normalizeMemoryCategory(b.category, b.content);
        const r = await tx.query<{ id: string }>(
          "SELECT app.coach_memory_write($1, 'UPDATE', $2, $3, $4, $5, 'member') AS id",
          [fact.member_id, id, category, inferMemoryTopic(category, b.content), b.content.trim()],
        );
        return { operation: "UPDATE", id: r.rows[0]?.id, category };
      }),
    );
  });

  app.delete("/coach/memory/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        if (role(req) !== "member" && role(req) !== "guardian")
          throw new HttpError(403, "forbidden");
        const { rows } = await tx.query<{ member_id: string; category: string }>(
          "SELECT member_id, category FROM app.member_memory WHERE id = $1 AND deleted_at IS NULL",
          [id],
        );
        const fact = rows[0];
        if (!fact) throw new HttpError(404, "not_found");
        await tx.query(
          "SELECT app.coach_memory_write($1, 'DELETE', $2, $3, 'deleted', '(borrado)', 'member')",
          [fact.member_id, id, fact.category],
        );
        return { operation: "DELETE", id };
      }),
    );
  });

  // Daily check-in ----------------------------------------------------------------------------------------------
  app.get("/coach/checkins", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, role(req), q.member_id);
      const { rows } = await tx.query(
        `SELECT ${CHECKIN_COLS} FROM app.daily_checkin c WHERE c.member_id = $1 ORDER BY c.local_date DESC LIMIT 28`,
        [member],
      );
      return { member_id: member, data: rows };
    });
  });

  app.post("/coach/checkins", async (req, reply) => {
    const b = CheckinBody.parse(req.body);
    const out = await guarded(reply, () =>
      app.asCaller(req, async (tx) =>
        registerCheckin(tx, await actingMember(tx, role(req), b.member_id), b),
      ),
    );
    if (reply.sent) return reply;
    return reply.code(201).send(out);
  });

  /** "Hoy": today's check-in + one line from the APPROVED (published) training plan only. */
  app.get("/coach/today", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, role(req), q.member_id);
      const { rows } = await tx.query(
        `SELECT ${CHECKIN_COLS} FROM app.daily_checkin c
           JOIN app.member m ON m.id = c.member_id JOIN app.location l ON l.id = m.home_location_id
          WHERE c.member_id = $1 AND c.local_date = (now() AT TIME ZONE l.timezone)::date`,
        [member],
      );
      const checkin =
        (rows[0] as { score: number | null; escalated: boolean; emergency: boolean } | undefined) ??
        null;
      const prior = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.daily_checkin c
           JOIN app.member m ON m.id = c.member_id JOIN app.location l ON l.id = m.home_location_id
          WHERE c.member_id = $1 AND c.local_date >= (now() AT TIME ZONE l.timezone)::date - 28
            AND c.local_date < (now() AT TIME ZONE l.timezone)::date`,
        [member],
      );
      const plan = await publishedTrainingPlan(tx, member);
      const band = checkin ? readinessBand(checkin.score) : null;
      const suggestion = !checkin
        ? "checkin_first"
        : checkin.emergency
          ? "emergency"
          : checkin.escalated
            ? "talk_to_trainer"
            : !plan
              ? "no_plan"
              : band === "below"
                ? "lighter_option"
                : "follow_plan";
      return {
        member_id: member,
        checkin,
        band,
        baseline_days: prior.rows[0]?.n ?? 0,
        plan,
        suggestion,
      };
    });
  });

  // Agent actions -----------------------------------------------------------------------------------------------
  app.get("/coach/actions", async (req) => {
    const q = MemberQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const member = await actingMember(tx, role(req), q.member_id);
      const { rows } = await tx.query(
        `SELECT id, tool, summary, status, proposed_at, expires_at, decided_at, executed_at, error
           FROM app.coach_action WHERE member_id = $1 ORDER BY proposed_at DESC LIMIT 50`,
        [member],
      );
      return { member_id: member, data: rows };
    });
  });

  app.post("/coach/actions/:id/confirm", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    EmptyBody.parse(req.body);
    return guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ tool: ActionTool; args: unknown; member_id: string }>(
          "SELECT tool, args, member_id FROM app.coach_action_decide($1, true)",
          [id],
        );
        const a = rows[0] as { tool: ActionTool; args: unknown; member_id: string };
        let ok = true;
        let result: unknown = null;
        let error: string | null = null;
        await tx.query("SAVEPOINT coach_exec");
        try {
          result = await executeAction(tx, a);
          await tx.query("RELEASE SAVEPOINT coach_exec");
        } catch (err) {
          await tx.query("ROLLBACK TO SAVEPOINT coach_exec");
          ok = false;
          error = errorCode(err);
        }
        const fin = await tx.query<{ s: string }>(
          "SELECT app.coach_action_finish($1, $2, $3, $4) AS s",
          [id, ok, result === null ? null : JSON.stringify(result), error],
        );
        return { id, status: fin.rows[0]?.s, result, error };
      }),
    );
  });

  app.post("/coach/actions/:id/reject", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    EmptyBody.parse(req.body);
    return guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ status: string }>(
          "SELECT status FROM app.coach_action_decide($1, false)",
          [id],
        );
        return { id, status: rows[0]?.status };
      }),
    );
  });

  // Chat --------------------------------------------------------------------------------------------------------
  app.post("/coach/chat", async (req, reply) => {
    const b = ChatBody.parse(req.body);
    if (role(req) !== "member") return reply.code(403).send({ error: "forbidden" });
    const member = await app.asCaller(req, (tx) => actingMember(tx, "member"));
    const provider = currentProvider();
    const event = (
      kind: "turn" | "emergency" | "human",
      blocked = false,
      proposals = 0,
      blockedTools = 0,
    ) =>
      app.asCaller(req, (tx) =>
        tx.query("SELECT app.coach_chat_event($1, $2, $3, $4, $5)", [
          member,
          kind,
          blocked,
          proposals,
          blockedTools,
        ]),
      );

    // The guardian's pre-check runs even when no provider is configured: acute symptoms always reach the banner.
    const pre = guardianPre(b.message);
    if (pre !== "allow") {
      await event(pre);
      return {
        enabled: provider.enabled,
        reply: COACH_COPY[b.lang][pre],
        emergency: pre === "emergency",
        human_handoff: pre === "human",
        proposals: [],
        blocked_tools: [],
      };
    }
    if (!provider.enabled)
      return {
        enabled: false,
        notice: "provider_disabled",
        reply: null,
        emergency: false,
        human_handoff: false,
        proposals: [],
        blocked_tools: [],
      };

    const memberData = await app.asCaller(req, async (tx) => {
      const facts = await tx.query(
        "SELECT category, content FROM app.member_memory WHERE member_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 30",
        [member],
      );
      const checkins = await tx.query(
        `SELECT to_char(local_date, 'YYYY-MM-DD') AS date, sleep, energy, pain, pain_area, score
           FROM app.daily_checkin WHERE member_id = $1 ORDER BY local_date DESC LIMIT 7`,
        [member],
      );
      const plan = await publishedTrainingPlan(tx, member);
      const brand = await tx.query<{ name: string }>(
        `SELECT b.name FROM app.member m JOIN app.location l ON l.id = m.home_location_id
           JOIN app.brand b ON b.id = l.brand_id WHERE m.id = $1`,
        [member],
      );
      return {
        brand: brand.rows[0]?.name ?? "",
        data: {
          facts: facts.rows,
          recent_checkins: checkins.rows,
          approved_plan: plan ? { title: plan.title, body: plan.body } : null,
        },
      };
    });

    const turn = await runCoachTurn({
      provider,
      userText: b.message,
      history: b.history,
      memberData: memberData.data,
      lang: b.lang,
      brand: memberData.brand,
      deps: {
        readTool: (name, args) =>
          app.asCaller(req, (tx) => readTool(tx, member, name, args as Record<string, unknown>)),
        proposeWrite: (name, args) =>
          app.asCaller(req, (tx) =>
            proposeWrite(tx, member, name, args as Record<string, unknown>),
          ),
      },
    });
    await event(
      turn.verdict === "emergency" ? "emergency" : "turn",
      turn.verdict === "blocked",
      turn.proposals.length,
      turn.blockedTools.length,
    );
    return {
      enabled: true,
      reply: turn.reply,
      verdict: turn.verdict,
      emergency: turn.verdict === "emergency",
      human_handoff: false,
      proposals: turn.proposals,
      blocked_tools: turn.blockedTools,
    };
  });

  // Staff -------------------------------------------------------------------------------------------------------
  /** Member-record "Coach" tab: memory (read-only), 28-day check-in trend, escalations. Trainer / location manager. */
  app.get("/coach/members/:id/summary", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!["trainer", "location_manager"].includes(role(req)))
      return reply.code(403).send({ error: "forbidden" });
    return app.asCaller(req, async (tx) => {
      const memory = await tx.query(
        `SELECT id, category, topic, content, source, updated_at FROM app.member_memory
          WHERE member_id = $1 AND deleted_at IS NULL ORDER BY category, updated_at DESC`,
        [id],
      );
      const checkins = await tx.query(
        `SELECT ${CHECKIN_COLS} FROM app.daily_checkin c WHERE c.member_id = $1 ORDER BY c.local_date DESC LIMIT 28`,
        [id],
      );
      const escalations = await tx.query(
        `SELECT e.id, e.reason, e.status, e.created_at, e.status_changed_at, s.display_name AS assigned_to,
                e.crm_task_id IS NOT NULL AS has_task
           FROM app.coach_escalation e LEFT JOIN app.staff_member s ON s.id = e.assigned_staff_id
          WHERE e.member_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
        [id],
      );
      return {
        member_id: id,
        memory: memory.rows,
        checkins: checkins.rows,
        escalations: escalations.rows,
      };
    });
  });

  for (const [action, status] of [
    ["acknowledge", "acknowledged"],
    ["close", "closed"],
  ] as const) {
    app.post(`/coach/escalations/:id/${action}`, async (req, reply) => {
      const { id } = IdParams.parse(req.params);
      EmptyBody.parse(req.body);
      return guarded(reply, () =>
        app.asCaller(req, async (tx) => {
          const { rows } = await tx.query<{ s: string }>(
            "SELECT app.coach_escalation_set_status($1, $2) AS s",
            [id, status],
          );
          return { id, status: rows[0]?.s };
        }),
      );
    });
  }

  /** Energy-range DRAFT for a licensed specialist (role nutritionist): stored as a nutrition care_plan draft. */
  app.post("/coach/nutrition-drafts", async (req, reply) => {
    const b = DraftBody.parse(req.body);
    if (role(req) !== "nutritionist") return reply.code(403).send({ error: "forbidden" });
    const out = await guarded(reply, () =>
      app.asCaller(req, async (tx) => {
        const seen = await tx.query("SELECT 1 FROM app.member WHERE id = $1", [b.member_id]);
        if (seen.rowCount === 0) throw new HttpError(403, "forbidden");
        const t = await tx.query<{
          nutrition_level: "green" | "amber" | "red";
          no_calorie_counting: boolean;
          requires_medical_referral: boolean;
          declared_conditions: string[];
          height_cm: number | null;
          weight_kg: number | null;
        }>(
          `SELECT t.nutrition_level, t.no_calorie_counting, t.requires_medical_referral, a.declared_conditions,
                  a.height_cm::float8 AS height_cm, a.weight_kg::float8 AS weight_kg
             FROM app.triage_result t JOIN app.assessment a ON a.id = t.assessment_id
            WHERE t.member_id = $1 ORDER BY t.computed_at DESC, t.id DESC LIMIT 1`,
          [b.member_id],
        );
        const tri = t.rows[0] ?? null;
        const guardian = await tx.query("SELECT 1 FROM app.guardian_link WHERE member_id = $1", [
          b.member_id,
        ]);
        const ageYears = ageOn(b.birth_date, new Date());
        const refusal = nutritionDraftRefusal({
          triage: tri,
          hasGuardian: (guardian.rowCount ?? 0) > 0,
          ageYears,
          conditions: tri?.declared_conditions ?? [],
          goal: b.goal,
        });
        if (refusal) return { refusal };
        if (!tri || tri.height_cm == null || tri.weight_kg == null)
          return { invalid: "measurements_required" };
        const days = await tx.query<{ n: number }>("SELECT app.coach_activity_days($1, 28) AS n", [
          b.member_id,
        ]);
        const activeDays28 = days.rows[0]?.n ?? 0;
        const draft = computeEnergyDraft({
          sex: b.sex,
          birthDate: b.birth_date,
          on: new Date(),
          heightCm: tri.height_cm,
          weightKg: tri.weight_kg,
          activeDays28,
          goal: b.goal,
        });
        const plan = energyDraftPlan(draft, {
          goal: b.goal,
          heightCm: tri.height_cm,
          weightKg: tri.weight_kg,
          activeDays28,
          needsReferral: tri.nutrition_level === "amber" || tri.requires_medical_referral,
        });
        const ins = await tx.query<{ id: string }>(
          "SELECT app.coach_nutrition_draft($1, $2, $3, $4, $5, $6) AS id",
          [
            b.member_id,
            b.goal,
            b.birth_date,
            plan.title,
            JSON.stringify(plan.body),
            plan.rationale,
          ],
        );
        return { plan_id: ins.rows[0]?.id, status: "draft", active_days_28: activeDays28, draft };
      }),
    );
    if (reply.sent) return reply;
    const o = out as { refusal?: string; invalid?: string };
    if (o.refusal) return reply.code(403).send({ error: "forbidden", reason: o.refusal });
    if (o.invalid) return reply.code(400).send({ error: "invalid_input", reason: o.invalid });
    return reply.code(201).send(out);
  });
}

// ── Agent tool execution ─────────────────────────────────────────────────────────────────────────────────────
async function readTool(
  tx: Tx,
  member: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_my_memory":
      return (
        await tx.query(
          "SELECT category, content FROM app.member_memory WHERE member_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50",
          [member],
        )
      ).rows;
    case "get_my_checkins":
      return (
        await tx.query(
          `SELECT to_char(local_date, 'YYYY-MM-DD') AS date, sleep, energy, pain, pain_area, score
             FROM app.daily_checkin WHERE member_id = $1 ORDER BY local_date DESC LIMIT 7`,
          [member],
        )
      ).rows;
    case "get_my_plan": {
      const p = await publishedTrainingPlan(tx, member);
      return p ? { title: p.title, approved_by: p.approver_name, body: p.body } : null;
    }
    case "list_classes":
      return (
        await tx.query(
          `SELECT s.id AS session_id, ct.name, l.name AS location,
                  to_char(s.starts_at AT TIME ZONE l.timezone, 'YYYY-MM-DD HH24:MI') AS starts_local
             FROM app.class_session s JOIN app.class_type ct ON ct.id = s.class_type_id
             JOIN app.location l ON l.id = s.location_id
            WHERE NOT s.cancelled AND s.starts_at > now() AND s.starts_at < now() + make_interval(days => $1)
            ORDER BY s.starts_at LIMIT 20`,
          [Number(args.days ?? 7)],
        )
      ).rows;
    case "find_exercise": {
      const q = String(args.query).replace(/[\\%_]/g, (c) => `\\${c}`);
      return (
        await tx.query(
          "SELECT id AS exercise_id, name, movement_pattern FROM app.exercise WHERE name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 10",
          [q],
        )
      ).rows;
    }
    default:
      throw new Error("unknown_tool");
  }
}

/** Build the confirmation card from server data (never model text) and create the proposal. */
async function proposeWrite(
  tx: Tx,
  member: string,
  tool: ActionTool,
  args: Record<string, unknown>,
): Promise<{ id: string; summary: string } | { blocked: string }> {
  if (!(ACTION_TOOLS as readonly string[]).includes(tool)) return { blocked: "unknown_tool" };
  let summary: string;
  if (tool === "book_class") {
    const s = await tx.query<{ name: string; at: string }>(
      `SELECT ct.name, to_char(s.starts_at AT TIME ZONE l.timezone, 'DD/MM/YYYY HH24:MI') AS at
         FROM app.class_session s JOIN app.class_type ct ON ct.id = s.class_type_id
         JOIN app.location l ON l.id = s.location_id
        WHERE s.id = $1 AND NOT s.cancelled AND s.starts_at > now()`,
      [args.session_id],
    );
    const row = s.rows[0];
    if (!row) return { blocked: "not_found" };
    summary = `Reservar la clase ${row.name} del ${row.at}`;
  } else if (tool === "log_set") {
    const e = await tx.query<{ name: string }>(
      "SELECT e.name FROM app.exercise e, app.location l WHERE e.id = $1 AND l.id = $2",
      [args.exercise_id, args.location_id],
    );
    const row = e.rows[0];
    if (!row) return { blocked: "not_found" };
    summary = `Registrar serie de ${row.name}: ${args.reps} repeticiones, ${args.weight_kg ?? 0} kg`;
  } else if (tool === "add_memory") {
    summary = `Recordar: ${String(args.content)}`;
  } else {
    summary = `Registrar check-in de hoy: sueño ${args.sleep}/5, energía ${args.energy}/5, dolor ${args.pain}/10`;
  }
  const { rows } = await tx.query<{ id: string }>(
    "SELECT app.coach_action_propose($1, $2, $3, $4) AS id",
    [member, tool, JSON.stringify(args), sanitizeSummary(summary)],
  );
  return { id: rows[0]?.id as string, summary: sanitizeSummary(summary) };
}
