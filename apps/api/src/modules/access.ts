import type { Db } from "@gym/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildSession } from "./auth.js";
import { IpLimiter } from "./signup.js";

/**
 * Access · every way in (and out). All rules live in the database (0024); these routes validate input, run the
 * definer functions and shape the answers.
 *
 * Signed in (/v1):
 *   POST /me/door                      member scans a door code → entry or exit for themself
 *   GET  /door/kiosk/:locationId       the two rotating codes the door tablet shows (front of house)
 *   GET  /door/inside/:locationId      who is inside now
 *   GET  /door/activity/:locationId    the last entries and exits at the location
 *   POST /door/check-out               front desk closes a visit by hand
 *   GET|PUT /me/biometric-consent      the member's own opt-in for face access
 *   GET  /door/face-access             face access per location (owner switches it with PUT)
 *   GET|POST /door/devices, PUT /door/devices/:id/review, DELETE /door/devices/:id   camera gateways
 *                                      (owner / manager); review = always confirmed by the front desk
 *   GET  /door/face-events, POST /door/face-events/:id/review   recognitions and the review queue
 * Public (/v1/public, no token):
 *   POST /login/start, POST /login/verify   sign-in code by e-mail (DEMO MODE shows the code on screen)
 *   GET  /device/enrolment, POST /device/recognitions   camera gateway, header "Authorization: Device <id>:<secret>"
 */
export const FACE_CONSENT_VERSION = "face-v1";

const Uuid = z.string().uuid();
const LocParams = z.object({ locationId: Uuid });
const IdParams = z.object({ id: Uuid });
const LocQuery = z.object({ location_id: Uuid.optional() }).strict();

export async function routes(app: FastifyInstance): Promise<void> {
  app.post("/me/door", async (req) => {
    const b = z
      .object({ token: z.string().min(1).max(160) })
      .strict()
      .parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM app.door_pass($1)", [b.token]);
      return rows[0];
    });
  });

  app.get("/door/kiosk/:locationId", async (req) => {
    const { locationId } = LocParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ direction: string; token: string; expires_at: string }>(
        "SELECT direction, token, expires_at FROM app.door_kiosk($1)",
        [locationId],
      );
      return { data: rows, server_time: new Date().toISOString() };
    });
  });

  app.get("/door/inside/:locationId", async (req) => {
    const { locationId } = LocParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT member_id, full_name, member_no, since, source FROM app.location_inside($1) ORDER BY since DESC",
        [locationId],
      );
      return { data: rows };
    });
  });

  app.get("/door/activity/:locationId", async (req) => {
    const { locationId } = LocParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      // RLS: front of house of the location (and nobody else) reads these rows.
      const { rows } = await tx.query(
        `SELECT * FROM (
           SELECT c.id, 'in' AS kind, c.result::text AS result, c.reason, c.source::text AS source, c.at,
                  c.member_id, m.full_name, m.member_no
             FROM app.check_in c LEFT JOIN app.member m ON m.id = c.member_id
            WHERE c.location_id = $1 AND c.at > now() - interval '16 hours'
           UNION ALL
           SELECT o.id, 'out', 'allowed', NULL, o.source::text, o.at, o.member_id, m.full_name, m.member_no
             FROM app.check_out o JOIN app.member m ON m.id = o.member_id
            WHERE o.location_id = $1 AND o.at > now() - interval '16 hours') x
         ORDER BY at DESC LIMIT 20`,
        [locationId],
      );
      return { data: rows };
    });
  });

  app.post("/door/check-out", async (req, reply) => {
    const b = z.object({ location_id: Uuid, member_id: Uuid }).strict().parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string | null }>(
        "SELECT app.check_out_member($1, $2) AS id",
        [b.location_id, b.member_id],
      );
      return rows[0]?.id ?? null;
    });
    if (!id) return reply.code(409).send({ error: "not_inside" });
    return { id };
  });

  app.get("/me/biometric-consent", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{
        version: string;
        granted_at: string;
        revoked_at: string | null;
      }>(
        `SELECT bc.version, bc.granted_at, bc.revoked_at
           FROM app.biometric_consent bc JOIN app.member m ON m.id = bc.member_id
          WHERE m.person_id = app.person_id() AND app.role() = 'member'`,
      );
      const r = rows[0];
      const { rows: on } = await tx.query<{ on: boolean }>(
        `SELECT coalesce(lp.face_access, false) AS on
           FROM app.member m LEFT JOIN app.location_policy lp ON lp.location_id = m.home_location_id
          WHERE m.person_id = app.person_id() AND app.role() = 'member'`,
      );
      return {
        active: !!r && r.revoked_at === null,
        version: r?.version ?? null,
        granted_at: r?.granted_at ?? null,
        revoked_at: r?.revoked_at ?? null,
        current_version: FACE_CONSENT_VERSION,
        location_enabled: on[0]?.on ?? false,
      };
    }),
  );
  app.put("/me/biometric-consent", async (req) => {
    const b = z.object({ grant: z.boolean() }).strict().parse(req.body);
    return app.asCaller(req, async (tx) => {
      await tx.query("SELECT app.set_biometric_consent($1, $2)", [
        b.grant,
        b.grant ? FACE_CONSENT_VERSION : null,
      ]);
      return { active: b.grant };
    });
  });

  app.get("/door/face-access", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT l.id AS location_id, l.name, coalesce(lp.face_access, false) AS face_access
           FROM app.location l LEFT JOIN app.location_policy lp ON lp.location_id = l.id
          WHERE app.can_see_location(l.id) ORDER BY l.name`,
      );
      return { data: rows };
    }),
  );
  app.put("/door/face-access", async (req) => {
    const b = z.object({ location_id: Uuid, on: z.boolean() }).strict().parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ on: boolean }>("SELECT app.set_face_access($1, $2) AS on", [
        b.location_id,
        b.on,
      ]);
      return { location_id: b.location_id, face_access: rows[0]?.on ?? false };
    });
  });

  app.get("/door/devices", async (req) => {
    const q = LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, location_id, name, direction, requires_review, created_at, revoked_at, last_seen_at
           FROM app.door_device
          WHERE ($1::uuid IS NULL OR location_id = $1) ORDER BY created_at DESC`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });
  app.post("/door/devices", async (req, reply) => {
    const b = z
      .object({
        location_id: Uuid,
        name: z.string().trim().min(2).max(60),
        direction: z.enum(["in", "out", "both"]),
        // Default ON: consumer cameras (e.g. Wyze RTSP) have no liveness detection.
        requires_review: z.boolean().default(true),
      })
      .strict()
      .parse(req.body);
    const created = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; secret: string }>(
        "SELECT id, secret FROM app.create_door_device($1, $2, $3, $4)",
        [b.location_id, b.name, b.direction, b.requires_review],
      );
      return rows[0];
    });
    // The only time the secret leaves the database: the owner copies it into the gateway's configuration.
    return reply.code(201).send(created);
  });
  app.put("/door/devices/:id/review", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = z.object({ requires_review: z.boolean() }).strict().parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ r: boolean }>("SELECT app.set_device_review($1, $2) AS r", [
        id,
        b.requires_review,
      ]);
      return { requires_review: rows[0]?.r ?? true };
    });
  });
  app.delete("/door/devices/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      await tx.query("SELECT app.revoke_door_device($1)", [id]);
      return { revoked: true };
    });
  });

  app.get("/door/face-events", async (req) => {
    const q = LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT e.id, e.location_id, e.device_id, d.name AS device_name, e.member_id, m.full_name, m.member_no,
                e.direction, e.score, e.outcome, e.reason, e.at, e.reviewed_at
           FROM app.face_event e JOIN app.member m ON m.id = e.member_id JOIN app.door_device d ON d.id = e.device_id
          WHERE ($1::uuid IS NULL OR e.location_id = $1)
          ORDER BY (e.outcome = 'review') DESC, e.at DESC LIMIT 30`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });
  app.post("/door/face-events/:id/review", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = z.object({ accept: z.boolean() }).strict().parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ r: string }>("SELECT app.review_face_event($1, $2) AS r", [
        id,
        b.accept,
      ]);
      return { result: rows[0]?.r };
    });
  });
}

// ── Public: sign-in code and camera gateways ─────────────────────────────────────────────────────────────
export interface AccessPublicOptions {
  db: Db;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  /** DEMO MODE: the sign-in code is returned on screen (there is no mail/SMS provider in the demo). */
  demo: boolean;
  limiter?: IpLimiter;
}

function clientIp(req: FastifyRequest): string {
  const h = req.headers["x-nf-client-connection-ip"];
  const v = Array.isArray(h) ? h[0] : h;
  return v && v.length <= 64 ? v : req.ip;
}

/** "Device <uuid>:<48 hex>" → [id, secret] or null. */
export function parseDeviceAuth(h: string | undefined): [string, string] | null {
  const m = h?.match(/^Device ([0-9a-f-]{36}):([0-9a-f]{48})$/i);
  return m?.[1] && m[2] ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
}

const LoginStart = z.object({ org_id: Uuid, email: z.string().trim().min(3).max(254) }).strict();
const LoginVerify = z
  .object({
    org_id: Uuid,
    email: z.string().trim().min(3).max(254),
    code: z.string().regex(/^[0-9]{6}$/),
  })
  .strict();
const Recognition = z
  .object({
    member_id: Uuid,
    score: z.number().min(0).max(1),
    direction: z.enum(["in", "out"]).optional(),
  })
  .strict();

interface Verified {
  ok: boolean;
  person_id?: string;
  member_id?: string;
  org_id?: string;
  full_name?: string;
  location_name?: string;
  brand_name?: string;
  refresh?: string;
}

export async function publicRoutes(app: FastifyInstance, opts: AccessPublicOptions): Promise<void> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const limiter = opts.limiter ?? new IpLimiter(10, 15 * 60_000);
  const deviceLimiter = new IpLimiter(600, 60_000);

  app.post("/login/start", async (req, reply) => {
    const p = LoginStart.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!limiter.take(`start:${clientIp(req)}`))
      return reply.code(429).send({ error: "rate_limited" });
    // Without a delivery channel there is no honest way to hand out a code outside the demo.
    if (!opts.demo) return reply.code(503).send({ error: "login_delivery_unavailable" });
    try {
      const { rows } = await opts.db.pool.query<{
        r: { sent: boolean; code?: string; expires_in?: number };
      }>("SELECT app_public.login_start($1, $2) AS r", [p.data.org_id, p.data.email]);
      const r = rows[0]?.r;
      return {
        sent: true,
        expires_in: 600,
        // DEMO MODE only: synthetic accounts, the code is shown instead of mailed.
        demo_code: r?.sent ? r.code : null,
      };
    } catch (err) {
      if ((err as { code?: string }).code === "54000")
        return reply.code(429).send({ error: "rate_limited" });
      throw err;
    }
  });

  app.post("/login/verify", async (req, reply) => {
    const p = LoginVerify.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!limiter.take(`verify:${clientIp(req)}`))
      return reply.code(429).send({ error: "rate_limited" });
    const { rows } = await opts.db.pool.query<{ r: Verified }>(
      "SELECT app_public.login_verify($1, $2, $3) AS r",
      [p.data.org_id, p.data.email, p.data.code],
    );
    const v = rows[0]?.r;
    if (!v?.ok || !v.person_id || !v.member_id || !v.org_id)
      return reply.code(400).send({ error: "invalid_code" });
    // A refresh token keeps the member signed in for 12 hours (rotated on every use; 0026).
    const session = await buildSession(
      key,
      opts.jwtIssuer,
      opts.jwtAudience,
      {
        person_id: v.person_id,
        org_id: v.org_id,
        role: "member",
        location_ids: [],
        display_name: v.full_name ?? "",
        home: v.location_name ?? null,
        org_name: v.brand_name ?? null,
      },
      v.refresh ?? "",
      "login",
    );
    return { session };
  });

  const device = (req: FastifyRequest, reply: FastifyReply): [string, string] | null => {
    if (!deviceLimiter.take(`device:${clientIp(req)}`)) {
      void reply.code(429).send({ error: "rate_limited" });
      return null;
    }
    const auth = parseDeviceAuth(req.headers.authorization);
    if (!auth) {
      void reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return auth;
  };

  app.get("/device/enrolment", async (req, reply) => {
    const auth = device(req, reply);
    if (!auth) return reply;
    try {
      const { rows } = await opts.db.pool.query<{ r: unknown }>(
        "SELECT app_public.device_enrolment($1, $2) AS r",
        auth,
      );
      return rows[0]?.r;
    } catch (err) {
      if ((err as { code?: string }).code === "42501")
        return reply.code(401).send({ error: "unauthenticated" });
      throw err;
    }
  });

  app.post("/device/recognitions", async (req, reply) => {
    const auth = device(req, reply);
    if (!auth) return reply;
    const p = Recognition.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      const { rows } = await opts.db.pool.query<{ r: unknown }>(
        "SELECT app_public.device_recognition($1, $2, $3, $4, $5) AS r",
        [auth[0], auth[1], p.data.member_id, p.data.score, p.data.direction ?? null],
      );
      return rows[0]?.r;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "42501") return reply.code(401).send({ error: "unauthenticated" });
      if (code === "22023") return reply.code(400).send({ error: "invalid_input" });
      throw err;
    }
  });
}
