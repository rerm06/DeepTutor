import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  addDays,
  computeStreak,
  goalPct,
  isoWeekStart,
  planProgress,
  planWeeks,
  weekTotals,
} from "../src/modules/portal.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";
const TZ = "America/Puerto_Rico"; // UTC-4 all year (no DST)

let t: TestDb;
let app: FastifyInstance;
let ward: string;
let ana: { person: string; member: string };
let today: string;
let classType: string;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
async function call(claims: Claims, method: "GET" | "PUT", url: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${await token(claims)}` },
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: res.statusCode, body: res.json() };
}
const as = (role: Role, org = t.fx.A) => t.claims(org, role);
const anaClaims = () => t.claims(t.fx.A, "member", ana.person);

/** A timestamp at local wall-clock time `hhmm` on `today + offset` in the location's zone. */
const localAt = (offset: number, hhmm: string) =>
  `((('${today}'::date + ${offset}) + time '${hhmm}') AT TIME ZONE '${TZ}')`;

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  const w = await t.admin.query<{ member_id: string }>(
    "SELECT member_id FROM app.guardian_link WHERE guardian_person_id = $1",
    [t.fx.A.people.guardian],
  );
  ward = w.rows[0]?.member_id as string;
  // A dedicated member with no fixture history, so the streak and week math is exact.
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ('portal.ana@demo.invalid') RETURNING id",
  );
  const m = await t.admin.query<{ id: string }>(
    `INSERT INTO app.member (org_id, person_id, home_location_id, full_name, member_no, status)
     VALUES ($1, $2, $3, 'Ana Portal Demo', 'A-9001', 'active') RETURNING id`,
    [t.fx.A.orgId, p.rows[0]?.id, t.fx.A.locations[0]],
  );
  ana = { person: p.rows[0]?.id as string, member: m.rows[0]?.id as string };
  const d = await t.admin.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS d`,
  );
  today = d.rows[0]?.d as string;
  const ct = await t.admin.query<{ id: string }>(
    "INSERT INTO app.class_type (org_id, name, duration_min) VALUES ($1, 'Portal Funcional', 45) RETURNING id",
    [t.fx.A.orgId],
  );
  classType = ct.rows[0]?.id as string;
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

async function checkIn(member: string, at: string, result: "allowed" | "denied" = "allowed") {
  await t.admin.query(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by, at)
     VALUES ($1, $2, $3, 'front_desk', $4, $5, $6, ${at})`,
    [
      t.fx.A.orgId,
      t.fx.A.locations[0],
      member,
      result,
      result === "allowed" ? "active" : "frozen",
      t.fx.A.people.front_desk,
    ],
  );
}
async function session(start: string, minutes: number, cancelled = false): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    `INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by, cancelled)
     VALUES ($1, $2, $3, 'Sala Portal', ${start}, ${start} + make_interval(mins => $4), 10, $5, $6) RETURNING id`,
    [t.fx.A.orgId, t.fx.A.locations[0], classType, minutes, t.fx.A.people.owner, cancelled],
  );
  return r.rows[0]?.id as string;
}
async function book(sessionId: string, member: string, status: string): Promise<string> {
  const r = await t.admin.query<{ id: string }>(
    `INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by, cancelled_at)
     VALUES ($1, $2, $3, $4::app.booking_status, $5, CASE WHEN $4::text = 'cancelled' THEN now() END) RETURNING id`,
    [t.fx.A.orgId, sessionId, member, status, t.fx.A.people.owner],
  );
  return r.rows[0]?.id as string;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────────────────
describe("portal math (pure)", () => {
  it("ISO weeks start on Monday; day arithmetic crosses months and years", () => {
    expect(isoWeekStart("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(isoWeekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(isoWeekStart("2027-01-01")).toBe("2026-12-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("streak ends today or yesterday; a gap of one day breaks it", () => {
    const s = (days: string[], d: string) => computeStreak(new Set(days), d);
    expect(s(["2026-11-02", "2026-11-01", "2026-10-31"], "2026-11-02").days).toBe(3);
    expect(s(["2026-11-01", "2026-10-31"], "2026-11-02").days).toBe(2); // ends yesterday
    expect(s(["2026-10-31", "2026-10-30"], "2026-11-02").days).toBe(0); // ended two days ago
    expect(s(["2026-11-02", "2026-10-31"], "2026-11-02").days).toBe(1);
    expect(s([], "2026-11-02")).toEqual({
      days: 0,
      last7: [false, false, false, false, false, false, false],
    });
    expect(s(["2026-10-27", "2026-11-02"], "2026-11-02").last7).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("week totals: check-in days, class minutes, 60 estimated minutes for a visit without a class", () => {
    const rows = [
      { d: "2026-11-01", checkin: true, classes: 1, minutes: 50 }, // previous week (Sunday)
      { d: "2026-11-02", checkin: true, classes: 1, minutes: 45 },
      { d: "2026-11-03", checkin: true, classes: 0, minutes: 0 },
      { d: "2026-11-04", checkin: false, classes: 2, minutes: 90 },
    ];
    expect(weekTotals(rows, "2026-11-02")).toEqual({
      trainings: 2,
      classes_attended: 3,
      active_minutes: 195,
    });
    expect(goalPct(2, 4)).toBe(50);
    expect(goalPct(5, 4)).toBe(100);
    expect(goalPct(1, 3)).toBe(33);
  });

  it("training plan weeks come from the section headings; progress from the publication date", () => {
    const body = {
      sections: [
        { heading: "Semanas 1 y 2", items: ["a"] },
        { heading: "Semanas 7 y 8", items: ["b"] },
        { heading: "Notas 99", items: ["c"] },
      ],
    };
    expect(planWeeks(body)).toBe(8);
    expect(planWeeks({ sections: [{ heading: "Week 4", items: [] }] })).toBe(4);
    expect(planWeeks({ sections: [{ heading: "Estructura", items: [] }] })).toBeNull();
    expect(planWeeks(null)).toBeNull();
    expect(planProgress("2026-10-18", "2026-11-02", 8)).toEqual({ week: 3, weeks: 8, pct: 27 });
    expect(planProgress("2026-01-01", "2026-11-02", 8)).toEqual({ week: 8, weeks: 8, pct: 100 });
    expect(planProgress("2026-10-18", "2026-11-02", null)).toEqual({
      week: null,
      weeks: null,
      pct: 0,
    });
  });
});

// ── GET /v1/me/home ─────────────────────────────────────────────────────────────────────────────────────────
describe("GET /v1/me/home", () => {
  it("returns EXACTLY the contract keys", async () => {
    const r = await call(as("member"), "GET", "/v1/me/home");
    expect(r.status).toBe(200);
    const b = r.body;
    expect(Object.keys(b).sort()).toEqual(
      [
        "challenge",
        "coach",
        "documents",
        "member",
        "membership",
        "next_class",
        "programs",
        "streak",
        "week",
      ].sort(),
    );
    expect(Object.keys(b.member).sort()).toEqual([
      "first_name",
      "id",
      "location_name",
      "member_no",
    ]);
    expect(Object.keys(b.membership).sort()).toEqual(
      ["credits_left", "expires_on", "kind", "name", "renews_on", "status"].sort(),
    );
    expect(Object.keys(b.next_class).sort()).toEqual([
      "booking_id",
      "class_name",
      "room",
      "starts_at",
    ]);
    expect(Object.keys(b.streak).sort()).toEqual(["days", "last7"]);
    expect(b.streak.last7).toHaveLength(7);
    expect(Object.keys(b.week).sort()).toEqual(
      ["active_minutes", "classes_attended", "classes_booked", "goal", "pct", "trainings"].sort(),
    );
    expect(b.programs.length).toBeGreaterThan(0);
    for (const p of b.programs)
      expect(Object.keys(p).sort()).toEqual(["href", "id", "kind", "name", "pct", "week", "weeks"]);
    expect(Object.keys(b.challenge).sort()).toEqual(["ends_on", "id", "joined", "name", "perks"]);
    expect(Object.keys(b.coach)).toEqual(["enabled"]);
    expect(typeof b.documents).toBe("number");
    // Fixture members[0] of A: live monthly subscription, goal row of 3, the perked challenge it joined.
    expect(b.member).toMatchObject({
      id: t.fx.A.members[0],
      first_name: "Demo",
      location_name: "Demo A Sede 1",
    });
    expect(b.membership).toMatchObject({
      kind: "subscription",
      status: "active",
      credits_left: null,
    });
    expect(b.membership.renews_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.week.goal).toBe(3);
    expect(b.challenge).toMatchObject({
      name: "Reto Demo Noviembre A",
      joined: true,
      perks: ["Entrenamiento guiado", "Seguimiento de progreso"],
    });
    expect(b.challenge.ends_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.next_class.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    // 2 agreements (signup fixture) + 1 paid invoice (billing fixture).
    expect(b.documents).toBe(3);
  });

  it("a member without history gets defaults: no membership, no class, goal 4, empty programs", async () => {
    const r = await call(anaClaims(), "GET", "/v1/me/home");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      member: {
        id: ana.member,
        first_name: "Ana",
        member_no: "A-9001",
        location_name: "Demo A Sede 1",
      },
      membership: {
        kind: "none",
        name: null,
        status: "none",
        renews_on: null,
        credits_left: null,
        expires_on: null,
      },
      next_class: null,
      streak: { days: 0, last7: [false, false, false, false, false, false, false] },
      week: {
        goal: 4,
        trainings: 0,
        classes_booked: 0,
        classes_attended: 0,
        active_minutes: 0,
        pct: 0,
      },
      programs: [],
      coach: { enabled: false },
      documents: 0,
    });
  });

  it("streak and last7 use LOCAL days (home location zone), allowed check-ins only", async () => {
    // Local days: today 00:00:05; -1 noon; -2 at 23:59 (03:59 UTC on day -1); -3 10:00; -4 at 22:00 (02:00 UTC on
    // day -3). Day -5: only a DENIED attempt. UTC dates would give a streak of 2; local dates give 5.
    await checkIn(ana.member, localAt(0, "00:00:05"));
    await checkIn(ana.member, localAt(-1, "12:00"));
    await checkIn(ana.member, localAt(-2, "23:59"));
    await checkIn(ana.member, localAt(-3, "10:00"));
    await checkIn(ana.member, localAt(-4, "22:00"));
    await checkIn(ana.member, localAt(-5, "09:00"), "denied");
    await checkIn(ana.member, localAt(-6, "09:00"));
    const r = await call(anaClaims(), "GET", "/v1/me/home");
    expect(r.body.streak).toEqual({ days: 5, last7: [true, false, true, true, true, true, true] });
  });

  it("week: trainings this local ISO week, booked/attended classes, minutes and pct against the goal", async () => {
    // Today: an attended 45-minute class (plus today's check-in above); a no-show and a booking later this week
    // (if the week has room); a cancelled booking and a booking on a cancelled session never count.
    const attended = await session(localAt(0, "00:10"), 45);
    await book(attended, ana.member, "attended");
    const noShow = await session(localAt(0, "00:20"), 30);
    await book(noShow, ana.member, "no_show");
    const cancelledBooking = await session(localAt(0, "00:30"), 30);
    await book(cancelledBooking, ana.member, "cancelled");
    const cancelledSession = await session(localAt(0, "00:40"), 30, true);
    await book(cancelledSession, ana.member, "booked");
    // Last week's Sunday 23:30 local (03:30 UTC Monday): attended class that belongs to LAST week.
    const weekStart = isoWeekStart(today);
    const offsetToLastSunday =
      Math.round((Date.parse(weekStart) - Date.parse(today)) / 86_400_000) - 1;
    const lastSunday = await session(localAt(offsetToLastSunday, "23:30"), 25);
    await book(lastSunday, ana.member, "attended");

    const r = await call(anaClaims(), "GET", "/v1/me/home");
    // Expected from first principles: check-in days (0..-4, -6) inside [weekStart, today].
    const inWeek = [0, -1, -2, -3, -4, -6]
      .map((k) => addDays(today, k))
      .filter((d) => d >= weekStart);
    const trainings = inWeek.length;
    const minutes = 45 + 60 * (trainings - 1); // today has a class (45), the other check-in days 60 each
    expect(r.body.week).toEqual({
      goal: 4,
      trainings,
      classes_booked: 2,
      classes_attended: 1,
      active_minutes: minutes,
      pct: Math.min(100, Math.round((trainings / 4) * 100)),
    });
  });

  it("next_class: the earliest future 'booked' session, never a cancelled one", async () => {
    const early = await session("now() + interval '2 hours'", 30, true);
    await book(early, ana.member, "booked");
    const later = await session("now() + interval '3 hours'", 30);
    const id = await book(later, ana.member, "booked");
    const r = await call(anaClaims(), "GET", "/v1/me/home");
    expect(r.body.next_class).toMatchObject({
      booking_id: id,
      class_name: "Portal Funcional",
      room: "Sala Portal",
    });
  });

  it("programs: open circuit run with sets done / planned; published training plan by week", async () => {
    const b = await call(as("member"), "GET", "/v1/me/home");
    const plan = b.body.programs.find((p: { kind: string }) => p.kind === "training_plan");
    // Fixture plan: "Semana 1" heading, published 20 days ago → week 1 of 1, 100 %.
    expect(plan).toMatchObject({
      name: "Demo plan de fuerza inicial",
      week: 1,
      weeks: 1,
      pct: 100,
      href: "/me/health/plan",
    });
    const circuit = await t.admin.query<{ id: string; total: number }>(
      `SELECT c.id, (SELECT sum(sets)::int FROM app.circuit_step s WHERE s.circuit_id = c.id) AS total
         FROM app.circuit c WHERE c.org_id = $1 AND c.location_id = $2 LIMIT 1`,
      [t.fx.A.orgId, t.fx.A.locations[0]],
    );
    const c = circuit.rows[0] as { id: string; total: number };
    const run = await t.admin.query<{ id: string }>(
      `INSERT INTO app.circuit_run (org_id, member_id, circuit_id, location_id, started_at)
       VALUES ($1, $2, $3, $4, now() - interval '10 minutes') RETURNING id`,
      [t.fx.A.orgId, ana.member, c.id, t.fx.A.locations[0]],
    );
    await t.admin.query(
      `INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, circuit_run_id, reps, weight_kg)
       SELECT $1, $2, $3, s.exercise_id, $4, 10, 20 FROM app.circuit_step s WHERE s.circuit_id = $5 LIMIT 1`,
      [t.fx.A.orgId, ana.member, t.fx.A.locations[0], run.rows[0]?.id, c.id],
    );
    const r = await call(anaClaims(), "GET", "/v1/me/home");
    expect(r.body.programs).toEqual([
      {
        id: c.id,
        kind: "circuit",
        name: expect.any(String),
        week: null,
        weeks: null,
        pct: Math.round(100 / c.total),
        href: "/me/circuits",
      },
    ]);
  });

  it("membership: subscription → cancel at period end → credits → pass → expired", async () => {
    const B = t.fx.B;
    const sub = await t.admin.query<{ id: string; end: string }>(
      "SELECT id, to_char(current_period_end, 'YYYY-MM-DD') AS end FROM app.subscription WHERE member_id = $1",
      [B.members[0]],
    );
    const s = sub.rows[0] as { id: string; end: string };
    const home = async (claims = as("member", B)) =>
      (await call(claims, "GET", "/v1/me/home")).body.membership;
    expect(await home()).toEqual({
      kind: "subscription",
      name: expect.any(String),
      status: "active",
      renews_on: s.end,
      credits_left: null,
      expires_on: null,
    });
    await t.admin.query("UPDATE app.subscription SET status = 'frozen' WHERE id = $1", [s.id]);
    expect((await home()).status).toBe("frozen");
    await t.admin.query(
      "UPDATE app.subscription SET status = 'active', cancel_at_period_end = true, cancel_requested_at = now() WHERE id = $1",
      [s.id],
    );
    expect(await home()).toMatchObject({
      kind: "subscription",
      status: "active",
      renews_on: null,
      expires_on: s.end,
    });
    await t.admin.query(
      "UPDATE app.subscription SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [s.id],
    );
    const exp = await t.admin.query<{ d: string }>(
      `SELECT to_char((expires_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS d FROM app.credit_balance WHERE member_id = $1`,
      [B.members[0]],
    );
    expect(await home()).toEqual({
      kind: "credits",
      name: expect.any(String),
      status: "active",
      renews_on: null,
      credits_left: 7,
      expires_on: exp.rows[0]?.d,
    });
    await t.admin.query(
      "UPDATE app.credit_balance SET credits_remaining = 0 WHERE member_id = $1",
      [B.members[0]],
    );
    expect(await home()).toMatchObject({ kind: "credits", status: "expired", credits_left: 0 });
    // members[1] holds an unexpired single-session pass.
    const m1 = await t.admin.query<{ person_id: string }>(
      "SELECT person_id FROM app.member WHERE id = $1",
      [B.members[1]],
    );
    const pass = await home(t.claims(B, "member", m1.rows[0]?.person_id));
    expect(pass).toMatchObject({ kind: "credits", status: "active", credits_left: null });
    expect(pass.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("coach.enabled follows the configured provider, and is false for a guardian", async () => {
    const keys = ["COACH_AI_PROVIDER", "COACH_AI_API_KEY", "COACH_AI_MODEL"] as const;
    const saved = keys.map((k) => process.env[k]);
    process.env.COACH_AI_PROVIDER = "openai";
    process.env.COACH_AI_API_KEY = "test-key-never-used";
    process.env.COACH_AI_MODEL = "test-model";
    try {
      expect((await call(as("member"), "GET", "/v1/me/home")).body.coach).toEqual({
        enabled: true,
      });
      expect((await call(as("guardian"), "GET", "/v1/me/home")).body.coach).toEqual({
        enabled: false,
      });
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });
});

// ── Scoping ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("scoping: member, guardian, staff, other member, other org", () => {
  const PATHS = ["/v1/me/home", "/v1/me/progress", "/v1/me/documents", "/v1/me/nutrition"];

  it("guardian acts for the ward (default and ?member_id=); never for anyone else", async () => {
    for (const path of PATHS) {
      const d = await call(as("guardian"), "GET", path);
      expect(d.status, path).toBe(200);
      const id = path === "/v1/me/home" ? d.body.member.id : d.body.member_id;
      expect(id, path).toBe(ward);
      const named = await call(as("guardian"), "GET", `${path}?member_id=${ward}`);
      expect(named.status, path).toBe(200);
      for (const other of [t.fx.A.members[0], t.fx.A.members[1], t.fx.B.members[0]]) {
        const r = await call(as("guardian"), "GET", `${path}?member_id=${other}`);
        expect(r.status, `${path} ${other}`).toBe(404);
        expect(r.body).toEqual({ error: "not_found" });
      }
    }
  });

  it("a member asking for another member (same org or other org) gets 404 and no data", async () => {
    for (const path of PATHS) {
      for (const other of [t.fx.A.members[1], ward, t.fx.B.members[0], ana.member]) {
        const r = await call(as("member"), "GET", `${path}?member_id=${other}`);
        expect(r.status, `${path} ${other}`).toBe(404);
        expect(r.body).toEqual({ error: "not_found" });
      }
      const own = await call(as("member"), "GET", `${path}?member_id=${t.fx.A.members[0]}`);
      expect(own.status).toBe(200);
    }
  });

  it("every staff role is refused (403): the portal never serves another person's data to staff", async () => {
    for (const role of [
      "owner",
      "location_manager",
      "front_desk",
      "trainer",
      "nutritionist",
      "chef",
      "clinician",
      "accountant",
    ] as Role[]) {
      for (const path of PATHS) {
        const r = await call(as(role), "GET", `${path}?member_id=${t.fx.A.members[0]}`);
        expect(r.status, `${role} ${path}`).toBe(403);
        const bare = await call(as(role), "GET", path);
        expect(bare.status, `${role} ${path}`).toBe(403);
      }
    }
  });

  it("strict query: unknown parameters and malformed ids are 400", async () => {
    expect((await call(as("member"), "GET", "/v1/me/home?member_id=nope")).status).toBe(400);
    expect((await call(as("member"), "GET", "/v1/me/home?debug=1")).status).toBe(400);
  });

  it("no token → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/me/home" });
    expect(r.statusCode).toBe(401);
  });
});

// ── Goal ────────────────────────────────────────────────────────────────────────────────────────────────────
describe("PUT /v1/me/goal", () => {
  it("member sets 1..14; the home and progress reflect it", async () => {
    const r = await call(anaClaims(), "PUT", "/v1/me/goal", { weekly_trainings: 6 });
    expect(r).toEqual({ status: 200, body: { weekly_trainings: 6 } });
    expect((await call(anaClaims(), "GET", "/v1/me/home")).body.week.goal).toBe(6);
    expect((await call(anaClaims(), "GET", "/v1/me/progress")).body.goal).toBe(6);
  });

  it("validation: out of range, non-integer, extra keys → 400 and nothing changes", async () => {
    for (const body of [
      { weekly_trainings: 0 },
      { weekly_trainings: 15 },
      { weekly_trainings: 3.5 },
      { weekly_trainings: "5" },
      { weekly_trainings: 5, member_id: ward },
      {},
    ]) {
      const r = await call(anaClaims(), "PUT", "/v1/me/goal", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    const g = await t.admin.query(
      "SELECT weekly_trainings FROM app.member_goal WHERE member_id = $1",
      [ana.member],
    );
    expect(g.rows[0]?.weekly_trainings).toBe(6);
  });

  it("guardian and staff are refused (403) and write nothing", async () => {
    for (const role of ["guardian", "owner", "front_desk", "trainer"] as Role[]) {
      const r = await call(as(role), "PUT", "/v1/me/goal", { weekly_trainings: 9 });
      expect(r.status, role).toBe(403);
    }
    const g = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.member_goal WHERE weekly_trainings = 9",
    );
    expect(g.rows[0]?.n).toBe(0);
  });
});

// ── Progress ────────────────────────────────────────────────────────────────────────────────────────────────
describe("GET /v1/me/progress", () => {
  it("12 local ISO weeks (oldest first, current last) and recent events newest first", async () => {
    const r = await call(anaClaims(), "GET", "/v1/me/progress");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["goal", "member_id", "recent", "weeks"]);
    const weeks = r.body.weeks as Array<Record<string, unknown>>;
    expect(weeks).toHaveLength(12);
    expect(weeks[11]?.week_start).toBe(isoWeekStart(today));
    expect(weeks[0]?.week_start).toBe(addDays(isoWeekStart(today), -77));
    for (const w of weeks)
      expect(Object.keys(w).sort()).toEqual([
        "active_minutes",
        "classes_attended",
        "trainings",
        "week_start",
      ]);
    const home = (await call(anaClaims(), "GET", "/v1/me/home")).body.week;
    expect(weeks[11]).toMatchObject({
      trainings: home.trainings,
      classes_attended: home.classes_attended,
      active_minutes: home.active_minutes,
    });
    // Every check-in day (6 allowed) and class lands in exactly one of the 12 weeks.
    expect(weeks.reduce((n, w) => n + (w.trainings as number), 0)).toBe(6);
    expect(weeks.reduce((n, w) => n + (w.classes_attended as number), 0)).toBe(2);
    const recent = r.body.recent as Array<{ at: string; kind: string; label: string }>;
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < recent.length; i += 1)
      expect(Date.parse(recent[i - 1]?.at as string)).toBeGreaterThanOrEqual(
        Date.parse(recent[i]?.at as string),
      );
    expect(new Set(recent.map((e) => e.kind))).toEqual(new Set(["check_in", "class", "circuit"]));
    // Denied attempts are never events.
    expect(recent.filter((e) => e.kind === "check_in")).toHaveLength(6);
  });
});

// ── Documents ───────────────────────────────────────────────────────────────────────────────────────────────
describe("GET /v1/me/documents", () => {
  it("agreements with their titles, consent status per channel/purpose, invoices without platform fees", async () => {
    const r = await call(as("member"), "GET", "/v1/me/documents");
    expect(r.status).toBe(200);
    expect(r.body.member_id).toBe(t.fx.A.members[0]);
    expect(r.body.agreements.map((a: { kind: string }) => a.kind).sort()).toEqual([
      "terms",
      "waiver",
    ]);
    for (const a of r.body.agreements) expect(a.title).toEqual(expect.any(String));
    expect(r.body.consents).toEqual([
      expect.objectContaining({
        channel: "sms",
        purpose: "reminder",
        status: "granted",
        since: expect.any(String),
      }),
    ]);
    expect(r.body.invoices).toEqual([
      {
        id: expect.any(String),
        number: 1,
        issued_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        total_cents: 3339,
        status: "paid",
        href: "/me/membership",
      },
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/application_fee/);
  });
});

// ── Nutrition ───────────────────────────────────────────────────────────────────────────────────────────────
describe("GET /v1/me/nutrition", () => {
  it("only a PUBLISHED plan, with the licensed approver's name and licence; drafts never show", async () => {
    const B = t.fx.B;
    const none = await call(as("member", B), "GET", "/v1/me/nutrition");
    expect(none.body).toEqual({ member_id: B.members[0], plan: null, appointment: null });
    const nutri = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND role = 'nutritionist'",
      [B.orgId],
    );
    const triage = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.triage_result WHERE member_id = $1",
      [B.members[0]],
    );
    const body = JSON.stringify({
      sections: [{ heading: "Estructura del día", items: ["Agua como bebida principal"] }],
    });
    await t.admin.query(
      `INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status)
       VALUES ($1, $2, 'nutrition', 'Borrador Demo', $3, $4, 'draft')`,
      [B.orgId, B.members[0], body, nutri.rows[0]?.id],
    );
    expect((await call(as("member", B), "GET", "/v1/me/nutrition")).body.plan).toBeNull();
    await t.admin.query(
      `INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status, submitted_at, approved_by,
         approved_at, approver_name, approver_license_no, triage_result_id, published_at)
       VALUES ($1, $2, 'nutrition', 'Plan alimentario Demo', $3, $4, 'published', now() - interval '3 days', $4,
               now() - interval '2 days', 'Valeria Demo', 'DEMO-N-0042', $5, now() - interval '2 days')`,
      [B.orgId, B.members[0], body, nutri.rows[0]?.id, triage.rows[0]?.id],
    );
    const r = await call(as("member", B), "GET", "/v1/me/nutrition");
    expect(r.body.plan).toMatchObject({
      title: "Plan alimentario Demo",
      approver_name: "Valeria Demo",
      approver_license_no: "DEMO-N-0042",
      body: {
        sections: [{ heading: "Estructura del día", items: ["Agua como bebida principal"] }],
      },
    });
    // Health data stays with the member: staff of the same org get 403 here.
    for (const role of ["owner", "front_desk", "chef", "accountant"] as Role[])
      expect(
        (await call(as(role, B), "GET", `/v1/me/nutrition?member_id=${B.members[0]}`)).status,
        role,
      ).toBe(403);
  });
});

// ── Challenge perks (staff) ─────────────────────────────────────────────────────────────────────────────────
describe("/v1/portal/challenges/:id/perks", () => {
  let challenge: string;
  beforeAll(async () => {
    const r = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.challenge WHERE org_id = $1 AND name = 'Reto Demo Noviembre A'",
      [t.fx.A.orgId],
    );
    challenge = r.rows[0]?.id as string;
  });

  it("owner replaces the list (positions follow the order); members read it on the home", async () => {
    const perks = [
      "Entrenamiento guiado",
      "Nutrición sugerida por especialista con licencia",
      "Reconocimiento y premios",
    ];
    const r = await call(as("owner"), "PUT", `/v1/portal/challenges/${challenge}/perks`, { perks });
    expect(r.status).toBe(200);
    expect(r.body.data.map((p: { label: string }) => p.label)).toEqual(perks);
    expect((await call(as("member"), "GET", "/v1/me/home")).body.challenge.perks).toEqual(perks);
    expect(
      (await call(as("front_desk"), "GET", `/v1/portal/challenges/${challenge}/perks`)).body.data,
    ).toHaveLength(3);
  });

  it("front desk, trainer, member, guardian and a location manager (org-wide challenge) cannot change it", async () => {
    for (const role of [
      "front_desk",
      "trainer",
      "member",
      "guardian",
      "location_manager",
    ] as Role[]) {
      const r = await call(as(role), "PUT", `/v1/portal/challenges/${challenge}/perks`, {
        perks: ["Hackeado"],
      });
      expect(r.status, role).toBe(403);
      const clear = await call(as(role), "PUT", `/v1/portal/challenges/${challenge}/perks`, {
        perks: [],
      });
      expect(clear.status, role).toBe(403);
    }
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.challenge_perk WHERE challenge_id = $1",
      [challenge],
    );
    expect(n.rows[0]?.n).toBe(3);
  });

  it("other org: 404; hostile labels: 400", async () => {
    expect(
      (
        await call(as("owner", t.fx.B), "PUT", `/v1/portal/challenges/${challenge}/perks`, {
          perks: [],
        })
      ).status,
    ).toBe(404);
    for (const perks of [
      ["https://phish.example"],
      ["<script>"],
      ["Llama 787-555-0101"],
      ["a"],
      Array(9).fill("Premio"),
    ])
      expect(
        (await call(as("owner"), "PUT", `/v1/portal/challenges/${challenge}/perks`, { perks }))
          .status,
      ).toBe(400);
    const extra = await call(as("owner"), "PUT", `/v1/portal/challenges/${challenge}/perks`, {
      perks: [],
      x: 1,
    });
    expect(extra.status).toBe(400);
  });
});
