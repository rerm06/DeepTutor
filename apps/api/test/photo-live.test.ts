import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DEFAULT_LIVE_MODEL, resolveLive, setLiveForTests } from "../src/modules/live.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let app: FastifyInstance;
let ward: string;

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
  method: "GET" | "PUT" | "DELETE" | "POST",
  url: string,
  payload?: unknown,
  ip = "203.0.113.9",
) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(claims ? { authorization: `Bearer ${await token(claims)}` } : {}),
      "x-nf-client-connection-ip": ip,
    },
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}
const as = (role: Role, org = t.fx.A) => t.claims(org, role);
const jpeg = (n = 3000) => {
  const b = Buffer.alloc(n, 9);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b.toString("base64");
};

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  const w = await t.admin.query<{ member_id: string }>(
    "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
    [t.fx.A.people.guardian],
  );
  ward = w.rows[0]?.member_id as string;
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});
afterEach(() => setLiveForTests(null, null));

describe("member photo routes", () => {
  it("the member uploads, reads back and removes their own photo", async () => {
    const put = await call(as("member"), "PUT", "/v1/me/photo", {
      mime: "image/jpeg",
      data: jpeg(),
      consent_version: "photo-v1",
    });
    expect(put.status).toBe(200);
    const got = await call(as("member"), "GET", "/v1/me/photo");
    expect(got.status).toBe(200);
    expect(got.body.mime).toBe("image/jpeg");
    expect(got.body.data).toBe(jpeg());
    expect((await call(as("member"), "DELETE", "/v1/me/photo")).body).toEqual({ removed: true });
    expect((await call(as("member"), "GET", "/v1/me/photo")).status).toBe(404);
  });

  it("front desk takes a member's photo; a trainer reads it but cannot write it", async () => {
    const put = await call(as("front_desk"), "PUT", `/v1/members/${ward}/photo`, {
      mime: "image/jpeg",
      data: jpeg(),
      consent_version: "photo-v1",
    });
    expect(put.status).toBe(200);
    expect((await call(as("trainer"), "GET", `/v1/members/${ward}/photo`)).status).toBe(200);
    const denied = await call(as("trainer"), "PUT", `/v1/members/${ward}/photo`, {
      mime: "image/jpeg",
      data: jpeg(),
      consent_version: "photo-v1",
    });
    expect(denied).toMatchObject({ status: 403, body: { error: "forbidden" } });
    // The accountant never sees photos: indistinguishable from none.
    expect((await call(as("accountant"), "GET", `/v1/members/${ward}/photo`)).status).toBe(404);
  });

  it("refuses bad images and missing consent with a precise code", async () => {
    const tiny = await call(as("member"), "PUT", "/v1/me/photo", {
      mime: "image/jpeg",
      data: jpeg(200),
      consent_version: "photo-v1",
    });
    expect(tiny).toMatchObject({ status: 400, body: { error: "invalid_photo" } });
    const png = await call(as("member"), "PUT", "/v1/me/photo", {
      mime: "image/webp",
      data: jpeg(),
      consent_version: "photo-v1",
    });
    expect(png).toMatchObject({ status: 400, body: { error: "invalid_photo" } });
    const noConsent = await call(as("member"), "PUT", "/v1/me/photo", {
      mime: "image/jpeg",
      data: jpeg(),
    });
    expect(noConsent.status).toBe(400);
  });
});

describe("Gemini Live ephemeral tokens", () => {
  it("resolves configuration from the environment; no key → disabled", () => {
    expect(resolveLive({})).toBeNull();
    expect(resolveLive({ GEMINI_API_KEY: "k" })).toEqual({
      apiKey: "k",
      model: DEFAULT_LIVE_MODEL,
      apiVersion: "v1beta",
    });
    expect(
      resolveLive({
        GEMINI_API_KEY: "k",
        GEMINI_LIVE_MODEL: "models/x-live",
        GEMINI_LIVE_API_VERSION: "v1alpha",
      }),
    ).toEqual({ apiKey: "k", model: "x-live", apiVersion: "v1alpha" });
    expect(resolveLive({ GEMINI_API_KEY: "k", GEMINI_LIVE_MODEL: "bad model/../" })).toBeNull();
  });

  it("503 live_unavailable without a key (the web app falls back to its local assistant)", async () => {
    setLiveForTests(null, {});
    const r = await call(as("front_desk"), "POST", "/v1/live/token", {});
    expect(r).toMatchObject({ status: 503, body: { error: "live_unavailable" } });
  });

  it("mints a one-use token locked to the model; the key never leaves the server", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    setLiveForTests(
      (async (url: string, init: RequestInit) => {
        sent = { url, init };
        return new Response(JSON.stringify({ name: "auth_tokens/abc123" }), { status: 200 });
      }) as unknown as typeof fetch,
      { GEMINI_API_KEY: "secret-key", GEMINI_LIVE_MODEL: "gemini-test-live" },
    );
    const r = await call(as("member"), "POST", "/v1/live/token", {});
    expect(r.status).toBe(200);
    expect(r.body.token).toBe("auth_tokens/abc123");
    expect(r.body.ws_url).toMatch(/BidiGenerateContentConstrained$/);
    expect(JSON.stringify(r.body)).not.toContain("secret-key");
    const s = sent as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    expect((s.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(String(s.init.body));
    expect(body).toMatchObject({
      uses: 1,
      bidiGenerateContentSetup: { model: "models/gemini-test-live" },
    });
  });

  it("upstream failure → 502, malformed token → 502", async () => {
    setLiveForTests((async () => new Response("no", { status: 500 })) as unknown as typeof fetch, {
      GEMINI_API_KEY: "k",
    });
    expect((await call(as("owner"), "POST", "/v1/live/token", {})).status).toBe(502);
    setLiveForTests(
      (async () =>
        new Response(JSON.stringify({ name: "x" }), { status: 200 })) as unknown as typeof fetch,
      { GEMINI_API_KEY: "k" },
    );
    expect((await call(as("owner"), "POST", "/v1/live/token", {})).status).toBe(502);
  });

  it("requires a session on the private route", async () => {
    expect((await call(null, "POST", "/v1/live/token", {})).status).toBe(401);
  });

  it("public route: open join page only, limited per address", async () => {
    setLiveForTests(
      (async () =>
        new Response(JSON.stringify({ name: "auth_tokens/pub" }), {
          status: 200,
        })) as unknown as typeof fetch,
      { GEMINI_API_KEY: "k" },
    );
    const unknown = await call(
      null,
      "POST",
      "/v1/public/live/token",
      {
        org_id: "00000000-0000-4000-8000-00000000abcd",
      },
      "198.51.100.1",
    );
    expect(unknown.status).toBe(404);
    const ok = await call(
      null,
      "POST",
      "/v1/public/live/token",
      { org_id: t.fx.A.orgId },
      "198.51.100.2",
    );
    expect(ok.status).toBe(200);
    let last = 200;
    for (let i = 0; i < 7; i++)
      last = (
        await call(null, "POST", "/v1/public/live/token", { org_id: t.fx.A.orgId }, "198.51.100.3")
      ).status;
    expect(last).toBe(429);
  });
});
