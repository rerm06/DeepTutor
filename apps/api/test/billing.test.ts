import { type TestDb, createTestDb } from "@gym/db/testing";
import type { Claims, Role } from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  type ChargeRequest,
  type PaymentGateway,
  routes as billingRoutes,
} from "../src/modules/billing.js";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const ISS = "gym-saas-test";
const AUD = "gym-saas-api";

let t: TestDb;
let app: FastifyInstance;
const charges: ChargeRequest[] = [];
let gatewayFails = false;
/** Recording, offline gateway mounted under /gw/v1 to observe what the adapter receives. */
const recordingGateway: PaymentGateway = {
  async charge(req) {
    charges.push(req);
    return gatewayFails
      ? { status: "failed", provider_ref: "sim_failed000" }
      : { status: "succeeded", provider_ref: `sim_${req.idempotency_key.replaceAll("-", "")}` };
  },
};

async function token(claims: Claims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}
const auth = async (claims: Claims) => ({ authorization: `Bearer ${await token(claims)}` });
const A = () => t.fx.A;
const B = () => t.fx.B;
const as = (role: Role, org = A()) => t.claims(org, role);

async function req(claims: Claims, method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: await auth(claims),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

let seq = 0;
async function newMember(org = A(), locIdx: 0 | 1 = 0) {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`api.billing.${seq}.${Date.now()}@demo.invalid`],
  );
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,'lead') RETURNING id",
    [org.orgId, p.rows[0]?.id, org.locations[locIdx], `Demo Api ${seq}`],
  );
  return { id: m.rows[0]?.id as string, person: p.rows[0]?.id as string };
}
let k = 0;
const key = () => `api-key-${Date.now()}-${++k}`;

/** Fixture ids by name (fixtures are inserted per org with the label in the name). */
async function priceOf(label: "A" | "B", productName: string) {
  const r = await t.admin.query(
    `SELECT pr.id FROM app.price pr JOIN app.plan_product pp ON pp.id = pr.product_id
      WHERE pp.name = $1 ORDER BY pr.created_at LIMIT 1`,
    [`${productName} ${label}`],
  );
  return r.rows[0].id as string;
}
async function openInvoiceAtLoc1(org = A()) {
  const r = await t.admin.query(
    "SELECT id FROM app.invoice WHERE org_id = $1 AND location_id = $2 AND status = 'open' ORDER BY number LIMIT 1",
    [org.orgId, org.locations[1]],
  );
  return r.rows[0].id as string;
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
  await app.register(billingRoutes, { prefix: "/gw/v1", gateway: recordingGateway });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("catalogue", () => {
  it("members read the catalogue; trainers see nothing; owner creates, front desk cannot", async () => {
    const m = await req(as("member"), "GET", "/v1/billing/catalog");
    expect(m.statusCode).toBe(200);
    expect(m.json().products.length).toBeGreaterThan(0);
    const tr = await req(as("trainer"), "GET", "/v1/billing/catalog");
    expect(tr.json()).toEqual({ products: [], prices: [] });

    const created = await req(as("owner"), "POST", "/v1/billing/products", {
      kind: "drop_in",
      name: "Sesión de prueba",
    });
    expect(created.statusCode).toBe(201);
    const price = await req(as("owner"), "POST", "/v1/billing/prices", {
      product_id: created.json().id,
      amount_cents: 2000,
      validity_days: 1,
    });
    expect(price.statusCode).toBe(201);
    expect(
      (
        await req(as("front_desk"), "POST", "/v1/billing/products", {
          kind: "drop_in",
          name: "X",
        })
      ).statusCode,
    ).toBe(403);
    // The location manager cannot price another location.
    expect(
      (
        await req(as("location_manager"), "POST", "/v1/billing/prices", {
          product_id: created.json().id,
          location_id: A().locations[1],
          amount_cents: 1,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("rejects unknown fields, hostile names and prices that do not fit the product", async () => {
    expect(
      (
        await req(as("owner"), "POST", "/v1/billing/products", {
          kind: "drop_in",
          name: "Sesión",
          org_id: B().orgId,
        })
      ).statusCode,
    ).toBe(400);
    for (const name of ["Visita gymbarato.com", "Plan con nutricionista", "Sesión {{x}}"]) {
      const r = await req(as("owner"), "POST", "/v1/billing/products", { kind: "drop_in", name });
      expect(r.statusCode, name).toBe(400);
    }
    const memb = await t.admin.query(
      "SELECT id FROM app.plan_product WHERE name = 'Demo Mensual A'",
    );
    const r = await req(as("owner"), "POST", "/v1/billing/prices", {
      product_id: memb.rows[0].id,
      amount_cents: 100,
      billing_interval: "none",
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("Cobrar sesión (pay per session)", () => {
  it("front desk sells one session: invoice with IVU, paid, same-day pass; retry is idempotent", async () => {
    const m = await newMember();
    const body = {
      price_id: await priceOf("A", "Demo Sesión"),
      location_id: A().locations[0],
      method: "cash",
      idempotency_key: key(),
    };
    const r = await req(as("front_desk"), "POST", `/v1/members/${m.id}/sales`, body);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ total_cents: 1673, status: "paid" });
    const again = await req(as("front_desk"), "POST", `/v1/members/${m.id}/sales`, body);
    expect(again.json().invoice_id).toBe(r.json().invoice_id);

    const billing = (await req(as("front_desk"), "GET", `/v1/members/${m.id}/billing`)).json();
    expect(billing.passes).toHaveLength(1);
    expect(billing.passes[0].live).toBe(true);
    expect(billing.invoices).toHaveLength(1);
    expect(billing.invoices[0]).toMatchObject({
      subtotal_cents: 1500,
      ivu_state_cents: 158,
      ivu_municipal_cents: 15,
      total_cents: 1673,
      balance_cents: 0,
    });
    expect(billing.invoices[0]).not.toHaveProperty("application_fee_cents");
    expect(billing.payments).toHaveLength(1);
  });

  it("simulated card charges go through the adapter with metadata.location_id and the idempotency key", async () => {
    const m = await newMember();
    const idem = key();
    const r = await req(as("front_desk"), "POST", `/gw/v1/members/${m.id}/sales`, {
      price_id: await priceOf("A", "Demo Paquete 10"),
      location_id: A().locations[0],
      quantity: 1,
      method: "card_simulated",
      idempotency_key: idem,
    });
    expect(r.statusCode).toBe(201);
    const c = charges.find((x) => x.idempotency_key === idem);
    expect(c).toMatchObject({
      amount_cents: 12000 + 1260 + 120,
      method: "card_simulated",
      metadata: { location_id: A().locations[0], invoice_id: r.json().invoice_id },
    });
    const credits = (await req(as("front_desk"), "GET", `/v1/members/${m.id}/billing`)).json()
      .credits;
    expect(credits[0]).toMatchObject({ credits_total: 10, credits_remaining: 10, live: true });
  });

  it("a failed charge rolls the whole sale back", async () => {
    const m = await newMember();
    gatewayFails = true;
    try {
      const r = await req(as("front_desk"), "POST", `/gw/v1/members/${m.id}/sales`, {
        price_id: await priceOf("A", "Demo Sesión"),
        location_id: A().locations[0],
        method: "card_simulated",
        idempotency_key: key(),
      });
      expect(r.statusCode).toBe(402);
    } finally {
      gatewayFails = false;
    }
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.invoice WHERE member_id = $1",
      [m.id],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("front desk of another location, other roles and other orgs are refused", async () => {
    const m = await newMember();
    const body = {
      price_id: await priceOf("A", "Demo Sesión"),
      location_id: A().locations[1],
      method: "cash",
      idempotency_key: key(),
    };
    expect(
      (await req(as("front_desk"), "POST", `/v1/members/${m.id}/sales`, body)).statusCode,
    ).toBe(403);
    for (const role of ["accountant", "trainer", "member"] as Role[]) {
      const r = await req(as(role), "POST", `/v1/members/${m.id}/sales`, {
        ...body,
        location_id: A().locations[0],
        idempotency_key: key(),
      });
      expect(r.statusCode, role).toBe(403);
    }
    const other = await req(as("owner", B()), "POST", `/v1/members/${m.id}/sales`, {
      price_id: await priceOf("B", "Demo Sesión"),
      location_id: B().locations[0],
      method: "cash",
      idempotency_key: key(),
    });
    expect(other.statusCode).toBe(403);
  });
});

describe("subscriptions: subscribe, freeze, cancel online", () => {
  it("full flow; the member cancels in one confirmed call and cannot touch someone else's", async () => {
    const m = await newMember();
    const sub = await req(as("front_desk"), "POST", `/v1/members/${m.id}/subscriptions`, {
      price_id: await priceOf("A", "Demo Mensual"),
    });
    expect(sub.statusCode).toBe(201);
    const subId = sub.json().id;
    const before = (await req(as("front_desk"), "GET", `/v1/members/${m.id}/billing`)).json()
      .subscriptions[0];

    const today = (
      await t.admin.query("SELECT ((now() AT TIME ZONE 'America/Puerto_Rico')::date)::text AS d")
    ).rows[0].d as string;
    const plus = (d: string, n: number) => {
      const x = new Date(`${d}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    const fr = await req(as("front_desk"), "POST", `/v1/subscriptions/${subId}/freeze`, {
      start_date: plus(today, 1),
      end_date: plus(today, 15),
    });
    expect(fr.statusCode).toBe(201);
    expect(fr.json().subscription.current_period_end).toBe(plus(before.current_period_end, 14));

    const memberClaims = t.claims(A(), "member", m.person);
    expect(
      (await req(memberClaims, "POST", `/v1/subscriptions/${subId}/cancel`, {})).statusCode,
    ).toBe(400);
    const cancel = await req(memberClaims, "POST", `/v1/subscriptions/${subId}/cancel`, {
      confirm: true,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({
      cancel_at_period_end: true,
      effective_date: plus(before.current_period_end, 14),
    });
    const mine = (await req(memberClaims, "GET", "/v1/billing/me")).json();
    expect(mine.subscriptions).toHaveLength(1);
    expect(mine.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: true });

    // Another member (the fixture member) cannot cancel it.
    expect(
      (await req(as("member"), "POST", `/v1/subscriptions/${subId}/cancel`, { confirm: true }))
        .statusCode,
    ).toBe(403);
  });
});

describe("invoices, payments and fees", () => {
  it("front desk of another location cannot record a payment; card numbers are refused", async () => {
    const inv = await openInvoiceAtLoc1();
    const body = { method: "cash", amount_cents: 100, idempotency_key: key() };
    expect(
      (await req(as("front_desk"), "POST", `/v1/invoices/${inv}/payments`, body)).statusCode,
    ).toBe(403);
    expect(
      (await req(as("accountant"), "POST", `/v1/invoices/${inv}/payments`, body)).statusCode,
    ).toBe(403);
    const card = await req(as("owner"), "POST", `/v1/invoices/${inv}/payments`, {
      ...body,
      reference: "4242 4242 4242 4242",
    });
    expect(card.statusCode).toBe(400);
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.payment WHERE invoice_id = $1",
      [inv],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("owner pays the balance in full → paid", async () => {
    const inv = await openInvoiceAtLoc1(B());
    const detail = (await req(as("owner", B()), "GET", `/v1/invoices/${inv}`)).json();
    expect(detail.lines.length).toBe(1);
    const r = await req(as("owner", B()), "POST", `/v1/invoices/${inv}/payments`, {
      method: "cash",
      amount_cents: detail.balance_cents,
      idempotency_key: key(),
      reference: "Recibo 0042",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().invoice_status).toBe("paid");
  });

  it("members list only their own invoices; front desk only its location; other orgs get 404", async () => {
    const mine = (await req(as("member"), "GET", "/v1/invoices")).json().data;
    expect(mine.length).toBeGreaterThan(0);
    for (const i of mine) expect(i.member_id).toBe(A().members[0]);
    const fd = (await req(as("front_desk"), "GET", "/v1/invoices")).json().data;
    for (const i of fd) expect(i.location_id).toBe(A().locations[0]);
    expect((await req(as("trainer"), "GET", "/v1/invoices")).json().data).toEqual([]);
    const acc = (await req(as("accountant"), "GET", "/v1/invoices?status=open")).json().data;
    expect(acc.some((i: { location_id: string }) => i.location_id === A().locations[1])).toBe(true);
    const inv = await openInvoiceAtLoc1();
    expect((await req(as("owner", B()), "GET", `/v1/invoices/${inv}`)).statusCode).toBe(404);
    expect((await req(as("member"), "GET", `/v1/invoices/${inv}`)).statusCode).toBe(404);
  });

  it("the platform fee is readable by owner and accountant only, and equals the plan rate", async () => {
    const r = await req(as("owner"), "GET", "/v1/billing/fees");
    expect(r.statusCode).toBe(200);
    for (const f of r.json().data) expect(f.application_fee_bps).toBe(100); // fixtures: plan esencial
    expect((await req(as("accountant"), "GET", "/v1/billing/fees")).statusCode).toBe(200);
    expect((await req(as("member"), "GET", "/v1/billing/fees")).statusCode).toBe(403);
    expect((await req(as("front_desk"), "GET", "/v1/billing/fees")).statusCode).toBe(403);
  });

  it("renewal cycle: owner and managers only, never in the future", async () => {
    expect((await req(as("front_desk"), "POST", "/v1/billing/cycle", {})).statusCode).toBe(403);
    const ok = await req(as("owner"), "POST", "/v1/billing/cycle", {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("renewed");
    expect(
      (await req(as("owner"), "POST", "/v1/billing/cycle", { as_of: "2099-01-01" })).statusCode,
    ).toBe(400);
    expect(
      (await req(as("owner"), "POST", "/v1/billing/cycle", { as_of: "2026-01-01", extra: 1 }))
        .statusCode,
    ).toBe(400);
  });
});
