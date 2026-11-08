import type { Db } from "@gym/db";
import { DEMO_IDS } from "@gym/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";
import { IpLimiter, SESSION_TTL_SECONDS } from "./signup.js";

/**
 * Staff sign-in with e-mail + password and long-lived sessions (0026). Rules (hashing, lockout, password policy,
 * refresh rotation and reuse detection) live in the database; these routes only shape the session.
 *   POST /v1/public/auth/password          { email, password } → session | { must_change: true }
 *   POST /v1/public/auth/password/change   { email, password, new_password } → session
 *   POST /v1/public/session/refresh        { refresh } → session (the old refresh token stops working)
 *   GET|POST /v1/staff/accounts            the owner's team list and new staff accounts (new e-mails only)
 * Every session carries a 15-minute access token (API limit) and a 12-hour rotating refresh token.
 */
interface Claims {
  person_id: string;
  org_id: string;
  role: string;
  location_ids: string[];
  display_name: string;
  home: string | null;
  org_name: string | null;
}
interface DbAnswer {
  ok: boolean;
  must_change?: boolean;
  locked?: boolean;
  weak?: boolean;
  claims?: Claims;
  refresh?: string;
}

export interface AuthPublicOptions {
  db: Db;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  limiter?: IpLimiter;
}

function clientIp(req: FastifyRequest): string {
  const h = req.headers["x-nf-client-connection-ip"];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.length <= 64 ? v : req.ip;
}

/** Build the session the web app stores (same shape as the demo session, plus the refresh token). */
export async function buildSession(
  key: Uint8Array,
  iss: string,
  aud: string,
  c: Claims,
  refresh: string,
  prefix = "pw",
) {
  const token = await new SignJWT({
    org_id: c.org_id,
    app_role: c.role,
    location_ids: c.location_ids,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.person_id)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
  return {
    token,
    refresh,
    expires_in: SESSION_TTL_SECONDS,
    persona: {
      id: `${prefix}-${c.person_id.slice(0, 8)}`,
      org: c.org_id === DEMO_IDS.orgB ? "B" : "A",
      org_name: c.org_name ?? "",
      org_logo_url: null,
      role: c.role,
      display_name: c.display_name,
      home: c.home,
    },
  };
}

const Email = z.string().trim().min(3).max(254);
const Password = z.string().min(1).max(128);

export async function publicRoutes(app: FastifyInstance, opts: AuthPublicOptions): Promise<void> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const limiter = opts.limiter ?? new IpLimiter(20, 15 * 60_000);
  const session = (c: Claims, r: string) =>
    buildSession(key, opts.jwtIssuer, opts.jwtAudience, c, r);
  const answer = async (a: DbAnswer | undefined, reply: import("fastify").FastifyReply) => {
    if (!a?.ok)
      return reply
        .code(401)
        .send({ error: a?.locked ? "locked" : a?.weak ? "weak_password" : "invalid_credentials" });
    if (a.must_change) return { must_change: true };
    if (!a.claims || !a.refresh) return reply.code(401).send({ error: "invalid_credentials" });
    return { session: await session(a.claims, a.refresh) };
  };

  app.post("/auth/password", async (req, reply) => {
    const p = z.object({ email: Email, password: Password }).strict().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!limiter.take(`pw:${clientIp(req)}`))
      return reply.code(429).send({ error: "rate_limited" });
    const { rows } = await opts.db.pool.query<{ r: DbAnswer }>(
      "SELECT app_public.password_login($1, $2) AS r",
      [p.data.email, p.data.password],
    );
    return answer(rows[0]?.r, reply);
  });

  app.post("/auth/password/change", async (req, reply) => {
    const p = z
      .object({ email: Email, password: Password, new_password: Password })
      .strict()
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!limiter.take(`pw:${clientIp(req)}`))
      return reply.code(429).send({ error: "rate_limited" });
    const { rows } = await opts.db.pool.query<{ r: DbAnswer }>(
      "SELECT app_public.password_change($1, $2, $3) AS r",
      [p.data.email, p.data.password, p.data.new_password],
    );
    const a = rows[0]?.r;
    if (a?.weak) return reply.code(400).send({ error: "weak_password" });
    return answer(a, reply);
  });

  app.post("/session/refresh", async (req, reply) => {
    const p = z
      .object({ refresh: z.string().regex(/^[0-9a-f]{64}$/) })
      .strict()
      .safeParse(req.body);
    if (!p.success) return reply.code(401).send({ error: "unauthenticated" });
    const { rows } = await opts.db.pool.query<{ r: DbAnswer }>(
      "SELECT app_public.session_refresh($1) AS r",
      [p.data.refresh],
    );
    const a = rows[0]?.r;
    if (!a?.ok || !a.claims || !a.refresh)
      return reply.code(401).send({ error: "unauthenticated" });
    return { session: await session(a.claims, a.refresh) };
  });
}

const STAFF_ROLES = [
  "owner",
  "location_manager",
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
] as const;

const SQL_REFUSALS = new Set([
  "invalid_email",
  "invalid_name",
  "invalid_role",
  "location_required",
  "invalid_password",
]);

/** Owner's team management (signed in). */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get("/staff/accounts", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT staff_id, person_id, display_name, email, role, active, has_password, must_change, protected FROM app.staff_accounts()",
      );
      return { data: rows };
    }),
  );
  app.put("/staff/accounts/:id/change-required", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.params);
    const b = z.object({ required: z.boolean() }).strict().parse(req.body);
    try {
      const r = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ r: boolean }>(
          "SELECT app.set_password_change_required($1, $2) AS r",
          [id, b.required],
        );
        return rows[0]?.r;
      });
      return { required: r };
    } catch (err) {
      if ((err as { message?: string }).message === "protected_account")
        return reply.code(403).send({ error: "protected_account" });
      throw err;
    }
  });
  app.post("/staff/accounts", async (req, reply) => {
    const b = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        full_name: z.string().trim().min(2).max(120),
        role: z.enum(STAFF_ROLES),
        location_id: z.string().uuid().nullable().optional(),
        password: z.string().min(8).max(128),
      })
      .strict()
      .parse(req.body);
    try {
      const id = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.create_staff_account($1, $2, $3, $4, $5) AS id",
          [b.email, b.full_name, b.role, b.location_id ?? null, b.password],
        );
        return rows[0]?.id;
      });
      return reply.code(201).send({ id, must_change: true });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "22023" && e.message && SQL_REFUSALS.has(e.message))
        return reply.code(400).send({ error: e.message });
      if (e.code === "23505") return reply.code(409).send({ error: "account_exists" });
      throw err;
    }
  });
}

/** Signed-in session operations that need to sign tokens (registered under /v1 with the JWT options). */
export async function sessionRoutes(
  app: FastifyInstance,
  opts: { jwtSecret: string; jwtIssuer: string; jwtAudience: string },
): Promise<void> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  app.get("/auth/roles", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ role: string }>("SELECT role FROM app.my_roles()");
      return { data: rows.map((r) => r.role), current: req.claims.app_role };
    }),
  );
  app.post("/auth/switch", async (req) => {
    const b = z
      .object({ role: z.enum(STAFF_ROLES) })
      .strict()
      .parse(req.body);
    const r = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ r: { claims: Claims; refresh: string } }>(
        "SELECT app.switch_role($1) AS r",
        [b.role],
      );
      return rows[0]?.r;
    });
    if (!r) throw Object.assign(new Error("forbidden"), { statusCode: 403 });
    return {
      session: await buildSession(key, opts.jwtIssuer, opts.jwtAudience, r.claims, r.refresh),
    };
  });
}
