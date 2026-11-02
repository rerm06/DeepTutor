import type { Tx } from "@gym/db";
import {
  FINANCE_BILL_DECISIONS,
  FINANCE_BILL_STATUSES,
  FINANCE_COMMISSION_SOURCES,
  FINANCE_COMMISSION_STATUSES,
  FINANCE_DEFAULT_MANAGER_MAX_CENTS,
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_MAX_AMOUNT_CENTS,
  FINANCE_MAX_COMMISSION_CENTS,
  FINANCE_MONTH_PATTERN,
  FINANCE_READER_ROLES,
  FINANCE_REF_PATTERN,
  FINANCE_SOURCE_REF_PATTERN,
} from "@gym/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

// Module finance · spec §8 (accrual basis [P]). Approval thresholds, segregation of duties, location scope,
// immutability of paid bills, the P&L and the journal CSV all live in SQL (migration 0013); this layer validates
// shape, maps business refusals and converts bigint sums to numbers.

const Id = z.string().uuid();
const IdParams = z.object({ id: Id }).strict();
const Text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u);
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "invalid_date");
const Month = z.string().regex(FINANCE_MONTH_PATTERN);
const Amount = z.number().int().min(1).max(FINANCE_MAX_AMOUNT_CENTS);
const Category = z.enum(FINANCE_EXPENSE_CATEGORIES);
const Ref = z.string().trim().regex(FINANCE_REF_PATTERN);
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const PolicyBody = z
  .object({ manager_approval_max_cents: z.number().int().min(0).max(FINANCE_MAX_AMOUNT_CENTS) })
  .strict();
const VendorBody = z
  .object({ name: Text(1, 120), contact_email: z.string().email().max(254).optional() })
  .strict();
const VendorPatch = z
  .object({
    name: Text(1, 120).optional(),
    contact_email: z.string().email().max(254).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });
const BillBody = z
  .object({
    vendor_id: Id,
    location_id: Id,
    number: Ref,
    category: Category.default("other"),
    memo: Text(1, 300).optional(),
    issued_on: Day,
    due_on: Day,
    amount_cents: Amount,
  })
  .strict();
const DecisionBody = z
  .object({ decision: z.enum(FINANCE_BILL_DECISIONS), note: Text(1, 300).optional() })
  .strict();
const PayBody = z.object({ paid_on: Day, payment_ref: Ref }).strict();
const ReasonBody = z.object({ reason: Text(3, 200) }).strict();
const ExpenseBody = z
  .object({
    location_id: Id,
    category: Category,
    amount_cents: Amount,
    spent_on: Day,
    receipt_note: Text(1, 300).optional(),
    vendor_id: Id.optional(),
  })
  .strict();
const RecurringBody = z
  .object({
    location_id: Id,
    category: Category,
    description: Text(1, 120),
    amount_cents: Amount,
    interval_months: z.number().int().min(1).max(12).default(1),
    next_on: Day,
    vendor_id: Id.optional(),
  })
  .strict();
const RecurringPatch = z
  .object({
    description: Text(1, 120).optional(),
    amount_cents: Amount.optional(),
    interval_months: z.number().int().min(1).max(12).optional(),
    next_on: Day.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });
const RunBody = z.object({ as_of: Day.optional() }).strict();
const CommissionBody = z
  .object({
    staff_member_id: Id,
    location_id: Id,
    source: z.enum(FINANCE_COMMISSION_SOURCES),
    source_ref: z.string().trim().regex(FINANCE_SOURCE_REF_PATTERN),
    amount_cents: z.number().int().min(1).max(FINANCE_MAX_COMMISSION_CENTS),
    earned_on: Day,
    note: Text(1, 300).optional(),
  })
  .strict();
const CommissionStatusBody = z
  .object({ status: z.enum(["approved", "paid", "void"]), paid_on: Day.optional() })
  .strict();
const ExportBody = z.object({ month: Month }).strict();

const BillsQuery = z
  .object({ status: z.enum(FINANCE_BILL_STATUSES).optional(), location_id: Id.optional() })
  .strict();
const ExpensesQuery = z
  .object({ month: Month.optional(), location_id: Id.optional(), include_voided: flag })
  .strict();
const CommissionsQuery = z
  .object({ status: z.enum(FINANCE_COMMISSION_STATUSES).optional(), location_id: Id.optional() })
  .strict();
const VendorsQuery = z.object({ include_inactive: flag }).strict();
const StaffQuery = z.object({ location_id: Id.optional() }).strict();
const MonthQuery = z.object({ month: Month }).strict();

/** Business refusals raised by the definer functions, surfaced with a stable `reason` for the UI. */
const REASONS: Record<string, { status: number; error: string }> = {
  approver_is_creator: { status: 403, error: "forbidden" },
  above_threshold: { status: 403, error: "forbidden" },
  invalid_status: { status: 409, error: "conflict" },
  bill_immutable: { status: 409, error: "conflict" },
  expense_immutable: { status: 409, error: "conflict" },
  commission_immutable: { status: 409, error: "conflict" },
  invalid_date: { status: 400, error: "invalid_input" },
  invalid_reference: { status: 400, error: "invalid_input" },
  invalid_reason: { status: 400, error: "invalid_input" },
  invalid_note: { status: 400, error: "invalid_input" },
};

async function refusals<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const hit = e.message ? REASONS[e.message] : undefined;
    if (hit && (e.code === "22023" || e.code === "42501"))
      return reply.code(hit.status).send({ error: hit.error, reason: e.message });
    throw err;
  }
}

/** bigint sums arrive as strings; amounts stay far below 2^53, so plain numbers are exact. */
function numbers<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  return out as T;
}

const PNL_KEYS = [
  "membership_revenue_cents",
  "other_billing_revenue_cents",
  "store_revenue_cents",
  "revenue_cents",
  "expenses_cents",
  "bills_cents",
  "commissions_cents",
  "platform_fees_cents",
  "costs_cents",
  "net_cents",
  "cash_in_cents",
  "cash_out_cents",
] as const;

const BILL_COLUMNS = `b.id, b.vendor_id, v.name AS vendor_name, b.location_id, l.name AS location_name, b.number,
  b.category, b.memo, b.issued_on::text AS issued_on, b.due_on::text AS due_on, b.amount_cents, b.status,
  b.created_by = app.person_id() AS created_by_me, b.created_at, b.approved_at, b.paid_on::text AS paid_on,
  b.payment_ref, b.voided_at, b.void_reason`;

async function loadBill(tx: Tx, id: string) {
  const { rows } = await tx.query(
    `SELECT ${BILL_COLUMNS} FROM app.bill b
       LEFT JOIN app.vendor v ON v.id = b.vendor_id LEFT JOIN app.location l ON l.id = b.location_id
      WHERE b.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const READERS: readonly string[] = FINANCE_READER_ROLES;

function filename(period: string): string {
  return `diario-${period.slice(0, 7)}.csv`;
}

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Policy (threshold)
  app.get("/finance/policy", async (req, reply) => {
    // The default threshold is not a secret, but only finance roles get an answer (no misleading defaults).
    if (!READERS.includes(req.claims.app_role)) return reply.code(403).send({ error: "forbidden" });
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT manager_approval_max_cents, updated_at FROM app.finance_policy LIMIT 1",
      );
      return {
        manager_approval_max_cents:
          rows[0]?.manager_approval_max_cents ?? FINANCE_DEFAULT_MANAGER_MAX_CENTS,
        updated_at: rows[0]?.updated_at ?? null,
      };
    });
  });

  app.put("/finance/policy", async (req, reply) => {
    const b = PolicyBody.parse(req.body);
    const saved = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.finance_policy (manager_approval_max_cents) VALUES ($1)
         ON CONFLICT (org_id) DO UPDATE SET manager_approval_max_cents = EXCLUDED.manager_approval_max_cents,
           updated_at = now()
         RETURNING manager_approval_max_cents`,
        [b.manager_approval_max_cents],
      );
      return rows[0];
    });
    return reply.send(saved);
  });

  // ── Vendors
  app.get("/finance/vendors", async (req) => {
    const q = VendorsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id, name, contact_email, active FROM app.vendor WHERE ($1 OR active) ORDER BY lower(name) LIMIT 500",
        [q.include_inactive],
      );
      return { data: rows };
    });
  });

  app.post("/finance/vendors", async (req, reply) => {
    const b = VendorBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.vendor (name, contact_email) VALUES ($1, $2) RETURNING id",
        [b.name, b.contact_email ?? null],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/finance/vendors/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = VendorPatch.parse(req.body) as Record<string, unknown>;
    const cols = (["name", "contact_email", "active"] as const).filter((c) => b[c] !== undefined);
    const n = await app.asCaller(req, async (tx) => {
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      const r = await tx.query(`UPDATE app.vendor SET ${sets} WHERE id = $1`, [
        id,
        ...cols.map((c) => b[c]),
      ]);
      return r.rowCount ?? 0;
    });
    if (n === 0) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  // ── Bills (accounts payable)
  app.get("/finance/bills", async (req) => {
    const q = BillsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${BILL_COLUMNS} FROM app.bill b
           LEFT JOIN app.vendor v ON v.id = b.vendor_id LEFT JOIN app.location l ON l.id = b.location_id
          WHERE ($1::app.bill_status IS NULL OR b.status = $1) AND ($2::uuid IS NULL OR b.location_id = $2)
          ORDER BY (b.status = 'pending_approval') DESC, b.due_on, b.created_at DESC LIMIT 500`,
        [q.status ?? null, q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/finance/bills", async (req, reply) => {
    const b = BillBody.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string }>(
        `INSERT INTO app.bill (vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`,
        [
          b.vendor_id,
          b.location_id,
          b.number,
          b.category,
          b.memo ?? null,
          b.issued_on,
          b.due_on,
          b.amount_cents,
        ],
      );
      return rows[0];
    });
    return reply.code(201).send(row);
  });

  app.get("/finance/bills/:id/approvals", async (req) => {
    const { id } = IdParams.parse(req.params);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, approver_role, decision, amount_cents, threshold_cents, note, at,
                approver_person_id = app.person_id() AS by_me
           FROM app.bill_approval WHERE bill_id = $1 ORDER BY at`,
        [id],
      );
      return { data: rows };
    });
  });

  app.post("/finance/bills/:id/decision", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = DecisionBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.decide_bill($1, $2, $3)", [id, b.decision, b.note ?? null]);
        return loadBill(tx, id);
      }),
    );
  });

  app.post("/finance/bills/:id/pay", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = PayBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.pay_bill($1, $2, $3)", [id, b.paid_on, b.payment_ref]);
        return loadBill(tx, id);
      }),
    );
  });

  app.post("/finance/bills/:id/void", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ReasonBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.void_bill($1, $2)", [id, b.reason]);
        return loadBill(tx, id);
      }),
    );
  });

  // ── Expenses and recurring templates
  app.get("/finance/expenses", async (req) => {
    const q = ExpensesQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT e.id, e.location_id, l.name AS location_name, e.vendor_id, v.name AS vendor_name, e.recurring_id,
                e.category, e.amount_cents, e.spent_on::text AS spent_on, e.receipt_note, e.created_at,
                e.voided_at, e.void_reason
           FROM app.expense e LEFT JOIN app.location l ON l.id = e.location_id
           LEFT JOIN app.vendor v ON v.id = e.vendor_id
          WHERE ($1::date IS NULL OR (e.spent_on >= $1::date AND e.spent_on < ($1::date + interval '1 month')))
            AND ($2::uuid IS NULL OR e.location_id = $2) AND ($3 OR e.voided_at IS NULL)
          ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 500`,
        [q.month ? `${q.month}-01` : null, q.location_id ?? null, q.include_voided],
      );
      return { data: rows };
    });
  });

  app.post("/finance/expenses", async (req, reply) => {
    const b = ExpenseBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.expense (location_id, category, amount_cents, spent_on, receipt_note, vendor_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          b.location_id,
          b.category,
          b.amount_cents,
          b.spent_on,
          b.receipt_note ?? null,
          b.vendor_id ?? null,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.post("/finance/expenses/:id/void", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ReasonBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.void_expense($1, $2)", [id, b.reason]);
        return { id, voided: true };
      }),
    );
  });

  app.get("/finance/recurring", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.location_id, l.name AS location_name, r.vendor_id, r.category, r.description,
                r.amount_cents, r.interval_months, r.next_on::text AS next_on, r.active
           FROM app.recurring_expense r LEFT JOIN app.location l ON l.id = r.location_id
          ORDER BY r.active DESC, r.next_on LIMIT 500`,
      );
      return { data: rows };
    }),
  );

  app.post("/finance/recurring", async (req, reply) => {
    const b = RecurringBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.recurring_expense (location_id, category, description, amount_cents, interval_months, next_on,
           vendor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          b.location_id,
          b.category,
          b.description,
          b.amount_cents,
          b.interval_months,
          b.next_on,
          b.vendor_id ?? null,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/finance/recurring/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = RecurringPatch.parse(req.body) as Record<string, unknown>;
    const cols = (
      ["description", "amount_cents", "interval_months", "next_on", "active"] as const
    ).filter((c) => b[c] !== undefined);
    const n = await app.asCaller(req, async (tx) => {
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      const r = await tx.query(
        `UPDATE app.recurring_expense SET ${sets}, updated_at = now() WHERE id = $1`,
        [id, ...cols.map((c) => b[c])],
      );
      return r.rowCount ?? 0;
    });
    if (n === 0) return reply.code(404).send({ error: "not_found" });
    return { id };
  });

  app.post("/finance/recurring/run", async (req, reply) => {
    const b = RunBody.parse(req.body ?? {});
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          "SELECT app.run_recurring_expenses($1) AS n",
          [b.as_of ?? null],
        );
        return { created: rows[0]?.n ?? 0 };
      }),
    );
  });

  // ── Commissions
  app.get("/finance/staff", async (req, reply) => {
    const q = StaffQuery.parse(req.query);
    if (!READERS.includes(req.claims.app_role)) return reply.code(403).send({ error: "forbidden" });
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT sm.id, sm.display_name, sm.role, sl.location_id
           FROM app.staff_member sm JOIN app.staff_location sl ON sl.staff_member_id = sm.id
          WHERE sm.active AND ($1::uuid IS NULL OR sl.location_id = $1)
          ORDER BY sm.display_name LIMIT 500`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/finance/commissions", async (req) => {
    const q = CommissionsQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id, c.staff_member_id, sm.display_name AS staff_name, c.location_id, l.name AS location_name,
                c.source, c.source_ref, c.amount_cents, c.earned_on::text AS earned_on, c.status, c.note,
                c.decided_at, c.paid_on::text AS paid_on, c.created_at
           FROM app.commission c LEFT JOIN app.staff_member sm ON sm.id = c.staff_member_id
           LEFT JOIN app.location l ON l.id = c.location_id
          WHERE ($1::app.commission_status IS NULL OR c.status = $1) AND ($2::uuid IS NULL OR c.location_id = $2)
          ORDER BY c.earned_on DESC, c.created_at DESC LIMIT 500`,
        [q.status ?? null, q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/finance/commissions", async (req, reply) => {
    const b = CommissionBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.commission (staff_member_id, location_id, source, source_ref, amount_cents, earned_on, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          b.staff_member_id,
          b.location_id,
          b.source,
          b.source_ref,
          b.amount_cents,
          b.earned_on,
          b.note ?? null,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.post("/finance/commissions/:id/status", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = CommissionStatusBody.parse(req.body);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        await tx.query("SELECT app.set_commission_status($1, $2, $3)", [
          id,
          b.status,
          b.paid_on ?? null,
        ]);
        return { id, status: b.status };
      }),
    );
  });

  // ── Read models
  app.get("/finance/pnl", async (req, reply) => {
    const q = MonthQuery.parse(req.query);
    return refusals(reply, () =>
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query("SELECT * FROM app.finance_pnl($1)", [`${q.month}-01`]);
        const locations = rows.map((r) => numbers(r, PNL_KEYS));
        const consolidated: Record<string, number> = {};
        for (const k of PNL_KEYS)
          consolidated[k] = locations.reduce((s, r) => s + (r[k] as number), 0);
        return { month: q.month, basis: "accrual", locations, consolidated };
      }),
    );
  });

  app.get("/finance/liabilities", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM app.finance_deferred()");
      const deferred = rows.map((r) =>
        numbers(r, ["prepaid_periods_cents", "unused_credits_cents"]),
      );
      let points: { outstanding_points: number; members_with_balance: number } | null = null;
      if (req.claims.app_role === "owner" || req.claims.app_role === "accountant") {
        const p = await tx.query("SELECT * FROM app.points_liability()");
        points = numbers(p.rows[0], ["outstanding_points", "members_with_balance"]);
      }
      return {
        deferred,
        totals: {
          prepaid_periods_cents: deferred.reduce((s, r) => s + r.prepaid_periods_cents, 0),
          unused_credits_cents: deferred.reduce((s, r) => s + r.unused_credits_cents, 0),
        },
        points,
      };
    }),
  );

  // ── Journal exports
  app.get("/finance/exports", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, period::text AS period, line_count, debit_total_cents, generated_at,
                generated_by = app.person_id() AS generated_by_me
           FROM app.journal_export ORDER BY generated_at DESC LIMIT 100`,
      );
      return {
        data: rows.map((r) => ({
          ...numbers(r, ["debit_total_cents"]),
          filename: filename(r.period),
        })),
      };
    }),
  );

  app.post("/finance/exports", async (req, reply) => {
    const b = ExportBody.parse(req.body);
    return refusals(reply, async () => {
      const out = await app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "SELECT app.generate_journal_export($1) AS id",
          [`${b.month}-01`],
        );
        const r = await tx.query(
          `SELECT id, period::text AS period, line_count, debit_total_cents, csv, generated_at
             FROM app.journal_export WHERE id = $1`,
          [rows[0]?.id],
        );
        const row = r.rows[0];
        return { ...numbers(row, ["debit_total_cents"]), filename: filename(row.period) };
      });
      return reply.code(201).send(out);
    });
  });

  app.get("/finance/exports/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = await app.asCaller(req, async (tx) => {
      const r = await tx.query(
        `SELECT id, period::text AS period, line_count, debit_total_cents, csv, generated_at
           FROM app.journal_export WHERE id = $1`,
        [id],
      );
      return r.rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return { ...numbers(row, ["debit_total_cents"]), filename: filename(row.period) };
  });
}
