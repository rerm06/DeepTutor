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
  claims: Claims,
  method: "GET" | "POST" | "PATCH" | "PUT",
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
const as = (role: Role, org = t.fx.A) => t.claims(org, role);

let seq = 0;
async function vendorId(org = t.fx.A): Promise<string> {
  const { rows } = await t.admin.query("SELECT id FROM app.vendor WHERE org_id = $1 LIMIT 1", [
    org.orgId,
  ]);
  return rows[0].id;
}
function billBody(amount: number, loc = t.fx.A.locations[0], vendor = "") {
  seq += 1;
  return {
    vendor_id: vendor,
    location_id: loc,
    number: `API-${seq}`,
    category: "maintenance",
    issued_on: "2026-10-01",
    due_on: "2026-10-31",
    amount_cents: amount,
  };
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("finance API · bills and approvals", () => {
  it("manager enters, owner approves, manager records payment; a paid bill cannot be voided (409 bill_immutable)", async () => {
    const v = await vendorId();
    const created = await call(
      as("location_manager"),
      "POST",
      "/finance/bills",
      billBody(42000, undefined, v),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("pending_approval");
    const id = created.json().id;

    const own = await call(as("location_manager"), "POST", `/finance/bills/${id}/decision`, {
      decision: "approve",
    });
    expect(own.statusCode).toBe(403);
    expect(own.json()).toEqual({ error: "forbidden", reason: "approver_is_creator" });

    const ok = await call(as("owner"), "POST", `/finance/bills/${id}/decision`, {
      decision: "approve",
      note: "Revisado",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id, status: "approved", vendor_name: "Demo Limpieza A" });

    const paid = await call(as("location_manager"), "POST", `/finance/bills/${id}/pay`, {
      paid_on: "2026-10-15",
      payment_ref: "CHK 2001",
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      status: "paid",
      paid_on: "2026-10-15",
      payment_ref: "CHK 2001",
    });

    const voided = await call(as("owner"), "POST", `/finance/bills/${id}/void`, {
      reason: "error",
    });
    expect(voided.statusCode).toBe(409);
    expect(voided.json()).toEqual({ error: "conflict", reason: "bill_immutable" });

    const approvals = await call(as("accountant"), "GET", `/finance/bills/${id}/approvals`);
    expect(approvals.json().data).toEqual([
      expect.objectContaining({
        approver_role: "owner",
        decision: "approve",
        amount_cents: 42000,
        note: "Revisado",
      }),
    ]);
  });

  it("the manager is refused above the threshold (403 above_threshold); the owner approves it", async () => {
    const v = await vendorId();
    const created = await call(
      as("owner"),
      "POST",
      "/finance/bills",
      billBody(50001, undefined, v),
    );
    const id = created.json().id;
    const r = await call(as("location_manager"), "POST", `/finance/bills/${id}/decision`, {
      decision: "approve",
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("above_threshold");
    const policy = await call(as("location_manager"), "GET", "/finance/policy");
    expect(policy.json().manager_approval_max_cents).toBe(50000);
    // Pending list shows it first, flagged as entered by the owner.
    const list = await call(as("owner"), "GET", "/finance/bills?status=pending_approval");
    expect(list.json().data.find((b: { id: string }) => b.id === id)).toMatchObject({
      created_by_me: true,
      amount_cents: 50001,
    });
  });

  it("only the owner changes the threshold", async () => {
    const mgr = await call(as("location_manager"), "PUT", "/finance/policy", {
      manager_approval_max_cents: 999999,
    });
    expect(mgr.statusCode).toBe(403);
    const own = await call(as("owner"), "PUT", "/finance/policy", {
      manager_approval_max_cents: 60000,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().manager_approval_max_cents).toBe(60000);
    const back = await call(as("owner"), "PUT", "/finance/policy", {
      manager_approval_max_cents: 50000,
    });
    expect(back.json().manager_approval_max_cents).toBe(50000);
  });

  it("other organisation and other location are refused", async () => {
    const v = await vendorId();
    const created = await call(
      as("owner"),
      "POST",
      "/finance/bills",
      billBody(1000, t.fx.A.locations[1], v),
    );
    const id = created.json().id;
    const b = await call(as("owner", t.fx.B), "POST", `/finance/bills/${id}/decision`, {
      decision: "approve",
    });
    expect(b.statusCode).toBe(403);
    expect(b.json()).toEqual({ error: "forbidden" });
    const listB = await call(as("owner", t.fx.B), "GET", "/finance/bills");
    expect(listB.json().data.map((x: { id: string }) => x.id)).not.toContain(id);
    const mgr = await call(as("location_manager"), "POST", `/finance/bills/${id}/decision`, {
      decision: "approve",
    });
    expect(mgr.statusCode).toBe(403);
    const mgrBill = await call(
      as("location_manager"),
      "POST",
      "/finance/bills",
      billBody(1000, t.fx.A.locations[1], v),
    );
    expect(mgrBill.statusCode).toBe(403);
    const status = await t.admin.query("SELECT status FROM app.bill WHERE id = $1", [id]);
    expect(status.rows[0].status).toBe("pending_approval");
  });

  it("bodies are strict: unknown keys, floats, bad refs and control characters are 400", async () => {
    const v = await vendorId();
    for (const body of [
      { ...billBody(100, undefined, v), status: "paid" },
      { ...billBody(100, undefined, v), amount_cents: 10.5 },
      { ...billBody(100, undefined, v), number: "=cmd|calc" },
      { ...billBody(100, undefined, v), memo: "hola\u0007" },
      { ...billBody(100, undefined, v), issued_on: "2026-13-45" },
    ]) {
      const r = await call(as("owner"), "POST", "/finance/bills", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const r = await call(as("owner"), "GET", "/finance/pnl?month=2026-1");
    expect(r.statusCode).toBe(400);
  });
});

describe("finance API · roles", () => {
  it("accountant reads P&L, liabilities and exports, and cannot write", async () => {
    const acc = as("accountant");
    const pnl = await call(acc, "GET", "/finance/pnl?month=2026-01");
    expect(pnl.statusCode).toBe(200);
    const body = pnl.json();
    expect(body.basis).toBe("accrual");
    expect(body.locations).toHaveLength(2);
    // January 2026 fixtures: rent 2,500.00 + supplies 45.50 + paid bill 1,200.00 (pending bill excluded).
    expect(body.consolidated.expenses_cents).toBe(254550);
    expect(body.consolidated.bills_cents).toBe(120000);
    expect(body.consolidated.net_cents).toBe(
      body.locations.reduce((s: number, l: { net_cents: number }) => s + l.net_cents, 0),
    );
    const liab = await call(acc, "GET", "/finance/liabilities");
    expect(liab.statusCode).toBe(200);
    expect(liab.json().points).toEqual(
      expect.objectContaining({ outstanding_points: expect.any(Number) }),
    );
    const v = await vendorId();
    for (const [url, payload] of [
      ["/finance/bills", billBody(100, undefined, v)],
      [
        "/finance/expenses",
        {
          location_id: t.fx.A.locations[0],
          category: "other",
          amount_cents: 100,
          spent_on: "2026-10-01",
        },
      ],
      ["/finance/vendors", { name: "Demo Contable" }],
    ] as const) {
      const r = await call(acc, "POST", url, payload);
      expect(r.statusCode, url).toBe(403);
    }
    const ex = await call(acc, "POST", "/finance/exports", { month: "2026-01" });
    expect(ex.statusCode).toBe(201);
    expect(ex.json().filename).toBe("diario-2026-01.csv");
    expect(ex.json().csv.split("\r\n")[0]).toBe(
      "JournalNo,JournalDate,Account,Debits,Credits,Description,Location",
    );
    const again = await call(as("owner"), "GET", `/finance/exports/${ex.json().id}`);
    expect(again.json().csv).toBe(ex.json().csv);
    const list = await call(acc, "GET", "/finance/exports");
    expect(list.json().data.length).toBeGreaterThanOrEqual(2);
  });

  it("the manager sees only their location, gets no points liability and cannot export", async () => {
    const mgr = as("location_manager");
    const pnl = await call(mgr, "GET", "/finance/pnl?month=2026-01");
    expect(pnl.json().locations.map((l: { location_id: string }) => l.location_id)).toEqual([
      t.fx.A.locations[0],
    ]);
    const liab = await call(mgr, "GET", "/finance/liabilities");
    expect(liab.json().points).toBeNull();
    expect((await call(mgr, "POST", "/finance/exports", { month: "2026-01" })).statusCode).toBe(
      403,
    );
    expect((await call(mgr, "GET", "/finance/exports")).json().data).toEqual([]);
  });

  it.each([
    "front_desk",
    "trainer",
    "nutritionist",
    "chef",
    "clinician",
    "member",
    "guardian",
  ] as const)("%s gets nothing from finance", async (role) => {
    const c = as(role);
    expect((await call(c, "GET", "/finance/pnl?month=2026-01")).statusCode).toBe(403);
    expect((await call(c, "GET", "/finance/liabilities")).statusCode).toBe(403);
    expect((await call(c, "GET", "/finance/policy")).statusCode).toBe(403);
    expect((await call(c, "GET", "/finance/bills")).json().data).toEqual([]);
    expect((await call(c, "GET", "/finance/expenses")).json().data).toEqual([]);
    expect((await call(c, "GET", "/finance/commissions")).json().data).toEqual([]);
    expect((await call(c, "POST", "/finance/exports", { month: "2026-01" })).statusCode).toBe(403);
  });
});

describe("finance API · expenses, recurring and commissions", () => {
  it("manager records an expense, voids it once (409 on the second void)", async () => {
    const r = await call(as("location_manager"), "POST", "/finance/expenses", {
      location_id: t.fx.A.locations[0],
      category: "supplies",
      amount_cents: 1250,
      spent_on: "2026-10-03",
      receipt_note: "Demo recibo",
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    const list = await call(as("location_manager"), "GET", "/finance/expenses?month=2026-10");
    expect(list.json().data.map((e: { id: string }) => e.id)).toContain(id);
    expect(
      (await call(as("owner"), "POST", `/finance/expenses/${id}/void`, { reason: "Duplicado" }))
        .statusCode,
    ).toBe(200);
    const again = await call(as("owner"), "POST", `/finance/expenses/${id}/void`, {
      reason: "Duplicado",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().reason).toBe("invalid_status");
  });

  it("recurring: create, refuse a future run date, run (idempotent)", async () => {
    const r = await call(as("owner"), "POST", "/finance/recurring", {
      location_id: t.fx.A.locations[1],
      category: "utilities",
      description: "Demo agua",
      amount_cents: 6000,
      next_on: "2023-01-01",
    });
    expect(r.statusCode).toBe(201);
    const future = await call(as("owner"), "POST", "/finance/recurring/run", {
      as_of: "2099-01-01",
    });
    expect(future.statusCode).toBe(400);
    expect(future.json().reason).toBe("invalid_date");
    const run = await call(as("owner"), "POST", "/finance/recurring/run", { as_of: "2023-02-15" });
    expect(run.json()).toEqual({ created: 2 });
    const rerun = await call(as("owner"), "POST", "/finance/recurring/run", {
      as_of: "2023-02-15",
    });
    expect(rerun.json()).toEqual({ created: 0 });
    const off = await call(as("owner"), "PATCH", `/finance/recurring/${r.json().id}`, {
      active: false,
    });
    expect(off.statusCode).toBe(200);
  });

  it("commissions: manager proposes, owner approves and pays; manager cannot change status", async () => {
    const staff = await call(
      as("location_manager"),
      "GET",
      `/finance/staff?location_id=${t.fx.A.locations[0]}`,
    );
    const trainer = staff.json().data.find((s: { role: string }) => s.role === "trainer");
    expect(trainer).toBeTruthy();
    const r = await call(as("location_manager"), "POST", "/finance/commissions", {
      staff_member_id: trainer.id,
      location_id: t.fx.A.locations[0],
      source: "session",
      source_ref: "API-SES-1",
      amount_cents: 2000,
      earned_on: "2026-10-04",
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    expect(
      (
        await call(as("location_manager"), "POST", `/finance/commissions/${id}/status`, {
          status: "approved",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(as("owner"), "POST", `/finance/commissions/${id}/status`, { status: "approved" }))
        .statusCode,
    ).toBe(200);
    const paid = await call(as("owner"), "POST", `/finance/commissions/${id}/status`, {
      status: "paid",
      paid_on: "2026-10-20",
    });
    expect(paid.json()).toEqual({ id, status: "paid" });
    const again = await call(as("owner"), "POST", `/finance/commissions/${id}/status`, {
      status: "void",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().reason).toBe("commission_immutable");
  });
});
