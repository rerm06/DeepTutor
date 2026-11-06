import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const STORE_TABLES = [
  "product",
  "inventory_level",
  "sale",
  "sale_line",
  "stock_movement",
  "stock_transfer",
  "stock_transfer_line",
];
const NO_STORE_ROLES: Role[] = ["trainer", "nutritionist", "chef", "clinician"];

let skuSeq = 0;
/** A fresh product owned by this test, with `qty` units received at `loc` (admin path, ledger-consistent). */
async function mkProduct(
  org: OrgFixture,
  opts: {
    qty?: number;
    loc?: string;
    restricted?: boolean;
    taxable?: boolean;
    price?: number;
  } = {},
): Promise<string> {
  skuSeq += 1;
  const { rows } = await t.admin.query<{ id: string }>(
    `INSERT INTO app.product (org_id, sku, name, category, age_restricted, taxable, price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      org.orgId,
      `T-${skuSeq}`,
      `Demo test ${skuSeq}`,
      opts.restricted ? "supplement" : "drink",
      opts.restricted ?? false,
      opts.taxable ?? true,
      opts.price ?? 1000,
    ],
  );
  const id = rows[0]?.id as string;
  const qty = opts.qty ?? 0;
  if (qty > 0) {
    const loc = opts.loc ?? org.locations[0];
    await t.admin.query(
      "INSERT INTO app.inventory_level (org_id, product_id, location_id, on_hand) VALUES ($1,$2,$3,$4)",
      [org.orgId, id, loc, qty],
    );
    await t.admin.query(
      `INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, by_person_id)
       VALUES ($1,$2,$3,'receive',$4,'TEST',$5)`,
      [org.orgId, id, loc, qty, org.people.owner],
    );
  }
  return id;
}

async function level(productId: string, loc: string) {
  const { rows } = await t.admin.query<{ on_hand: number; reserved: number }>(
    "SELECT on_hand, reserved FROM app.inventory_level WHERE product_id = $1 AND location_id = $2",
    [productId, loc],
  );
  return rows[0] ?? { on_hand: 0, reserved: 0 };
}

const lines = (...l: Array<[string, number]>) =>
  JSON.stringify(l.map(([product_id, qty]) => ({ product_id, qty })));

async function sell(
  tx: Tx,
  loc: string,
  l: string,
  opts: { pay?: string | null; member?: string | null; age?: boolean } = {},
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "SELECT app.record_sale($1, $2::jsonb, $3, $4, $5) AS id",
    [loc, l, opts.pay === undefined ? "cash" : opts.pay, opts.member ?? null, opts.age ?? false],
  );
  return rows[0]?.id as string;
}
async function order(tx: Tx, loc: string, l: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "SELECT app.place_online_order($1, $2::jsonb) AS id",
    [loc, l],
  );
  return rows[0]?.id as string;
}

async function memberPerson(memberId: string): Promise<string> {
  const { rows } = await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [
    memberId,
  ]);
  return rows[0].person_id;
}

/** E11: for every (product, location) of the org, on_hand = Σ movements and reserved = Σ pending lines. */
async function ledgerMismatches(orgId: string) {
  const { rows } = await t.admin.query(
    `SELECT i.product_id, i.location_id, i.on_hand, i.reserved,
            coalesce((SELECT sum(m.qty) FROM app.stock_movement m
                       WHERE m.product_id = i.product_id AND m.location_id = i.location_id), 0)::int AS moved,
            coalesce((SELECT sum(sl.qty) FROM app.sale_line sl JOIN app.sale s ON s.id = sl.sale_id
                       WHERE s.status = 'pending_pickup' AND sl.product_id = i.product_id
                         AND s.location_id = i.location_id), 0)::int AS pending
       FROM app.inventory_level i WHERE i.org_id = $1`,
    [orgId],
  );
  return rows.filter((r) => r.on_hand !== r.moved || r.reserved !== r.pending);
}

const denied = (p: Promise<unknown>, code = "42501") => expect(p).rejects.toMatchObject({ code });

describe("IVU per line [VERIFICAR · CPA]", () => {
  it.each([
    [1, 100, true, [100, 11, 1, 112]], // 10.5 → 11 (half-up), 1 % → 1
    [3, 100, true, [300, 32, 3, 335]], // 31.5 → 32
    [1, 999, false, [999, 0, 0, 999]], // non-taxable line carries no IVU
    [1, 5, true, [5, 1, 0, 6]], // 0.525 → 1, 0.05 → 0
    [999, 100000, true, [99900000, 10489500, 999000, 111388500]],
  ])("store_line_amounts(%i × %i, taxable=%s)", async (qty, unit, taxable, expected) => {
    const { rows } = await t.admin.query(
      "SELECT subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents FROM app.store_line_amounts($1, $2, $3)",
      [qty, unit, taxable],
    );
    expect(Object.values(rows[0])).toEqual(expected);
  });

  it("a sale rounds IVU on each line, not on the invoice total", async () => {
    const { A } = t.fx;
    const p1 = await mkProduct(A, { qty: 5, price: 100 });
    const p2 = await mkProduct(A, { qty: 5, price: 100 });
    const p3 = await mkProduct(A, { qty: 5, price: 250, taxable: false });
    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p1, 1], [p2, 1], [p3, 2])),
    );
    const sale = await t.admin.query(
      "SELECT subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents FROM app.sale WHERE id = $1",
      [id],
    );
    // Per invoice it would be round(200 × 10.5 %) = 21; per line it is 11 + 11 = 22.
    expect(sale.rows[0]).toEqual({
      subtotal_cents: 700,
      ivu_state_cents: 22,
      ivu_municipal_cents: 2,
      total_cents: 724,
    });
    const ls = await t.admin.query(
      "SELECT product_id, ivu_state_cents, ivu_municipal_cents, total_cents FROM app.sale_line WHERE sale_id = $1",
      [id],
    );
    expect(ls.rows.find((r) => r.product_id === p3)).toMatchObject({
      ivu_state_cents: 0,
      ivu_municipal_cents: 0,
      total_cents: 500,
    });
  });

  it("the quote prices a cart server-side with the same per-line rule and writes nothing", async () => {
    const { A } = t.fx;
    const p1 = await mkProduct(A, { qty: 1, price: 100 });
    const p2 = await mkProduct(A, { qty: 1, price: 100, restricted: true });
    const q = await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      const { rows } = await tx.query("SELECT app.store_quote($1::jsonb) AS q", [
        lines([p1, 1], [p2, 1]),
      ]);
      return rows[0].q;
    });
    expect(q).toMatchObject({ subtotal_cents: 200, ivu_state_cents: 22, age_restricted: true });
    expect(q.lines).toHaveLength(2);
    expect((await level(p1, A.locations[0])).on_hand).toBe(1);
  });
});

describe("POS sale (record_sale)", () => {
  it.each([
    ["owner", 1],
    ["location_manager", 0],
    ["front_desk", 0],
  ] as Array<[Role, 0 | 1]>)(
    "%s sells at its location: stock, ledger and audit move together",
    async (role, li) => {
      const { A } = t.fx;
      const loc = A.locations[li];
      const p = await mkProduct(A, { qty: 5, loc });
      const id = await asCaller(t.api, t.claims(A, role), (tx) =>
        sell(tx, loc, lines([p, 2]), { pay: "card_simulated" }),
      );
      expect((await level(p, loc)).on_hand).toBe(3);
      const mv = await t.admin.query(
        "SELECT kind, qty FROM app.stock_movement WHERE sale_id = $1",
        [id],
      );
      expect(mv.rows).toEqual([{ kind: "sale", qty: -2 }]);
      const audit = await t.admin.query(
        "SELECT actor_role, location_id, meta FROM app.audit_log WHERE action = 'store.sale.record' AND entity_id = $1",
        [id],
      );
      expect(audit.rows[0]).toMatchObject({ actor_role: role, location_id: loc });
      expect(audit.rows[0].meta.total_cents).toBe(2230);
    },
  );

  it.each([...NO_STORE_ROLES, "accountant", "member", "guardian"] as Role[])(
    "%s cannot sell",
    async (role) => {
      const { A } = t.fx;
      const p = await mkProduct(A, { qty: 5 });
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(sell(tx, A.locations[0], lines([p, 1]))),
      );
      expect((await level(p, A.locations[0])).on_hand).toBe(5);
    },
  );

  it.each(["front_desk", "location_manager"] as Role[])(
    "%s cannot sell at a location it is not assigned to",
    async (role) => {
      const { A } = t.fx;
      const p = await mkProduct(A, { qty: 5, loc: A.locations[1] });
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(sell(tx, A.locations[1], lines([p, 1]))),
      );
    },
  );

  it("another organisation's location or product is refused and nothing is written", async () => {
    const { A, B } = t.fx;
    const pB = await mkProduct(B, { qty: 5 });
    const pA = await mkProduct(A, { qty: 5 });
    await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await denied(sell(tx, B.locations[0], lines([pA, 1])));
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await denied(sell(tx, A.locations[0], lines([pB, 1])), "22023");
    });
    expect((await level(pB, B.locations[0])).on_hand).toBe(5);
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.sale_line WHERE product_id = $1",
      [pB],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("a member of another location or org cannot be attached to the sale", async () => {
    const { A, B } = t.fx;
    const p = await mkProduct(A, { qty: 5 });
    for (const member of [A.members[1], B.members[0]]) {
      await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
        denied(sell(tx, A.locations[0], lines([p, 1]), { member })),
      );
    }
    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p, 1]), { member: A.members[0] }),
    );
    const s = await t.admin.query("SELECT member_id FROM app.sale WHERE id = $1", [id]);
    expect(s.rows[0].member_id).toBe(A.members[0]);
  });

  it("an age-restricted product without ID verification is refused; with it, the verifier is recorded", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 3, restricted: true });
    const plain = await mkProduct(A, { qty: 3 });
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      expect(sell(tx, A.locations[0], lines([plain, 1], [p, 1]))).rejects.toMatchObject({
        code: "22023",
        message: "age_verification_required",
      }),
    );
    expect((await level(p, A.locations[0])).on_hand).toBe(3);
    expect((await level(plain, A.locations[0])).on_hand).toBe(3);

    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p, 1]), { age: true }),
    );
    const s = await t.admin.query(
      `SELECT sm.person_id, sm.role FROM app.sale s JOIN app.staff_member sm ON sm.id = s.age_verified_by
        WHERE s.id = $1`,
      [id],
    );
    expect(s.rows[0]).toEqual({ person_id: A.people.front_desk, role: "front_desk" });
    // No restricted line → no verifier recorded even if the box was ticked.
    const id2 = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([plain, 1]), { age: true }),
    );
    const s2 = await t.admin.query("SELECT age_verified_by FROM app.sale WHERE id = $1", [id2]);
    expect(s2.rows[0].age_verified_by).toBeNull();
  });

  it("insufficient stock is refused and nothing is written", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 2 });
    const before = await t.admin.query("SELECT count(*)::int AS n FROM app.sale");
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      expect(sell(tx, A.locations[0], lines([p, 3]))).rejects.toMatchObject({
        code: "23514",
        message: "insufficient_stock",
      }),
    );
    // A product with no inventory row at the location counts as zero stock.
    const none = await mkProduct(A, { qty: 0 });
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(sell(tx, A.locations[0], lines([none, 1])), "23514"),
    );
    expect((await level(p, A.locations[0])).on_hand).toBe(2);
    const after = await t.admin.query("SELECT count(*)::int AS n FROM app.sale");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("inactive products cannot be sold", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 2 });
    await t.admin.query("UPDATE app.product SET active = false WHERE id = $1", [p]);
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(sell(tx, A.locations[0], lines([p, 1])), "22023"),
    );
  });

  it("hostile or malformed carts are refused (22023) before anything happens", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 5 });
    const bad = [
      "{}",
      "[]",
      '"x"',
      JSON.stringify([{ product_id: p, qty: 0 }]),
      JSON.stringify([{ product_id: p, qty: -1 }]),
      JSON.stringify([{ product_id: p, qty: 1.5 }]),
      JSON.stringify([{ product_id: p, qty: "1" }]),
      JSON.stringify([{ product_id: p, qty: 1000 }]),
      JSON.stringify([
        { product_id: p, qty: 600 },
        { product_id: p, qty: 600 },
      ]),
      JSON.stringify([{ product_id: p, qty: 1, unit_price_cents: 1 }]),
      JSON.stringify([{ product_id: "x'); DROP TABLE app.sale; --", qty: 1 }]),
      JSON.stringify([{ product_id: p.toUpperCase(), qty: 1 }]),
      JSON.stringify([[p, 1]]),
      JSON.stringify(Array.from({ length: 51 }, () => ({ product_id: p, qty: 1 }))),
    ];
    for (const l of bad) {
      await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
        denied(sell(tx, A.locations[0], l), "22023"),
      );
    }
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(sell(tx, A.locations[0], lines([p, 1]), { pay: null }), "22023"),
    );
    expect((await level(p, A.locations[0])).on_hand).toBe(5);
    // Duplicate lines of one product are merged into one sale line.
    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p, 1], [p, 2])),
    );
    const sl = await t.admin.query("SELECT qty FROM app.sale_line WHERE sale_id = $1", [id]);
    expect(sl.rows).toEqual([{ qty: 3 }]);
  });
});

describe("concurrency", () => {
  it("two concurrent sales of the last unit: exactly one succeeds", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 1 });
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, t.claims(A, "front_desk"));
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, t.claims(A, "location_manager"));
      await sell(c1, A.locations[0], lines([p, 1])); // holds the inventory row lock
      const second = sell(c2, A.locations[0], lines([p, 1])).then(
        () => "sold",
        (e) => e.message,
      );
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      expect(await second).toBe("insufficient_stock");
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect((await level(p, A.locations[0])).on_hand).toBe(0);
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.sale_line WHERE product_id = $1",
      [p],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("racing sales from separate transactions never oversell (Promise.all)", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        asCaller(t.api, t.claims(A, "front_desk"), (tx) => sell(tx, A.locations[0], lines([p, 1]))),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await level(p, A.locations[0])).on_hand).toBe(0);
  });

  it("an online reservation of the last unit blocks a POS sale of it", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 1 });
    await asCaller(t.api, t.claims(A, "member"), (tx) => order(tx, A.locations[0], lines([p, 1])));
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(sell(tx, A.locations[0], lines([p, 1])), "23514"),
    );
    expect(await level(p, A.locations[0])).toEqual({ on_hand: 1, reserved: 1 });
  });

  it("two concurrent refunds of one sale: only one restores stock", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 2 });
    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p, 2])),
    );
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        asCaller(t.api, t.claims(A, "location_manager"), (tx) =>
          tx.query("SELECT app.refund_sale($1, 'Demo devolución')", [id]),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await level(p, A.locations[0])).on_hand).toBe(2);
  });
});

describe("online orders (member) and pickup (front desk)", () => {
  it("a member orders for pickup: stock is reserved, not moved, and only they see the order", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 4, restricted: true });
    const id = await asCaller(t.api, t.claims(A, "member"), async (tx) => {
      const sid = await order(tx, A.locations[0], lines([p, 2]));
      const mine = await tx.query("SELECT status, channel, member_id FROM app.sale WHERE id = $1", [
        sid,
      ]);
      expect(mine.rows[0]).toEqual({
        status: "pending_pickup",
        channel: "online",
        member_id: A.members[0],
      });
      const ls = await tx.query("SELECT qty FROM app.sale_line WHERE sale_id = $1", [sid]);
      expect(ls.rows).toEqual([{ qty: 2 }]);
      return sid;
    });
    expect(await level(p, A.locations[0])).toEqual({ on_hand: 4, reserved: 2 });
    const mv = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.stock_movement WHERE sale_id = $1",
      [id],
    );
    expect(mv.rows[0].n).toBe(0);

    const other = t.claims(A, "member", await memberPerson(A.members[1]));
    for (const claims of [
      other,
      t.claims(A, "guardian"),
      t.claims(A, "trainer"),
      t.claims(t.fx.B, "owner"),
    ]) {
      await asCaller(t.api, claims, async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.sale WHERE id = $1", [id])).rowCount).toBe(0);
        expect(
          (await tx.query("SELECT 1 FROM app.sale_line WHERE sale_id = $1", [id])).rowCount,
        ).toBe(0);
      });
    }
  });

  it.each(["owner", "front_desk", "guardian", "accountant", "trainer"] as Role[])(
    "%s cannot place an online order",
    async (role) => {
      const { A } = t.fx;
      const p = await mkProduct(A, { qty: 4 });
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(order(tx, A.locations[0], lines([p, 1]))),
      );
    },
  );

  it("a staff member who is also a member cannot order under a staff token", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 4 });
    await t.admin.query(
      "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1, $2, $3, 'Demo staff member', 'active')",
      [A.orgId, A.people.front_desk, A.locations[0]],
    );
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(order(tx, A.locations[0], lines([p, 1]))),
    );
    // The same person with a member token may order.
    await asCaller(t.api, t.claims(A, "member", A.people.front_desk), (tx) =>
      order(tx, A.locations[0], lines([p, 1])),
    );
  });

  it("a member cannot order at another organisation's location or with its products", async () => {
    const { A, B } = t.fx;
    const pA = await mkProduct(A, { qty: 4 });
    const pB = await mkProduct(B, { qty: 4 });
    await asCaller(t.api, t.claims(A, "member"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await denied(order(tx, B.locations[0], lines([pA, 1])));
      await tx.query("ROLLBACK TO SAVEPOINT s");
      await denied(order(tx, A.locations[0], lines([pB, 1])), "22023");
    });
  });

  it("pickup checks age for restricted items, then moves stock and records payment and verifier", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 4, restricted: true });
    const id = await asCaller(t.api, t.claims(A, "member"), (tx) =>
      order(tx, A.locations[0], lines([p, 2])),
    );
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      expect(tx.query("SELECT app.complete_pickup($1, 'cash', false)", [id])).rejects.toMatchObject(
        {
          message: "age_verification_required",
        },
      ),
    );
    for (const role of ["accountant", "trainer", "member"] as Role[]) {
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(tx.query("SELECT app.complete_pickup($1, 'cash', true)", [id])),
      );
    }
    await asCaller(t.api, t.claims(t.fx.B, "owner"), (tx) =>
      denied(tx.query("SELECT app.complete_pickup($1, 'cash', true)", [id])),
    );
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      tx.query("SELECT app.complete_pickup($1, 'card_simulated', true)", [id]),
    );
    expect(await level(p, A.locations[0])).toEqual({ on_hand: 2, reserved: 0 });
    const s = await t.admin.query(
      "SELECT status, payment_method, age_verified_by IS NOT NULL AS verified FROM app.sale WHERE id = $1",
      [id],
    );
    expect(s.rows[0]).toEqual({
      status: "completed",
      payment_method: "card_simulated",
      verified: true,
    });
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(tx.query("SELECT app.complete_pickup($1, 'cash', true)", [id]), "22023"),
    );
  });

  it("front desk cannot hand over an order placed for another location", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 4, loc: A.locations[1] });
    const id = await asCaller(t.api, t.claims(A, "member"), (tx) =>
      order(tx, A.locations[1], lines([p, 1])),
    );
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.sale WHERE id = $1", [id])).rowCount).toBe(0);
      await denied(tx.query("SELECT app.complete_pickup($1, 'cash', true)", [id]));
    });
  });

  it("the member cancels their own order (reservation released); not someone else's", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 3 });
    const id = await asCaller(t.api, t.claims(A, "member"), (tx) =>
      order(tx, A.locations[0], lines([p, 3])),
    );
    const other = t.claims(A, "member", await memberPerson(A.members[1]));
    await asCaller(t.api, other, (tx) =>
      denied(tx.query("SELECT app.cancel_online_order($1)", [id])),
    );
    await asCaller(t.api, t.claims(A, "trainer"), (tx) =>
      denied(tx.query("SELECT app.cancel_online_order($1)", [id])),
    );
    await asCaller(t.api, t.claims(A, "member"), (tx) =>
      tx.query("SELECT app.cancel_online_order($1)", [id]),
    );
    expect(await level(p, A.locations[0])).toEqual({ on_hand: 3, reserved: 0 });
    await asCaller(t.api, t.claims(A, "member"), (tx) =>
      denied(tx.query("SELECT app.cancel_online_order($1)", [id]), "22023"),
    );
    const audit = await t.admin.query(
      "SELECT actor_role FROM app.audit_log WHERE action = 'store.order.cancel' AND entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ actor_role: "member" }]);
  });
});

describe("refunds", () => {
  it("the location manager refunds a sale: stock returns through a 'return' movement and it is audited", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 5 });
    const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      sell(tx, A.locations[0], lines([p, 2])),
    );
    for (const reason of ["", "  ", "x", "línea\nnueva", "a".repeat(201)]) {
      await asCaller(t.api, t.claims(A, "location_manager"), (tx) =>
        denied(tx.query("SELECT app.refund_sale($1, $2)", [id, reason]), "22023"),
      );
    }
    await asCaller(t.api, t.claims(A, "location_manager"), (tx) =>
      tx.query("SELECT app.refund_sale($1, 'Producto defectuoso')", [id]),
    );
    expect((await level(p, A.locations[0])).on_hand).toBe(5);
    const mv = await t.admin.query(
      "SELECT kind, qty FROM app.stock_movement WHERE sale_id = $1 ORDER BY kind",
      [id],
    );
    expect(mv.rows).toEqual([
      { kind: "sale", qty: -2 },
      { kind: "return", qty: 2 },
    ]);
    const s = await t.admin.query("SELECT status, refund_reason FROM app.sale WHERE id = $1", [id]);
    expect(s.rows[0]).toEqual({ status: "refunded", refund_reason: "Producto defectuoso" });
    const audit = await t.admin.query(
      "SELECT actor_role, meta FROM app.audit_log WHERE action = 'store.sale.refund' AND entity_id = $1",
      [id],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_role: "location_manager",
      meta: { total_cents: 2230 },
    });
    await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      denied(tx.query("SELECT app.refund_sale($1, 'otra vez')", [id]), "22023"),
    );
  });

  it.each(["front_desk", "accountant", "trainer", "member"] as Role[])(
    "%s cannot refund",
    async (role) => {
      const { A } = t.fx;
      const p = await mkProduct(A, { qty: 5 });
      const id = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
        sell(tx, A.locations[0], lines([p, 1])),
      );
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(tx.query("SELECT app.refund_sale($1, 'Demo motivo')", [id])),
      );
      expect((await level(p, A.locations[0])).on_hand).toBe(4);
    },
  );

  it("other location's manager and other organisation's owner cannot refund", async () => {
    const { A, B } = t.fx;
    const p = await mkProduct(A, { qty: 5, loc: A.locations[1] });
    const id = await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      sell(tx, A.locations[1], lines([p, 1])),
    );
    for (const claims of [t.claims(A, "location_manager"), t.claims(B, "owner")]) {
      await asCaller(t.api, claims, (tx) =>
        denied(tx.query("SELECT app.refund_sale($1, 'Demo motivo')", [id])),
      );
    }
  });
});

describe("stock management", () => {
  it("receive: owner and the location's manager; refs are screened; front desk and others are refused", async () => {
    const { A, B } = t.fx;
    const p = await mkProduct(A);
    await asCaller(t.api, t.claims(A, "location_manager"), (tx) =>
      tx.query("SELECT app.receive_stock($1, $2, 12, 'Factura 1001')", [A.locations[0], p]),
    );
    await asCaller(t.api, t.claims(A, "owner"), (tx) =>
      tx.query("SELECT app.receive_stock($1, $2, 3, NULL)", [A.locations[1], p]),
    );
    expect((await level(p, A.locations[0])).on_hand).toBe(12);
    expect((await level(p, A.locations[1])).on_hand).toBe(3);
    for (const [role, loc] of [
      ["front_desk", A.locations[0]],
      ["accountant", A.locations[0]],
      ["location_manager", A.locations[1]],
    ] as Array<[Role, string]>) {
      await asCaller(t.api, t.claims(A, role), (tx) =>
        denied(tx.query("SELECT app.receive_stock($1, $2, 1, NULL)", [loc, p])),
      );
    }
    await asCaller(t.api, t.claims(B, "owner"), (tx) =>
      denied(tx.query("SELECT app.receive_stock($1, $2, 1, NULL)", [B.locations[0], p]), "22023"),
    );
    for (const [qty, ref, code] of [
      [0, null, "22023"],
      [100001, null, "22023"],
      [1, "<script>", "23514"],
      [1, "https://evil.invalid", "23514"],
    ] as Array<[number, string | null, string]>) {
      await asCaller(t.api, t.claims(A, "owner"), (tx) =>
        denied(
          tx.query("SELECT app.receive_stock($1, $2, $3, $4)", [A.locations[0], p, qty, ref]),
          code,
        ),
      );
    }
    expect(await ledgerMismatches(A.orgId)).toEqual([]);
  });

  it("adjust: reason required, never below reserved units, recorded as an 'adjust' movement", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 5 });
    await asCaller(t.api, t.claims(A, "member"), (tx) => order(tx, A.locations[0], lines([p, 2])));
    const adj = (
      claims = t.claims(A, "location_manager"),
      delta = -1,
      reason: string | null = "Conteo físico",
    ) =>
      asCaller(t.api, claims, (tx) =>
        tx.query("SELECT app.adjust_stock($1, $2, $3, $4)", [A.locations[0], p, delta, reason]),
      );
    await denied(adj(undefined, -1, null), "22023");
    await denied(adj(undefined, 0), "22023");
    await denied(adj(undefined, -4), "23514"); // 5 − 4 = 1 < 2 reserved
    await denied(adj(t.claims(A, "front_desk")));
    await adj(undefined, -3, "Producto vencido");
    expect(await level(p, A.locations[0])).toEqual({ on_hand: 2, reserved: 2 });
    const mv = await t.admin.query(
      "SELECT qty, reason FROM app.stock_movement WHERE product_id = $1 AND kind = 'adjust'",
      [p],
    );
    expect(mv.rows).toEqual([{ qty: -3, reason: "Producto vencido" }]);
  });

  it("transfer: atomic out/in between the org's locations, from a location the caller manages", async () => {
    const { A, B } = t.fx;
    const p = await mkProduct(A, { qty: 6 });
    const q = await mkProduct(A, { qty: 1 });
    const tr = (
      claims = t.claims(A, "location_manager"),
      from = A.locations[0],
      to = A.locations[1],
      l = lines([p, 4]),
    ) =>
      asCaller(t.api, claims, async (tx) => {
        const { rows } = await tx.query(
          "SELECT app.transfer_stock($1, $2, $3::jsonb, 'Demo') AS id",
          [from, to, l],
        );
        return rows[0].id as string;
      });
    // Not enough of q: the whole transfer fails, p does not move either.
    await denied(tr(undefined, A.locations[0], A.locations[1], lines([p, 4], [q, 2])), "23514");
    expect((await level(p, A.locations[0])).on_hand).toBe(6);
    expect((await level(p, A.locations[1])).on_hand).toBe(0);

    const id = await tr();
    expect((await level(p, A.locations[0])).on_hand).toBe(2);
    expect((await level(p, A.locations[1])).on_hand).toBe(4);
    const mv = await t.admin.query(
      "SELECT kind, qty, location_id FROM app.stock_movement WHERE transfer_id = $1 ORDER BY qty",
      [id],
    );
    expect(mv.rows).toEqual([
      { kind: "transfer_out", qty: -4, location_id: A.locations[0] },
      { kind: "transfer_in", qty: 4, location_id: A.locations[1] },
    ]);
    // Manager of location 0 cannot pull from location 1; nobody can ship to another org; front desk cannot transfer.
    await denied(tr(undefined, A.locations[1], A.locations[0], lines([p, 1])));
    await denied(tr(t.claims(A, "owner"), A.locations[0], B.locations[0], lines([p, 1])));
    await denied(tr(t.claims(A, "front_desk"), A.locations[0], A.locations[1], lines([p, 1])));
    await denied(tr(t.claims(A, "owner"), A.locations[0], A.locations[0], lines([p, 1])), "22023");
    expect(await ledgerMismatches(A.orgId)).toEqual([]);
  });

  it("reorder points feed the low-stock list; setting one is manager-only and audited", async () => {
    const { A } = t.fx;
    const p = await mkProduct(A, { qty: 2 });
    await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      denied(tx.query("SELECT app.set_reorder_point($1, $2, 5)", [A.locations[0], p])),
    );
    await asCaller(t.api, t.claims(A, "location_manager"), (tx) =>
      tx.query("SELECT app.set_reorder_point($1, $2, 5)", [A.locations[0], p]),
    );
    const low = await asCaller(t.api, t.claims(A, "front_desk"), (tx) =>
      tx.query(
        "SELECT product_id FROM app.inventory_level WHERE on_hand - reserved <= reorder_point AND product_id = $1",
        [p],
      ),
    );
    expect(low.rowCount).toBe(1);
    const audit = await t.admin.query(
      "SELECT 1 FROM app.audit_log WHERE action = 'store.stock.reorder_point' AND entity_id = $1",
      [p],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("read access by role (RLS)", () => {
  it.each(NO_STORE_ROLES)("%s sees no store data and cannot open the catalogue", async (role) => {
    await asCaller(t.api, t.claims(t.fx.A, role), async (tx) => {
      for (const table of STORE_TABLES) {
        expect((await tx.query(`SELECT 1 FROM app.${table}`)).rowCount, table).toBe(0);
      }
      await denied(tx.query("SELECT * FROM app.store_catalogue($1)", [t.fx.A.locations[0]]));
    });
  });

  it("the accountant reads every sale and line but no stock tables, and writes nothing", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "accountant"), async (tx) => {
      const sales = await tx.query("SELECT DISTINCT location_id FROM app.sale");
      expect(sales.rows.map((r) => r.location_id).sort()).toEqual([...A.locations].sort());
      expect((await tx.query("SELECT 1 FROM app.sale_line")).rowCount).toBeGreaterThan(0);
      expect((await tx.query("SELECT 1 FROM app.product")).rowCount).toBeGreaterThan(0);
      for (const table of [
        "inventory_level",
        "stock_movement",
        "stock_transfer",
        "stock_transfer_line",
      ]) {
        expect((await tx.query(`SELECT 1 FROM app.${table}`)).rowCount, table).toBe(0);
      }
      await denied(
        tx.query(
          "INSERT INTO app.product (sku, name, category, price_cents) VALUES ('ACC-1', 'Demo x', 'other', 1)",
        ),
      );
    });
  });

  it("front desk sees stock and sales of its own location only, and no movement ledger", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "front_desk"), async (tx) => {
      const inv = await tx.query("SELECT DISTINCT location_id FROM app.inventory_level");
      expect(inv.rows.map((r) => r.location_id)).toEqual([A.locations[0]]);
      const sales = await tx.query("SELECT DISTINCT location_id FROM app.sale");
      expect(sales.rows.map((r) => r.location_id)).toEqual([A.locations[0]]);
      expect((await tx.query("SELECT 1 FROM app.stock_movement")).rowCount).toBe(0);
      expect((await tx.query("SELECT 1 FROM app.stock_transfer")).rowCount).toBe(0);
    });
  });

  it("the location manager sees the ledger of its own location only", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "location_manager"), async (tx) => {
      const mv = await tx.query("SELECT DISTINCT location_id FROM app.stock_movement");
      expect(mv.rows.map((r) => r.location_id)).toEqual([A.locations[0]]);
      expect((await tx.query("SELECT 1 FROM app.stock_transfer_line")).rowCount).toBeGreaterThan(0);
    });
  });

  it("members see active products and their own purchases only; the catalogue shows sellable units", async () => {
    const { A } = t.fx;
    await asCaller(t.api, t.claims(A, "member"), async (tx) => {
      const products = await tx.query("SELECT sku, active FROM app.product");
      expect(products.rows.every((r) => r.active)).toBe(true);
      expect(products.rows.map((r) => r.sku)).not.toContain("DEMO-OLD");
      expect((await tx.query("SELECT 1 FROM app.inventory_level")).rowCount).toBe(0);
      const sales = await tx.query("SELECT DISTINCT member_id FROM app.sale");
      for (const r of sales.rows) expect(r.member_id).toBe(A.members[0]);
      const cat = await tx.query(
        "SELECT sku, available FROM app.store_catalogue($1) WHERE sku LIKE 'DEMO-%' ORDER BY sku",
        [A.locations[1]],
      );
      // loc1: PROT 4 received − 1 reserved for the fixture order; AGUA 12 + 4 transferred.
      expect(cat.rows).toEqual([
        { sku: "DEMO-AGUA", available: 16 },
        { sku: "DEMO-PROT", available: 3 },
        { sku: "DEMO-TEE", available: 0 },
      ]);
      await denied(tx.query("SELECT * FROM app.store_catalogue($1)", [t.fx.B.locations[0]]));
    });
  });
});

describe("direct writes and forbidden columns", () => {
  it("only the owner maintains products (org-wide catalogue), through the allowed columns, and it is audited", async () => {
    const { A, B } = t.fx;
    // Security review H1: products are org-wide, so a location manager must not change them.
    await asCaller(t.api, t.claims(A, "location_manager"), async (tx) => {
      await tx.query("SAVEPOINT s");
      await denied(
        tx.query(
          `INSERT INTO app.product (sku, name, category, age_restricted, taxable, price_cents)
           VALUES ('MGR-01', 'Demo Manager', 'supplement', false, true, 100)`,
        ),
        "42501",
      );
      await tx.query("ROLLBACK TO SAVEPOINT s");
      const u = await tx.query("UPDATE app.product SET taxable = false, price_cents = 0");
      expect(u.rowCount).toBe(0);
    });
    const id = await asCaller(t.api, t.claims(A, "owner"), async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.product (sku, name, category, age_restricted, taxable, price_cents)
         VALUES ('BAR-01', 'Demo Barra Proteica', 'supplement', false, true, 299) RETURNING id`,
      );
      await tx.query("UPDATE app.product SET price_cents = 349 WHERE id = $1", [rows[0].id]);
      return rows[0].id as string;
    });
    const audit = await t.admin.query(
      "SELECT action, actor_role, meta FROM app.audit_log WHERE entity = 'product' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "store.product.create",
      "store.product.update",
    ]);
    expect(audit.rows[1].meta).toMatchObject({ price_cents: 349, old_price_cents: 299 });

    for (const role of ["front_desk", "accountant", "trainer", "member"] as Role[]) {
      await asCaller(t.api, t.claims(A, role), async (tx) => {
        await tx.query("SAVEPOINT s");
        await denied(
          tx.query(
            "INSERT INTO app.product (sku, name, category, price_cents) VALUES ('X-1', 'Demo x', 'other', 1)",
          ),
        );
        await tx.query("ROLLBACK TO SAVEPOINT s");
        const upd = await tx.query("UPDATE app.product SET price_cents = 1 WHERE id = $1", [id]);
        expect(upd.rowCount).toBe(0);
      });
    }
    await asCaller(t.api, t.claims(B, "owner"), async (tx) => {
      const upd = await tx.query("UPDATE app.product SET price_cents = 1 WHERE id = $1", [id]);
      expect(upd.rowCount).toBe(0);
    });
    const price = await t.admin.query("SELECT price_cents FROM app.product WHERE id = $1", [id]);
    expect(price.rows[0].price_cents).toBe(349);
  });

  it.each([
    "UPDATE app.product SET org_id = gen_random_uuid()",
    "UPDATE app.product SET sku = 'NEW-SKU'",
    "UPDATE app.inventory_level SET on_hand = 999",
    "UPDATE app.inventory_level SET reserved = 0",
    "INSERT INTO app.inventory_level (product_id, location_id, on_hand) SELECT id, NULL, 1 FROM app.product LIMIT 1",
    "INSERT INTO app.stock_movement (product_id, location_id, kind, qty, by_person_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'receive', 1, gen_random_uuid())",
    "DELETE FROM app.stock_movement",
    "UPDATE app.sale SET status = 'refunded'",
    "UPDATE app.sale SET total_cents = 0",
    "UPDATE app.sale_line SET unit_price_cents = 0",
    "INSERT INTO app.sale (location_id, channel, status, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents, created_by) VALUES (gen_random_uuid(), 'pos', 'completed', 0, 0, 0, 0, gen_random_uuid())",
    "DELETE FROM app.sale",
    "DELETE FROM app.product",
    "INSERT INTO app.stock_transfer (from_location_id, to_location_id, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())",
  ])("owner cannot: %s", async (sql) => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) => denied(tx.query(sql)));
  });

  it("internal building blocks are not callable by request traffic", async () => {
    const { A } = t.fx;
    for (const sql of [
      "SELECT app.store_insert_sale($1, $2, 'pos', NULL, 'completed', 'cash', NULL, '{}'::uuid[], '{}'::int[])",
      "SELECT app.store_lock_available($1, $2, '{}'::uuid[], '{}'::int[])",
      "SELECT app.store_cart($1, '[]'::jsonb)",
      "SELECT app.store_lock_sale($1)",
      "SELECT app.store_caller_staff_id()",
    ]) {
      const n = (sql.match(/\$\d/g) ?? []).length;
      await asCaller(t.api, t.claims(A, "owner"), (tx) =>
        denied(tx.query(sql, [A.orgId, A.locations[0]].slice(0, n))),
      );
    }
  });

  it.each([
    ["bad sku", "ab cd", "Demo ok", 100],
    ["sku braces", "{{X}}", "Demo ok", 100],
    ["link in name", "LNK-1", "Demo visita gymbarato.com", 100],
    ["phone in name", "PHN-1", "Demo llama 787 555 0101", 100],
    ["health claim", "CLM-1", "Demo quemador que cura", 100],
    ["title", "TTL-1", "Demo plan del nutricionista", 100],
    ["newline", "NL-1", "Demo\nlinea", 100],
    ["braces in name", "BR-1", "Demo {{name}}", 100],
    ["negative price", "NEG-1", "Demo ok", -1],
    ["huge price", "BIG-1", "Demo ok", 100001],
  ])("hostile product input is refused: %s", async (_label, sku, name, price) => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      denied(
        tx.query(
          "INSERT INTO app.product (sku, name, category, price_cents) VALUES ($1, $2, 'supplement', $3)",
          [sku, name, price],
        ),
        "23514",
      ),
    );
  });

  it("duplicate SKU within an organisation conflicts; the same SKU in another organisation is fine", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      denied(
        tx.query(
          "INSERT INTO app.product (sku, name, category, price_cents) VALUES ('DEMO-TEE', 'Demo y', 'apparel', 1)",
        ),
        "23505",
      ),
    );
    await asCaller(t.api, t.claims(t.fx.B, "owner"), (tx) =>
      tx.query(
        "INSERT INTO app.product (sku, name, category, price_cents) VALUES ('UNIQ-B', 'Demo y', 'apparel', 1)",
      ),
    );
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      tx.query(
        "INSERT INTO app.product (sku, name, category, price_cents) VALUES ('UNIQ-B', 'Demo y', 'apparel', 1)",
      ),
    );
  });
});

describe("E11 acceptance: inventory equals the sum of movements after 100 mixed POS/online sales", () => {
  it("100 interleaved sales, pickups, cancellations and refunds keep the ledger exact", async () => {
    const { A } = t.fx;
    const loc = A.locations[0];
    const products = [
      await mkProduct(A, { qty: 400, restricted: true, price: 3999 }),
      await mkProduct(A, { qty: 400, price: 150 }),
      await mkProduct(A, { qty: 400, price: 1800, taxable: false }),
    ];
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const cart = () => {
      const k = 1 + rnd(3);
      return lines(...products.slice(0, k).map((p) => [p, 1 + rnd(3)] as [string, number]));
    };
    const fd = t.claims(A, "front_desk");
    const mgr = t.claims(A, "location_manager");
    // Fresh members for this test: one member may hold at most 5 open pickup orders and 10 units of a product
    // across them (security review M4), so the online traffic is spread over 5 members.
    const members: ReturnType<typeof t.claims>[] = [];
    for (let k = 0; k < 5; k++) {
      const person = await t.admin.query<{ id: string }>(
        "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
        [`e11.store.${k}@demo.invalid`],
      );
      await t.admin.query(
        "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,'Demo E11','active')",
        [A.orgId, person.rows[0]?.id, loc],
      );
      members.push(t.claims(A, "member", person.rows[0]?.id));
    }

    const ops: Array<() => Promise<unknown>> = [];
    for (let i = 0; i < 100; i++) {
      const l = cart();
      const kind = i % 5;
      const member = members[Math.floor(i / 5) % members.length] as ReturnType<typeof t.claims>;
      if (kind <= 1) ops.push(() => asCaller(t.api, fd, (tx) => sell(tx, loc, l, { age: true })));
      // Online orders left pending: only the first two (one member may hold at most 5 open orders).
      else if (kind === 2 && i < 10)
        ops.push(() => asCaller(t.api, member, (tx) => order(tx, loc, l)));
      else if (kind === 2)
        ops.push(async () => {
          const id = await asCaller(t.api, member, (tx) => order(tx, loc, l));
          await asCaller(t.api, fd, (tx) =>
            tx.query("SELECT app.complete_pickup($1, 'cash', true)", [id]),
          );
        });
      else if (kind === 3)
        ops.push(async () => {
          const id = await asCaller(t.api, member, (tx) => order(tx, loc, l));
          const fn =
            i % 2 ? "app.complete_pickup($1, 'cash', true)" : "app.cancel_online_order($1)";
          await asCaller(t.api, i % 2 ? fd : member, (tx) => tx.query(`SELECT ${fn}`, [id]));
        });
      else
        ops.push(async () => {
          const id = await asCaller(t.api, mgr, (tx) =>
            sell(tx, loc, l, { age: true, pay: "card_simulated" }),
          );
          await asCaller(t.api, mgr, (tx) =>
            tx.query("SELECT app.refund_sale($1, 'Demo devolución')", [id]),
          );
        });
    }
    // Ten at a time on separate connections, so the row locks really compete.
    for (let i = 0; i < ops.length; i += 10) {
      const res = await Promise.allSettled(ops.slice(i, i + 10).map((op) => op()));
      for (const r of res) if (r.status === "rejected") throw r.reason;
    }

    const n = await t.admin.query(
      `SELECT count(DISTINCT s.id)::int AS n FROM app.sale s JOIN app.sale_line sl ON sl.sale_id = s.id
        WHERE sl.product_id = ANY ($1)`,
      [products],
    );
    expect(n.rows[0].n).toBe(100);
    expect(await ledgerMismatches(A.orgId)).toEqual([]);
    expect(await ledgerMismatches(t.fx.B.orgId)).toEqual([]);
    // Every cart contains the first product, so it saw sales, refunds and still-pending reservations.
    const lv = await level(products[0] as string, loc);
    expect(lv.on_hand).toBeLessThan(400);
    expect(lv.reserved).toBeGreaterThan(0);
  }, 60_000);
});
