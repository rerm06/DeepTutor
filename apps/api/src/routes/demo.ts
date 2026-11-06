import { DEMO_ORG_LOGOS, DEMO_PERSONAS } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";

/**
 * DEMO MODE ONLY. Issues short-lived tokens for the synthetic personas of packages/db/seed/demo.sql so the app can be
 * explored without an identity provider. Registered only when buildApp() receives `demo: true`. Tokens can only ever
 * carry the claims of a listed persona (fixed demo orgs); they never reach real tenants.
 */
export interface DemoOptions {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
}

const SessionBody = z.object({ persona_id: z.string().min(1).max(40) }).strict();
const TTL_SECONDS = 900;

export async function demoRoutes(app: FastifyInstance, opts: DemoOptions): Promise<void> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const publicPersona = (p: (typeof DEMO_PERSONAS)[number]) => ({
    id: p.id,
    org: p.org,
    org_name: p.org_name,
    org_logo_url: DEMO_ORG_LOGOS[p.org],
    role: p.role,
    display_name: p.display_name,
    home: p.home,
  });

  app.get("/demo/personas", async () => ({ data: DEMO_PERSONAS.map(publicPersona) }));

  app.post("/demo/session", async (req, reply) => {
    const { persona_id } = SessionBody.parse(req.body);
    const persona = DEMO_PERSONAS.find((p) => p.id === persona_id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    const token = await new SignJWT({
      org_id: persona.org_id,
      app_role: persona.role,
      location_ids: persona.location_ids,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(persona.person_id)
      .setIssuer(opts.jwtIssuer)
      .setAudience(opts.jwtAudience)
      .setIssuedAt()
      .setExpirationTime(`${TTL_SECONDS}s`)
      .sign(key);
    return { token, expires_in: TTL_SECONDS, persona: publicPersona(persona) };
  });
}
