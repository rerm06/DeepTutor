import { type Db, withClaims } from "@gym/db";
import { type Claims, ClaimsSchema } from "@gym/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { ZodError } from "zod";
import { httpFromPg } from "./errors.js";
import { memberRoutes } from "./routes/members.js";
import { messagingRoutes } from "./routes/messaging.js";
import { orgRoutes } from "./routes/org.js";

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    claims: Claims;
  }
  interface FastifyInstance {
    /** Run a query block under the caller's claims (RLS). The only DB entry point for routes. */
    asCaller<T>(req: FastifyRequest, fn: Parameters<typeof withClaims<T>>[2]): Promise<T>;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 256 * 1024 });
  const key = new TextEncoder().encode(deps.jwtSecret);

  app.decorateRequest("claims", null as unknown as Claims);
  app.decorate("asCaller", <T>(req: FastifyRequest, fn: Parameters<typeof withClaims<T>>[2]) =>
    withClaims<T>(deps.db, req.claims, fn),
  );

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthenticated" });
    try {
      const { payload } = await jwtVerify(header.slice(7), key, {
        algorithms: ["HS256"],
        issuer: deps.jwtIssuer,
        audience: deps.jwtAudience,
        // Security review MEDIUM-7: no eternal tokens. Location scope lives in the token, so keep it short.
        requiredClaims: ["exp", "iat"],
        maxTokenAge: "15m",
      });
      req.claims = ClaimsSchema.parse(payload);
    } catch {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({ error: "invalid_input", issues: err.issues });
    const mapped = httpFromPg(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.code });
    if (
      (err as { statusCode?: number }).statusCode &&
      (err as { statusCode: number }).statusCode < 500
    ) {
      return reply.code((err as { statusCode: number }).statusCode).send({ error: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "internal" });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(orgRoutes, { prefix: "/v1" });
  await app.register(memberRoutes, { prefix: "/v1" });
  await app.register(messagingRoutes, { prefix: "/v1" });
  return app;
}
