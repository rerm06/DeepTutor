import type { Db } from "@gym/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { IpLimiter } from "./signup.js";

/**
 * Gemini Live · short-lived credentials for the in-browser voice agent.
 * The Gemini API key NEVER reaches the browser: the server exchanges it for an ephemeral token
 * (POST {base}/{version}/auth_tokens, x-goog-api-key) locked to one model, valid for ONE session, which must start
 * within 60 s and ends after 15 min. The browser then opens
 *   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.{version}.GenerativeService
 *     .BidiGenerateContentConstrained?access_token={token}
 * Endpoints:
 *   POST /v1/live/token           any signed-in caller (staff or member)
 *   POST /v1/public/live/token    the public join page, body { org_id } of an org with an open join page;
 *                                 limited per client address (it spends the gym's Gemini quota).
 * Unset GEMINI_API_KEY → 503 live_unavailable; the web app then runs its local (browser speech) assistant.
 * Env: GEMINI_API_KEY, GEMINI_LIVE_MODEL (default below [VERIFICAR · current model id at ai.google.dev]),
 *      GEMINI_LIVE_API_VERSION (default v1beta, per the ephemeral-token docs; the JS SDK still says v1alpha).
 */
export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
const API_BASE = "https://generativelanguage.googleapis.com";
const WS_BASE = "wss://generativelanguage.googleapis.com";
export const SESSION_START_S = 60;
export const SESSION_MAX_S = 15 * 60;

export interface LiveConfig {
  apiKey: string;
  model: string;
  apiVersion: "v1alpha" | "v1beta";
}
export function resolveLive(env: NodeJS.ProcessEnv = process.env): LiveConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = (env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL).replace(/^models\//, "");
  if (!/^[a-z0-9][a-z0-9.\-]{2,80}$/.test(model)) return null;
  const apiVersion = env.GEMINI_LIVE_API_VERSION?.trim() === "v1alpha" ? "v1alpha" : "v1beta";
  return { apiKey, model, apiVersion };
}

export interface LiveToken {
  token: string;
  model: string;
  ws_url: string;
  expires_at: string;
}

type Fetch = typeof fetch;
let fetchOverride: Fetch | null = null;
let envOverride: NodeJS.ProcessEnv | null = null;
/** Tests only: a scripted fetch and environment (null restores the real ones). */
export function setLiveForTests(f: Fetch | null, env: NodeJS.ProcessEnv | null = null): void {
  fetchOverride = f;
  envOverride = env;
}

/** Exchange the API key for a one-session ephemeral token. Throws on any upstream failure. */
export async function mintToken(cfg: LiveConfig, now = Date.now()): Promise<LiveToken> {
  const f = fetchOverride ?? fetch;
  const expires = new Date(now + SESSION_MAX_S * 1000).toISOString();
  const res = await f(`${API_BASE}/${cfg.apiVersion}/auth_tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: expires,
      newSessionExpireTime: new Date(now + SESSION_START_S * 1000).toISOString(),
      // Lock the model only; the browser sends its own setup (tools, voice, instructions).
      bidiGenerateContentSetup: { model: `models/${cfg.model}` },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`live_upstream_${res.status}`);
  const body = (await res.json()) as { name?: unknown };
  const token = typeof body.name === "string" ? body.name : "";
  if (!/^auth_tokens\/[A-Za-z0-9._\-]+$/.test(token)) throw new Error("live_upstream_shape");
  return {
    token,
    model: cfg.model,
    ws_url: `${WS_BASE}/ws/google.ai.generativelanguage.${cfg.apiVersion}.GenerativeService.BidiGenerateContentConstrained`,
    expires_at: expires,
  };
}

function clientIp(req: FastifyRequest): string {
  const h = req.headers["x-nf-client-connection-ip"];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.length <= 64 ? v : req.ip;
}

async function issue(req: FastifyRequest, reply: import("fastify").FastifyReply) {
  const cfg = resolveLive(envOverride ?? process.env);
  if (!cfg) return reply.code(503).send({ error: "live_unavailable" });
  try {
    return await mintToken(cfg);
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "live token");
    return reply.code(502).send({ error: "live_upstream" });
  }
}

/** Signed-in callers (registered under /v1, behind the JWT hook). */
export async function routes(app: FastifyInstance): Promise<void> {
  const limiter = new IpLimiter(30, 10 * 60_000);
  app.post("/live/token", async (req, reply) => {
    if (!limiter.take(`${req.claims.org_id}:${req.claims.sub}`))
      return reply.code(429).send({ error: "rate_limited" });
    return issue(req, reply);
  });
}

const PublicBody = z.object({ org_id: z.string().uuid() }).strict();
export interface LivePublicOptions {
  db: Db;
  limiter?: IpLimiter;
}
/** The public join page (registered under /v1/public, no token). */
export async function publicRoutes(app: FastifyInstance, opts: LivePublicOptions): Promise<void> {
  const limiter = opts.limiter ?? new IpLimiter(6, 10 * 60_000);
  app.post("/live/token", async (req, reply) => {
    const p = PublicBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!limiter.take(clientIp(req))) return reply.code(429).send({ error: "rate_limited" });
    // Only organisations whose public join page is open (join_info is NULL otherwise).
    const { rows } = await opts.db.pool.query<{ r: unknown }>(
      "SELECT app_public.join_info($1) AS r",
      [p.data.org_id],
    );
    if (!rows[0]?.r) return reply.code(404).send({ error: "not_found" });
    return issue(req, reply);
  });
}
