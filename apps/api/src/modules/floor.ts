import {
  FLOOR_ASSET_STATUSES,
  FLOOR_ASSET_TYPES,
  FLOOR_EQUIPMENT_TYPES,
  FLOOR_ISSUE_KINDS,
  FLOOR_ISSUE_STATUSES,
  FLOOR_MOVEMENT_PATTERNS,
  FLOOR_SAFE_NAME,
  FLOOR_STATION_CODE,
  normalizeStationCode,
} from "@gym/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Module floor (spec §6.4): equipment, issues, exercise library, circuits, runs and set logs.
// Every query runs through app.asCaller (RLS as app_authenticated). Cross-row rules (issue workflow, runs, set
// logging) live in the definer functions of migration 0011; this layer validates shape only.

const Id = z.string().uuid();
const IdParams = z.object({ id: Id }).strict();
const Note = z
  .string()
  .max(500)
  .regex(/^[^\p{Cc}<>{}]*$/u);
const Name = z.string().trim().regex(FLOOR_SAFE_NAME);
const BrandModel = z
  .string()
  .trim()
  .regex(/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{1,80}$/);
const StationCode = z
  .string()
  .max(40)
  .transform(normalizeStationCode)
  .pipe(z.string().regex(FLOOR_STATION_CODE));
const Cues = z
  .string()
  .max(1000)
  .regex(/^(?:[^<>{}\p{Cc}]|\n)*$/u);

const AssetQuery = z.object({ location_id: Id.optional() }).strict();
const NewAsset = z
  .object({
    location_id: Id,
    equipment_type: z.enum(FLOOR_ASSET_TYPES),
    brand: BrandModel.optional(),
    model: BrandModel.optional(),
    // Left out: the database generates <PREFIX>-<NN> (migration 0029). Given: kept as typed (one unit only).
    station_code: StationCode.optional(),
    quantity: z.number().int().min(1).max(50).default(1),
    notes: Note.optional(),
  })
  .strict()
  .refine((b) => b.station_code === undefined || b.quantity === 1, {
    message: "station_code_needs_quantity_1",
    path: ["quantity"],
  });
const AssetPatch = z
  .object({
    status: z.enum(FLOOR_ASSET_STATUSES).optional(),
    equipment_type: z.enum(FLOOR_ASSET_TYPES).optional(),
    brand: BrandModel.nullable().optional(),
    model: BrandModel.nullable().optional(),
    station_code: StationCode.optional(),
    notes: Note.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "empty patch");

const IssueBody = z.object({ kind: z.enum(FLOOR_ISSUE_KINDS), note: Note.optional() }).strict();
const IssueQuery = z
  .object({ location_id: Id.optional(), status: z.enum(FLOOR_ISSUE_STATUSES).optional() })
  .strict();
const ResolveBody = z.object({ restore_asset: z.boolean().default(true) }).strict();

const NewExercise = z
  .object({
    name: Name,
    movement_pattern: z.enum(FLOOR_MOVEMENT_PATTERNS),
    equipment_type: z.enum(FLOOR_EQUIPMENT_TYPES),
    cues: Cues.default(""),
    active: z.boolean().default(true),
  })
  .strict();
const ExercisePatch = z
  .object({
    name: Name.optional(),
    movement_pattern: z.enum(FLOOR_MOVEMENT_PATTERNS).optional(),
    equipment_type: z.enum(FLOOR_EQUIPMENT_TYPES).optional(),
    cues: Cues.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "empty patch");

const SubstituteQuery = z
  .object({ exercise_id: Id, location_id: Id, exclude_asset_id: Id.optional() })
  .strict();

const CircuitQuery = z.object({ location_id: Id.optional() }).strict();
const NewCircuit = z
  .object({ location_id: Id, name: Name, active: z.boolean().default(true) })
  .strict();
const CircuitPatch = z
  .object({ name: Name.optional(), active: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "empty patch");
const Step = z
  .object({
    exercise_id: Id,
    asset_id: Id.nullable().optional(),
    equipment_type: z.enum(FLOOR_EQUIPMENT_TYPES).nullable().optional(),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(100),
    rest_seconds: z.number().int().min(0).max(900).default(60),
  })
  .strict()
  .refine(
    (s) => (s.asset_id ? 1 : 0) + (s.equipment_type ? 1 : 0) === 1,
    "asset_id xor equipment_type",
  );
const StepsBody = z.object({ steps: z.array(Step).max(50) }).strict();

const SetBody = z
  .object({
    exercise_id: Id,
    location_id: Id,
    asset_id: Id.optional(),
    circuit_run_id: Id.optional(),
    reps: z.number().int().min(0).max(1000),
    weight_kg: z.number().min(0).max(1000).multipleOf(0.01),
  })
  .strict();
const SetQuery = z
  .object({ member_id: Id.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();

/** "Not open" (SQLSTATE 55000) from the issue workflow is a 409, not a server error. */
async function mapState<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if ((err as { code?: string }).code === "55000")
      throw Object.assign(new Error("conflict"), { statusCode: 409 });
    throw err;
  }
}
const notFound = () => Object.assign(new Error("not_found"), { statusCode: 404 });

export async function routes(app: FastifyInstance): Promise<void> {
  // ── Equipment
  app.get("/floor/assets", async (req) => {
    const q = AssetQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id, a.location_id, a.equipment_type, a.brand, a.model, a.station_code, a.status, a.notes,
                (SELECT count(*)::int FROM app.asset_issue i
                  WHERE i.asset_id = a.id AND i.status <> 'resolved'
                    AND (i.expires_at IS NULL OR i.expires_at > now())) AS open_issues
           FROM app.asset a
          WHERE ($1::uuid IS NULL OR a.location_id = $1)
          ORDER BY a.location_id, a.station_code LIMIT 500`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  // Adds one or more units of the same equipment; each gets its own station code (all in one transaction).
  app.post("/floor/assets", async (req, reply) => {
    const b = NewAsset.parse(req.body);
    const created = await app.asCaller(req, async (tx) => {
      const out: Array<{ id: string; station_code: string }> = [];
      for (let i = 0; i < b.quantity; i += 1) {
        const { rows } = await tx.query<{ id: string; station_code: string }>(
          `INSERT INTO app.asset (location_id, equipment_type, brand, model, station_code, notes)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, station_code`,
          [
            b.location_id,
            b.equipment_type,
            b.brand ?? null,
            b.model ?? null,
            b.station_code ?? null,
            b.notes ?? null,
          ],
        );
        if (rows[0]) out.push(rows[0]);
      }
      return out;
    });
    const first = created[0];
    return reply.code(201).send({ id: first?.id, station_code: first?.station_code, created });
  });

  app.patch("/floor/assets/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = AssetPatch.parse(req.body);
    // Column names come from the zod schema keys only, never from the client.
    const cols = Object.keys(b) as Array<keyof typeof b>;
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string }>(
        `UPDATE app.asset SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}
          WHERE id = $1 RETURNING id, status`,
        [id, ...cols.map((c) => b[c] ?? null)],
      );
      return rows[0];
    });
    if (!row) throw notFound();
    return row;
  });

  // ── Station lookup (member scans or types the code on the label → exercise card)
  app.get("/floor/stations/:code", async (req) => {
    const { code } = z.object({ code: StationCode }).strict().parse(req.params);
    const card = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id, a.location_id, l.name AS location_name, a.equipment_type, a.brand, a.model,
                a.station_code, a.status
           FROM app.asset a JOIN app.location l ON l.id = a.location_id
          WHERE a.station_code = $1`,
        [code],
      );
      const asset = rows[0];
      if (!asset) return null;
      const exercises = await tx.query(
        `SELECT id, name, movement_pattern, equipment_type, cues FROM app.exercise
          WHERE equipment_type = $1 AND active ORDER BY name LIMIT 20`,
        [asset.equipment_type],
      );
      const steps = await tx.query(
        `SELECT s.circuit_id, c.name AS circuit_name, s.position, s.exercise_id, s.sets, s.reps, s.rest_seconds
           FROM app.circuit_step s JOIN app.circuit c ON c.id = s.circuit_id
          WHERE s.asset_id = $1 AND c.active ORDER BY c.name, s.position`,
        [asset.id],
      );
      return { asset, exercises: exercises.rows, circuit_steps: steps.rows };
    });
    if (!card) throw notFound();
    return card;
  });

  // ── Issues
  app.get("/floor/issues", async (req) => {
    const q = IssueQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.id, i.asset_id, a.station_code, a.equipment_type, a.status AS asset_status, i.location_id,
                i.kind, i.status, i.note, i.reported_at, i.expires_at, i.confirmed_at, i.resolved_at,
                i.reported_by = app.person_id() AS mine
           FROM app.asset_issue i JOIN app.asset a ON a.id = i.asset_id
          WHERE ($1::uuid IS NULL OR i.location_id = $1)
            AND ($2::app.asset_issue_status IS NULL OR i.status = $2)
            AND (i.kind <> 'busy' OR i.expires_at > now() OR i.status = 'resolved')
          ORDER BY i.reported_at DESC LIMIT 200`,
        [q.location_id ?? null, q.status ?? null],
      );
      return { data: rows };
    });
  });

  app.post("/floor/assets/:id/issues", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const b = IssueBody.parse(req.body);
    const issueId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.report_asset_issue($1, $2, $3) AS id",
        [id, b.kind, b.note ?? null],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id: issueId });
  });

  app.post("/floor/issues/:id/confirm", async (req) => {
    const { id } = IdParams.parse(req.params);
    const assetStatus = await mapState(
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ s: string }>("SELECT app.confirm_asset_issue($1) AS s", [
          id,
        ]);
        return rows[0]?.s;
      }),
    );
    return { id, status: "confirmed", asset_status: assetStatus };
  });

  app.post("/floor/issues/:id/resolve", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = ResolveBody.parse(req.body ?? {});
    const assetStatus = await mapState(
      app.asCaller(req, async (tx) => {
        const { rows } = await tx.query<{ s: string }>(
          "SELECT app.resolve_asset_issue($1, $2) AS s",
          [id, b.restore_asset],
        );
        return rows[0]?.s;
      }),
    );
    return { id, status: "resolved", asset_status: assetStatus };
  });

  // ── Exercise library and substitution
  app.get("/floor/exercises", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, name, movement_pattern, equipment_type, cues, active FROM app.exercise
          ORDER BY movement_pattern, name LIMIT 500`,
      );
      return { data: rows };
    }),
  );

  app.post("/floor/exercises", async (req, reply) => {
    const b = NewExercise.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO app.exercise (name, movement_pattern, equipment_type, cues, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [b.name, b.movement_pattern, b.equipment_type, b.cues, b.active],
      );
      return rows[0];
    });
    return reply.code(201).send(row);
  });

  app.patch("/floor/exercises/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = ExercisePatch.parse(req.body);
    const cols = Object.keys(b) as Array<keyof typeof b>;
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE app.exercise SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}
          WHERE id = $1 RETURNING id`,
        [id, ...cols.map((c) => b[c])],
      );
      return rows[0];
    });
    if (!row) throw notFound();
    return row;
  });

  app.get("/floor/substitutes", async (req) => {
    const q = SubstituteQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT exercise_id, name, movement_pattern, equipment_type, cues, asset_id, station_code, same_exercise
           FROM app.substitute_exercise($1, $2, $3)`,
        [q.exercise_id, q.location_id, q.exclude_asset_id ?? null],
      );
      return { data: rows };
    });
  });

  // ── Circuits
  app.get("/floor/circuits", async (req) => {
    const q = CircuitQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id, c.location_id, c.name, c.active,
                (SELECT count(*)::int FROM app.circuit_step s WHERE s.circuit_id = c.id) AS steps
           FROM app.circuit c
          WHERE ($1::uuid IS NULL OR c.location_id = $1)
          ORDER BY c.location_id, c.name LIMIT 200`,
        [q.location_id ?? null],
      );
      return { data: rows };
    });
  });

  app.get("/floor/circuits/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const circuit = await app.asCaller(req, async (tx) => {
      const c = await tx.query(
        "SELECT id, location_id, name, active FROM app.circuit WHERE id = $1",
        [id],
      );
      if (!c.rows[0]) return null;
      const steps = await tx.query(
        `SELECT s.id, s.position, s.exercise_id, e.name AS exercise_name, e.movement_pattern, e.cues,
                s.asset_id, a.station_code, a.status AS asset_status,
                coalesce(s.equipment_type, a.equipment_type) AS equipment_type,
                s.sets, s.reps, s.rest_seconds
           FROM app.circuit_step s
           JOIN app.exercise e ON e.id = s.exercise_id
           LEFT JOIN app.asset a ON a.id = s.asset_id
          WHERE s.circuit_id = $1 ORDER BY s.position`,
        [id],
      );
      return { ...c.rows[0], steps: steps.rows };
    });
    if (!circuit) throw notFound();
    return circuit;
  });

  app.post("/floor/circuits", async (req, reply) => {
    const b = NewCircuit.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO app.circuit (location_id, name, active) VALUES ($1, $2, $3) RETURNING id",
        [b.location_id, b.name, b.active],
      );
      return rows[0];
    });
    return reply.code(201).send(row);
  });

  app.patch("/floor/circuits/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = CircuitPatch.parse(req.body);
    const row = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE app.circuit SET name = coalesce($2, name), active = coalesce($3, active)
          WHERE id = $1 RETURNING id`,
        [id, b.name ?? null, b.active ?? null],
      );
      return rows[0];
    });
    if (!row) throw notFound();
    return row;
  });

  // Replace the ordered steps of a circuit in one transaction. The circuit row is locked (FOR UPDATE needs the
  // UPDATE policy, so only its managers get here) so two builders cannot interleave.
  app.put("/floor/circuits/:id/steps", async (req) => {
    const { id } = IdParams.parse(req.params);
    const b = StepsBody.parse(req.body);
    const n = await app.asCaller(req, async (tx) => {
      const c = await tx.query<{ location_id: string }>(
        "SELECT location_id FROM app.circuit WHERE id = $1 FOR UPDATE",
        [id],
      );
      const loc = c.rows[0]?.location_id;
      if (!loc) return null;
      await tx.query("DELETE FROM app.circuit_step WHERE circuit_id = $1", [id]);
      for (const [i, s] of b.steps.entries()) {
        await tx.query(
          `INSERT INTO app.circuit_step (circuit_id, location_id, position, exercise_id, asset_id, equipment_type,
             sets, reps, rest_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            loc,
            i + 1,
            s.exercise_id,
            s.asset_id ?? null,
            s.equipment_type ?? null,
            s.sets,
            s.reps,
            s.rest_seconds,
          ],
        );
      }
      return b.steps.length;
    });
    if (n === null) throw notFound();
    return { id, steps: n };
  });

  // ── Runs and set logs (members)
  app.post("/floor/circuits/:id/runs", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const runId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>("SELECT app.start_circuit_run($1) AS id", [
        id,
      ]);
      return rows[0]?.id;
    });
    return reply.code(201).send({ id: runId });
  });

  app.post("/floor/runs/:id/finish", async (req) => {
    const { id } = IdParams.parse(req.params);
    const at = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ at: Date }>("SELECT app.finish_circuit_run($1) AS at", [
        id,
      ]);
      return rows[0]?.at;
    });
    return { id, finished_at: at };
  });

  app.get("/floor/runs", async (req) =>
    app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.member_id, r.circuit_id, c.name AS circuit_name, r.location_id, r.started_at, r.finished_at
           FROM app.circuit_run r JOIN app.circuit c ON c.id = r.circuit_id
          ORDER BY r.started_at DESC LIMIT 50`,
      );
      return { data: rows };
    }),
  );

  app.post("/floor/sets", async (req, reply) => {
    const b = SetBody.parse(req.body);
    const setId = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT app.log_set($1, $2, $3, $4, $5, $6) AS id",
        [
          b.exercise_id,
          b.location_id,
          b.asset_id ?? null,
          b.circuit_run_id ?? null,
          b.reps,
          b.weight_kg,
        ],
      );
      return rows[0]?.id;
    });
    return reply.code(201).send({ id: setId });
  });

  app.get("/floor/sets", async (req) => {
    const q = SetQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.member_id, s.location_id, s.exercise_id, e.name AS exercise_name, s.asset_id,
                s.circuit_run_id, s.reps, s.weight_kg::float8 AS weight_kg, s.at
           FROM app.set_log s JOIN app.exercise e ON e.id = s.exercise_id
          WHERE ($1::uuid IS NULL OR s.member_id = $1)
          ORDER BY s.at DESC LIMIT $2`,
        [q.member_id ?? null, q.limit],
      );
      return { data: rows };
    });
  });
}
