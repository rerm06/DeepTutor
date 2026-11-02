import type { Tx } from "@gym/db";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

// E13 · Panel y reportes. Every number comes from an invoker-rights read model in Postgres (migration 0014), so
// it is computed under the caller's RLS; role and location gates are re-checked there (42501 → 403). This layer
// validates shape, converts bigint strings to numbers and renders CSV. Every CSV export is audited in the same
// transaction (app.report_log_export) before any row is read.

const Id = z.string().uuid();
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Day = z.string().date();
const Lang = z.enum(["es", "en"]).default("es");
/** The web client only parses JSON: `envelope=json` wraps the CSV text as `{ filename, csv }`. */
const Envelope = z.enum(["json"]).optional();

const LocQuery = z.object({ location_id: Id.optional() }).strict();
const ExpiringQuery = z
  .object({ location_id: Id.optional(), days: z.coerce.number().int().min(1).max(31).default(7) })
  .strict();
const HeatmapQuery = z
  .object({
    location_id: Id.optional(),
    weeks: z.enum(["4", "8"]).default("4").transform(Number),
  })
  .strict();
const IvuQuery = z.object({ month: Month, location_id: Id.optional() }).strict();
const SalesQuery = z.object({ from: Day, to: Day, location_id: Id.optional() }).strict();
const MembersQuery = z
  .object({
    location_id: Id.optional(),
    months: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict();
const csvOf = <T extends z.ZodRawShape>(q: z.ZodObject<T, "strict">) =>
  q.extend({ lang: Lang, envelope: Envelope }).strict();

const MunicipalityBody = z
  .object({
    municipality: z
      .string()
      .trim()
      .regex(/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü .'-]{1,59}$/),
    suri_status: z.enum(["participant", "non_participant"]),
    note: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .regex(/^[^\p{Cc}]*$/u)
      .optional(),
  })
  .strict();

type Row = Record<string, unknown>;
/** pg returns bigint/numeric as strings; report money and counts fit in a JS number. */
function nums<T extends Row>(rows: T[], keys: string[]): T[] {
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
    return out as T;
  });
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────
type Cell = string | number | null | undefined | { cents: number };
/**
 * RFC 4180 quoting plus spreadsheet-formula neutralisation: a text cell that starts with = + - @ or a control
 * character is prefixed with an apostrophe, so a hostile member name can never become a formula. Numbers and
 * money are written as plain numerals (money in dollars with two decimals).
 */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "object") return (v.cents / 100).toFixed(2);
  let s = v.replace(/\r\n|\r|\n/g, " ");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  if (/[",;]/.test(s) || s !== s.trim()) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
const money = (v: unknown): Cell => (v === null || v === undefined ? null : { cents: Number(v) });

function sendCsv(
  reply: FastifyReply,
  envelope: "json" | undefined,
  filename: string,
  csv: string,
): unknown {
  if (envelope === "json") return { filename, csv };
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${filename}"`);
  reply.header("Cache-Control", "no-store");
  return reply.send(csv);
}

const H = {
  es: {
    overdue: ["factura", "socio", "num_socio", "sede", "vence", "dias_vencida", "saldo_usd"],
    expiring: ["tipo", "socio", "sede", "vence", "creditos_restantes"],
    heatmap: ["dia_semana_iso", "hora", "check_ins"],
    ivu: [
      "municipio",
      "estado_suri",
      "origen",
      "documentos",
      "base_tributable_usd",
      "base_exenta_usd",
      "ivu_estatal_usd",
      "ivu_municipal_usd",
    ],
    sales: [
      "origen",
      "sede",
      "producto",
      "tipo",
      "vendedor",
      "documentos",
      "unidades",
      "subtotal_usd",
      "ivu_usd",
      "total_usd",
    ],
    members: ["mes", "altas", "bajas"],
  },
  en: {
    overdue: ["invoice", "member", "member_no", "location", "due", "days_overdue", "balance_usd"],
    expiring: ["kind", "member", "location", "expires", "credits_remaining"],
    heatmap: ["iso_weekday", "hour", "check_ins"],
    ivu: [
      "municipality",
      "suri_status",
      "source",
      "documents",
      "taxable_base_usd",
      "exempt_base_usd",
      "ivu_state_usd",
      "ivu_municipal_usd",
    ],
    sales: [
      "source",
      "location",
      "product",
      "kind",
      "seller",
      "documents",
      "units",
      "subtotal_usd",
      "ivu_usd",
      "total_usd",
    ],
    members: ["month", "joins", "cancellations"],
  },
} as const;

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Read models (JSON)
  app.get("/reports/dashboard", async (req) => {
    const q = LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query("SELECT app.report_dashboard($1) AS d", [
        q.location_id ?? null,
      ]);
      return rows[0]?.d;
    });
  });

  app.get("/reports/today", async (req) => {
    const q = LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query("SELECT app.report_today($1) AS d", [q.location_id ?? null]);
      return rows[0]?.d;
    });
  });

  const overdueRows = (tx: Tx, loc?: string) =>
    tx
      .query(
        `SELECT o.invoice_id, o.number, o.member_id, o.full_name, o.member_no, o.location_id,
                o.due_date::text AS due_date, o.days_overdue, o.balance_cents, l.name AS location_name
           FROM app.report_overdue($1) o
           LEFT JOIN app.location l ON l.id = o.location_id`,
        [loc ?? null],
      )
      .then((r) => nums(r.rows, ["number", "balance_cents"]));
  app.get("/reports/overdue", async (req) => {
    const q = LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({ data: await overdueRows(tx, q.location_id) }));
  });

  const expiringRows = (tx: Tx, loc: string | undefined, days: number) =>
    tx
      .query(
        `SELECT e.*, l.name AS location_name FROM app.report_expiring($1, $2) e
           LEFT JOIN app.location l ON l.id = e.location_id`,
        [loc ?? null, days],
      )
      .then((r) => r.rows);
  app.get("/reports/expiring", async (req) => {
    const q = ExpiringQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: await expiringRows(tx, q.location_id, q.days),
    }));
  });

  const heatmapRows = (tx: Tx, loc: string | undefined, weeks: number) =>
    tx
      .query("SELECT dow, hour, check_ins FROM app.report_heatmap($1, $2)", [loc ?? null, weeks])
      .then((r) => nums(r.rows, ["check_ins"]));
  app.get("/reports/heatmap", async (req) => {
    const q = HeatmapQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      weeks: q.weeks,
      data: await heatmapRows(tx, q.location_id, q.weeks),
    }));
  });

  const ivuRows = (tx: Tx, month: string, loc: string | undefined) =>
    tx
      .query("SELECT * FROM app.report_ivu($1::date, $2)", [`${month}-01`, loc ?? null])
      .then((r) =>
        nums(r.rows, [
          "documents",
          "taxable_base_cents",
          "exempt_base_cents",
          "ivu_state_cents",
          "ivu_municipal_cents",
        ]),
      );
  app.get("/reports/ivu", async (req) => {
    const q = IvuQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      month: q.month,
      data: await ivuRows(tx, q.month, q.location_id),
    }));
  });

  const salesRows = (tx: Tx, from: string, to: string, loc: string | undefined) =>
    tx
      .query(
        `SELECT s.*, l.name AS location_name FROM app.report_sales($1::date, $2::date, $3) s
           LEFT JOIN app.location l ON l.id = s.location_id`,
        [from, to, loc ?? null],
      )
      .then((r) =>
        nums(r.rows, ["documents", "units", "subtotal_cents", "ivu_cents", "total_cents"]),
      );
  app.get("/reports/sales", async (req) => {
    const q = SalesQuery.parse(req.query);
    return app.asCaller(req, async (tx) => ({
      data: await salesRows(tx, q.from, q.to, q.location_id),
    }));
  });

  const memberRows = async (tx: Tx, loc: string | undefined, months: number) => {
    const status = await tx.query("SELECT status, members FROM app.report_member_status($1)", [
      loc ?? null,
    ]);
    const flow = await tx.query(
      "SELECT to_char(month, 'YYYY-MM') AS month, joins, cancellations FROM app.report_member_flow($1, $2)",
      [loc ?? null, months],
    );
    return {
      status: nums(status.rows, ["members"]),
      flow: nums(flow.rows, ["joins", "cancellations"]),
    };
  };
  app.get("/reports/members", async (req) => {
    const q = MembersQuery.parse(req.query);
    return app.asCaller(req, (tx) => memberRows(tx, q.location_id, q.months));
  });

  // ── CSV exports (audited)
  const audit = (
    tx: Tx,
    report: string,
    loc: string | undefined,
    params: Record<string, unknown>,
  ) => tx.query("SELECT app.report_log_export($1, $2, $3)", [report, loc ?? null, params]);

  app.get("/reports/overdue.csv", async (req, reply) => {
    const q = csvOf(LocQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "overdue", q.location_id, {});
      const rows = await overdueRows(tx, q.location_id);
      return toCsv(
        [...H[q.lang].overdue],
        rows.map((r) => [
          r.number as number,
          r.full_name as string | null,
          r.member_no as string | null,
          r.location_name as string | null,
          r.due_date as string,
          r.days_overdue as number,
          money(r.balance_cents),
        ]),
      );
    });
    return sendCsv(reply, q.envelope, "saldos-vencidos.csv", csv);
  });

  app.get("/reports/expiring.csv", async (req, reply) => {
    const q = csvOf(ExpiringQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "expiring", q.location_id, { days: q.days });
      const rows = await expiringRows(tx, q.location_id, q.days);
      return toCsv(
        [...H[q.lang].expiring],
        rows.map((r) => [
          r.kind as string,
          r.full_name as string | null,
          r.location_name as string | null,
          r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
          r.credits_remaining as number | null,
        ]),
      );
    });
    return sendCsv(reply, q.envelope, `vencimientos-${q.days}d.csv`, csv);
  });

  app.get("/reports/heatmap.csv", async (req, reply) => {
    const q = csvOf(HeatmapQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "heatmap", q.location_id, { weeks: q.weeks });
      const rows = await heatmapRows(tx, q.location_id, q.weeks);
      return toCsv(
        [...H[q.lang].heatmap],
        rows.map((r) => [r.dow as number, r.hour as number, r.check_ins as number]),
      );
    });
    return sendCsv(reply, q.envelope, `horas-pico-${q.weeks}s.csv`, csv);
  });

  app.get("/reports/ivu.csv", async (req, reply) => {
    const q = csvOf(IvuQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "ivu", q.location_id, { month: q.month });
      const rows = await ivuRows(tx, q.month, q.location_id);
      return toCsv(
        [...H[q.lang].ivu],
        rows.map((r) => [
          r.municipality as string,
          r.suri_status as string,
          r.source as string,
          r.documents as number,
          money(r.taxable_base_cents),
          money(r.exempt_base_cents),
          money(r.ivu_state_cents),
          money(r.ivu_municipal_cents),
        ]),
      );
    });
    return sendCsv(reply, q.envelope, `ivu-${q.month}.csv`, csv);
  });

  app.get("/reports/sales.csv", async (req, reply) => {
    const q = csvOf(SalesQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "sales", q.location_id, { from: q.from, to: q.to });
      const rows = await salesRows(tx, q.from, q.to, q.location_id);
      return toCsv(
        [...H[q.lang].sales],
        rows.map((r) => [
          r.source as string,
          r.location_name as string | null,
          r.product_name as string,
          r.product_kind as string,
          r.seller_name as string | null,
          r.documents as number,
          r.units as number,
          money(r.subtotal_cents),
          money(r.ivu_cents),
          money(r.total_cents),
        ]),
      );
    });
    return sendCsv(reply, q.envelope, `ventas-${q.from}-${q.to}.csv`, csv);
  });

  app.get("/reports/members.csv", async (req, reply) => {
    const q = csvOf(MembersQuery).parse(req.query);
    const csv = await app.asCaller(req, async (tx) => {
      await audit(tx, "members", q.location_id, { months: q.months });
      const { flow } = await memberRows(tx, q.location_id, q.months);
      return toCsv(
        [...H[q.lang].members],
        flow.map((r) => [r.month as string, r.joins as number, r.cancellations as number]),
      );
    });
    return sendCsv(reply, q.envelope, "socios-altas-bajas.csv", csv);
  });

  // ── SURI participation per municipality (owner writes; owner, manager, accountant read)
  app.get("/reports/ivu-municipalities", async (req) => {
    LocQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, municipality, suri_status, note, updated_at FROM app.ivu_municipality
          ORDER BY municipality`,
      );
      return { data: rows };
    });
  });

  app.put("/reports/ivu-municipalities", async (req) => {
    const b = MunicipalityBody.parse(req.body);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.ivu_municipality (municipality, suri_status, note) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, lower(municipality))
         DO UPDATE SET suri_status = EXCLUDED.suri_status, note = EXCLUDED.note
         RETURNING id, municipality, suri_status, note`,
        [b.municipality, b.suri_status, b.note ?? null],
      );
      return rows[0];
    });
  });
}
