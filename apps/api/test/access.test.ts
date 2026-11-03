import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseDeviceAuth } from "../src/modules/access.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";
// Fixture camera gateway of org A (packages/db/src/fixtures/access.ts).
const DEVICE = "d0000000-0000-4000-8000-00000000000a";
const DEVICE_SECRET = "a1".repeat(24);

let t: TestDb;
let demo: FastifyInstance;
let prod: FastifyInstance;
let member0Email = "";

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
  app: FastifyInstance,
  claims: Claims | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(claims ? { authorization: `Bearer ${await token(claims)}` } : {}),
      "x-nf-client-connection-ip": "198.51.100.77",
      ...headers,
    },
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}
const as = (role: Role, org = t.fx.A) => t.claims(org, role);

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
  const r = await t.admin.query<{ email: string }>(
    "SELECT p.email FROM app.person p JOIN app.member m ON m.person_id = p.id WHERE m.id = $1",
    [t.fx.A.members[0]],
  );
  member0Email = r.rows[0]?.email as string;
}, 60_000);
afterAll(async () => {
  await demo?.close();
  await prod?.close();
  await t?.drop();
});

describe("door QR through the API", () => {
  it("kiosk codes → member enters and leaves; the kiosk sees who is inside and the activity", async () => {
    const k = await call(prod, as("front_desk"), "GET", `/v1/door/kiosk/${t.fx.A.locations[0]}`);
    expect(k.status).toBe(200);
    const byDir = Object.fromEntries(
      (k.body.data as { direction: string; token: string }[]).map((x) => [x.direction, x.token]),
    );
    const enter = await call(prod, as("member"), "POST", "/v1/me/door", { token: byDir.in });
    expect(enter.body).toMatchObject({ result: "allowed", direction: "in" });
    const inside = await call(
      prod,
      as("front_desk"),
      "GET",
      `/v1/door/inside/${t.fx.A.locations[0]}`,
    );
    expect(inside.body.data.map((x: { member_id: string }) => x.member_id)).toContain(
      t.fx.A.members[0],
    );
    const exit = await call(prod, as("member"), "POST", "/v1/me/door", { token: byDir.out });
    expect(exit.body.result).toBe("checked_out");
    const act = await call(
      prod,
      as("front_desk"),
      "GET",
      `/v1/door/activity/${t.fx.A.locations[0]}`,
    );
    expect(act.body.data.slice(0, 2).map((x: { kind: string }) => x.kind)).toEqual(["out", "in"]);
    expect(
      (await call(prod, as("trainer"), "GET", `/v1/door/kiosk/${t.fx.A.locations[0]}`)).status,
    ).toBe(403);
  });

  it("front desk checks out by hand; 409 when the member is not inside", async () => {
    const r = await call(prod, as("front_desk"), "POST", "/v1/door/check-out", {
      location_id: t.fx.A.locations[0],
      member_id: t.fx.A.members[0],
    });
    expect(r).toMatchObject({ status: 409, body: { error: "not_inside" } });
  });
});

describe("sign-in code", () => {
  it("DEMO MODE: the code is shown, verify signs the member in, a wrong code is refused", async () => {
    const s = await call(demo, null, "POST", "/v1/public/login/start", {
      org_id: t.fx.A.orgId,
      email: member0Email,
    });
    expect(s.status).toBe(200);
    expect(s.body.demo_code).toMatch(/^[0-9]{6}$/);
    const bad = await call(demo, null, "POST", "/v1/public/login/verify", {
      org_id: t.fx.A.orgId,
      email: member0Email,
      code: s.body.demo_code === "123456" ? "654321" : "123456",
    });
    expect(bad).toMatchObject({ status: 400, body: { error: "invalid_code" } });
    const ok = await call(demo, null, "POST", "/v1/public/login/verify", {
      org_id: t.fx.A.orgId,
      email: member0Email,
      code: s.body.demo_code,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.session.persona.role).toBe("member");
    // The issued token works: the member reads their own consent state.
    const me = await demo.inject({
      method: "GET",
      url: "/v1/me/biometric-consent",
      headers: { authorization: `Bearer ${ok.body.session.token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it("unknown e-mail looks the same (no code); outside the demo there is no delivery channel → 503", async () => {
    const s = await call(demo, null, "POST", "/v1/public/login/start", {
      org_id: t.fx.A.orgId,
      email: "nadie@demo.invalid",
    });
    expect(s.body).toMatchObject({ sent: true, demo_code: null });
    const p = await call(prod, null, "POST", "/v1/public/login/start", {
      org_id: t.fx.A.orgId,
      email: member0Email,
    });
    expect(p).toMatchObject({ status: 503, body: { error: "login_delivery_unavailable" } });
  });
});

describe("face access", () => {
  const dev = { authorization: `Device ${DEVICE}:${DEVICE_SECRET}` };

  it("parses the device header strictly", () => {
    expect(parseDeviceAuth(`Device ${DEVICE}:${DEVICE_SECRET}`)).toEqual([DEVICE, DEVICE_SECRET]);
    expect(parseDeviceAuth(`Bearer ${DEVICE}:${DEVICE_SECRET}`)).toBeNull();
    expect(parseDeviceAuth(`Device ${DEVICE}:short`)).toBeNull();
  });

  it("device without a valid secret → 401; with face access off → empty enrolment", async () => {
    expect((await call(prod, null, "GET", "/v1/public/device/enrolment")).status).toBe(401);
    const bad = await call(prod, null, "GET", "/v1/public/device/enrolment", undefined, {
      authorization: `Device ${DEVICE}:${"b2".repeat(24)}`,
    });
    expect(bad.status).toBe(401);
    const off = await call(prod, null, "GET", "/v1/public/device/enrolment", undefined, dev);
    expect(off.body).toMatchObject({ enabled: false, members: [] });
  });

  it("owner enables the location; recognition enters; the review queue and devices are listed", async () => {
    expect(
      (
        await call(prod, as("location_manager"), "PUT", "/v1/door/face-access", {
          location_id: t.fx.A.locations[1],
          on: true,
        })
      ).status,
    ).toBe(403);
    const on = await call(prod, as("owner"), "PUT", "/v1/door/face-access", {
      location_id: t.fx.A.locations[1],
      on: true,
    });
    expect(on.body.face_access).toBe(true);
    const enr = await call(prod, null, "GET", "/v1/public/device/enrolment", undefined, dev);
    expect(enr.body.members.map((m: { member_id: string }) => m.member_id)).toEqual([
      t.fx.A.members[1],
    ]);
    const rec = await call(
      prod,
      null,
      "POST",
      "/v1/public/device/recognitions",
      { member_id: t.fx.A.members[1], score: 0.91 },
      dev,
    );
    expect(rec.body.outcome).toBe("checked_in");
    const events = await call(
      prod,
      as("owner"),
      "GET",
      `/v1/door/face-events?location_id=${t.fx.A.locations[1]}`,
    );
    expect(events.body.data[0].outcome).toBe("review"); // review first
    const reviewed = await call(
      prod,
      as("owner"),
      "POST",
      `/v1/door/face-events/${events.body.data[0].id}/review`,
      {
        accept: true,
      },
    );
    expect(reviewed.status).toBe(200);
    const devices = await call(prod, as("owner"), "GET", "/v1/door/devices");
    expect(JSON.stringify(devices.body)).not.toContain("secret");
  });

  it("creating a device returns its secret once", async () => {
    const r = await call(prod, as("owner"), "POST", "/v1/door/devices", {
      location_id: t.fx.A.locations[0],
      name: "Cámara recepción",
      direction: "both",
    });
    expect(r.status).toBe(201);
    expect(r.body.secret).toMatch(/^[0-9a-f]{48}$/);
    const enr = await call(prod, null, "GET", "/v1/public/device/enrolment", undefined, {
      authorization: `Device ${r.body.id}:${r.body.secret}`,
    });
    expect(enr.status).toBe(200);
  });

  it("the member gives and withdraws their own consent", async () => {
    const m2 = await t.admin.query<{ person_id: string }>(
      "SELECT person_id FROM app.member WHERE id = $1",
      [t.fx.A.members[1]],
    );
    const claims = t.claims(t.fx.A, "member", m2.rows[0]?.person_id);
    expect((await call(prod, claims, "GET", "/v1/me/biometric-consent")).body).toMatchObject({
      active: true,
      location_enabled: true,
    });
    await call(prod, claims, "PUT", "/v1/me/biometric-consent", { grant: false });
    expect((await call(prod, claims, "GET", "/v1/me/biometric-consent")).body.active).toBe(false);
    expect(
      (await call(prod, as("owner"), "PUT", "/v1/me/biometric-consent", { grant: true })).status,
    ).toBe(403);
  });
});
