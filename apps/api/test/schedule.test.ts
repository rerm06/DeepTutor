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
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const headers = claims ? { authorization: `Bearer ${await token(claims)}` } : {};
  return app.inject({ method, url: `/v1${url}`, headers, payload: payload as object });
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

const A = () => t.fx.A;
const fd = () => t.claims(t.fx.A, "front_desk");
let seq = 0;
async function newMember(status = "active", loc = t.fx.A.locations[0]) {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`api.sched${seq}@demo.invalid`],
  );
  const personId = p.rows[0]?.id as string;
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [t.fx.A.orgId, personId, loc, `Demo Api ${seq}`, status],
  );
  return { id: m.rows[0]?.id as string, claims: t.claims(t.fx.A, "member", personId) };
}
async function classTypeId() {
  const r = await t.admin.query("SELECT id FROM app.class_type WHERE org_id = $1 LIMIT 1", [
    t.fx.A.orgId,
  ]);
  return r.rows[0].id as string;
}
const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000);

async function createSession(capacity = 1, days = 5) {
  const r = await call(t.claims(A(), "owner"), "POST", "/schedule/sessions", {
    location_id: A().locations[0],
    class_type_id: await classTypeId(),
    instructor_id: null,
    room: "Salon 3",
    starts_at: inDays(days).toISOString(),
    ends_at: inDays(days, 1).toISOString(),
    capacity,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}

describe("auth and input", () => {
  it("refuses calls without a token", async () => {
    expect((await call(null, "GET", "/schedule/sessions")).statusCode).toBe(401);
  });

  it("strict bodies: unknown fields, both member and token, and bad ranges are 400", async () => {
    const loc = A().locations[0];
    for (const [url, body] of [
      ["/schedule/check-ins", { location_id: loc, member_id: A().members[0], token: "v1.x" }],
      ["/schedule/check-ins", { location_id: loc }],
      ["/schedule/check-ins", { location_id: loc, token: "has space" }],
      ["/schedule/bookings", { session_id: loc, member_id: A().members[0], status: "attended" }],
      ["/schedule/class-types", { name: "Visita {{x}}" }],
      ["/schedule/class-types", { name: "Spin", org_id: t.fx.B.orgId }],
    ] as const) {
      const r = await call(fd(), "POST", url, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const r = await call(
      fd(),
      "GET",
      "/schedule/sessions?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z",
    );
    expect(r.statusCode).toBe(400);
  });
});

describe("sessions and bookings", () => {
  it("owner creates a session; the member books; a double booking is 409; the next one waitlists", async () => {
    const s = await createSession(1);
    const m = await newMember();
    const b1 = await call(m.claims, "POST", "/schedule/bookings", {
      session_id: s,
      member_id: m.id,
    });
    expect(b1.statusCode).toBe(201);
    expect(b1.json()).toMatchObject({ status: "booked", waitlist_position: null });
    const again = await call(m.claims, "POST", "/schedule/bookings", {
      session_id: s,
      member_id: m.id,
    });
    expect(again.statusCode).toBe(409);
    const w = await newMember();
    const b2 = await call(fd(), "POST", "/schedule/bookings", { session_id: s, member_id: w.id });
    expect(b2.json()).toMatchObject({ status: "waitlisted", waitlist_position: 1 });

    const list = await call(m.claims, "GET", "/schedule/sessions");
    const row = list.json().data.find((x: { id: string }) => x.id === s);
    expect(row).toMatchObject({ booked: 1, waitlisted: 1, capacity: 1 });

    // Cancelling the seat promotes the waitlisted booking.
    const c = await call(m.claims, "POST", `/schedule/bookings/${b1.json().id}/cancel`);
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({
      status: "cancelled",
      late_cancel: false,
      promoted_booking_id: b2.json().id,
    });
    const mine = await call(w.claims, "GET", `/schedule/bookings?member_id=${w.id}`);
    expect(mine.json().data[0]).toMatchObject({ status: "booked", waitlist_position: null });
  });

  it("front desk cannot create sessions (403) and a member cannot book someone else (403)", async () => {
    const r = await call(fd(), "POST", "/schedule/sessions", {
      location_id: A().locations[0],
      class_type_id: await classTypeId(),
      starts_at: inDays(6).toISOString(),
      ends_at: inDays(6, 1).toISOString(),
      capacity: 5,
    });
    expect(r.statusCode).toBe(403);
    const s = await createSession(5, 7);
    const other = await newMember();
    const b = await call(t.claims(A(), "member"), "POST", "/schedule/bookings", {
      session_id: s,
      member_id: other.id,
    });
    expect(b.statusCode).toBe(403);
  });

  it("another org's session is invisible and cannot be booked", async () => {
    const s = await createSession(5, 8);
    const list = await call(t.claims(t.fx.B, "owner"), "GET", "/schedule/sessions");
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((x: { id: string }) => x.id)).not.toContain(s);
    const b = await call(t.claims(t.fx.B, "front_desk"), "POST", "/schedule/bookings", {
      session_id: s,
      member_id: t.fx.B.members[0],
    });
    expect(b.statusCode).toBe(403);
    const roster = await call(t.claims(t.fx.B, "owner"), "GET", `/schedule/sessions/${s}/roster`);
    expect(roster.statusCode).toBe(403);
  });

  it("trainer reads the roster of the session they teach and marks attendance", async () => {
    const trainer = await t.admin.query(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND role = 'trainer' AND person_id = $2",
      [A().orgId, A().people.trainer],
    );
    const s = await t.admin.query(
      `INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, starts_at, ends_at, capacity, created_by)
       VALUES ($1,$2,$3,$4, now() - interval '5 minutes', now() + interval '40 minutes', 5, $5) RETURNING id`,
      [A().orgId, A().locations[0], await classTypeId(), trainer.rows[0].id, A().people.owner],
    );
    const m = await newMember();
    const b = await t.admin.query(
      "INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by) VALUES ($1,$2,$3,'booked',$4) RETURNING id",
      [A().orgId, s.rows[0].id, m.id, A().people.front_desk],
    );
    const tr = t.claims(A(), "trainer");
    const roster = await call(tr, "GET", `/schedule/sessions/${s.rows[0].id}/roster`);
    expect(roster.json().data).toHaveLength(1);
    const mark = await call(tr, "POST", `/schedule/bookings/${b.rows[0].id}/attendance`, {
      status: "attended",
    });
    expect(mark.json()).toEqual({ id: b.rows[0].id, status: "attended" });
    const bad = await call(tr, "POST", `/schedule/bookings/${b.rows[0].id}/attendance`, {
      status: "booked",
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("check-in", () => {
  it("member fetches the QR token; front desk scans it → allowed", async () => {
    const m = await newMember();
    const q = await call(m.claims, "GET", `/schedule/qr-token?member_id=${m.id}`);
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({ window_seconds: 30 });
    const r = await call(fd(), "POST", "/schedule/check-ins", {
      location_id: A().locations[0],
      token: q.json().token,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      result: "allowed",
      reason: "active",
      member_id: m.id,
      full_name: expect.stringContaining("Demo Api"),
    });
  });

  it("staff cannot fetch a member's token (403)", async () => {
    const r = await call(fd(), "GET", `/schedule/qr-token?member_id=${A().members[0]}`);
    expect(r.statusCode).toBe(403);
  });

  it("an expired window is denied (recorded as expired_token)", async () => {
    const m = await newMember();
    const old = await t.admin.query(
      "SELECT app.qr_token_for($1, $2, app.qr_window(clock_timestamp()) - 3) AS t",
      [A().orgId, m.id],
    );
    const r = await call(fd(), "POST", "/schedule/check-ins", {
      location_id: A().locations[0],
      token: old.rows[0].t,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ result: "denied", reason: "expired_token", member_id: m.id });
    const hist = await call(fd(), "GET", `/schedule/check-ins?member_id=${m.id}`);
    expect(hist.json().data).toEqual([
      expect.objectContaining({ result: "denied", reason: "expired_token", source: "qr" }),
    ]);
  });

  it.each([
    ["frozen", "denied", "frozen"],
    ["cancelled", "denied", "cancelled"],
    ["lead", "denied", "lead"],
    ["past_due", "allowed", "past_due"],
  ])("front desk check-in of a %s member → %s (%s)", async (status, result, reason) => {
    const m = await newMember(status);
    const r = await call(fd(), "POST", "/schedule/check-ins", {
      location_id: A().locations[0],
      member_id: m.id,
    });
    expect(r.json()).toMatchObject({ result, reason });
  });

  it("trainer and other-location front desk cannot check in (403)", async () => {
    const m = await newMember();
    expect(
      (
        await call(t.claims(A(), "trainer"), "POST", "/schedule/check-ins", {
          location_id: A().locations[0],
          member_id: m.id,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(fd(), "POST", "/schedule/check-ins", {
          location_id: A().locations[1],
          member_id: m.id,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("policy and appointments", () => {
  it("manager cannot switch deny_past_due (403); owner can", async () => {
    const body = { cancel_window_hours: 12, no_show_penalty: false, deny_past_due: true };
    const url = `/schedule/location-policies/${A().locations[0]}`;
    expect((await call(t.claims(A(), "location_manager"), "PUT", url, body)).statusCode).toBe(403);
    const ok = await call(t.claims(A(), "owner"), "PUT", url, body);
    expect(ok.statusCode).toBe(200);
    await call(t.claims(A(), "owner"), "PUT", url, { ...body, deny_past_due: false });
  });

  it("front desk books personal training and sees it; overlap is 409", async () => {
    const staff = await call(fd(), "GET", `/schedule/staff?location_id=${A().locations[0]}`);
    const trainer = staff.json().data.find((s: { role: string }) => s.role === "trainer");
    const body = {
      kind: "personal_training",
      staff_member_id: trainer.id,
      member_id: A().members[0],
      location_id: A().locations[0],
      starts_at: inDays(9).toISOString(),
      ends_at: inDays(9, 1).toISOString(),
    };
    const r = await call(fd(), "POST", "/schedule/appointments", body);
    expect(r.statusCode).toBe(201);
    expect((await call(fd(), "POST", "/schedule/appointments", body)).statusCode).toBe(409);
    const list = await call(
      fd(),
      "GET",
      `/schedule/appointments?location_id=${A().locations[0]}&from=${inDays(8).toISOString()}&to=${inDays(10).toISOString()}`,
    );
    expect(list.json().data.map((a: { id: string }) => a.id)).toContain(r.json().id);
  });

  it("my-members is for members and guardians only", async () => {
    expect((await call(fd(), "GET", "/schedule/my-members")).statusCode).toBe(403);
    const g = await call(t.claims(A(), "guardian"), "GET", "/schedule/my-members");
    expect(g.json().data.map((m: { full_name: string }) => m.full_name)).toEqual(["Demo ward A"]);
  });
});
