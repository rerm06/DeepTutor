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
let member2A: string;

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
type Org = TestDb["fx"]["A"];
const who = (org: Org, role: Role, person?: string) => t.claims(org, role, person);
async function call(claims: Claims, method: string, url: string, payload?: unknown) {
  const r = await app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${await token(claims)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return { status: r.statusCode, body: r.json() };
}
beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  member2A = (
    await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [t.fx.A.members[1]])
  ).rows[0].person_id;
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

// Equipment use (0029): generated codes, scan → use mapped to the routine, live board, member progress.
describe("adding equipment", () => {
  it("the owner adds several units at once and each gets its own generated code", async () => {
    const A = t.fx.A;
    const r = await call(who(A, "owner"), "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "bike",
      quantity: 3,
    });
    expect(r.status).toBe(201);
    expect(r.body.created.map((c: { station_code: string }) => c.station_code)).toEqual([
      "BIC-01",
      "BIC-02",
      "BIC-03",
    ]);
    expect(r.body).toMatchObject({ station_code: "BIC-01" });
  });

  it("a typed code is for one unit only; front desk cannot add equipment", async () => {
    const A = t.fx.A;
    const many = await call(who(A, "owner"), "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "rack",
      station_code: "RACK-X",
      quantity: 2,
    });
    expect(many.status).toBe(400);
    const fd = await call(who(A, "front_desk"), "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "rack",
    });
    expect(fd.status).toBe(403);
    const tooMany = await call(who(A, "owner"), "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "rack",
      quantity: 51,
    });
    expect(tooMany.status).toBe(400);
  });
});

describe("a member scans a station", () => {
  it("registers the use, maps it to the open routine and shows the progress", async () => {
    const A = t.fx.A;
    const me = who(A, "member");
    const circuit = (
      await t.admin.query(
        "SELECT id FROM app.circuit WHERE org_id = $1 AND name = 'Circuito Fuerza A'",
        [A.orgId],
      )
    ).rows[0].id;
    const runR = await call(me, "POST", `/v1/floor/circuits/${circuit}/runs`, {});
    expect(runR.status).toBe(201);
    const r = await call(me, "POST", "/v1/floor/stations/a1-lat-01/use", { source: "scan" });
    expect(r.status).toBe(201);
    expect(r.body.use).toMatchObject({
      station_code: "A1-LAT-01",
      exercise_name: "Jalón al pecho",
      circuit_run_id: runR.body.id,
      ended_at: null,
    });
    expect(r.body.routine).toMatchObject({
      run_id: runR.body.id,
      sets_planned: 9,
      sets_done: 0,
      pct: 0,
    });
    expect(r.body.routine.steps).toHaveLength(3);

    // A set on the station counts toward the routine.
    const set = await call(me, "POST", "/v1/floor/sets", {
      exercise_id: r.body.use.exercise_id,
      location_id: A.locations[0],
      asset_id: r.body.use.asset_id,
      circuit_run_id: runR.body.id,
      reps: 10,
      weight_kg: 40,
    });
    expect(set.status).toBe(201);
    const now = await call(me, "GET", "/v1/floor/me/use");
    expect(now.body.use.id).toBe(r.body.use.id);
    expect(now.body.routine).toMatchObject({ sets_done: 1, pct: 11 });
    expect(
      now.body.routine.steps.find(
        (s: { exercise_name: string }) => s.exercise_name === "Jalón al pecho",
      ).done,
    ).toBe(1);

    const end = await call(me, "POST", `/v1/floor/uses/${r.body.use.id}/end`, {});
    expect(end.status).toBe(200);
    expect((await call(me, "GET", "/v1/floor/me/use")).body.use).toBeNull();
  });

  it("refusals: equipment down 409, unknown 404, other org 404, staff 403, bad code 400", async () => {
    const A = t.fx.A;
    const me = who(A, "member");
    expect((await call(me, "POST", "/v1/floor/stations/A1-LP-02/use", {})).body).toEqual({
      error: "asset_unavailable",
    });
    expect((await call(me, "POST", "/v1/floor/stations/A1-LP-02/use", {})).status).toBe(409);
    expect((await call(me, "POST", "/v1/floor/stations/ZZ-404/use", {})).status).toBe(404);
    expect((await call(me, "POST", "/v1/floor/stations/B1-BAR-01/use", {})).status).toBe(404);
    expect(
      (await call(who(A, "owner"), "POST", "/v1/floor/stations/A1-BAR-01/use", {})).status,
    ).toBe(403);
    expect((await call(me, "POST", "/v1/floor/stations/%3Cx%3E/use", {})).status).toBe(400);
  });
});

describe("live board and progress for coaches", () => {
  it("the owner sees who is on each station now, today's uses and routine progress", async () => {
    const A = t.fx.A;
    // The fixture's open use (members[1] on A2-LP-01) is dated when the template database was built: refresh it.
    await t.admin.query(
      "UPDATE app.equipment_use SET started_at = now() - interval '3 minutes', last_activity_at = now() WHERE member_id = $1 AND ended_at IS NULL",
      [A.members[1]],
    );
    const scan = await call(who(A, "member"), "POST", "/v1/floor/stations/A1-BAR-01/use", {});
    expect(scan.status).toBe(201);
    const r = await call(who(A, "owner"), "GET", "/v1/floor/live");
    expect(r.status).toBe(200);
    const bar = r.body.assets.find((a: { station_code: string }) => a.station_code === "A1-BAR-01");
    expect(bar.in_use).toHaveLength(1);
    expect(bar.in_use[0]).toMatchObject({ member_id: A.members[0] });
    expect(bar.in_use[0].name).toBeTruthy();
    expect(bar.uses_today).toBeGreaterThanOrEqual(1);
    // Fixture: members[1] is on A2-LP-01 at the second location right now.
    const lp2 = r.body.assets.find((a: { station_code: string }) => a.station_code === "A2-LP-01");
    expect(lp2.in_use).toHaveLength(1);
    expect(r.body.totals.members_now).toBe(2);
    const training = r.body.training.find(
      (x: { member_id: string }) => x.member_id === A.members[0],
    );
    expect(training).toMatchObject({
      circuit_name: "Circuito Fuerza A",
      station_code: "A1-BAR-01",
    });
  });

  it("a trainer sees only their location; front desk and members are refused", async () => {
    const A = t.fx.A;
    const r = await call(who(A, "trainer"), "GET", "/v1/floor/live");
    expect(r.status).toBe(200);
    expect(new Set(r.body.assets.map((a: { location_id: string }) => a.location_id))).toEqual(
      new Set([A.locations[0]]),
    );
    expect(r.body.assets.some((a: { in_use: unknown[] }) => a.in_use.length > 0)).toBe(true);
    expect((await call(who(A, "front_desk"), "GET", "/v1/floor/live")).status).toBe(403);
    expect((await call(who(A, "member"), "GET", "/v1/floor/live")).status).toBe(403);
    // Org B never sees org A's uses.
    const b = await call(who(t.fx.B, "owner"), "GET", "/v1/floor/live");
    expect(
      b.body.assets.every((a: { location_id: string }) => t.fx.B.locations.includes(a.location_id)),
    ).toBe(true);
  });

  it("member profile: the coach reads routines and uses; the member reads their own", async () => {
    const A = t.fx.A;
    const coach = await call(
      who(A, "owner"),
      "GET",
      `/v1/floor/training?member_id=${A.members[0]}`,
    );
    expect(coach.status).toBe(200);
    expect(coach.body.open).toMatchObject({ circuit_name: "Circuito Fuerza A" });
    expect(coach.body.routines.length).toBeGreaterThanOrEqual(2);
    expect(coach.body.uses.length).toBeGreaterThan(0);
    expect(coach.body.by_equipment.length).toBeGreaterThan(0);
    const self = await call(who(A, "member", member2A), "GET", "/v1/floor/training");
    expect(self.status).toBe(200);
    expect(self.body.member_id).toBe(A.members[1]);
    // A member cannot read someone else's; front desk cannot read anyone's.
    expect(
      (await call(who(A, "member"), "GET", `/v1/floor/training?member_id=${A.members[1]}`)).status,
    ).toBe(403);
    expect(
      (await call(who(A, "front_desk"), "GET", `/v1/floor/training?member_id=${A.members[0]}`))
        .status,
    ).toBe(403);
    // A trainer at location 1 does not see the routines or uses of a member trained only at location 2.
    const far = await call(
      who(A, "trainer"),
      "GET",
      `/v1/floor/training?member_id=${A.members[1]}`,
    );
    expect(far.status).toBe(200);
    expect(
      far.body.uses.every((u: { station_code: string }) => !u.station_code.startsWith("A2")),
    ).toBe(true);
  });
});
