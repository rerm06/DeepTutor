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

let skuSeq = 0;
async function mkProduct(
  opts: { qty?: number; loc?: string; restricted?: boolean; price?: number } = {},
) {
  skuSeq += 1;
  const A = t.fx.A;
  const { rows } = await t.admin.query<{ id: string }>(
    `INSERT INTO app.product (org_id, sku, name, category, age_restricted, price_cents)
     VALUES ($1, $2, $3, 'supplement', $4, $5) RETURNING id`,
    [A.orgId, `API-${skuSeq}`, `Demo api ${skuSeq}`, opts.restricted ?? false, opts.price ?? 1000],
  );
  const id = rows[0]?.id as string;
  if (opts.qty) {
    const loc = opts.loc ?? A.locations[0];
    await t.admin.query(
      "INSERT INTO app.inventory_level (org_id, product_id, location_id, on_hand) VALUES ($1,$2,$3,$4)",
      [A.orgId, id, loc, opts.qty],
    );
    await t.admin.query(
      `INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, by_person_id)
       VALUES ($1,$2,$3,'receive',$4,'TEST',$5)`,
      [A.orgId, id, loc, opts.qty, A.people.owner],
    );
  }
  return id;
}
async function onHand(productId: string, loc = t.fx.A.locations[0]) {
  const { rows } = await t.admin.query(
    "SELECT on_hand, reserved FROM app.inventory_level WHERE product_id = $1 AND location_id = $2",
    [productId, loc],
  );
  return rows[0];
}

beforeAll(async () => {
  t = await createTestDb();
  app = await buildApp({ db: t.api, jwtSecret: SECRET, jwtIssuer: ISS, jwtAudience: AUD });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

describe("POS: POST /v1/store/sales", () => {
  it("front desk sells and gets a receipt with the per-line IVU breakdown", async () => {
    const p = await mkProduct({ qty: 5, price: 100 });
    const q = await mkProduct({ qty: 5, price: 100 });
    const r = await call(as("front_desk"), "POST", "/store/sales", {
      location_id: t.fx.A.locations[0],
      lines: [
        { product_id: p, qty: 1 },
        { product_id: q, qty: 1 },
      ],
      payment_method: "cash",
    });
    expect(r.statusCode).toBe(201);
    const sale = r.json();
    expect(sale).toMatchObject({
      status: "completed",
      channel: "pos",
      subtotal_cents: 200,
      ivu_state_cents: 22,
      ivu_municipal_cents: 2,
      total_cents: 224,
      payment_method: "cash",
      location_name: "Demo A Sede 1",
    });
    expect(sale.lines).toHaveLength(2);
    expect(sale.lines[0]).toMatchObject({ qty: 1, ivu_state_cents: 11, ivu_municipal_cents: 1 });
    expect((await onHand(p)).on_hand).toBe(4);
  });

  it("an age-restricted item without verification → 400 with reason; with it → 201", async () => {
    const p = await mkProduct({ qty: 2, restricted: true });
    const body = {
      location_id: t.fx.A.locations[0],
      lines: [{ product_id: p, qty: 1 }],
      payment_method: "card_simulated",
    };
    const r = await call(as("front_desk"), "POST", "/store/sales", body);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: "invalid_input", reason: "age_verification_required" });
    expect((await onHand(p)).on_hand).toBe(2);
    const ok = await call(as("front_desk"), "POST", "/store/sales", {
      ...body,
      age_verified: true,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().age_verified).toBe(true);
  });

  it("insufficient stock → 409 conflict with reason, nothing sold", async () => {
    const p = await mkProduct({ qty: 1 });
    const r = await call(as("front_desk"), "POST", "/store/sales", {
      location_id: t.fx.A.locations[0],
      lines: [{ product_id: p, qty: 2 }],
      payment_method: "cash",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "conflict", reason: "insufficient_stock" });
    expect((await onHand(p)).on_hand).toBe(1);
  });

  it("other location, other organisation and non-selling roles → 403", async () => {
    const p = await mkProduct({ qty: 5, loc: t.fx.A.locations[1] });
    const body = (loc: string) => ({
      location_id: loc,
      lines: [{ product_id: p, qty: 1 }],
      payment_method: "cash",
    });
    expect(
      (await call(as("front_desk"), "POST", "/store/sales", body(t.fx.A.locations[1]))).statusCode,
    ).toBe(403);
    expect(
      (await call(as("owner", t.fx.B), "POST", "/store/sales", body(t.fx.A.locations[1])))
        .statusCode,
    ).toBe(403);
    for (const role of [
      "trainer",
      "chef",
      "clinician",
      "nutritionist",
      "accountant",
      "member",
    ] as Role[]) {
      const r = await call(as(role), "POST", "/store/sales", body(t.fx.A.locations[1]));
      expect(r.statusCode, role).toBe(403);
    }
    expect((await onHand(p, t.fx.A.locations[1])).on_hand).toBe(5);
  });

  it("hostile bodies are refused by .strict() schemas (400) and nothing is sold", async () => {
    const p = await mkProduct({ qty: 5 });
    const base = {
      location_id: t.fx.A.locations[0],
      lines: [{ product_id: p, qty: 1 }],
      payment_method: "cash",
    };
    for (const body of [
      { ...base, total_cents: 1 },
      { ...base, lines: [{ product_id: p, qty: 1, unit_price_cents: 1 }] },
      { ...base, lines: [] },
      { ...base, lines: [{ product_id: p, qty: 0 }] },
      { ...base, lines: [{ product_id: p, qty: 1.5 }] },
      { ...base, lines: [{ product_id: "not-a-uuid", qty: 1 }] },
      { ...base, payment_method: "stripe_live" },
      { ...base, age_verified: "yes" },
      { ...base, location_id: "' OR 1=1 --" },
    ]) {
      const r = await call(as("front_desk"), "POST", "/store/sales", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await onHand(p)).on_hand).toBe(5);
  });
});

describe("refunds and sales list", () => {
  it("the manager refunds; front desk and accountant cannot; the accountant reads every sale", async () => {
    const p = await mkProduct({ qty: 3 });
    const sale = (
      await call(as("front_desk"), "POST", "/store/sales", {
        location_id: t.fx.A.locations[0],
        lines: [{ product_id: p, qty: 3 }],
        payment_method: "cash",
      })
    ).json();
    for (const role of ["front_desk", "accountant"] as Role[]) {
      const r = await call(as(role), "POST", `/store/sales/${sale.id}/refund`, {
        reason: "Demo motivo",
      });
      expect(r.statusCode, role).toBe(403);
    }
    const bad = await call(as("location_manager"), "POST", `/store/sales/${sale.id}/refund`, {
      reason: "x",
    });
    expect(bad.statusCode).toBe(400);
    const r = await call(as("location_manager"), "POST", `/store/sales/${sale.id}/refund`, {
      reason: "Cliente devolvió el producto",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("refunded");
    expect((await onHand(p)).on_hand).toBe(3);
    const again = await call(as("owner"), "POST", `/store/sales/${sale.id}/refund`, {
      reason: "Otra vez",
    });
    expect(again.statusCode).toBe(409);

    const list = await call(as("accountant"), "GET", "/store/sales?status=refunded");
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((s: { id: string }) => s.id)).toContain(sale.id);
    const b = await call(as("owner", t.fx.B), "GET", `/store/sales/${sale.id}`);
    expect(b.statusCode).toBe(404);
  });
});

describe("online orders: POST /v1/store/orders → pickup", () => {
  it("member orders, sees the order, front desk hands it over with an ID check", async () => {
    const p = await mkProduct({ qty: 3, restricted: true, price: 3999 });
    const cat = await call(
      as("member"),
      "GET",
      `/store/catalogue?location_id=${t.fx.A.locations[0]}`,
    );
    expect(cat.statusCode).toBe(200);
    expect(cat.json().data.find((x: { product_id: string }) => x.product_id === p)).toMatchObject({
      available: 3,
      age_restricted: true,
    });
    const r = await call(as("member"), "POST", "/store/orders", {
      location_id: t.fx.A.locations[0],
      lines: [{ product_id: p, qty: 2 }],
    });
    expect(r.statusCode).toBe(201);
    const order = r.json();
    expect(order).toMatchObject({ status: "pending_pickup", channel: "online", total_cents: 8918 });
    expect(await onHand(p)).toEqual({ on_hand: 3, reserved: 2 });

    const mine = await call(as("member"), "GET", "/store/sales");
    expect(mine.json().data.map((s: { id: string }) => s.id)).toContain(order.id);
    const guardian = await call(as("guardian"), "GET", `/store/sales/${order.id}`);
    expect(guardian.statusCode).toBe(404);

    const noAge = await call(as("front_desk"), "POST", `/store/orders/${order.id}/pickup`, {
      payment_method: "cash",
    });
    expect(noAge.statusCode).toBe(400);
    expect(noAge.json().reason).toBe("age_verification_required");
    const done = await call(as("front_desk"), "POST", `/store/orders/${order.id}/pickup`, {
      payment_method: "cash",
      age_verified: true,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: "completed", age_verified: true });
    expect(await onHand(p)).toEqual({ on_hand: 1, reserved: 0 });
    const twice = await call(as("front_desk"), "POST", `/store/orders/${order.id}/pickup`, {
      payment_method: "cash",
      age_verified: true,
    });
    expect(twice.statusCode).toBe(409);
  });

  it("staff cannot order as a member; members cannot sell, manage products or see inventory", async () => {
    const p = await mkProduct({ qty: 3 });
    const body = { location_id: t.fx.A.locations[0], lines: [{ product_id: p, qty: 1 }] };
    expect((await call(as("front_desk"), "POST", "/store/orders", body)).statusCode).toBe(403);
    expect(
      (
        await call(as("member"), "POST", "/store/products", {
          sku: "MEM-1",
          name: "Demo",
          category: "other",
          price_cents: 1,
        })
      ).statusCode,
    ).toBe(403);
    const inv = await call(as("member"), "GET", "/store/inventory");
    expect(inv.json().data).toEqual([]);
  });

  it("member cancels own pending order", async () => {
    const p = await mkProduct({ qty: 2 });
    const order = (
      await call(as("member"), "POST", "/store/orders", {
        location_id: t.fx.A.locations[0],
        lines: [{ product_id: p, qty: 2 }],
      })
    ).json();
    const r = await call(as("member"), "POST", `/store/orders/${order.id}/cancel`);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("cancelled");
    expect(await onHand(p)).toEqual({ on_hand: 2, reserved: 0 });
  });
});

describe("products and inventory", () => {
  it("manager creates and edits a product; front desk cannot; hostile names are refused", async () => {
    const r = await call(as("location_manager"), "POST", "/store/products", {
      sku: "SHAKER-01",
      name: "Demo Shaker",
      category: "accessory",
      price_cents: 899,
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    const dup = await call(as("owner"), "POST", "/store/products", {
      sku: "SHAKER-01",
      name: "Demo Shaker 2",
      category: "accessory",
      price_cents: 899,
    });
    expect(dup.statusCode).toBe(409);
    const patch = await call(as("location_manager"), "PATCH", `/store/products/${id}`, {
      price_cents: 999,
      active: false,
    });
    expect(patch.statusCode).toBe(200);
    const fd = await call(as("front_desk"), "PATCH", `/store/products/${id}`, { price_cents: 1 });
    expect(fd.statusCode).toBe(404);
    for (const body of [
      { sku: "PATCH-SKU" },
      { org_id: t.fx.B.orgId },
      {},
      { name: "Demo visita gymbarato.com" },
    ]) {
      const bad = await call(as("owner"), "PATCH", `/store/products/${id}`, body);
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    }
    const row = await t.admin.query("SELECT price_cents, active FROM app.product WHERE id = $1", [
      id,
    ]);
    expect(row.rows[0]).toEqual({ price_cents: 999, active: false });
    const list = await call(as("member"), "GET", "/store/products?include_inactive=true");
    expect(list.json().data.map((x: { id: string }) => x.id)).not.toContain(id);
  });

  it("receive, adjust, transfer and the low-stock list", async () => {
    const A = t.fx.A;
    const p = await mkProduct();
    const mgr = as("location_manager");
    expect(
      (
        await call(mgr, "POST", "/store/inventory/receive", {
          location_id: A.locations[0],
          product_id: p,
          qty: 10,
          ref: "Factura 77",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(as("front_desk"), "POST", "/store/inventory/receive", {
          location_id: A.locations[0],
          product_id: p,
          qty: 10,
        })
      ).statusCode,
    ).toBe(403);
    const adj = await call(mgr, "POST", "/store/inventory/adjust", {
      location_id: A.locations[0],
      product_id: p,
      delta: -2,
      reason: "Conteo",
    });
    expect(adj.statusCode).toBe(200);
    const tr = await call(mgr, "POST", "/store/transfers", {
      from_location_id: A.locations[0],
      to_location_id: A.locations[1],
      lines: [{ product_id: p, qty: 5 }],
    });
    expect(tr.statusCode).toBe(201);
    const tooMuch = await call(mgr, "POST", "/store/transfers", {
      from_location_id: A.locations[0],
      to_location_id: A.locations[1],
      lines: [{ product_id: p, qty: 50 }],
    });
    expect(tooMuch.statusCode).toBe(409);
    expect((await onHand(p)).on_hand).toBe(3);
    expect((await onHand(p, A.locations[1])).on_hand).toBe(5);
    await call(mgr, "PUT", "/store/inventory/reorder-point", {
      location_id: A.locations[0],
      product_id: p,
      reorder_point: 4,
    });
    const low = await call(as("front_desk"), "GET", "/store/inventory?low=true");
    expect(low.json().data.map((x: { product_id: string }) => x.product_id)).toContain(p);
    const mv = await call(mgr, "GET", `/store/movements?product_id=${p}`);
    expect(
      mv
        .json()
        .data.map((m: { kind: string }) => m.kind)
        .sort(),
    ).toEqual(["adjust", "receive", "transfer_out"]);
    const fdMv = await call(as("front_desk"), "GET", "/store/movements");
    expect(fdMv.json().data).toEqual([]);
  });

  it("quote: server-side IVU for a member cart", async () => {
    const p = await mkProduct({ qty: 1, price: 100 });
    const r = await call(as("member"), "POST", "/store/quote", {
      lines: [{ product_id: p, qty: 3 }],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      subtotal_cents: 300,
      ivu_state_cents: 32,
      ivu_municipal_cents: 3,
      total_cents: 335,
    });
    const trainer = await call(as("trainer"), "POST", "/store/quote", {
      lines: [{ product_id: p, qty: 1 }],
    });
    expect(trainer.statusCode).toBe(400);
  });
});
