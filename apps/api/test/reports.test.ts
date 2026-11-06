import { type TestDb, asCaller, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { csvCell, toCsv } from "../src/modules/reports.js";

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
async function call(role: Role, method: string, url: string, payload?: unknown, org = t.fx.A) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${await token(t.claims(org, role))}` },
    payload: payload as Record<string, unknown> | undefined,
  });
}
async function exports(): Promise<Array<{ entity_id: string; actor_role: string }>> {
  const { rows } = await t.admin.query(
    "SELECT entity_id, actor_role, meta FROM app.audit_log WHERE action = 'report.export' ORDER BY id",
  );
  return rows;
}

const HOSTILE = '=HYPERLINK("http://evil.example","x"), Demo';

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  const A = t.fx.A;
  // A member with a hostile name and an overdue invoice at loc0 (superuser insert; totals follow the CHECKs).
  const person = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ('rpt.hostile@demo.invalid') RETURNING id",
  );
  const member = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,'past_due') RETURNING id",
    [A.orgId, person.rows[0]?.id, A.locations[0], HOSTILE],
  );
  const le = await t.admin.query<{ legal_entity_id: string }>(
    "SELECT legal_entity_id FROM app.location WHERE id = $1",
    [A.locations[0]],
  );
  const inv = await t.admin.query<{ id: string }>(
    `INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, municipality, subtotal_cents,
       ivu_state_cents, ivu_municipal_cents, total_cents, application_fee_bps, application_fee_cents, status,
       issued_at, due_date, created_by)
     VALUES ($1,$2,900,$3,$4,'San Juan',1500,158,15,1673,100,17,'open', now() - interval '10 days',
       (now() AT TIME ZONE '${TZ}')::date - 4, $5) RETURNING id`,
    [A.orgId, le.rows[0]?.legal_entity_id, member.rows[0]?.id, A.locations[0], A.people.front_desk],
  );
  const prod = await t.admin.query<{ id: string; price: string }>(
    `SELECT p.id, pr.id AS price FROM app.plan_product p JOIN app.price pr ON pr.product_id = p.id
      WHERE p.org_id = $1 AND p.kind = 'drop_in' LIMIT 1`,
    [A.orgId],
  );
  await t.admin.query(
    `INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents, tax_category)
     VALUES ($1,$2,$3,$4,'Demo sesión',1,1500,'taxable')`,
    [A.orgId, inv.rows[0]?.id, prod.rows[0]?.id, prod.rows[0]?.price],
  );
  // A check-in today so the heatmap and today counters are non-zero.
  await t.admin.query(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by)
     VALUES ($1,$2,$3,'front_desk','allowed','active',$4)`,
    [A.orgId, A.locations[0], A.members[0], A.people.front_desk],
  );
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("panel and 'Hoy'", () => {
  it("owner reads the panel; it equals the database read model for the same caller", async () => {
    const r = await call("owner", "GET", "/v1/reports/dashboard");
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    const direct = await asCaller(
      t.api,
      t.claims(t.fx.A, "owner"),
      async (tx) => (await tx.query("SELECT app.report_dashboard(NULL) AS d")).rows[0].d,
    );
    const { generated_at: _a, ...rest } = body;
    const { generated_at: _b, ...want } = direct;
    expect(rest).toEqual(want);
    expect(body.overdue_invoices).toBeGreaterThanOrEqual(1);
    expect(body.check_ins_today).toBeGreaterThanOrEqual(1);
    expect(typeof body.points_liability).toBe("number");
  });

  it("location manager: own location ok, other location and other org 403", async () => {
    const own = await call(
      "location_manager",
      "GET",
      `/v1/reports/dashboard?location_id=${t.fx.A.locations[0]}`,
    );
    expect(own.statusCode).toBe(200);
    expect(own.json()).not.toHaveProperty("points_liability");
    for (const loc of [t.fx.A.locations[1], t.fx.B.locations[0]]) {
      const r = await call("location_manager", "GET", `/v1/reports/dashboard?location_id=${loc}`);
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: "forbidden" });
    }
  });

  it("front desk gets 'Hoy' without any revenue figure, and 403 on the panel and financial reports", async () => {
    const today = await call("front_desk", "GET", "/v1/reports/today");
    expect(today.statusCode).toBe(200);
    expect(today.body).not.toMatch(/cents|revenue|invoiced|collected|liability|total/);
    expect(today.json().overdue_members).toBe(1);
    for (const url of [
      "/v1/reports/dashboard",
      "/v1/reports/ivu?month=2026-09",
      "/v1/reports/sales?from=2026-09-01&to=2026-09-30",
      "/v1/reports/heatmap",
      "/v1/reports/expiring",
      "/v1/reports/members",
      "/v1/reports/ivu.csv?month=2026-09",
    ]) {
      const r = await call("front_desk", "GET", url);
      expect(r.statusCode, url).toBe(403);
    }
    const overdue = await call("front_desk", "GET", "/v1/reports/overdue");
    expect(overdue.statusCode).toBe(200);
    expect(overdue.json().data).toEqual([
      expect.objectContaining({ full_name: HOSTILE, balance_cents: 1673, days_overdue: 4 }),
    ]);
  });

  it.each(["trainer", "nutritionist", "chef", "clinician", "member", "guardian"] as Role[])(
    "%s: every report is 403",
    async (role) => {
      for (const url of [
        "/v1/reports/dashboard",
        "/v1/reports/today",
        "/v1/reports/overdue",
        "/v1/reports/ivu?month=2026-09",
        "/v1/reports/sales?from=2026-09-01&to=2026-09-30",
        "/v1/reports/members",
        "/v1/reports/overdue.csv",
      ]) {
        const r = await call(role, "GET", url);
        expect(r.statusCode, `${role} ${url}`).toBe(403);
      }
    },
  );

  it("unauthenticated → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/reports/dashboard" });
    expect(r.statusCode).toBe(401);
  });
});

describe("heatmap, expiring, members", () => {
  it("heatmap returns the 7 × 24 grid; weeks other than 4/8 → 400", async () => {
    const r = await call("owner", "GET", "/v1/reports/heatmap?weeks=8");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.weeks).toBe(8);
    expect(body.data).toHaveLength(168);
    expect(
      body.data.reduce((a: number, c: { check_ins: number }) => a + c.check_ins, 0),
    ).toBeGreaterThan(0);
    expect((await call("owner", "GET", "/v1/reports/heatmap?weeks=5")).statusCode).toBe(400);
  });

  it("expiring and members respond for the owner; bad parameters → 400", async () => {
    expect((await call("owner", "GET", "/v1/reports/expiring?days=7")).statusCode).toBe(200);
    expect((await call("owner", "GET", "/v1/reports/expiring?days=40")).statusCode).toBe(400);
    const m = await call("owner", "GET", "/v1/reports/members?months=3");
    expect(m.statusCode).toBe(200);
    expect(m.json().flow).toHaveLength(3);
    expect(
      m.json().status.find((s: { status: string }) => s.status === "past_due").members,
    ).toBeGreaterThanOrEqual(1);
  });

  it("strict query: unknown parameters are rejected", async () => {
    const r = await call("owner", "GET", "/v1/reports/dashboard?location_id=x");
    expect(r.statusCode).toBe(400);
    const r2 = await call("owner", "GET", `/v1/reports/dashboard?org_id=${t.fx.B.orgId}`);
    expect(r2.statusCode).toBe(400);
  });
});

describe("financial reports", () => {
  it("accountant reads IVU and sales org-wide; panel and members are 403", async () => {
    const ivu = await call("accountant", "GET", "/v1/reports/ivu?month=2026-11");
    expect(ivu.statusCode).toBe(200);
    expect(Array.isArray(ivu.json().data)).toBe(true);
    const sales = await call(
      "accountant",
      "GET",
      "/v1/reports/sales?from=2026-01-01&to=2026-12-31",
    );
    expect(sales.statusCode).toBe(200);
    expect((await call("accountant", "GET", "/v1/reports/dashboard")).statusCode).toBe(403);
    expect((await call("accountant", "GET", "/v1/reports/members")).statusCode).toBe(403);
  });

  it("invalid month / range → 400", async () => {
    expect((await call("owner", "GET", "/v1/reports/ivu?month=2026-13")).statusCode).toBe(400);
    expect(
      (await call("owner", "GET", "/v1/reports/sales?from=2024-01-01&to=2026-01-01")).statusCode,
    ).toBe(400);
    expect(
      (await call("owner", "GET", "/v1/reports/sales?from=2026-02-30&to=2026-03-01")).statusCode,
    ).toBe(400);
  });
});

describe("CSV exports", () => {
  it("IVU CSV: text/csv attachment with BOM and header; the export is audited with the real actor", async () => {
    const before = (await exports()).length;
    const r = await call("accountant", "GET", "/v1/reports/ivu.csv?month=2026-11&lang=en");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="ivu-2026-11.csv"');
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    expect(r.body.slice(1).split("\r\n")[0]).toBe(
      "municipality,suri_status,source,documents,taxable_base_usd,exempt_base_usd,ivu_state_usd,ivu_municipal_usd",
    );
    const after = await exports();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({ entity_id: "ivu", actor_role: "accountant" });
  });

  it("overdue CSV neutralises a hostile member name (no formula, quoted) and shows money in dollars", async () => {
    const r = await call("front_desk", "GET", "/v1/reports/overdue.csv?envelope=json");
    expect(r.statusCode).toBe(200);
    const { filename, csv } = r.json();
    expect(filename).toBe("saldos-vencidos.csv");
    const line = (csv as string).split("\r\n")[1] ?? "";
    expect(line).toContain(`"'=HYPERLINK(""http://evil.example"",""x""), Demo"`);
    expect(line).not.toMatch(/,=HYPERLINK/);
    expect(line.endsWith(",16.73")).toBe(true);
  });

  it("a refused export writes nothing to the audit log", async () => {
    const before = (await exports()).length;
    expect(
      (await call("front_desk", "GET", "/v1/reports/sales.csv?from=2026-09-01&to=2026-09-30"))
        .statusCode,
    ).toBe(403);
    expect((await call("trainer", "GET", "/v1/reports/overdue.csv")).statusCode).toBe(403);
    expect(
      (await call("owner", "GET", `/v1/reports/heatmap.csv?location_id=${t.fx.B.locations[0]}`))
        .statusCode,
    ).toBe(403);
    expect(await exports()).toHaveLength(before);
  });

  it("every report has a CSV export for the owner", async () => {
    for (const url of [
      "/v1/reports/overdue.csv",
      "/v1/reports/expiring.csv?days=7",
      "/v1/reports/heatmap.csv?weeks=4",
      "/v1/reports/ivu.csv?month=2026-11",
      "/v1/reports/sales.csv?from=2026-11-01&to=2026-11-30",
      "/v1/reports/members.csv?months=6",
    ]) {
      const r = await call("owner", "GET", url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers["content-type"], url).toMatch(/^text\/csv/);
    }
  });

  it("csvCell: quoting, formula prefixes and money", () => {
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("+1 787 555 0100")).toBe("'+1 787 555 0100");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('di "x"')).toBe('"di ""x"""');
    expect(csvCell("línea\nnueva")).toBe("línea nueva");
    expect(csvCell(-12)).toBe("-12");
    expect(csvCell({ cents: -2500 })).toBe("-25.00");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a"], [[1]])).toBe("﻿a\r\n1\r\n");
  });
});

describe("SURI participation per municipality", () => {
  it("owner upserts; the change is audited; manager and accountant read; accountant cannot write", async () => {
    const put = await call("owner", "PUT", "/v1/reports/ivu-municipalities", {
      municipality: "Bayamón",
      suri_status: "non_participant",
      note: "Demo: confirmar con CPA",
    });
    expect(put.statusCode, put.body).toBe(200);
    const again = await call("owner", "PUT", "/v1/reports/ivu-municipalities", {
      municipality: "bayamón",
      suri_status: "participant",
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      id: put.json().id,
      suri_status: "participant",
      note: null,
    });
    const audit = await t.admin.query(
      "SELECT action FROM app.audit_log WHERE entity = 'ivu_municipality' AND entity_id = $1 ORDER BY id",
      [put.json().id],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "ivu_municipality.create",
      "ivu_municipality.update",
    ]);
    const lm = await call("location_manager", "GET", "/v1/reports/ivu-municipalities");
    expect(lm.json().data.map((d: { municipality: string }) => d.municipality)).toContain(
      "Bayamón",
    );
    const acc = await call("accountant", "PUT", "/v1/reports/ivu-municipalities", {
      municipality: "Ponce",
      suri_status: "participant",
    });
    expect(acc.statusCode).toBe(403);
    const fd = await call("front_desk", "GET", "/v1/reports/ivu-municipalities");
    expect(fd.json().data).toEqual([]);
  });

  it("body is strict and the name is screened", async () => {
    for (const body of [
      { municipality: "Ponce", suri_status: "participant", org_id: t.fx.B.orgId },
      { municipality: "Ponce", suri_status: "participant", updated_by: t.fx.A.people.accountant },
      { municipality: "http://evil.example", suri_status: "participant" },
      { municipality: "Ponce", suri_status: "maybe" },
      { municipality: "Ponce", suri_status: "participant", note: "a\u0000b" },
    ]) {
      const r = await call("owner", "PUT", "/v1/reports/ivu-municipalities", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});
