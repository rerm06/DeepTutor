import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";
let t: TestDb;
let app: FastifyInstance;
let ip = 0;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
async function call(
  claims: Claims | null,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  bearer?: string,
) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(claims ? { authorization: `Bearer ${await token(claims)}` } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "x-nf-client-connection-ip": `203.0.113.${(ip++ % 200) + 1}`,
    },
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}
const as = (role: Role, org = t.fx.A) => t.claims(org, role);

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("owner creates an owner account; the new owner signs in", () => {
  it("full flow: create → must change → change → session works → refresh rotates", async () => {
    const created = await call(as("owner"), "POST", "/v1/staff/accounts", {
      email: "Nueva.Duena@Ejemplo.com",
      full_name: "Nueva Dueña",
      role: "owner",
      password: "Password",
    });
    expect(created).toMatchObject({ status: 201, body: { must_change: true } });
    const again = await call(as("owner"), "POST", "/v1/staff/accounts", {
      email: "nueva.duena@ejemplo.com",
      full_name: "Otra",
      role: "owner",
      password: "Password",
    });
    expect(again).toMatchObject({ status: 409, body: { error: "account_exists" } });

    const first = await call(null, "POST", "/v1/public/auth/password", {
      email: "nueva.duena@ejemplo.com",
      password: "Password",
    });
    expect(first.body).toEqual({ must_change: true });
    const weak = await call(null, "POST", "/v1/public/auth/password/change", {
      email: "nueva.duena@ejemplo.com",
      password: "Password",
      new_password: "Password",
    });
    expect(weak).toMatchObject({ status: 400, body: { error: "weak_password" } });
    const ok = await call(null, "POST", "/v1/public/auth/password/change", {
      email: "nueva.duena@ejemplo.com",
      password: "Password",
      new_password: "Gimnasio-Seguro-2026",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.session.persona).toMatchObject({
      role: "owner",
      display_name: "Nueva Dueña",
      org: "A",
    });
    // The access token works on owner-only data.
    const team = await call(null, "GET", "/v1/staff/accounts", undefined, ok.body.session.token);
    expect(team.status).toBe(200);
    expect(
      team.body.data.some((r: { email: string }) => r.email === "nueva.duena@ejemplo.com"),
    ).toBe(true);
    // Refresh rotates.
    const r1 = await call(null, "POST", "/v1/public/session/refresh", {
      refresh: ok.body.session.refresh,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.session.refresh).not.toBe(ok.body.session.refresh);
    const replay = await call(null, "POST", "/v1/public/session/refresh", {
      refresh: ok.body.session.refresh,
    });
    expect(replay.status).toBe(401);
  });

  it("wrong password → 401 invalid_credentials; non-owners cannot create or list accounts", async () => {
    const bad = await call(null, "POST", "/v1/public/auth/password", {
      email: "nueva.duena@ejemplo.com",
      password: "no-es-esta-123",
    });
    expect(bad).toMatchObject({ status: 401, body: { error: "invalid_credentials" } });
    expect((await call(as("location_manager"), "GET", "/v1/staff/accounts")).status).toBe(403);
    const r = await call(as("front_desk"), "POST", "/v1/staff/accounts", {
      email: "x@ejemplo.com",
      full_name: "X Y",
      role: "owner",
      password: "Password",
    });
    expect(r.status).toBe(403);
  });

  it("validation: location roles need a location; short initial password refused", async () => {
    const noLoc = await call(as("owner"), "POST", "/v1/staff/accounts", {
      email: "recep@ejemplo.com",
      full_name: "Recep Uno",
      role: "front_desk",
      password: "Password",
    });
    expect(noLoc).toMatchObject({ status: 400, body: { error: "location_required" } });
    const short = await call(as("owner"), "POST", "/v1/staff/accounts", {
      email: "corta@ejemplo.com",
      full_name: "Corta",
      role: "owner",
      password: "abc",
    });
    expect(short.status).toBe(400);
  });
});

describe("role switching, protected account, production join (0027/0028)", () => {
  it("a person with several roles switches role and gets a session for it", async () => {
    await call(as("owner"), "POST", "/v1/staff/accounts", {
      email: "multi@ejemplo.com",
      full_name: "Multi Rol",
      role: "owner",
      password: "Password",
    });
    const p = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.person WHERE email = 'multi@ejemplo.com'",
    );
    const person = p.rows[0]?.id as string;
    const fd = await t.admin.query<{ id: string }>(
      "INSERT INTO app.staff_member (org_id, person_id, role, display_name) VALUES ($1, $2, 'front_desk', 'Multi Rol') RETURNING id",
      [t.fx.A.orgId, person],
    );
    await t.admin.query(
      "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1, $2, $3)",
      [t.fx.A.orgId, fd.rows[0]?.id, t.fx.A.locations[0]],
    );
    const claims = t.claims(t.fx.A, "owner", person);
    const roles = await call(claims, "GET", "/v1/auth/roles");
    expect(roles.body).toEqual({ data: ["owner", "front_desk"], current: "owner" });
    const sw = await call(claims, "POST", "/v1/auth/switch", { role: "front_desk" });
    expect(sw.body.session.persona.role).toBe("front_desk");
    const kiosk = await call(
      null,
      "GET",
      `/v1/door/kiosk/${t.fx.A.locations[0]}`,
      undefined,
      sw.body.session.token,
    );
    expect(kiosk.status).toBe(200);
    expect((await call(claims, "POST", "/v1/auth/switch", { role: "chef" })).status).toBe(403);
  });

  it("owner keeps an account's password valid (no forced change); protected accounts refuse it", async () => {
    const list = await call(as("owner"), "GET", "/v1/staff/accounts");
    const multi = list.body.data.find(
      (a: { email: string; role: string }) => a.email === "multi@ejemplo.com" && a.role === "owner",
    );
    const off = await call(
      as("owner"),
      "PUT",
      `/v1/staff/accounts/${multi.staff_id}/change-required`,
      { required: false },
    );
    expect(off.body).toEqual({ required: false });
    const login = await call(null, "POST", "/v1/public/auth/password", {
      email: "multi@ejemplo.com",
      password: "Password",
    });
    expect(login.body.session.persona.role).toBe("owner");
    await t.admin.query(
      "INSERT INTO app_private.protected_person (person_id) SELECT id FROM app.person WHERE email = 'multi@ejemplo.com'",
    );
    const blocked = await call(
      as("owner"),
      "PUT",
      `/v1/staff/accounts/${multi.staff_id}/change-required`,
      { required: true },
    );
    expect(blocked).toMatchObject({ status: 403, body: { error: "protected_account" } });
    const again = await call(as("owner"), "GET", "/v1/staff/accounts");
    expect(
      again.body.data.find((a: { email: string }) => a.email === "multi@ejemplo.com").protected,
    ).toBe(true);
  });
});
