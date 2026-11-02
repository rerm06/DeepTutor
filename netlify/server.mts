import { buildApp } from "@gym/api/app";
import { createDb } from "@gym/db";
/**
 * Server bundle entry (bundled by scripts/bundle-function.mjs into netlify/server-bundle.mjs). Netlify Function exposing the Fastify API at /api/*. One Fastify instance per warm container.
 * Connection: the Netlify Database owner connection; every request transaction drops to app_authenticated with
 * signed claims (withClaims). Secrets (claims HMAC key, JWT secret) are generated inside the database by migration
 * 0005 and read once per cold start through this system path — none live in the repo or in env vars.
 */
import { getConnectionString } from "@netlify/database";
import pg from "pg";

// DEMO deployment: the database holds only the synthetic seed (packages/db/seed/demo.sql). Turn this off before any
// real tenant is onboarded; real sessions must come from the identity provider.
const DEMO_MODE = true;
const ISSUER = "gym-saas-netlify";
const AUDIENCE = "gym-saas-api";

type App = Awaited<ReturnType<typeof buildApp>>;
let appPromise: Promise<App> | undefined;

async function init(): Promise<App> {
  const url = process.env.GYM_DB_URL ?? getConnectionString();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const k = await c.query<{ key: string }>(
      "SELECT encode(key, 'hex') AS key FROM app_private.claims_key",
    );
    const j = await c.query<{ s: string }>(
      "SELECT encode(secret, 'hex') AS s FROM app_private.jwt_secret",
    );
    const claimsKey = k.rows[0]?.key;
    const jwtSecret = j.rows[0]?.s;
    if (!claimsKey || !jwtSecret)
      throw new Error("database secrets missing: migrations not applied");
    const db = createDb(url, claimsKey);
    db.pool.options.max = 3;
    return buildApp({ db, jwtSecret, jwtIssuer: ISSUER, jwtAudience: AUDIENCE, demo: DEMO_MODE });
  } finally {
    await c.end();
  }
}

export default async (req: Request): Promise<Response> => {
  appPromise ??= init().catch((err) => {
    appPromise = undefined; // retry on the next request instead of caching a failure
    throw err;
  });
  const app = await appPromise;
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const res = await app.inject({
    method: req.method as "GET",
    url: url.pathname.replace(/^\/api/, "") + url.search,
    headers,
    payload: body,
  });
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (
      v === undefined ||
      k === "content-length" ||
      k === "transfer-encoding" ||
      k === "connection"
    )
      continue;
    out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  out.set("cache-control", "no-store");
  return new Response(res.body, { status: res.statusCode, headers: out });
};
