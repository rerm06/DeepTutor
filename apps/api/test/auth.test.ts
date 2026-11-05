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
