import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { GENERIC_MESSAGE, IpLimiter, JoinBody } from "../src/modules/signup.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let demo: FastifyInstance;
let prod: FastifyInstance;
let birth30: string;
let birth20: string;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
const auth = async (claims: Claims) => ({ authorization: `Bearer ${await token(claims)}` });

beforeAll(async () => {
  t = await createTestDb();
  demo = await buildApp({
    db: t.api,
    jwtSecret: SECRET,
    jwtIssuer: ISS,
    jwtAudience: AUD,
    demo: true,
  });
  prod = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  const r = await t.admin.query<{ a: string; b: string }>(
    `SELECT to_char((now() AT TIME ZONE 'America/Puerto_Rico')::date - interval '30 years', 'YYYY-MM-DD') AS a,
            to_char((now() AT TIME ZONE 'America/Puerto_Rico')::date - interval '20 years', 'YYYY-MM-DD') AS b`,
  );
  birth30 = r.rows[0]?.a as string;
  birth20 = r.rows[0]?.b as string;
}, 60_000);
afterAll(async () => {
  await demo?.close();
  await prod?.close();
  await t?.drop();
});

let seq = 0;
let ip = 0;
/** Every request from a fresh address unless a test is about the limiter. */
const nextIp = () => {
  ip += 1;
  return `10.0.${Math.floor(ip / 250)}.${ip % 250}`;
};
function body(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    org_id: t.fx.A.orgId,
    location_id: t.fx.A.locations[0],
    full_name: "Lucía Torres Demo",
    email: `api${seq}.${Date.now()}@demo.invalid`,
    phone: "+1-787-555-0142",
    birth_date: birth30,
    terms_version: "v2026-11",
    waiver_version: "v2026-11",
    accept_terms: true,
    accept_waiver: true,
    sms_reminders: false,
    sms_marketing: false,
    locale: "es",
    ...over,
  };
}
const post = (app: FastifyInstance, payload: unknown, remoteAddress = nextIp()) =>
  app.inject({ method: "POST", url: "/v1/public/join", payload: payload as object, remoteAddress });

describe("GET /v1/public/join/:orgId", () => {
  it("is public and returns brand, open locations and the current texts", async () => {
    const r = await demo.inject({ url: `/v1/public/join/${t.fx.A.orgId}` });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.locations.map((l: { id: string }) => l.id)).toEqual([t.fx.A.locations[0]]);
    expect(Object.keys(j.locations[0]).sort()).toEqual(["brand_id", "id", "municipality", "name"]);
    expect(j.agreements.length).toBe(8);
    expect(JSON.stringify(j)).not.toMatch(/@demo\.invalid|member_no|saas_plan/);
  });
  it("404 for an unknown org and for a malformed id", async () => {
    expect(
      (await demo.inject({ url: "/v1/public/join/00000000-0000-4000-8000-000000000999" }))
        .statusCode,
    ).toBe(404);
    expect((await demo.inject({ url: "/v1/public/join/not-a-uuid" })).statusCode).toBe(404);
  });
  it("the public prefix opens nothing else", async () => {
    for (const url of [
      "/v1/public/../members",
      "/v1/public/%2e%2e/members",
      "/v1/public/members",
    ]) {
      const r = await demo.inject({ url });
      expect(r.statusCode, url).not.toBe(200);
    }
    expect((await demo.inject({ url: "/v1/members" })).statusCode).toBe(401);
  });
});

describe("POST /v1/public/join", () => {
  it("demo mode: a brand-new person gets 202 and a member session for exactly their new identity", async () => {
    const b = body({ sms_reminders: true });
    const r = await post(demo, b);
    expect(r.statusCode).toBe(202);
    const j = r.json();
    expect(j.message).toBeNull();
    expect(j.session.expires_in).toBe(900);
    expect(j.session.persona).toMatchObject({
      role: "member",
      display_name: "Lucía Torres Demo",
      home: "Demo A Sede 1",
    });
    const { payload } = await jwtVerify(j.session.token, new TextEncoder().encode(SECRET), {
      issuer: ISS,
      audience: AUD,
    });
    expect(payload).toMatchObject({ org_id: t.fx.A.orgId, app_role: "member", location_ids: [] });
    expect((payload.exp as number) - (payload.iat as number)).toBe(900);
    const p = await t.admin.query("SELECT id FROM app.person WHERE email = $1", [b.email]);
    expect(payload.sub).toBe(p.rows[0].id);
    // The session works: /me answers as the new member, who sees only their own member row.
    const me = await demo.inject({
      url: "/v1/me",
      headers: { authorization: `Bearer ${j.session.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "member", person: { email: b.email } });
    const ag = await demo.inject({
      url: "/v1/members",
      headers: { authorization: `Bearer ${j.session.token}` },
    });
    expect(ag.json().data).toHaveLength(1);
    const agreements = await demo.inject({
      url: `/v1/members/${ag.json().data[0].id}/agreements`,
      headers: { authorization: `Bearer ${j.session.token}` },
    });
    expect(
      agreements
        .json()
        .data.map((a: { kind: string }) => a.kind)
        .sort(),
    ).toEqual(["terms", "waiver"]);
  });

  it("an e-mail that already exists (any org) gets the same 202 shape, no session, and nothing is created", async () => {
    const before = await t.admin.query("SELECT count(*)::int AS n FROM app.member");
    for (const email of ["member.b@demo.invalid", "member.a@demo.invalid", "SHARED@demo.invalid"]) {
      const r = await post(demo, body({ email }));
      expect(r.statusCode, email).toBe(202);
      expect(r.json()).toEqual({ session: null, message: GENERIC_MESSAGE.es });
    }
    const en = await post(demo, body({ email: "member.b@demo.invalid", locale: "en" }));
    expect(en.json()).toEqual({ session: null, message: GENERIC_MESSAGE.en });
    const after = await t.admin.query("SELECT count(*)::int AS n FROM app.member");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("demo mode off: a brand-new person gets exactly the generic answer too (no oracle), but is created", async () => {
    const b = body();
    const r = await post(prod, b);
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ session: null, message: GENERIC_MESSAGE.es });
    const existing = await post(prod, body({ email: "member.b@demo.invalid" }));
    expect(existing.body).toBe(r.body);
    const p = await t.admin.query("SELECT 1 FROM app.person WHERE email = $1", [b.email]);
    expect(p.rowCount).toBe(1);
  });

  it("refuses non-demo e-mails and phones at the API (and stores nothing)", async () => {
    for (const email of ["ana@gmail.com", "ana@demo.invalid.evil.com", "ana@example.com"]) {
      const r = await post(demo, body({ email }));
      expect(r.statusCode, email).toBe(400);
      expect(r.json()).toEqual({ error: "invalid_email" });
    }
    for (const phone of ["+1-787-555-0200", "+1-305-555-0101", "7875550101"]) {
      const r = await post(demo, body({ phone }));
      expect(r.statusCode, phone).toBe(400);
      expect(r.json()).toEqual({ error: "invalid_phone" });
    }
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.person WHERE email IN ('ana@gmail.com', 'ana@example.com')",
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("maps SQL refusals to explicit codes: under 21, closed or foreign location, agreements, SMS without phone", async () => {
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ birth_date: birth20 }, 400, "age_requires_guardian"],
      [{ location_id: t.fx.A.locations[1] }, 400, "invalid_location"],
      [{ location_id: t.fx.B.locations[0] }, 400, "invalid_location"],
      [{ accept_waiver: false }, 400, "agreements_required"],
      [{ terms_version: "v2020-01" }, 400, "agreement_outdated"],
      [{ phone: "", sms_marketing: true }, 400, "phone_required_for_sms"],
      [{ full_name: "{{brand}} Demo" }, 400, "invalid_name"],
      [{ birth_date: "2000-02-30" }, 400, "invalid_birth_date"],
      [{ org_id: "00000000-0000-4000-8000-000000000999" }, 404, "not_found"],
    ];
    for (const [over, status, error] of cases) {
      const r = await post(demo, body(over));
      expect(r.statusCode, error).toBe(status);
      expect(r.json(), error).toEqual({ error });
      expect(r.body).not.toContain("token");
    }
  });

  it("rejects unknown fields (.strict) and a client-chosen role or status", async () => {
    for (const extra of [
      { role: "owner" },
      { status: "active" },
      { person_id: t.fx.A.people.owner },
    ]) {
      const r = await post(demo, body(extra));
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: "invalid_input" });
    }
  });

  it("limits attempts per client address (11th from one address is 429; another address is fine)", async () => {
    const addr = "192.0.2.77";
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1)
      codes.push((await post(demo, body({ email: "x@gmail.com" }), addr)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
    expect(codes[10]).toBe(429);
    const blocked = await post(demo, body(), addr);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "rate_limited" });
    expect((await post(demo, body(), "192.0.2.78")).statusCode).toBe(202);
    // Behind Netlify the edge address header is the key.
    const viaEdge = await demo.inject({
      method: "POST",
      url: "/v1/public/join",
      payload: body(),
      remoteAddress: addr,
      headers: { "x-nf-client-connection-ip": "198.51.100.9" },
    });
    expect(viaEdge.statusCode).toBe(202);
  });

  it("the per-org SQL cap answers 429", async () => {
    await t.admin.query(
      `INSERT INTO app.join_attempt (org_id, location_id, outcome, at)
       SELECT $1, $2, 'existing', now() - interval '5 minutes' FROM generate_series(1, 30)`,
      [t.fx.B.orgId, t.fx.B.locations[0]],
    );
    const r = await post(demo, body({ org_id: t.fx.B.orgId, location_id: t.fx.B.locations[0] }));
    expect(r.statusCode).toBe(429);
    expect(r.json()).toEqual({ error: "rate_limited" });
  });
});

describe("API-level PII guard (independent of the database)", () => {
  it("the request schema itself refuses non-demo e-mails and phones", () => {
    const base = {
      org_id: "a0000000-0000-4000-8000-000000000001",
      location_id: "a0000000-0000-4000-8000-000000000011",
      full_name: "Ana Demo",
      email: "ana@demo.invalid",
      phone: "+1-787-555-0101",
      birth_date: "1990-01-01",
      terms_version: "v2026-11",
      waiver_version: "v2026-11",
      accept_terms: true,
      accept_waiver: true,
      locale: "es",
    };
    expect(JoinBody.safeParse(base).success).toBe(true);
    expect(JoinBody.safeParse({ ...base, email: "Ana@Demo.Invalid" }).success).toBe(true);
    for (const email of ["ana@gmail.com", "ana@demo.invalid.com", "ana@sub.demo.invalid"])
      expect(JoinBody.safeParse({ ...base, email }).success, email).toBe(false);
    for (const phone of ["+1-787-555-0200", "+1-212-555-0101", "7875550101"])
      expect(JoinBody.safeParse({ ...base, phone }).success, phone).toBe(false);
  });
});

describe("IpLimiter", () => {
  it("resets after the window and stays bounded", () => {
    const l = new IpLimiter(2, 1000, 3);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2)]).toEqual([true, true, false]);
    expect(l.take("a", 1001)).toBe(true);
    for (const k of ["b", "c", "d", "e"]) l.take(k, 1002);
    expect((l as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(3);
  });
});

describe("signed-in routes", () => {
  it("owner lists and switches locations; front desk cannot switch; the switch shows on the public page", async () => {
    const owner = await auth(t.claims(t.fx.A, "owner"));
    const list = await demo.inject({ url: "/v1/signup/locations", headers: owner });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((l: { enabled: boolean }) => l.enabled)).toEqual([true, false]);
    const fd = await demo.inject({
      method: "PUT",
      url: `/v1/signup/locations/${t.fx.A.locations[0]}`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: { enabled: false },
    });
    expect(fd.statusCode).toBe(403);
    const on = await demo.inject({
      method: "PUT",
      url: `/v1/signup/locations/${t.fx.A.locations[1]}`,
      headers: owner,
      payload: { enabled: true },
    });
    expect(on.json()).toEqual({ id: t.fx.A.locations[1], enabled: true });
    const pub = await demo.inject({ url: `/v1/public/join/${t.fx.A.orgId}` });
    expect(pub.json().locations).toHaveLength(2);
    const bad = await demo.inject({
      method: "PUT",
      url: `/v1/signup/locations/${t.fx.A.locations[1]}`,
      headers: owner,
      payload: { enabled: true, org_id: t.fx.B.orgId },
    });
    expect(bad.statusCode).toBe(400);
    await demo.inject({
      method: "PUT",
      url: `/v1/signup/locations/${t.fx.A.locations[1]}`,
      headers: owner,
      payload: { enabled: false },
    });
  });
  it("members see an empty location list and cannot switch", async () => {
    const m = await auth(t.claims(t.fx.A, "member"));
    expect((await demo.inject({ url: "/v1/signup/locations", headers: m })).json().data).toEqual(
      [],
    );
    const r = await demo.inject({
      method: "PUT",
      url: `/v1/signup/locations/${t.fx.A.locations[0]}`,
      headers: m,
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(403);
  });
  it("agreements follow RLS: staff of another org see none", async () => {
    const r = await demo.inject({
      url: `/v1/members/${t.fx.A.members[0]}/agreements`,
      headers: await auth(t.claims(t.fx.B, "owner")),
    });
    expect(r.json().data).toEqual([]);
    const own = await demo.inject({
      url: `/v1/members/${t.fx.A.members[0]}/agreements`,
      headers: await auth(t.claims(t.fx.A, "front_desk")),
    });
    expect(own.json().data).toHaveLength(2);
  });
});

/**
 * Netlify path with the demo seed: migrations from netlify/database/migrations applied by a NON-superuser owner, and
 * the real function handler, whose connection is that owner (there the owner is the API login role).
 */
describe("Netlify function + demo seed", () => {
  const ADMIN = process.env.TEST_PG_ADMIN_URL ?? "postgres://postgres@localhost:54329/postgres";
  const DB = `nfj_${Date.now().toString(36)}`;
  const MIG = join(__dirname, "..", "..", "..", "netlify", "database", "migrations");
  const ORG_A = "a0000000-0000-4000-8000-000000000001";
  const ORG_B = "b0000000-0000-4000-8000-000000000001";
  let handler: (req: Request) => Promise<Response>;
  const url = (db: string, user?: string, pw?: string) => {
    const u = new URL(ADMIN);
    u.pathname = `/${db}`;
    if (user) u.username = user;
    if (pw) u.password = pw;
    return u.toString();
  };

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
    await root.query("GRANT app_authenticated, app_definer TO nf_owner WITH ADMIN OPTION");
    await root.query(`CREATE DATABASE ${DB} OWNER nf_owner`);
    await root.end();
    const owner = new pg.Client({ connectionString: url(DB, "nf_owner", "nf_owner_dev") });
    await owner.connect();
    for (const f of readdirSync(MIG)
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await owner.query(readFileSync(join(MIG, f), "utf8"));
    // Applying the seed twice is a no-op (idempotent).
    await owner.query(readFileSync(join(MIG, "20261102101850_signup_demo_seed.sql"), "utf8"));
    await owner.end();
    process.env.GYM_DB_URL = url(DB, "nf_owner", "nf_owner_dev");
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

  it("Fitness R Us shows its brand, both locations and the pay-per-session model; Club Sur is not pay-per-session", async () => {
    const a = await call(`/v1/public/join/${ORG_A}`);
    expect(a.status).toBe(200);
    const ja = await a.json();
    expect(ja.brand.name).toBe("Fitness R Us");
    expect(ja.brand.theme.logo_url).toBe("/brand/fitnessrus-logo.png");
    expect(ja.locations.map((l: { name: string }) => l.name).sort()).toEqual([
      "Demo Sede Bayamón",
      "Demo Sede San Juan",
    ]);
    expect(ja.model.pay_per_session).toBe(true);
    const jb = await (await call(`/v1/public/join/${ORG_B}`)).json();
    expect(jb.model.pay_per_session).toBe(false);
  });

  it("a visitor joins through the function and the session opens their portal", async () => {
    const info = await (await call(`/v1/public/join/${ORG_A}`)).json();
    const r = await call("/v1/public/join", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": "203.0.113.5" },
      body: JSON.stringify({
        org_id: ORG_A,
        location_id: info.locations[0].id,
        full_name: "Lucía Torres Demo",
        email: "lucia.netlify@demo.invalid",
        phone: null,
        birth_date: "1990-05-15",
        terms_version: "v2026-11",
        waiver_version: "v2026-11",
        accept_terms: true,
        accept_waiver: true,
        sms_reminders: false,
        sms_marketing: false,
        locale: "es",
      }),
    });
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j.session.persona.org).toBe("A");
    const me = await call("/v1/me", { headers: { authorization: `Bearer ${j.session.token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).role).toBe("member");
    const ana = await call("/v1/public/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_id: ORG_A,
        location_id: info.locations[0].id,
        full_name: "Otra Demo",
        email: "ana.110.a@demo.invalid",
        birth_date: "1990-05-15",
        terms_version: "v2026-11",
        waiver_version: "v2026-11",
        accept_terms: true,
        accept_waiver: true,
        locale: "es",
      }),
    });
    expect(ana.status).toBe(202);
    expect((await ana.json()).session).toBeNull();
  });
});
