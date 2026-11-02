import type { Db } from "@gym/db";
import { DEMO_IDS } from "@gym/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";

/**
 * Module signup ("Únete") · spec E7 (registration and sign-in), §11. Two route groups:
 *   - `publicRoutes` (registered under /v1/public, no token): GET /join/:orgId and POST /join. They call the
 *     SECURITY DEFINER functions in schema app_public as the API login role, before any claims exist. The functions
 *     validate everything; this layer re-checks shape and the demo PII guard, limits attempts per IP, and issues a
 *     demo session ONLY for a brand-new person.
 *   - `routes` (registered under /v1, token required): the per-location switch and a member's agreements, as the
 *     caller (app.asCaller → RLS).
 */

// [VERIFICAR · lift only with a real identity provider, e-mail verification and a privacy notice] Demo PII guard,
// mirrored in SQL (app.join_email_ok / app.join_phone_ok).
export const DEMO_EMAIL = /^[a-z0-9][a-z0-9._+-]{0,63}@demo\.invalid$/;
export const DEMO_PHONE = /^\+1-(787|939)-555-01[0-9]{2}$/;
/** Same lifetime as the demo session route (routes/demo.ts). */
export const SESSION_TTL_SECONDS = 900;
/** The answer for every outcome without a session: never says whether the e-mail already had an account. */
export const GENERIC_MESSAGE = {
  es: "Recibimos tu solicitud. Si ya tienes cuenta, entra desde tu sede.",
  en: "We received your request. If you already have an account, sign in at your location.",
} as const;

const OrgParams = z.object({ orgId: z.string().uuid() }).strict();
export const JoinBody = z
  .object({
    org_id: z.string().uuid(),
    location_id: z.string().uuid(),
    full_name: z.string().trim().min(2).max(120),
    email: z
      .string()
      .trim()
      .max(254)
      .transform((s) => s.toLowerCase())
      .pipe(z.string().regex(DEMO_EMAIL)),
    phone: z
      .union([z.string().trim().max(20).regex(DEMO_PHONE), z.literal(""), z.null()])
      .optional()
      .transform((p) => (p ? p : null)),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    terms_version: z.string().max(20),
    waiver_version: z.string().max(20),
    accept_terms: z.boolean(),
    accept_waiver: z.boolean(),
    sms_reminders: z.boolean().default(false),
    sms_marketing: z.boolean().default(false),
    locale: z.enum(["es", "en"]),
  })
  .strict();

const FIELD_ERROR: Record<string, string> = {
  email: "invalid_email",
  phone: "invalid_phone",
  full_name: "invalid_name",
  birth_date: "invalid_birth_date",
  location_id: "invalid_location",
};
/** SQL refusals (message of SQLSTATE 22023) that the public form explains to the visitor. */
const SQL_REFUSALS = new Set([
  "invalid_location",
  "invalid_name",
  "invalid_email",
  "invalid_phone",
  "invalid_birth_date",
  "age_requires_guardian",
  "agreements_required",
  "agreement_outdated",
  "phone_required_for_sms",
  "invalid_locale",
]);

/** Small fixed-window limiter per client address (in memory, per instance). The SQL cap per org is the hard limit. */
export class IpLimiter {
  private readonly hits = new Map<string, { n: number; reset: number }>();
  constructor(
    readonly max = 10,
    readonly windowMs = 15 * 60_000,
    private readonly maxKeys = 10_000,
  ) {}
  /** Count one attempt; true when the caller is still within the limit. */
  take(key: string, now = Date.now()): boolean {
    let e = this.hits.get(key);
    if (!e || e.reset <= now) {
      if (this.hits.size >= this.maxKeys) this.prune(now);
      e = { n: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.n += 1;
    return e.n <= this.max;
  }
  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    // Still full (a flood of distinct addresses): drop the oldest entries rather than grow without bound.
    for (const k of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}

/**
 * Client address for the limiter. Behind Netlify the edge sets x-nf-client-connection-ip [VERIFICAR · that the edge
 * overwrites a client-supplied value]; elsewhere the socket address.
 */
function clientIp(req: FastifyRequest): string {
  const h = req.headers["x-nf-client-connection-ip"];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.length <= 64 ? v : req.ip;
}

export interface PublicOptions {
  db: Db;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  /** DEMO MODE: issue a session to a brand-new member. Off → 202 without a session, always. */
  demo: boolean;
  limiter?: IpLimiter;
}

interface Created {
  outcome: "created";
  person_id: string;
  member_id: string;
  org_id: string;
  location_id: string;
  location_name: string;
  brand_name: string;
  full_name: string;
}

export async function publicRoutes(app: FastifyInstance, opts: PublicOptions): Promise<void> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const limiter = opts.limiter ?? new IpLimiter();

  app.get("/join/:orgId", async (req, reply) => {
    const p = OrgParams.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: "not_found" });
    // No claims: the API login role calls the definer function directly (it cannot read any table itself).
    const { rows } = await opts.db.pool.query<{ r: unknown }>(
      "SELECT app_public.join_info($1) AS r",
      [p.data.orgId],
    );
    const info = rows[0]?.r;
    if (!info) return reply.code(404).send({ error: "not_found" });
    return info;
  });

  app.post("/join", async (req, reply) => {
    if (!limiter.take(clientIp(req))) return reply.code(429).send({ error: "rate_limited" });
    const parsed = JoinBody.safeParse(req.body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "");
      return reply.code(400).send({ error: FIELD_ERROR[field] ?? "invalid_input" });
    }
    const b = parsed.data;
    let result: Created | { outcome: "existing" };
    try {
      const { rows } = await opts.db.pool.query<{ r: Created | { outcome: "existing" } }>(
        "SELECT app_public.join_submit($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13) AS r",
        [
          b.org_id,
          b.location_id,
          b.full_name,
          b.email,
          b.phone,
          b.birth_date,
          b.terms_version,
          b.waiver_version,
          b.accept_terms,
          b.accept_waiver,
          b.sms_reminders,
          b.sms_marketing,
          b.locale,
        ],
      );
      result = rows[0]?.r as Created | { outcome: "existing" };
    } catch (err) {
      // Never log the body: it carries a birth date and contact data.
      const e = err as { code?: string; message?: string };
      if (e.code === "P0002") return reply.code(404).send({ error: "not_found" });
      if (e.code === "54000") return reply.code(429).send({ error: "rate_limited" });
      if (e.code === "22023" && e.message && SQL_REFUSALS.has(e.message))
        return reply.code(400).send({ error: e.message });
      if (e.code === "22008" || e.code === "22007")
        return reply.code(400).send({ error: "invalid_birth_date" }); // e.g. 2000-02-30
      if (e.code === "22023") return reply.code(400).send({ error: "invalid_input" });
      req.log.error({ code: e.code }, "join_submit failed");
      return reply.code(500).send({ error: "internal" });
    }

    if (result.outcome !== "created" || !opts.demo) {
      return reply.code(202).send({ session: null, message: GENERIC_MESSAGE[b.locale] });
    }
    // Same signing as the demo session route: issuer, audience, TTL; role member, no staff locations.
    const token = await new SignJWT({
      org_id: result.org_id,
      app_role: "member",
      location_ids: [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(result.person_id)
      .setIssuer(opts.jwtIssuer)
      .setAudience(opts.jwtAudience)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(key);
    return reply.code(202).send({
      session: {
        token,
        expires_in: SESSION_TTL_SECONDS,
        persona: {
          id: `join-${result.member_id.slice(0, 8)}`,
          org: result.org_id === DEMO_IDS.orgB ? "B" : "A",
          org_name: result.brand_name,
          org_logo_url: null,
          role: "member",
          display_name: result.full_name,
          home: result.location_name,
        },
      },
      message: null,
    });
  });
}

const IdParams = z.object({ id: z.string().uuid() }).strict();
const SwitchBody = z.object({ enabled: z.boolean() }).strict();

/** Signed-in routes (under /v1): the online sign-up switch per location and a member's agreements. */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get("/signup/locations", async (req) =>
    app.asCaller(req, async (tx) => {
      // join_location RLS: staff of the location; the definer function decides who may switch.
      const { rows } = await tx.query(
        `SELECT l.id, l.name, l.municipality, coalesce(j.enabled, false) AS enabled, j.updated_at
           FROM app.location l LEFT JOIN app.join_location j ON j.location_id = l.id
          WHERE (SELECT app.is_staff())
          ORDER BY l.name, l.id`,
      );
      return { data: rows };
    }),
  );

  app.put("/signup/locations/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const { enabled } = SwitchBody.parse(req.body);
    await app.asCaller(req, (tx) =>
      tx.query("SELECT app.set_join_location($1, $2)", [id, enabled]),
    );
    return { id, enabled };
  });

  app.get("/members/:id/agreements", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, kind, version, locale, source, accepted_at
           FROM app.member_agreement WHERE member_id = $1 ORDER BY accepted_at DESC, kind`,
        [id],
      );
      return { data: rows };
    });
  });
}
