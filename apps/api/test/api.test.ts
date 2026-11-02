import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let app: FastifyInstance;

async function token(claims: Claims, secret = SECRET): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}
const auth = async (claims: Claims) => ({ authorization: `Bearer ${await token(claims)}` });

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("authentication", () => {
  it("health is public", async () => {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });
  it("rejects a missing token", async () => {
    expect((await app.inject({ url: "/v1/me" })).statusCode).toBe(401);
  });
  it("rejects a token signed with another secret", async () => {
    const bad = await token(
      t.claims(t.fx.A, "owner"),
      "another-secret-that-is-also-longer-than-32-chars",
    );
    expect(
      (await app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${bad}` } })).statusCode,
    ).toBe(401);
  });
  it("rejects a token whose role is unknown", async () => {
    const forged = await new SignJWT({ ...t.claims(t.fx.A, "owner"), app_role: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET));
    expect(
      (await app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${forged}` } }))
        .statusCode,
    ).toBe(401);
  });
});

describe("tenancy through the API", () => {
  it("/v1/me returns the caller's organisation only", async () => {
    const r = await app.inject({
      url: "/v1/me",
      headers: await auth(t.claims(t.fx.A, "front_desk")),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().organization.id).toBe(t.fx.A.orgId);
  });

  it("front desk registers a member at its own location", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: {
        email: "nuevo@demo.invalid",
        full_name: "Demo Nuevo",
        home_location_id: t.fx.A.locations[0],
      },
    });
    expect(r.statusCode).toBe(201);
  });

  it("front desk cannot register at another organisation's location (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: {
        email: "cross@demo.invalid",
        full_name: "X",
        home_location_id: t.fx.B.locations[0],
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("the accountant cannot register members (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: await auth(t.claims(t.fx.A, "accountant")),
      payload: {
        email: "acct@demo.invalid",
        full_name: "X",
        home_location_id: t.fx.A.locations[0],
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("invalid input is rejected with 400 before touching the database", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: await auth(t.claims(t.fx.A, "front_desk")),
      payload: { email: "not-an-email", full_name: "", home_location_id: "nope" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("another organisation's member is indistinguishable from a missing one (404)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/members/${t.fx.B.members[0]}`,
      headers: await auth(t.claims(t.fx.A, "owner")),
      payload: { status: "cancelled" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("status change is audited", async () => {
    const h = await auth(t.claims(t.fx.A, "owner"));
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/members/${t.fx.A.members[1]}`,
      headers: h,
      payload: { status: "frozen" },
    });
    expect(r.statusCode).toBe(200);
    const log = await app.inject({ url: "/v1/audit-log", headers: h });
    expect(log.json().data.some((e: { action: string }) => e.action === "member.status")).toBe(
      true,
    );
  });

  it("a member listing returns only themself", async () => {
    const r = await app.inject({
      url: "/v1/members",
      headers: await auth(t.claims(t.fx.A, "member")),
    });
    expect(r.json().data).toHaveLength(1);
  });
});
