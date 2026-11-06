import {
  CRM_TASK_STATUSES,
  LEAD_ACTIVITY_KINDS,
  LEAD_MANUAL_STAGES,
  LEAD_SOURCES,
  LEAD_STAGES,
} from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// E9 · CRM. Role, location scope, stage logging, conversion and auditing live in Postgres (migration 0008):
// RLS policies, column grants, the lead/task triggers and app.convert_lead(). This layer validates shape only.
// Capturing a lead never creates messaging consent; consent stays in the E8 model (/members/:id/consents).

const IdParams = z.object({ id: z.string().uuid() });
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "no control characters");
const Email = z.string().trim().toLowerCase().email().max(254);
const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]{7,20}$/);

const LeadBody = z
  .object({
    location_id: z.string().uuid(),
    source: z.enum(LEAD_SOURCES),
    full_name: oneLine(200),
    email: Email.optional(),
    phone: Phone.optional(),
    notes: z.string().max(2000).optional(),
    owner_staff_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((b) => b.email || b.phone, { message: "email_or_phone_required" });

const LeadPatch = z
  .object({
    stage: z.enum(LEAD_MANUAL_STAGES).optional(),
    lost_reason: oneLine(300).optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    full_name: oneLine(200).optional(),
    email: Email.nullable().optional(),
    phone: Phone.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    owner_staff_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });

const LeadQuery = z
  .object({ location_id: z.string().uuid().optional(), stage: z.enum(LEAD_STAGES).optional() })
  .strict();
const ActivityBody = z
  .object({ kind: z.enum(LEAD_ACTIVITY_KINDS), body: z.string().trim().min(1).max(2000) })
  .strict();

const TaskBody = z
  .object({
    location_id: z.string().uuid(),
    title: oneLine(200),
    due_at: z.string().datetime({ offset: true }),
    assigned_staff_id: z.string().uuid(),
    lead_id: z.string().uuid().optional(),
    member_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((b) => !(b.lead_id && b.member_id), { message: "one_subject" });
const TaskPatch = z
  .object({
    status: z.enum(CRM_TASK_STATUSES).optional(),
    title: oneLine(200).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
    assigned_staff_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty_patch" });
const TaskQuery = z
  .object({
    mine: z.enum(["true", "false"]).optional(),
    member_id: z.string().uuid().optional(),
    lead_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    status: z.enum(CRM_TASK_STATUSES).optional(),
  })
  .strict();
const FunnelQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    location_id: z.string().uuid().optional(),
  })
  .strict();
const StaffQuery = z
  .object({ location_id: z.string().uuid(), purpose: z.enum(["lead", "task"]).default("task") })
  .strict();
const PURPOSE_ROLES = {
  lead: "{owner,location_manager,front_desk}",
  task: "{owner,location_manager,front_desk,trainer}",
} as const;

const LEAD_COLUMNS = `l.id, l.location_id, l.source, l.stage, l.lost_reason, l.owner_staff_id, l.full_name, l.email,
  l.phone, l.notes, l.member_id, l.created_at, l.updated_at, l.stage_changed_at,
  (SELECT s.display_name FROM app.staff_member s WHERE s.id = l.owner_staff_id) AS owner_name`;
const TASK_COLUMNS = `t.id, t.location_id, t.title, t.due_at, t.status, t.assigned_staff_id, t.lead_id, t.member_id,
  t.created_at, t.completed_at,
  (SELECT s.display_name FROM app.staff_member s WHERE s.id = t.assigned_staff_id) AS assignee_name,
  (SELECT l.full_name FROM app.lead l WHERE l.id = t.lead_id) AS lead_name,
  (SELECT m.full_name FROM app.member m WHERE m.id = t.member_id) AS member_name`;

/** HTTP routes for module crm (CRM y leads). Registered under /v1 by modules/index.ts. */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get("/crm/leads", async (req) => {
    const q = LeadQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${LEAD_COLUMNS} FROM app.lead l
          WHERE ($1::uuid IS NULL OR l.location_id = $1) AND ($2::app.crm_lead_stage IS NULL OR l.stage = $2)
          ORDER BY l.stage_changed_at DESC LIMIT 500`,
        [q.location_id ?? null, q.stage ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/crm/leads", async (req, reply) => {
    const b = LeadBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.lead (location_id, source, full_name, email, phone, notes, owner_staff_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          b.location_id,
          b.source,
          b.full_name,
          b.email ?? null,
          b.phone ?? null,
          b.notes ?? null,
          b.owner_staff_id ?? null,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.get("/crm/leads/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const result = await app.asCaller(req, async (tx) => {
      const lead = await tx.query(`SELECT ${LEAD_COLUMNS} FROM app.lead l WHERE l.id = $1`, [id]);
      if (!lead.rows[0]) return null;
      const acts = await tx.query(
        `SELECT a.id, a.kind, a.body, a.from_stage, a.to_stage, a.at, a.by_person_id,
                (SELECT s.display_name FROM app.staff_member s WHERE s.person_id = a.by_person_id
                  ORDER BY s.created_at LIMIT 1) AS by_name
           FROM app.lead_activity a WHERE a.lead_id = $1 ORDER BY a.at DESC, a.id LIMIT 500`,
        [id],
      );
      return { ...lead.rows[0], activities: acts.rows };
    });
    // RLS: another org's (or another location's) lead is indistinguishable from a missing one.
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  app.patch("/crm/leads/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = LeadPatch.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [col, value] of Object.entries(b)) {
      params.push(value);
      // Column names come from the strict zod schema keys only; values are always bound parameters.
      sets.push(`${col} = $${params.length}`);
    }
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; stage: string }>(
        `UPDATE app.lead SET ${sets.join(", ")} WHERE id = $1 RETURNING id, stage`,
        params,
      );
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.post("/crm/leads/:id/activities", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = ActivityBody.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const visible = await tx.query("SELECT 1 FROM app.lead WHERE id = $1", [id]);
      if (!visible.rowCount) return null;
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.lead_activity (lead_id, kind, body) VALUES ($1, $2, $3) RETURNING id",
        [id, b.kind, b.body],
      );
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send(row);
  });

  app.post("/crm/leads/:id/convert", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const memberId = await app.asCaller(req, async (tx) => {
      const visible = await tx.query("SELECT 1 FROM app.lead WHERE id = $1", [id]);
      if (!visible.rowCount) return null;
      const { rows } = await tx.query<{ id: string }>("SELECT app.convert_lead($1) AS id", [id]);
      return rows[0]?.id ?? null;
    });
    if (!memberId) return reply.code(404).send({ error: "not_found" });
    return reply.code(201).send({ member_id: memberId });
  });

  app.get("/crm/tasks", async (req) => {
    const q = TaskQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT ${TASK_COLUMNS} FROM app.crm_task t
          WHERE ($1::boolean IS NOT TRUE OR t.assigned_staff_id = ANY (app.crm_my_staff_ids()))
            AND ($2::uuid IS NULL OR t.member_id = $2)
            AND ($3::uuid IS NULL OR t.lead_id = $3)
            AND ($4::uuid IS NULL OR t.location_id = $4)
            AND ($5::app.crm_task_status IS NULL OR t.status = $5)
          ORDER BY (t.status = 'open') DESC, t.due_at LIMIT 500`,
        [
          q.mine === "true",
          q.member_id ?? null,
          q.lead_id ?? null,
          q.location_id ?? null,
          q.status ?? null,
        ],
      );
      return { data: rows };
    });
  });

  app.post("/crm/tasks", async (req, reply) => {
    const b = TaskBody.parse(req.body);
    const id = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.crm_task (location_id, title, due_at, assigned_staff_id, lead_id, member_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          b.location_id,
          b.title,
          b.due_at,
          b.assigned_staff_id,
          b.lead_id ?? null,
          b.member_id ?? null,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch("/crm/tasks/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = TaskPatch.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [col, value] of Object.entries(b)) {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string }>(
        `UPDATE app.crm_task SET ${sets.join(", ")} WHERE id = $1 RETURNING id, status`,
        params,
      );
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.get("/crm/funnel", async (req) => {
    const q = FunnelQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT location_id, source, total::int, new::int, contacted::int, tour_booked::int, trial::int,
                won::int, lost::int, conversion_pct::float AS conversion_pct
           FROM app.crm_funnel($1::date, $2::date, $3::uuid)`,
        [q.from, q.to, q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  // Staff who can own a lead (purpose=lead) or take a task (purpose=task) at a location.
  app.get("/crm/staff", async (req) => {
    const q = StaffQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.display_name, s.role FROM app.staff_member s
          WHERE app.crm_is_manager() AND s.active AND app.crm_staff_at_location(s.id, $1, $2::app.role_name[])
          ORDER BY s.display_name LIMIT 200`,
        [q.location_id, PURPOSE_ROLES[q.purpose]],
      );
      return { data: rows };
    });
  });
}
