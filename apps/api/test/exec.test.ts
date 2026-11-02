import { type TestDb, asCaller, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// Module exec · GET /v1/reports/executive — the JSON contract the executive dashboard UI is written against.

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";
const TZ = "America/Puerto_Rico";

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
async function get(role: Role, url: string, org = t.fx.A) {
  return app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${await token(t.claims(org, role))}` },
  });
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  // A check-in today so the KPI is non-trivial.
  await t.admin.query(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by)
     VALUES ($1,$2,$3,'front_desk','allowed','active',$4)`,
    [t.fx.A.orgId, t.fx.A.locations[0], t.fx.A.members[0], t.fx.A.people.front_desk],
  );
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

const KPI12 = [
  "revenue_month_cents",
  "active_members",
  "net_profit_month_cents",
  "renewal_rate_pct",
];
const KPI14 = ["checkins_today", "classes_today"];
const isInt = (x: unknown) => typeof x === "number" && Number.isInteger(x);

describe("GET /v1/reports/executive", () => {
  it("owner: exact contract keys and types", async () => {
    const r = await get("owner", "/v1/reports/executive");
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(Object.keys(b).sort()).toEqual(
      [
        "as_of",
        "currency",
        "months",
        "kpis",
        "revenue_vs_expenses",
        "new_members",
        "member_status",
        "sales_mix",
      ].sort(),
    );
    expect(Number.isNaN(Date.parse(b.as_of))).toBe(false);
    expect(b.currency).toBe("USD");
    expect(b.months).toHaveLength(12);
    for (const m of b.months) expect(m).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    const { rows } = await t.admin.query(
      `SELECT to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM') AS m`,
    );
    expect(b.months[11]).toBe(rows[0].m);
    expect([...b.months].sort()).toEqual(b.months);

    expect(Object.keys(b.kpis).sort()).toEqual([...KPI12, ...KPI14].sort());
    for (const k of [...KPI12, ...KPI14]) {
      const v = b.kpis[k];
      expect(Object.keys(v).sort(), k).toEqual(["prev", "series", "value"]);
      expect(v.series, k).toHaveLength(KPI14.includes(k) ? 14 : 12);
      if (k === "renewal_rate_pct") {
        for (const x of [v.value, v.prev, ...v.series])
          expect(x === null || (typeof x === "number" && Math.round(x * 10) === x * 10), k).toBe(
            true,
          );
      } else {
        for (const x of [v.value, v.prev, ...v.series]) expect(isInt(x), k).toBe(true);
        expect(v.value, k).toBe(v.series[v.series.length - 1]);
      }
    }
    expect(b.kpis.checkins_today.value).toBeGreaterThanOrEqual(1);

    expect(b.revenue_vs_expenses).toHaveLength(12);
    for (const x of b.revenue_vs_expenses) {
      expect(Object.keys(x).sort()).toEqual(["expenses_cents", "month", "revenue_cents"]);
      expect(isInt(x.revenue_cents) && isInt(x.expenses_cents)).toBe(true);
    }
    expect(b.new_members).toHaveLength(12);
    for (const x of b.new_members) {
      expect(Object.keys(x).sort()).toEqual(["cancellations", "joins", "month"]);
      expect(isInt(x.joins) && isInt(x.cancellations)).toBe(true);
    }
    expect(Object.keys(b.member_status).sort()).toEqual(["active", "expired", "frozen", "other"]);
    for (const v of Object.values(b.member_status)) expect(isInt(v)).toBe(true);
    expect(b.sales_mix.length).toBeGreaterThan(0);
    expect(b.sales_mix.length).toBeLessThanOrEqual(7);
    for (const s of b.sales_mix) {
      expect(Object.keys(s).sort()).toEqual([
        "kind",
        "label_en",
        "label_es",
        "revenue_cents",
        "units",
      ]);
      expect(
        typeof s.kind === "string" &&
          typeof s.label_es === "string" &&
          typeof s.label_en === "string",
      ).toBe(true);
      expect(isInt(s.units) && isInt(s.revenue_cents)).toBe(true);
    }
  });

  it("equals the database read model for the same caller", async () => {
    const r = (
      await get("owner", `/v1/reports/executive?location_id=${t.fx.A.locations[0]}`)
    ).json();
    const direct = await asCaller(
      t.api,
      t.claims(t.fx.A, "owner"),
      async (tx) =>
        (await tx.query("SELECT app.report_executive($1) AS r", [t.fx.A.locations[0]])).rows[0].r,
    );
    const { as_of: _a, ...got } = r;
    const { as_of: _b, ...want } = direct;
    expect(got).toEqual(want);
  });

  it("location manager: own location (or none) ok; other location and other org → 403", async () => {
    expect((await get("location_manager", "/v1/reports/executive")).statusCode).toBe(200);
    expect(
      (await get("location_manager", `/v1/reports/executive?location_id=${t.fx.A.locations[0]}`))
        .statusCode,
    ).toBe(200);
    for (const loc of [t.fx.A.locations[1], t.fx.B.locations[0]]) {
      const r = await get("location_manager", `/v1/reports/executive?location_id=${loc}`);
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: "forbidden" });
    }
    const b = await get(
      "owner",
      `/v1/reports/executive?location_id=${t.fx.A.locations[0]}`,
      t.fx.B,
    );
    expect(b.statusCode).toBe(403);
  });

  it.each([
    "front_desk",
    "trainer",
    "nutritionist",
    "chef",
    "clinician",
    "accountant",
    "member",
    "guardian",
  ] as Role[])("%s → 403", async (role) => {
    const r = await get(role, "/v1/reports/executive");
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toMatch(/cents/);
  });

  it("bad input → 400; no token → 401", async () => {
    expect((await get("owner", "/v1/reports/executive?location_id=nope")).statusCode).toBe(400);
    expect((await get("owner", "/v1/reports/executive?months=24")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/reports/executive" })).statusCode).toBe(
      401,
    );
  });
});
