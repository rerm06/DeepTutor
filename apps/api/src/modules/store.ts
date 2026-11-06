import type { Tx } from "@gym/db";
import {
  STORE_CATEGORIES,
  STORE_MAX_LINES,
  STORE_MAX_LINE_QTY,
  STORE_MAX_PRICE_CENTS,
  STORE_PAYMENT_METHODS,
  STORE_SALE_STATUSES,
  STORE_SKU_PATTERN,
} from "@gym/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

// Module store · E5 POS, E11 store & inventory. Location scope, stock locking, IVU, age verification and auditing
// live in the SQL definer functions of migration 0009; this layer validates shape and maps business refusals.

const Id = z.string().uuid();
const IdParams = z.object({ id: Id }).strict();
const Text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u);
const Lines = z
  .array(
    z.object({ product_id: Id, qty: z.number().int().min(1).max(STORE_MAX_LINE_QTY) }).strict(),
  )
  .min(1)
  .max(STORE_MAX_LINES);
const Payment = z.enum(STORE_PAYMENT_METHODS);

const ProductBody = z
  .object({
    sku: z.string().regex(STORE_SKU_PATTERN),
    name: Text(1, 120),
    category: z.enum(STORE_CATEGORIES),
    age_restricted: z.boolean().default(false),
    taxable: z.boolean().default(true),
    price_cents: z.number().int().min(0).max(STORE_MAX_PRICE_CENTS),
    active: z.boolean().default(true),
  })
  .strict();
const ProductPatch = ProductBody.omit({ sku: true })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });
const SaleBody = z
  .object({
    location_id: Id,
    lines: Lines,
    payment_method: Payment,
    member_id: Id.optional(),
    age_verified: z.boolean().default(false),
  })
  .strict();
const OrderBody = z.object({ location_id: Id, lines: Lines }).strict();
const PickupBody = z
  .object({ payment_method: Payment, age_verified: z.boolean().default(false) })
  .strict();
const RefundBody = z.object({ reason: Text(3, 200) }).strict();
const QuoteBody = z.object({ lines: Lines }).strict();
const ReceiveBody = z
  .object({
    location_id: Id,
    product_id: Id,
    qty: z.number().int().min(1).max(100_000),
    ref: z
      .string()
      .regex(/^[A-Za-z0-9 ._/#-]{1,60}$/)
      .optional(),
  })
  .strict();
const AdjustBody = z
  .object({
    location_id: Id,
    product_id: Id,
    delta: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((n) => n !== 0),
    reason: Text(3, 200),
  })
  .strict();
const ReorderBody = z
  .object({ location_id: Id, product_id: Id, reorder_point: z.number().int().min(0).max(100_000) })
  .strict();
const TransferBody = z
  .object({
    from_location_id: Id,
    to_location_id: Id,
    lines: Lines,
    note: Text(0, 200).optional(),
  })
  .strict();

const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");
const ProductsQuery = z.object({ include_inactive: flag }).strict();
const LocationQuery = z.object({ location_id: Id }).strict();
const InventoryQuery = z.object({ location_id: Id.optional(), low: flag }).strict();
const MovementsQuery = z.object({ location_id: Id.optional(), product_id: Id.optional() }).strict();
const SalesQuery = z
  .object({
    location_id: Id.optional(),
    member_id: Id.optional(),
    status: z.enum(STORE_SALE_STATUSES).optional(),
  })
  .strict();

/** Business refusals raised by the definer functions, surfaced with a stable `reason` for the UI. */
const REASONS: Record<string, { status: number; error: string }> = {
  insufficient_stock: { status: 409, error: "conflict" },
  invalid_status: { status: 409, error: "conflict" },
  age_verification_required: { status: 400, error: "invalid_input" },
  invalid_product: { status: 400, error: "invalid_input" },
  invalid_lines: { status: 400, error: "invalid_input" },
  same_location: { status: 400, error: "invalid_input" },
};

async function refusals<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const hit = e.message ? REASONS[e.message] : undefined;
    if (hit && (e.code === "22023" || e.code === "23514"))
      return reply.code(hit.status).send({ error: hit.error, reason: e.message });
    throw err;
  }
}

/** Sale with lines and location name, read back under the caller's RLS (receipt view). */
async function loadSale(tx: Tx, id: string) {
  const { rows } = await tx.query(
    `SELECT s.id, s.location_id, l.name AS location_name, s.channel, s.member_id, s.status, s.subtotal_cents,
            s.ivu_state_cents, s.ivu_municipal_cents, s.total_cents, s.payment_method,
            s.age_verified_by IS NOT NULL AS age_verified, s.created_at, s.completed_at, s.refunded_at,
            s.refund_reason, s.cancelled_at
       FROM app.sale s LEFT JOIN app.location l ON l.id = s.location_id
      WHERE s.id = $1`,
    [id],
  );
  const sale = rows[0];
  if (!sale) return null;
  const lines = await tx.query(
    `SELECT sl.product_id, p.sku, p.name, p.category, sl.qty, sl.unit_price_cents, sl.taxable, sl.age_restricted,
            sl.subtotal_cents, sl.ivu_state_cents, sl.ivu_municipal_cents, sl.total_cents
       FROM app.sale_line sl LEFT JOIN app.product p ON p.id = sl.product_id
      WHERE sl.sale_id = $1 ORDER BY p.name`,
    [id],
  );
  return { ...sale, lines: lines.rows };
}

const PATCHABLE = [
  "name",
  "category",
  "age_restricted",
  "taxable",
  "price_cents",
  "active",
] as const;

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Products
  app.get("/store/products", async (req) => {
    const q = ProductsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, sku, name, category, age_restricted, taxable, price_cents, active
           FROM app.product WHERE ($1 OR active) ORDER BY category, name LIMIT 1000`,
        [q.include_inactive],
      );
      return { data: rows };
    });
  });

  app.post("/store/products", async (req, reply) => {
    const b = ProductBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.product (sku, name, category, age_restricted, taxable, price_cents, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [b.sku, b.name, b.category, b.age_restricted, b.taxable, b.price_cents, b.active],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/store/products/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ProductPatch.parse(req.body) as Record<string, unknown>;
    const cols = PATCHABLE.filter((c) => b[c] !== undefined);
    const n = await app.asCaller(req, async (tx) => {
      const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      const r = await tx.query(`UPDATE app.product SET ${set} WHERE id = $1`, [
        id,
        ...cols.map((c) => b[c]),
      ]);
      return r.rowCount ?? 0;
    });
    if (n === 0) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  // ── Catalogue and quote (server-side IVU; nothing is written)
  app.get("/store/catalogue", async (req) => {
    const q = LocationQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM app.store_catalogue($1)", [q.location_id]);
      return { data: rows };
    });
  });

  app.post("/store/quote", async (req, reply) => {
    const b = QuoteBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query("SELECT app.store_quote($1::jsonb) AS q", [
          JSON.stringify(b.lines),
        ]);
        return rows[0]?.q;
      }),
    );
  });

  // ── Inventory
  app.get("/store/inventory", async (req) => {
    const q = InventoryQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.product_id, p.sku, p.name, p.category, p.active, i.location_id, i.on_hand, i.reserved,
                i.on_hand - i.reserved AS available, i.reorder_point,
                (i.on_hand - i.reserved <= i.reorder_point) AS low
           FROM app.inventory_level i JOIN app.product p ON p.id = i.product_id
          WHERE ($1::uuid IS NULL OR i.location_id = $1)
            AND (NOT $2 OR i.on_hand - i.reserved <= i.reorder_point)
          ORDER BY p.name, i.location_id LIMIT 2000`,
        [q.location_id ?? null, q.low],
      );
      return { data: rows };
    });
  });

  app.get("/store/movements", async (req) => {
    const q = MovementsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT m.id, m.product_id, p.sku, p.name, m.location_id, m.kind, m.qty, m.ref, m.reason, m.sale_id,
                m.transfer_id, m.at
           FROM app.stock_movement m JOIN app.product p ON p.id = m.product_id
          WHERE ($1::uuid IS NULL OR m.location_id = $1) AND ($2::uuid IS NULL OR m.product_id = $2)
          ORDER BY m.at DESC LIMIT 200`,
        [q.location_id ?? null, q.product_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/store/inventory/receive", async (req, reply) => {
    const b = ReceiveBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.receive_stock($1, $2, $3, $4)", [
          b.location_id,
          b.product_id,
          b.qty,
          b.ref ?? null,
        ]);
        return { ok: true };
      }),
    );
  });

  app.post("/store/inventory/adjust", async (req, reply) => {
    const b = AdjustBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.adjust_stock($1, $2, $3, $4)", [
          b.location_id,
          b.product_id,
          b.delta,
          b.reason,
        ]);
        return { ok: true };
      }),
    );
  });

  app.put("/store/inventory/reorder-point", async (req, reply) => {
    const b = ReorderBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.set_reorder_point($1, $2, $3)", [
          b.location_id,
          b.product_id,
          b.reorder_point,
        ]);
        return { ok: true };
      }),
    );
  });

  app.post("/store/transfers", async (req, reply) => {
    const b = TransferBody.parse(req.body);
    const res = await refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.transfer_stock($1, $2, $3::jsonb, $4) AS id",
          [b.from_location_id, b.to_location_id, JSON.stringify(b.lines), b.note ?? null],
        );
        return { id: rows[0]?.id };
      }),
    );
    return reply.sent ? res : reply.code(201).send(res);
  });

  app.get("/store/transfers", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, t.from_location_id, t.to_location_id, t.status, t.note, t.created_at,
                coalesce((SELECT jsonb_agg(jsonb_build_object('product_id', tl.product_id, 'qty', tl.qty))
                            FROM app.stock_transfer_line tl WHERE tl.transfer_id = t.id), '[]') AS lines
           FROM app.stock_transfer t ORDER BY t.created_at DESC LIMIT 100`,
      );
      return { data: rows };
    }),
  );

  // ── Sales (POS) and online orders
  app.post("/store/sales", async (req, reply) => {
    const b = SaleBody.parse(req.body);
    const res = await refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.record_sale($1, $2::jsonb, $3, $4, $5) AS id",
          [
            b.location_id,
            JSON.stringify(b.lines),
            b.payment_method,
            b.member_id ?? null,
            b.age_verified,
          ],
        );
        return loadSale(tx, rows[0]?.id as string);
      }),
    );
    return reply.sent ? res : reply.code(201).send(res);
  });

  app.get("/store/sales", async (req) => {
    const q = SalesQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.location_id, s.channel, s.member_id, m.full_name AS member_name, s.status,
                s.subtotal_cents, s.ivu_state_cents, s.ivu_municipal_cents, s.total_cents, s.payment_method,
                s.age_verified_by IS NOT NULL AS age_verified, s.created_at, s.completed_at, s.refunded_at,
                s.refund_reason, s.cancelled_at,
                (SELECT coalesce(sum(sl.qty), 0)::int FROM app.sale_line sl WHERE sl.sale_id = s.id) AS units
           FROM app.sale s LEFT JOIN app.member m ON m.id = s.member_id
          WHERE ($1::uuid IS NULL OR s.location_id = $1) AND ($2::uuid IS NULL OR s.member_id = $2)
            AND ($3::app.store_sale_status IS NULL OR s.status = $3)
          ORDER BY s.created_at DESC LIMIT 200`,
        [q.location_id ?? null, q.member_id ?? null, q.status ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/store/sales/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const sale = await app.asCaller(req, (tx) => loadSale(tx, id));
    if (!sale) return reply.code(404).send({ error: "not_found" });
    return sale;
  });

  app.post("/store/sales/:id/refund", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = RefundBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.refund_sale($1, $2)", [id, b.reason]);
        return loadSale(tx, id);
      }),
    );
  });

  app.post("/store/orders", async (req, reply) => {
    const b = OrderBody.parse(req.body);
    const res = await refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.place_online_order($1, $2::jsonb) AS id",
          [b.location_id, JSON.stringify(b.lines)],
        );
        return loadSale(tx, rows[0]?.id as string);
      }),
    );
    return reply.sent ? res : reply.code(201).send(res);
  });

  app.post("/store/orders/:id/pickup", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PickupBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.complete_pickup($1, $2, $3)", [
          id,
          b.payment_method,
          b.age_verified,
        ]);
        return loadSale(tx, id);
      }),
    );
  });

  app.post("/store/orders/:id/cancel", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.cancel_online_order($1)", [id]);
        return loadSale(tx, id);
      }),
    );
  });
}
