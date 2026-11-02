import type pg from "pg";
import type { OrgFixture } from "../testing.js";

async function one(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (!id) throw new Error(`store fixture failed: ${sql}`);
  return id;
}

type MoneyKey = "subtotal_cents" | "ivu_state_cents" | "ivu_municipal_cents" | "total_cents";
type Priced = Record<MoneyKey, number> & {
  productId: string;
  qty: number;
  price_cents: number;
  taxable: boolean;
  age_restricted: boolean;
};

/**
 * Test fixtures for module store (superuser connection, RLS bypassed): rows in EVERY store table for this org,
 * consistent with the ledger rule on_hand = Σ stock_movement.qty and reserved = Σ pending online lines.
 *   products  DEMO-PROT (supplement, age-restricted), DEMO-TEE, DEMO-AGUA, DEMO-OLD (inactive)
 *   stock     loc0: PROT 10, TEE 5, AGUA 24 · loc1: PROT 4, AGUA 12 (received), then
 *   sales     a completed POS sale at loc0 (1 PROT age-verified + 2 AGUA), an online order pending pickup at
 *             loc1 for members[1] (1 PROT reserved), and a transfer of 4 AGUA loc0 → loc1.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const [l0, l1] = org.locations;
  const frontStaff = await one(
    c,
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = 'front_desk'",
    [org.orgId, org.people.front_desk],
  );
  const product = (
    sku: string,
    name: string,
    category: string,
    restricted: boolean,
    price: number,
    active = true,
  ) =>
    one(
      c,
      `INSERT INTO app.product (org_id, sku, name, category, age_restricted, taxable, price_cents, active)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id`,
      [org.orgId, sku, name, category, restricted, price, active],
    );
  const prot = await product("DEMO-PROT", `Demo Proteína Whey ${label}`, "supplement", true, 3999);
  const tee = await product("DEMO-TEE", `Demo Camiseta ${label}`, "apparel", false, 1800);
  const agua = await product("DEMO-AGUA", `Demo Agua ${label}`, "drink", false, 150);
  await product("DEMO-OLD", `Demo Botella vieja ${label}`, "accessory", false, 900, false);

  const receive = async (productId: string, loc: string, qty: number, reorder: number) => {
    await c.query(
      `INSERT INTO app.inventory_level (org_id, product_id, location_id, on_hand, reorder_point)
       VALUES ($1, $2, $3, $4, $5)`,
      [org.orgId, productId, loc, qty, reorder],
    );
    await c.query(
      `INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, by_person_id)
       VALUES ($1, $2, $3, 'receive', $4, 'FIXTURE', $5)`,
      [org.orgId, productId, loc, qty, org.people.location_manager],
    );
  };
  await receive(prot, l0, 10, 3);
  await receive(tee, l0, 5, 2);
  await receive(agua, l0, 24, 6);
  await receive(prot, l1, 4, 2);
  await receive(agua, l1, 12, 6);

  const sale = async (
    loc: string,
    channel: "pos" | "online",
    memberId: string | null,
    lines: Array<[string, number]>,
  ) => {
    const priced: Priced[] = [];
    for (const [productId, qty] of lines) {
      const { rows } = await c.query<Omit<Priced, "productId" | "qty">>(
        `SELECT p.price_cents, p.taxable, p.age_restricted, a.*
           FROM app.product p, LATERAL app.store_line_amounts($2, p.price_cents, p.taxable) a WHERE p.id = $1`,
        [productId, qty],
      );
      const row = rows[0];
      if (!row) throw new Error("store fixture: unknown product");
      priced.push({ productId, qty, ...row });
    }
    const sum = (k: MoneyKey) => priced.reduce((n, l) => n + l[k], 0);
    const pos = channel === "pos";
    const restricted = priced.some((l) => l.age_restricted);
    const saleId = await one(
      c,
      `INSERT INTO app.sale (org_id, location_id, channel, member_id, status, subtotal_cents, ivu_state_cents,
         ivu_municipal_cents, total_cents, payment_method, age_verified_by, created_by, completed_by, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [
        org.orgId,
        loc,
        channel,
        memberId,
        pos ? "completed" : "pending_pickup",
        sum("subtotal_cents"),
        sum("ivu_state_cents"),
        sum("ivu_municipal_cents"),
        sum("total_cents"),
        pos ? "cash" : null,
        pos && restricted ? frontStaff : null,
        pos ? org.people.front_desk : org.people.member,
        pos ? org.people.front_desk : null,
        pos ? new Date() : null,
      ],
    );
    for (const l of priced) {
      await c.query(
        `INSERT INTO app.sale_line (org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
           subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          org.orgId,
          saleId,
          l.productId,
          l.qty,
          l.price_cents,
          l.taxable,
          l.age_restricted,
          l.subtotal_cents,
          l.ivu_state_cents,
          l.ivu_municipal_cents,
          l.total_cents,
        ],
      );
      if (pos) {
        await c.query(
          "UPDATE app.inventory_level SET on_hand = on_hand - $3 WHERE product_id = $1 AND location_id = $2",
          [l.productId, loc, l.qty],
        );
        await c.query(
          `INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id)
           VALUES ($1, $2, $3, 'sale', $4, 'POS', $5, $6)`,
          [org.orgId, l.productId, loc, -l.qty, saleId, org.people.front_desk],
        );
      } else {
        await c.query(
          "UPDATE app.inventory_level SET reserved = reserved + $3 WHERE product_id = $1 AND location_id = $2",
          [l.productId, loc, l.qty],
        );
      }
    }
    return saleId;
  };
  await sale(l0, "pos", null, [
    [prot, 1],
    [agua, 2],
  ]);
  await sale(l1, "online", org.members[1], [[prot, 1]]);

  const transfer = await one(
    c,
    `INSERT INTO app.stock_transfer (org_id, from_location_id, to_location_id, note, created_by)
     VALUES ($1, $2, $3, 'Demo reposición', $4) RETURNING id`,
    [org.orgId, l0, l1, org.people.location_manager],
  );
  await c.query(
    "INSERT INTO app.stock_transfer_line (org_id, transfer_id, product_id, qty) VALUES ($1, $2, $3, 4)",
    [org.orgId, transfer, agua],
  );
  for (const [loc, kind, qty] of [
    [l0, "transfer_out", -4],
    [l1, "transfer_in", 4],
  ] as const) {
    await c.query(
      "UPDATE app.inventory_level SET on_hand = on_hand + $3 WHERE product_id = $1 AND location_id = $2",
      [agua, loc, qty],
    );
    await c.query(
      `INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, transfer_id, by_person_id)
       VALUES ($1, $2, $3, $4, $5, 'TRANSFER', $6, $7)`,
      [org.orgId, agua, loc, kind, qty, transfer, org.people.location_manager],
    );
  }
}
