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
const assetId = async (code: string, org: Org = t.fx.A) =>
  (
    await t.admin.query("SELECT id FROM app.asset WHERE org_id = $1 AND station_code = $2", [
      org.orgId,
      code,
    ])
  ).rows[0].id as string;
const exerciseId = async (name: string, org: Org = t.fx.A) =>
  (
    await t.admin.query("SELECT id FROM app.exercise WHERE org_id = $1 AND name = $2", [
      org.orgId,
      name,
    ])
  ).rows[0].id as string;

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

describe("station lookup", () => {
  it("a member scans a label (any case, padded) and gets the exercise card", async () => {
    const r = await call(who(t.fx.A, "member"), "GET", "/v1/floor/stations/%20a1-bar-01%20");
    expect(r.status).toBe(200);
    expect(r.body.asset.station_code).toBe("A1-BAR-01");
    expect(r.body.exercises.map((e: { name: string }) => e.name)).toContain("Sentadilla con barra");
    expect(
      r.body.exercises.every((e: { equipment_type: string }) => e.equipment_type === "barbell"),
    ).toBe(true);
    expect(r.body.circuit_steps.length).toBeGreaterThan(0);
  });

  it("unknown or other-org codes are 404; malformed codes are 400", async () => {
    expect((await call(who(t.fx.B, "member"), "GET", "/v1/floor/stations/A1-BAR-01")).status).toBe(
      404,
    );
    expect((await call(who(t.fx.A, "member"), "GET", "/v1/floor/stations/ZZ-404")).status).toBe(
      404,
    );
    for (const bad of ["a%20b", "%3Cscript%3E", "https%3A%2F%2Fevil.invalid"]) {
      expect((await call(who(t.fx.A, "member"), "GET", `/v1/floor/stations/${bad}`)).status).toBe(
        400,
      );
    }
  });
});

describe("busy machine → substitutes", () => {
  it("reporting busy changes nothing and substitutes share the movement pattern", async () => {
    const A = t.fx.A;
    const bar = await assetId("A1-BAR-01");
    const squat = await exerciseId("Sentadilla con barra");
    const rep = await call(who(A, "member"), "POST", `/v1/floor/assets/${bar}/issues`, {
      kind: "busy",
    });
    expect(rep.status).toBe(201);
    const subs = await call(
      who(A, "member"),
      "GET",
      `/v1/floor/substitutes?exercise_id=${squat}&location_id=${A.locations[0]}&exclude_asset_id=${bar}`,
    );
    expect(subs.status).toBe(200);
    expect(subs.body.data.length).toBeGreaterThan(0);
    expect(
      subs.body.data.every((s: { movement_pattern: string }) => s.movement_pattern === "squat"),
    ).toBe(true);
    expect(subs.body.data.some((s: { asset_id: string }) => s.asset_id === bar)).toBe(false);
    const asset = await call(
      who(A, "trainer"),
      "GET",
      `/v1/floor/assets?location_id=${A.locations[0]}`,
    );
    expect(asset.body.data.find((a: { id: string }) => a.id === bar).status).toBe("ok");
  });

  it("issue bodies are strict and notes are screened", async () => {
    const bar = await assetId("A1-BAR-01");
    for (const payload of [
      { kind: "busy", status: "confirmed" },
      { kind: "occupied" },
      { kind: "busy", note: "<img src=x>" },
      { kind: "busy", note: "{{brand}}" },
    ]) {
      const r = await call(
        who(t.fx.A, "member"),
        "POST",
        `/v1/floor/assets/${bar}/issues`,
        payload,
      );
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe("issue workflow over HTTP", () => {
  it("confirm flips the asset out of service; a second confirm is 409; front desk cannot resolve", async () => {
    const A = t.fx.A;
    const lat = await assetId("A1-LAT-01");
    const rep = await call(who(A, "member"), "POST", `/v1/floor/assets/${lat}/issues`, {
      kind: "out_of_service",
      note: "Demo: el cable salta",
    });
    expect(rep.status).toBe(201);
    const issue = rep.body.id;
    const queue = await call(who(A, "front_desk"), "GET", "/v1/floor/issues?status=reported");
    expect(queue.body.data.map((i: { id: string }) => i.id)).toContain(issue);

    const c1 = await call(who(A, "front_desk"), "POST", `/v1/floor/issues/${issue}/confirm`);
    expect(c1).toMatchObject({ status: 200, body: { asset_status: "out_of_service" } });
    const c2 = await call(who(A, "front_desk"), "POST", `/v1/floor/issues/${issue}/confirm`);
    expect(c2).toMatchObject({ status: 409, body: { error: "conflict" } });
    const fd = await call(who(A, "front_desk"), "POST", `/v1/floor/issues/${issue}/resolve`, {});
    expect(fd.status).toBe(403);
    const ok = await call(who(A, "trainer"), "POST", `/v1/floor/issues/${issue}/resolve`, {
      restore_asset: true,
    });
    expect(ok).toMatchObject({ status: 200, body: { asset_status: "ok" } });
  });

  it("the other organisation and non-floor roles cannot confirm", async () => {
    const A = t.fx.A;
    const rep = await call(
      who(A, "member"),
      "POST",
      `/v1/floor/assets/${await assetId("A1-CP-01")}/issues`,
      { kind: "out_of_service" },
    );
    for (const c of [
      who(t.fx.B, "owner"),
      who(A, "chef"),
      who(A, "accountant"),
      who(A, "member"),
    ]) {
      const r = await call(c, "POST", `/v1/floor/issues/${rep.body.id}/confirm`);
      expect(r.status, c.app_role).toBe(403);
    }
  });
});

describe("set logs over HTTP", () => {
  it("a member logs a set and reads only their own history", async () => {
    const A = t.fx.A;
    const r = await call(who(A, "member"), "POST", "/v1/floor/sets", {
      exercise_id: await exerciseId("Sentadilla goblet"),
      location_id: A.locations[1],
      asset_id: await assetId("A2-KB-01"),
      reps: 12,
      weight_kg: 16,
    });
    expect(r.status).toBe(201);
    const mine = await call(who(A, "member"), "GET", "/v1/floor/sets");
    expect(mine.body.data.map((s: { id: string }) => s.id)).toContain(r.body.id);
    expect(mine.body.data.every((s: { member_id: string }) => s.member_id === A.members[0])).toBe(
      true,
    );
    const peek = await call(who(A, "member"), "GET", `/v1/floor/sets?member_id=${A.members[1]}`);
    expect(peek).toMatchObject({ status: 200, body: { data: [] } });
    const other = await call(who(A, "member", member2A), "GET", "/v1/floor/sets");
    expect(other.body.data.map((s: { id: string }) => s.id)).not.toContain(r.body.id);
    for (const role of ["front_desk", "accountant", "chef", "clinician"] as Role[]) {
      const x = await call(who(A, role), "GET", "/v1/floor/sets");
      expect(x.body.data, role).toEqual([]);
    }
    const b = await call(who(t.fx.B, "owner"), "GET", `/v1/floor/sets?member_id=${A.members[0]}`);
    expect(b.body.data).toEqual([]);
  });

  it("refuses smuggled fields and hostile numbers", async () => {
    const A = t.fx.A;
    const base = {
      exercise_id: await exerciseId("Flexiones"),
      location_id: A.locations[0],
      reps: 10,
      weight_kg: 0,
    };
    for (const payload of [
      { ...base, member_id: A.members[1] },
      { ...base, reps: -1 },
      { ...base, reps: 1.5 },
      { ...base, weight_kg: 5000 },
      { ...base, weight_kg: "10" },
    ]) {
      const r = await call(who(A, "member"), "POST", "/v1/floor/sets", payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
    }
    const trainer = await call(who(A, "trainer"), "POST", "/v1/floor/sets", base);
    expect(trainer.status).toBe(403);
  });

  it("a member runs a circuit end to end", async () => {
    const A = t.fx.A;
    const list = await call(who(A, "member"), "GET", "/v1/floor/circuits");
    const circuit = list.body.data[0];
    const detail = await call(who(A, "member"), "GET", `/v1/floor/circuits/${circuit.id}`);
    expect(detail.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2, 3]);
    const run = await call(who(A, "member"), "POST", `/v1/floor/circuits/${circuit.id}/runs`);
    expect(run.status).toBe(201);
    const step = detail.body.steps[0];
    const set = await call(who(A, "member"), "POST", "/v1/floor/sets", {
      exercise_id: step.exercise_id,
      location_id: circuit.location_id,
      asset_id: step.asset_id ?? undefined,
      circuit_run_id: run.body.id,
      reps: 10,
      weight_kg: 40.5,
    });
    expect(set.status).toBe(201);
    const fin = await call(who(A, "member"), "POST", `/v1/floor/runs/${run.body.id}/finish`);
    expect(fin.status).toBe(200);
    const after = await call(who(A, "member"), "POST", "/v1/floor/sets", {
      exercise_id: step.exercise_id,
      location_id: circuit.location_id,
      circuit_run_id: run.body.id,
      reps: 10,
      weight_kg: 40,
    });
    expect(after.status).toBe(403);
  });
});

describe("staff management", () => {
  it("a trainer builds a circuit with ordered steps at their location only", async () => {
    const A = t.fx.A;
    const tr = who(A, "trainer");
    const c = await call(tr, "POST", "/v1/floor/circuits", {
      location_id: A.locations[0],
      name: "Circuito Demo API",
    });
    expect(c.status).toBe(201);
    const steps = [
      {
        exercise_id: await exerciseId("Prensa de piernas"),
        asset_id: await assetId("A1-LP-01"),
        sets: 3,
        reps: 12,
      },
      {
        exercise_id: await exerciseId("Flexiones"),
        equipment_type: "none",
        sets: 3,
        reps: 15,
        rest_seconds: 45,
      },
    ];
    const put = await call(tr, "PUT", `/v1/floor/circuits/${c.body.id}/steps`, { steps });
    expect(put).toMatchObject({ status: 200, body: { steps: 2 } });
    const reordered = await call(tr, "PUT", `/v1/floor/circuits/${c.body.id}/steps`, {
      steps: [steps[1], steps[0]],
    });
    expect(reordered.status).toBe(200);
    const detail = await call(tr, "GET", `/v1/floor/circuits/${c.body.id}`);
    expect(detail.body.steps.map((s: { exercise_name: string }) => s.exercise_name)).toEqual([
      "Flexiones",
      "Prensa de piernas",
    ]);
    // Both asset and equipment type → 400; asset from another location → 400 (FK), nothing replaced.
    const both = await call(tr, "PUT", `/v1/floor/circuits/${c.body.id}/steps`, {
      steps: [{ ...steps[0], equipment_type: "leg_press" }],
    });
    expect(both.status).toBe(400);
    const far = await call(tr, "PUT", `/v1/floor/circuits/${c.body.id}/steps`, {
      steps: [{ ...steps[0], asset_id: await assetId("A2-LP-01") }],
    });
    expect(far.status).toBe(400);
    expect((await call(tr, "GET", `/v1/floor/circuits/${c.body.id}`)).body.steps.length).toBe(2);

    const other = await call(tr, "POST", "/v1/floor/circuits", {
      location_id: A.locations[1],
      name: "Circuito Ajeno",
    });
    expect(other.status).toBe(403);
    const fd = await call(who(A, "front_desk"), "PUT", `/v1/floor/circuits/${c.body.id}/steps`, {
      steps: [],
    });
    expect(fd.status).toBe(404);
  });

  it("equipment: create, duplicate code, status toggle, and location scope", async () => {
    const A = t.fx.A;
    const mgr = who(A, "location_manager");
    const created = await call(mgr, "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "bench",
      brand: "Demo Bancos",
      station_code: "a1-bn-09",
    });
    expect(created.status).toBe(201);
    const dup = await call(mgr, "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "bench",
      station_code: "A1-BN-09",
    });
    expect(dup.status).toBe(409);
    const toggled = await call(mgr, "PATCH", `/v1/floor/assets/${created.body.id}`, {
      status: "maintenance",
    });
    expect(toggled).toMatchObject({ status: 200, body: { status: "maintenance" } });
    const smuggle = await call(mgr, "PATCH", `/v1/floor/assets/${created.body.id}`, {
      location_id: A.locations[1],
    });
    expect(smuggle.status).toBe(400);
    const far = await call(mgr, "PATCH", `/v1/floor/assets/${await assetId("A2-KB-01")}`, {
      status: "maintenance",
    });
    expect(far.status).toBe(404);
    const fdCreate = await call(who(A, "front_desk"), "POST", "/v1/floor/assets", {
      location_id: A.locations[0],
      equipment_type: "bench",
      station_code: "A1-BN-10",
    });
    expect(fdCreate.status).toBe(403);
  });

  it("exercise library: trainers add, hostile names refused, members read", async () => {
    const A = t.fx.A;
    const ok = await call(who(A, "trainer"), "POST", "/v1/floor/exercises", {
      name: "Zancada caminando",
      movement_pattern: "lunge",
      equipment_type: "dumbbell",
      cues: "Paso largo.\nRodilla trasera cerca del piso.",
    });
    expect(ok.status).toBe(201);
    for (const name of ["<b>x</b>", "Visita evil.invalid {{x}}", "Prеss"]) {
      const r = await call(who(A, "trainer"), "POST", "/v1/floor/exercises", {
        name,
        movement_pattern: "core",
        equipment_type: "none",
      });
      expect(r.status, name).toBe(400);
    }
    const fd = await call(who(A, "front_desk"), "POST", "/v1/floor/exercises", {
      name: "Plancha lateral",
      movement_pattern: "core",
      equipment_type: "none",
    });
    expect(fd.status).toBe(403);
    const list = await call(who(A, "member"), "GET", "/v1/floor/exercises");
    expect(list.body.data.map((e: { name: string }) => e.name)).toContain("Zancada caminando");
  });
});
