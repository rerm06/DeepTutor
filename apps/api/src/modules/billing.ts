import { createHash } from "node:crypto";
import type { Tx } from "@gym/db";
import {
  BILLING_INTERVALS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_KINDS,
  type PaymentMethod,
  TAX_CATEGORIES,
} from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

/**
 * HTTP routes for module billing (Membresías, catálogo y facturación). Registered under /v1 by modules/index.ts.
 * Every rule (roles, location scope, IVU, fee, numbering, freezes, cancellation, idempotency, audit) lives in the
 * SQL definer functions of migration 0006; this layer validates shape and runs everything through app.asCaller.
 */

// ── Payment gateway adapter (spec §5.1). Stripe is NOT called in this build: only the simulated adapter exists.
// A real adapter would create a PaymentIntent on the connected account with the idempotency key,
// metadata.location_id and application_fee_amount computed by the database — never by the client.
export interface ChargeRequest {
  amount_cents: number;
  method: Exclude<PaymentMethod, "cash">;
  idempotency_key: string;
  metadata: { location_id: string; invoice_id: string };
}
export interface ChargeResult {
  status: "succeeded" | "failed";
  provider_ref: string;
}
export interface PaymentGateway {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}
/** Deterministic, offline: the same idempotency key always yields the same reference. No network. */
export const simulatedGateway: PaymentGateway = {
  async charge(req) {
    const ref = createHash("sha256").update(req.idempotency_key).digest("hex").slice(0, 24);
    return { status: "succeeded", provider_ref: `sim_${ref}` };
  },
};

const Uuid = z.string().uuid();
const IdParams = z.object({ id: Uuid });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const Name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\r\n{}<>]*$/);
const Description = z
  .string()
  .max(500)
  .regex(/^[^{}<>]*$/);

const ProductBody = z
  .object({
    kind: z.enum(PRODUCT_KINDS),
    name: Name,
    description: Description.optional(),
    tax_category: z.enum(TAX_CATEGORIES).default("taxable"),
  })
  .strict();
const ProductPatch = z
  .object({
    name: Name.optional(),
    description: Description.nullable().optional(),
    tax_category: z.enum(TAX_CATEGORIES).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty" });
const PriceBody = z
  .object({
    product_id: Uuid,
    location_id: Uuid.nullable().optional(),
    amount_cents: z.number().int().min(0).max(10_000_000),
    billing_interval: z.enum(BILLING_INTERVALS).default("none"),
    credits: z.number().int().min(1).max(500).nullable().optional(),
    validity_days: z.number().int().min(1).max(730).nullable().optional(),
    commitment_months: z.number().int().min(0).max(36).default(0),
  })
  .strict();
const PricePatch = z.object({ active: z.boolean() }).strict();
const SubscribeBody = z
  .object({
    price_id: Uuid,
    start_date: IsoDate.optional(),
    enrollment_price_id: Uuid.optional(),
  })
  .strict();
const FreezeBody = z
  .object({ start_date: IsoDate, end_date: IsoDate, reason: z.string().max(300).optional() })
  .strict();
const CancelBody = z.object({ confirm: z.literal(true) }).strict();
const SaleBody = z
  .object({
    price_id: Uuid,
    location_id: Uuid,
    quantity: z.number().int().min(1).max(20).default(1),
    method: z.enum(PAYMENT_METHODS),
    idempotency_key: IdempotencyKey,
  })
  .strict();
const PaymentBody = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount_cents: z.number().int().min(1).max(10_000_000),
    idempotency_key: IdempotencyKey,
    // Free reference (receipt or check number). Card numbers are refused here and by the database.
    reference: z
      .string()
      .max(40)
      .regex(/^[A-Za-z0-9 #._-]*$/)
      .refine((s) => (s.match(/\d/g) ?? []).length <= 6, { message: "no_card_numbers" })
      .optional(),
  })
  .strict();
const VoidBody = z.object({ reason: z.string().trim().min(1).max(300) }).strict();
const CycleBody = z.object({ as_of: IsoDate.optional(), location_id: Uuid.optional() }).strict();
const InvoicesQuery = z
  .object({
    status: z.enum(INVOICE_STATUSES).optional(),
    overdue: z.enum(["true", "false"]).optional(),
    location_id: Uuid.optional(),
    member_id: Uuid.optional(),
  })
  .strict();
const FeesQuery = z.object({ location_id: Uuid.optional() }).strict();

const INVOICE_COLS = `i.id, i.number::integer AS number, i.member_id, m.full_name AS member_name, i.location_id,
  i.municipality, i.subscription_id, i.period_start::text AS period_start, i.period_end::text AS period_end,
  i.subtotal_cents, i.ivu_state_cents, i.ivu_municipal_cents, i.total_cents, i.status, i.issued_at,
  i.due_date::text AS due_date, i.paid_at, i.voided_at, i.void_reason,
  (i.status = 'open' AND i.due_date < (now() AT TIME ZONE 'America/Puerto_Rico')::date) AS overdue,
  i.total_cents - coalesce((SELECT sum(p.amount_cents) FROM app.payment p
                             WHERE p.invoice_id = i.id AND p.status = 'succeeded'), 0)::integer AS balance_cents`;

/** Everything billing-related about a set of members, as the caller sees it under RLS. */
async function billingFor(tx: Tx, where: string, params: unknown[]) {
  const q = async (sql: string) => (await tx.query(sql, params)).rows;
  const [subscriptions, freezes, invoices, lines, payments, credits, passes] = await Promise.all([
    q(`SELECT s.id, s.member_id, s.product_id, pp.name AS product_name, s.price_id, pr.amount_cents,
              s.location_id, s.status, s.billing_interval, s.start_date::text AS start_date,
              s.current_period_start::text AS current_period_start, s.current_period_end::text AS current_period_end,
              s.commitment_end::text AS commitment_end, s.cancel_at_period_end,
              greatest(s.current_period_end, coalesce(s.commitment_end, s.current_period_end))::text AS ends_on
         FROM app.subscription s
         LEFT JOIN app.plan_product pp ON pp.id = s.product_id
         LEFT JOIN app.price pr ON pr.id = s.price_id
        WHERE ${where.replaceAll("$M", "s.member_id")} ORDER BY s.created_at DESC`),
    q(`SELECT f.id, f.subscription_id, f.start_date::text AS start_date, f.end_date::text AS end_date, f.days, f.reason
         FROM app.subscription_freeze f WHERE ${where.replaceAll("$M", "f.member_id")} ORDER BY f.start_date DESC`),
    q(`SELECT ${INVOICE_COLS} FROM app.invoice i LEFT JOIN app.member m ON m.id = i.member_id
        WHERE ${where.replaceAll("$M", "i.member_id")} ORDER BY i.issued_at DESC, i.number DESC LIMIT 100`),
    q(`SELECT l.id, l.invoice_id, l.description, l.quantity, l.unit_amount_cents, l.tax_category, l.amount_cents,
              l.ivu_state_cents, l.ivu_municipal_cents
         FROM app.invoice_line l JOIN app.invoice i ON i.id = l.invoice_id
        WHERE ${where.replaceAll("$M", "i.member_id")}`),
    q(`SELECT p.id, p.invoice_id, p.method, p.amount_cents, p.status, p.reference, p.received_at
         FROM app.payment p WHERE ${where.replaceAll("$M", "p.member_id")} ORDER BY p.received_at DESC LIMIT 100`),
    q(`SELECT c.id, c.member_id, c.product_id, pp.name AS product_name, c.location_id, c.credits_total,
              c.credits_remaining, c.expires_at, (c.expires_at IS NULL OR c.expires_at > now()) AS live
         FROM app.credit_balance c LEFT JOIN app.plan_product pp ON pp.id = c.product_id
        WHERE ${where.replaceAll("$M", "c.member_id")} ORDER BY c.created_at DESC`),
    q(`SELECT a.id, a.member_id, a.product_id, pp.name AS product_name, a.location_id, a.valid_from, a.valid_to,
              (now() BETWEEN a.valid_from AND a.valid_to) AS live
         FROM app.access_pass a LEFT JOIN app.plan_product pp ON pp.id = a.product_id
        WHERE ${where.replaceAll("$M", "a.member_id")} ORDER BY a.valid_from DESC LIMIT 50`),
  ]);
  return { subscriptions, freezes, invoices, lines, payments, credits, passes };
}

export interface BillingRouteOptions {
  gateway?: PaymentGateway;
}

export async function routes(app: FastifyInstance, opts: BillingRouteOptions = {}): Promise<void> {
  const gateway = opts.gateway ?? simulatedGateway;

  // ── Catalogue (E3)
  app.get("/billing/catalog", async (req) =>
    app.asCaller(req, async (tx) => {
      const products = (
        await tx.query(
          "SELECT id, kind, name, description, tax_category, active FROM app.plan_product ORDER BY active DESC, kind, name",
        )
      ).rows;
      const prices = (
        await tx.query(
          `SELECT id, product_id, location_id, amount_cents, billing_interval, credits, validity_days,
                  commitment_months, active
             FROM app.price ORDER BY product_id, location_id NULLS FIRST, created_at`,
        )
      ).rows;
      return { products, prices };
    }),
  );

  app.post("/billing/products", async (req, reply) => {
    const b = ProductBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.plan_product (kind, name, description, tax_category) VALUES ($1,$2,$3,$4) RETURNING id",
        [b.kind, b.name, b.description ?? null, b.tax_category],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/billing/products/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ProductPatch.parse(req.body);
    const n = await app.asCaller(req, async (tx) => {
      const r = await tx.query(
        `UPDATE app.plan_product SET
           name = CASE WHEN $2::boolean THEN $3 ELSE name END,
           description = CASE WHEN $4::boolean THEN $5 ELSE description END,
           tax_category = coalesce($6::app.tax_category, tax_category),
           active = coalesce($7::boolean, active)
         WHERE id = $1`,
        [
          id,
          b.name !== undefined,
          b.name ?? null,
          b.description !== undefined,
          b.description ?? null,
          b.tax_category ?? null,
          b.active ?? null,
        ],
      );
      return r.rowCount ?? 0;
    });
    if (n === 0) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  app.post("/billing/prices", async (req, reply) => {
    const b = PriceBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.price (product_id, location_id, amount_cents, billing_interval, credits, validity_days, commitment_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          b.product_id,
          b.location_id ?? null,
          b.amount_cents,
          b.billing_interval,
          b.credits ?? null,
          b.validity_days ?? null,
          b.commitment_months,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/billing/prices/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PricePatch.parse(req.body);
    const n = await app.asCaller(
      req,
      async (tx) =>
        (await tx.query("UPDATE app.price SET active = $2 WHERE id = $1", [id, b.active]))
          .rowCount ?? 0,
    );
    if (n === 0) return reply.code(404).send({ error: "not_found" });
    return { id, active: b.active };
  });

  app.get("/billing/policy", async (req) =>
    app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          "SELECT location_id, max_commitment_months, invoice_due_days, max_freeze_days FROM app.billing_policy ORDER BY location_id NULLS FIRST",
        )
      ).rows,
    })),
  );

  // ── A member's billing (staff tab) and the caller's own (member portal)
  app.get("/members/:id/billing", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, (tx) => billingFor(tx, "$M = $1", [id]));
  });
  app.get("/billing/me", async (req) =>
    app.asCaller(req, (tx) => billingFor(tx, "app.billing_is_self($M)", [])),
  );

  // ── Subscriptions (E4)
  app.post("/members/:id/subscriptions", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = SubscribeBody.parse(req.body);
    const subId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.create_subscription($1, $2, $3, $4) AS id",
        [id, b.price_id, b.start_date ?? null, b.enrollment_price_id ?? null],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id: subId });
  });

  app.post("/subscriptions/:id/freeze", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = FreezeBody.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.freeze_subscription($1, $2::date, $3::date, $4) AS id",
        [id, b.start_date, b.end_date, b.reason ?? null],
      );
      const sub = await tx.query<{ current_period_end: string; status: string }>(
        "SELECT current_period_end::text AS current_period_end, status FROM app.subscription WHERE id = $1",
        [id],
      );
      return { id: rows[0]?.id, subscription: sub.rows[0] };
    });
    return reply.code(201).send(row);
  });

  app.post("/subscriptions/:id/cancel", async (req) => {
    const { id } = IdParams.parse(req.params);
    CancelBody.parse(req.body);
    const effective = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ d: string }>(
        "SELECT app.cancel_subscription($1)::text AS d",
        [id],
      );
      return rows[0]?.d;
    });
    return { id, cancel_at_period_end: true, effective_date: effective };
  });

  // ── One-off sales: single session, day pass, packs (pay at the desk)
  app.post("/members/:id/sales", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = SaleBody.parse(req.body);
    const result = await app.asCaller(req, async (tx) => {
      const providerRef =
        b.method === "cash"
          ? null
          : `sim_${createHash("sha256").update(b.idempotency_key).digest("hex").slice(0, 24)}`;
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.sell_one_off($1, $2, $3, $4, $5, $6, $7) AS id",
        [id, b.price_id, b.location_id, b.quantity, b.method, b.idempotency_key, providerRef],
      );
      const invoiceId = rows[0]?.id as string;
      const inv = (
        await tx.query<{ total_cents: number; status: string; number: number }>(
          "SELECT total_cents, status, number::integer AS number FROM app.invoice WHERE id = $1",
          [invoiceId],
        )
      ).rows[0];
      // Charge through the adapter inside the transaction: a failed charge rolls the sale back.
      if (b.method !== "cash" && inv && inv.total_cents > 0) {
        const charge = await gateway.charge({
          amount_cents: inv.total_cents,
          method: b.method,
          idempotency_key: b.idempotency_key,
          metadata: { location_id: b.location_id, invoice_id: invoiceId },
        });
        if (charge.status !== "succeeded")
          throw Object.assign(new Error("payment_failed"), { statusCode: 402 });
      }
      return { invoice_id: invoiceId, ...inv };
    });
    return reply.code(201).send(result);
  });

  // ── Invoices and payments
  app.get("/invoices", async (req) => {
    const q = InvoicesQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${INVOICE_COLS} FROM app.invoice i LEFT JOIN app.member m ON m.id = i.member_id
          WHERE ($1::app.invoice_status IS NULL OR i.status = $1)
            AND ($2::boolean IS NOT TRUE OR (i.status = 'open' AND i.due_date < (now() AT TIME ZONE 'America/Puerto_Rico')::date))
            AND ($3::uuid IS NULL OR i.location_id = $3)
            AND ($4::uuid IS NULL OR i.member_id = $4)
          ORDER BY i.issued_at DESC, i.number DESC LIMIT 200`,
        [q.status ?? null, q.overdue === "true", q.location_id ?? null, q.member_id ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/invoices/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const res = await app.asCaller(req, async (tx) => {
      const inv = (
        await tx.query(
          `SELECT ${INVOICE_COLS} FROM app.invoice i LEFT JOIN app.member m ON m.id = i.member_id WHERE i.id = $1`,
          [id],
        )
      ).rows[0];
      if (!inv) return null;
      const lines = (
        await tx.query(
          `SELECT id, description, quantity, unit_amount_cents, tax_category, amount_cents, ivu_state_cents,
                  ivu_municipal_cents FROM app.invoice_line WHERE invoice_id = $1 ORDER BY amount_cents DESC`,
          [id],
        )
      ).rows;
      const payments = (
        await tx.query(
          "SELECT id, method, amount_cents, status, reference, received_at FROM app.payment WHERE invoice_id = $1 ORDER BY received_at",
          [id],
        )
      ).rows;
      return { ...inv, lines, payments };
    });
    if (!res) return reply.code(404).send({ error: "not_found" });
    return res;
  });

  app.post("/invoices/:id/payments", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PaymentBody.parse(req.body);
    const result = await app.asCaller(req, async (tx) => {
      // RLS decides whether the caller can see the invoice; the definer function re-checks role and location.
      const inv = (
        await tx.query<{ location_id: string }>(
          "SELECT location_id FROM app.invoice WHERE id = $1",
          [id],
        )
      ).rows[0];
      let providerRef: string | null = null;
      if (b.method !== "cash" && inv) {
        // Security review (money modules): never charge more than the open balance. Validate BEFORE the gateway
        // call, so a real provider is never charged for a payment the database would then refuse.
        const bal = (
          await tx.query<{ balance: number }>(
            `SELECT (i.total_cents - coalesce(sum(p.amount_cents) FILTER (WHERE p.status = 'succeeded'), 0))::integer AS balance
               FROM app.invoice i LEFT JOIN app.payment p ON p.invoice_id = i.id
              WHERE i.id = $1 GROUP BY i.total_cents`,
            [id],
          )
        ).rows[0]?.balance;
        if (bal === undefined || b.amount_cents > bal)
          throw Object.assign(new Error("amount_exceeds_balance"), { statusCode: 400 });
        const charge = await gateway.charge({
          amount_cents: b.amount_cents,
          method: b.method,
          idempotency_key: b.idempotency_key,
          metadata: { location_id: inv.location_id, invoice_id: id },
        });
        if (charge.status !== "succeeded")
          throw Object.assign(new Error("payment_failed"), { statusCode: 402 });
        providerRef = charge.provider_ref;
      }
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.record_payment($1, $2, $3, $4, $5, $6) AS id",
        [id, b.method, b.amount_cents, b.idempotency_key, b.reference ?? null, providerRef],
      );
      const status = (
        await tx.query<{ status: string }>("SELECT status FROM app.invoice WHERE id = $1", [id])
      ).rows[0]?.status;
      return { id: rows[0]?.id, invoice_status: status };
    });
    return reply.code(201).send(result);
  });

  app.post("/invoices/:id/void", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = VoidBody.parse(req.body);
    await app.asCaller(req, (tx) => tx.query("SELECT app.void_invoice($1, $2)", [id, b.reason]));
    return { id, status: "void" };
  });

  app.post("/billing/cycle", async (req) => {
    const b = CycleBody.parse(req.body ?? {});
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ r: unknown }>(
        "SELECT app.run_billing_cycle($1::date, $2) AS r",
        [b.as_of ?? null, b.location_id ?? null],
      );
      return rows[0]?.r;
    });
  });

  app.get("/billing/fees", async (req) => {
    const q = FeesQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: (
        await tx.query(
          "SELECT invoice_id, application_fee_bps, application_fee_cents FROM app.invoice_fees($1)",
          [q.location_id ?? null],
        )
      ).rows,
    }));
  });
}
