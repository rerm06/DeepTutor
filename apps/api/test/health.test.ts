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
let licensedNutri: string;

const NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false };

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
const as = (role: Role, org = t.fx.A, person?: string) => t.claims(org, role, person);
async function call(
  claims: Claims,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/v1${url}`,
    headers: { authorization: `Bearer ${await token(claims)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

let seq = 0;
async function newMember(loc = t.fx.A.locations[0]): Promise<string> {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`api.health${seq}.${Date.now()}@demo.invalid`],
  );
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id",
    [t.fx.A.orgId, p.rows[0]?.id, loc, `Demo api ${seq}`],
  );
  return m.rows[0]?.id as string;
}
async function signed(member: string, extra: Record<string, unknown> = {}) {
  const c = await call(as("trainer"), "POST", "/health/assessments", {
    member_id: member,
    parq: NO,
    ...extra,
  });
  expect(c.statusCode).toBe(201);
  const s = await call(as("trainer"), "POST", `/health/assessments/${c.json().id}/sign`);
  expect(s.statusCode).toBe(200);
  return { id: c.json().id as string, triage: s.json().triage };
}
const plan = (member: string, kind: string) => ({
  member_id: member,
  kind,
  title: "Demo plan",
  body: { sections: [{ heading: "Semana 1", items: ["Caminata 20 minutos"] }] },
});

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ('api.nutri.lic@demo.invalid') RETURNING id",
  );
  const s = await t.admin.query<{ id: string }>(
    `INSERT INTO app.staff_member (org_id, person_id, role, display_name, license_no, license_verified_at)
     VALUES ($1, $2, 'nutritionist', 'Demo Especialista', 'LIC-API-1', now()) RETURNING id`,
    [t.fx.A.orgId, p.rows[0]?.id],
  );
  await t.admin.query(
    "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1, $2, $3)",
    [t.fx.A.orgId, s.rows[0]?.id, t.fx.A.locations[0]],
  );
  licensedNutri = p.rows[0]?.id as string;
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("assessments API", () => {
  it("trainer creates, edits and signs; the triage comes back from the database", async () => {
    const m = await newMember();
    const c = await call(as("trainer"), "POST", "/health/assessments", {
      member_id: m,
      parq: { ...NO, q2: true },
      declared_conditions: ["cvd"],
      resting_hr: 72,
      bp_sys: 130,
      bp_dia: 85,
      height_cm: 165.5,
      weight_kg: 70,
      fitness_tests: { pushups: 10 },
    });
    expect(c.statusCode).toBe(201);
    const id = c.json().id;
    expect(
      (await call(as("trainer"), "PATCH", `/health/assessments/${id}`, { waist_cm: 80 }))
        .statusCode,
    ).toBe(200);
    const s = await call(as("trainer"), "POST", `/health/assessments/${id}/sign`);
    expect(s.statusCode).toBe(200);
    expect(s.json().triage).toMatchObject({
      rule_version: "v0-propuesta",
      exercise_level: "amber",
      nutrition_level: "amber",
      requires_medical_referral: true,
      emergency: false,
    });
    const g = await call(as("trainer"), "GET", `/health/assessments/${id}`);
    expect(g.json()).toMatchObject({
      status: "signed",
      waist_cm: 80,
      signed_by_name: "Demo trainer A",
    });
    // Signed → no more edits; looks missing.
    expect(
      (await call(as("trainer"), "PATCH", `/health/assessments/${id}`, { waist_cm: 81 }))
        .statusCode,
    ).toBe(404);
    const again = await call(as("trainer"), "POST", `/health/assessments/${id}/sign`);
    expect(again.statusCode).toBe(403);
    expect(again.json().reason).toBe("assessment_signed_immutable");
  });

  it("acute symptoms → emergency flag in the triage", async () => {
    const { triage } = await signed(await newMember(), { acute_symptoms: true });
    expect(triage).toMatchObject({ emergency: true, exercise_level: "red" });
  });

  it("strict bodies: unknown fields, forbidden columns, unknown conditions and future dates are 400", async () => {
    const m = await newMember();
    for (const body of [
      { member_id: m, parq: NO, status: "signed" },
      { member_id: m, parq: NO, evaluator_staff_id: m },
      { member_id: m, parq: { ...NO, q8: true } },
      { member_id: m, parq: NO, declared_conditions: ["cancer"] },
      { member_id: m, parq: NO, taken_at: "2999-01-01T00:00:00Z" },
      { member_id: m, parq: NO, fitness_tests: { notes: "x" } },
      { member_id: "not-a-uuid", parq: NO },
    ]) {
      const r = await call(as("trainer"), "POST", "/health/assessments", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.assessment WHERE member_id = $1",
      [m],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it.each(["front_desk", "chef", "accountant"] as Role[])(
    "%s sees no health data and cannot create any",
    async (role) => {
      for (const path of ["/health/assessments", "/health/plans"]) {
        const r = await call(as(role), "GET", path);
        expect(r.statusCode).toBe(200);
        expect(r.json().data).toEqual([]);
      }
      const r = await call(as(role), "POST", "/health/assessments", {
        member_id: t.fx.A.members[0],
        parq: NO,
      });
      expect(r.statusCode).toBe(403);
    },
  );

  it("the member gets only their own signed assessments and published plans", async () => {
    const a = await call(as("member"), "GET", "/health/assessments");
    expect(a.statusCode).toBe(200);
    expect(a.json().data.length).toBeGreaterThan(0);
    for (const r of a.json().data) {
      expect(r.member_id).toBe(t.fx.A.members[0]);
      expect(r.status).toBe("signed");
      expect(r.triage).not.toBeNull();
    }
    const p = await call(as("member"), "GET", "/health/plans");
    for (const r of p.json().data) {
      expect(r.member_id).toBe(t.fx.A.members[0]);
      expect(r.status).toBe("published");
    }
  });

  it("other org: 404 on read, 403 on sign", async () => {
    const { id } = await signed(await newMember());
    expect((await call(as("owner", t.fx.B), "GET", `/health/assessments/${id}`)).statusCode).toBe(
      404,
    );
    const c = await call(as("trainer"), "POST", "/health/assessments", {
      member_id: await newMember(),
      parq: NO,
    });
    const s = await call(as("owner", t.fx.B), "POST", `/health/assessments/${c.json().id}/sign`);
    expect(s.statusCode).toBe(403);
  });

  it("triage preview uses the same SQL rules", async () => {
    const r = await call(as("trainer"), "POST", "/health/triage-preview", {
      parq: NO,
      declared_conditions: ["eating_disorder_screen_positive"],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rule_version: "v0-propuesta", nutrition_level: "red" });
  });
});

describe("care plans API", () => {
  it("whoami reports the licence state", async () => {
    const un = await call(as("nutritionist"), "GET", "/health/whoami");
    expect(un.json().staff).toMatchObject({ role: "nutritionist", license_verified: false });
    const lic = await call(as("nutritionist", t.fx.A, licensedNutri), "GET", "/health/whoami");
    expect(lic.json().staff).toMatchObject({ license_no: "LIC-API-1", license_verified: true });
  });

  it("nutrition: unlicensed → 403 license_not_verified; red triage → 403; licensed + green → approved and published", async () => {
    const m = await newMember();
    await signed(m);
    const c = await call(as("nutritionist"), "POST", "/health/plans", plan(m, "nutrition"));
    expect(c.statusCode).toBe(201);
    const id = c.json().id;
    expect(
      (await call(as("nutritionist"), "POST", `/health/plans/${id}/submit`)).json().status,
    ).toBe("review");
    const un = await call(as("nutritionist"), "POST", `/health/plans/${id}/approve`, {});
    expect([un.statusCode, un.json().reason]).toEqual([403, "license_not_verified"]);
    const ok = await call(
      as("nutritionist", t.fx.A, licensedNutri),
      "POST",
      `/health/plans/${id}/approve`,
      {
        referral_acknowledged: false,
      },
    );
    expect(ok.json()).toEqual({ id, status: "approved" });
    expect(
      (await call(as("location_manager"), "POST", `/health/plans/${id}/publish`)).json().status,
    ).toBe("published");
    const g = await call(as("trainer"), "GET", `/health/plans/${id}`);
    expect(g.json()).toMatchObject({
      approver_name: "Demo Especialista",
      approver_license_no: "LIC-API-1",
    });

    const red = await newMember();
    await signed(red, { declared_conditions: ["active_ed"] });
    const rp = (
      await call(as("nutritionist"), "POST", "/health/plans", plan(red, "nutrition"))
    ).json().id;
    await call(as("nutritionist"), "POST", `/health/plans/${rp}/submit`);
    const blocked = await call(
      as("nutritionist", t.fx.A, licensedNutri),
      "POST",
      `/health/plans/${rp}/approve`,
      {
        referral_acknowledged: true,
      },
    );
    expect([blocked.statusCode, blocked.json().reason]).toEqual([
      403,
      "triage_red_blocks_nutrition",
    ]);
  });

  it("trainer cannot draft nutrition; publish before approve is refused; new version after publish", async () => {
    const m = await newMember();
    await signed(m);
    expect(
      (await call(as("trainer"), "POST", "/health/plans", plan(m, "nutrition"))).statusCode,
    ).toBe(403);
    const id = (await call(as("trainer"), "POST", "/health/plans", plan(m, "training"))).json().id;
    const early = await call(as("trainer"), "POST", `/health/plans/${id}/publish`);
    expect([early.statusCode, early.json().reason]).toEqual([403, "invalid_transition"]);
    expect(
      (await call(as("trainer"), "PATCH", `/health/plans/${id}`, { title: "Demo v1" })).statusCode,
    ).toBe(200);
    await call(as("trainer"), "POST", `/health/plans/${id}/submit`);
    await call(as("trainer"), "POST", `/health/plans/${id}/approve`, {});
    await call(as("trainer"), "POST", `/health/plans/${id}/publish`);
    expect(
      (await call(as("trainer"), "PATCH", `/health/plans/${id}`, { title: "x" })).statusCode,
    ).toBe(404);
    const v2 = await call(as("trainer"), "POST", `/health/plans/${id}/new-version`);
    expect(v2.statusCode).toBe(201);
    const dup = await call(as("trainer"), "POST", `/health/plans/${id}/new-version`);
    expect(dup.statusCode).toBe(409);
    const list = await call(as("trainer"), "GET", `/health/plans?member_id=${m}`);
    expect(
      list.json().data.map((r: { version: number; status: string }) => [r.version, r.status]),
    ).toEqual([
      [2, "draft"],
      [1, "published"],
    ]);
  });

  it("hostile plan input: unknown fields, markup and regulated titles are refused", async () => {
    const m = await newMember();
    for (const body of [
      { ...plan(m, "training"), status: "published" },
      { ...plan(m, "training"), title: "<script>" },
      { ...plan(m, "training"), body: { sections: [{ heading: "A", items: ["{{name}}"] }] } },
      { ...plan(m, "training"), approver_license_no: "X" },
    ]) {
      expect((await call(as("trainer"), "POST", "/health/plans", body)).statusCode).toBe(400);
    }
    // Passes the API shape check but the database screen refuses the regulated title.
    const r = await call(as("trainer"), "POST", "/health/plans", {
      ...plan(m, "training"),
      title: "Plan del nutricionista",
    });
    expect(r.statusCode).toBe(400);
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.care_plan WHERE member_id = $1",
      [m],
    );
    expect(n.rows[0].n).toBe(0);
  });
});
