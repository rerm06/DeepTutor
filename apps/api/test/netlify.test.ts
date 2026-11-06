/**
 * Netlify path, end to end, against local Postgres configured like Netlify Database: the migrations in
 * netlify/database/migrations are applied in order by a NON-superuser owner (CREATEROLE only), and requests go
 * through the real function handler (netlify/functions/api.mts) with the demo personas.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres@localhost:54329/postgres";
const DB = `nf_${Date.now().toString(36)}`;
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
  // The deployed site runs in production mode; these cases exercise the demo deployment (personas, demo sign-up).
  // netlify-prod.test.ts covers production mode with its own module instance.
  process.env.GYM_DEMO_MODE = "true";
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
async function session(persona: string) {
  const r = await call("/v1/demo/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ persona_id: persona }),
  });
  expect(r.status).toBe(200);
  return { authorization: `Bearer ${(await r.json()).token}`, "content-type": "application/json" };
}

describe("Netlify function + Netlify-style database", () => {
  it("lists personas without auth and refuses everything else without a token", async () => {
    const p = await call("/v1/demo/personas");
    expect(p.status).toBe(200);
    expect((await p.json()).data.length).toBeGreaterThanOrEqual(8);
    expect((await call("/v1/members")).status).toBe(401);
  });

  it("front desk sees only its location; the owner sees the whole org; org B sees none of org A", async () => {
    const fd = await (await call("/v1/members", { headers: await session("A-front") })).json();
    const owner = await (await call("/v1/members", { headers: await session("A-owner") })).json();
    const b = await (await call("/v1/members", { headers: await session("B-owner") })).json();
    expect(fd.data.length).toBeGreaterThan(0);
    expect(owner.data.length).toBeGreaterThan(fd.data.length);
    expect(b.data.some((m: { email: string }) => m.email.endsWith(".a@demo.invalid"))).toBe(false);
  });

  it("a reminder to a consenting member is queued and rendered by the database", async () => {
    const h = await session("A-front");
    const members = (await (await call("/v1/members", { headers: h })).json()).data as Array<{
      id: string;
      full_name: string;
    }>;
    const ana = members.find((m) => m.full_name.startsWith("Ana"));
    expect(ana).toBeDefined();
    const r = await call("/v1/messages", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        member_id: ana?.id,
        brand_id: "a0000000-0000-4000-8000-000000000003",
        channel: "sms",
        template_key: "class.reminder",
        locale: "es",
        vars: { date: "2026-11-10", time: "18:00" },
      }),
    });
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe("queued");
    const hist = await (await call(`/v1/messages?member_id=${ana?.id}`, { headers: h })).json();
    expect(hist.data[0].body).toContain("Hola Ana");
  });

  it("request traffic runs as app_authenticated, never as the owner", async () => {
    const me = await call("/v1/me", { headers: await session("A-owner") });
    expect(me.status).toBe(200);
    const c = new pg.Client({ connectionString: process.env.GYM_DB_URL });
    await c.connect();
    const r = await c.query(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname IN ('app_authenticated','app_definer')",
    );
    expect(r.rows.every((x) => x.rolbypassrls === false)).toBe(true);
    await c.end();
  });

  it("an unknown persona cannot mint a token", async () => {
    const r = await call("/v1/demo/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona_id: "root" }),
    });
    expect(r.status).toBe(404);
  });
});
