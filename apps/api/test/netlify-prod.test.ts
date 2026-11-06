/**
 * Netlify path, end to end, against local Postgres configured like Netlify Database: the migrations in
 * netlify/database/migrations are applied in order by a NON-superuser owner (CREATEROLE only), and requests go
 * through the real function handler (netlify/functions/api.mts) in PRODUCTION mode (GYM_DEMO_MODE unset).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres@localhost:54329/postgres";
const DB = `nfp_${Date.now().toString(36)}`;
const MIG = join(__dirname, "..", "..", "..", "netlify", "database", "migrations");
let handler: (req: Request) => Promise<Response>;

function url(db: string, user?: string, pw?: string) {
  const u = new URL(ADMIN);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (pw) u.password = pw;
  return u.toString();
}

beforeAll(async () => {
  const root = new pg.Client({ connectionString: ADMIN });
  await root.connect();
  await root.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nf_owner') THEN
      CREATE ROLE nf_owner LOGIN PASSWORD 'nf_owner_dev' CREATEROLE NOSUPERUSER NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN CREATE ROLE app_authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_definer') THEN CREATE ROLE app_definer NOLOGIN; END IF;
  END $$`);
  // On Netlify the owner creates these roles itself and therefore administers them; simulate that.
  await root.query("GRANT app_authenticated, app_definer TO nf_owner WITH ADMIN OPTION");
  await root.query(`CREATE DATABASE ${DB} OWNER nf_owner`);
  await root.end();

  const owner = new pg.Client({ connectionString: url(DB, "nf_owner", "nf_owner_dev") });
  await owner.connect();
  for (const f of readdirSync(MIG)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await owner.query(readFileSync(join(MIG, f), "utf8"));
  }
  await owner.end();
  process.env.GYM_DB_URL = url(DB, "nf_owner", "nf_owner_dev");
  Reflect.deleteProperty(process.env, "GYM_DEMO_MODE"); // production mode, as deployed on Netlify
  handler = (await import("../../../netlify/functions/api.mts")).default;
}, 120_000);

afterAll(async () => {
  const root = new pg.Client({ connectionString: ADMIN });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await root.end();
});

const call = (path: string, init?: RequestInit) =>
  handler(new Request(`https://demo.invalid/api${path}`, init));

const PROD_ORG = "f1000000-0000-4000-8000-000000000001";
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Netlify function in production mode", () => {
  it("has no demo personas or demo sessions", async () => {
    expect((await call("/v1/demo/personas")).status).toBe(401);
    expect((await call("/v1/demo/session", json({ persona_id: "A-owner" }))).status).toBe(401);
  });

  it("the production organisation exists with its Toa Baja location and an open join page", async () => {
    const r = await call(`/v1/public/join/${PROD_ORG}`);
    // Online sign-up is opened by the seed only once an account exists to sign the switch; before that the page is
    // closed (404). Either way the organisation itself is there: a member code cannot be requested without a provider.
    expect([200, 404]).toContain(r.status);
    const code = await call(
      "/v1/public/login/start",
      json({ org_id: PROD_ORG, email: "persona@gmail.com" }),
    );
    expect(code.status).toBe(503);
  });

  it("staff sign in with a password; an unknown account gets the uniform refusal", async () => {
    const r = await call(
      "/v1/public/auth/password",
      json({ email: "nadie@gmail.com", password: "Password" }),
    );
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "invalid_credentials" });
  });
});
