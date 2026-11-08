import type { Tx } from "@gym/db";
import { FLOOR_STATION_CODE, normalizeStationCode } from "@gym/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

// Equipment use (migration 0029): a member's scan of a station registers a use mapped to the member, the exercise
// and the open routine; coaching staff read per-equipment use live and each member's routine progress.
// Every query runs as the caller (RLS). Writes go only through app.start_equipment_use / app.end_equipment_use /
// app.log_set. "Active" = not ended and activity in the last 20 minutes (the same window the database uses).

const ACTIVE = "u.ended_at IS NULL AND u.last_activity_at > now() - interval '20 minutes'";
const COACHES = new Set(["owner", "location_manager", "trainer"]);

const Id = z.string().uuid();
const StationCode = z
  .string()
  .max(40)
  .transform(normalizeStationCode)
  .pipe(z.string().regex(FLOOR_STATION_CODE));
const UseBody = z.object({ source: z.enum(["scan", "code"]).default("scan") }).strict();
const LiveQuery = z.object({ location_id: Id.optional() }).strict();
const TrainingQuery = z.object({ member_id: Id.optional() }).strict();

const fail = (status: number, error: string) =>
  Object.assign(new Error(error), { statusCode: status });

/** Definer errors that are not access problems: unknown code → 404, equipment down → 409. */
async function mapUseErrors<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "P0002") throw fail(404, "not_found");
    if (e.code === "55000")
      throw fail(409, e.message === "asset_unavailable" ? "asset_unavailable" : "conflict");
    throw err;
  }
}

interface RoutineStep {
  position: number;
  exercise_id: string;
  exercise_name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  station_code: string | null;
  equipment_type: string | null;
  done: number;
}
export interface Routine {
  run_id: string;
  circuit_id: string;
  circuit_name: string;
  location_id: string;
  started_at: string;
  finished_at: string | null;
  sets_done: number;
  sets_planned: number;
  pct: number;
}
const pct = (done: number, planned: number) =>
  planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;

/** Circuit runs of a member (newest first) with sets logged vs planned. RLS decides who may read them. */
async function routines(tx: Tx, member: string, limit: number): Promise<Routine[]> {
  const { rows } = await tx.query<
    Omit<Routine, "pct" | "started_at" | "finished_at"> & {
      started_at: Date;
      finished_at: Date | null;
    }
  >(
    `SELECT r.id AS run_id, r.circuit_id, c.name AS circuit_name, r.location_id, r.started_at, r.finished_at,
            (SELECT count(*)::int FROM app.set_log l WHERE l.circuit_run_id = r.id) AS sets_done,
            (SELECT coalesce(sum(s.sets), 0)::int FROM app.circuit_step s WHERE s.circuit_id = r.circuit_id)
              AS sets_planned
       FROM app.circuit_run r JOIN app.circuit c ON c.id = r.circuit_id
      WHERE r.member_id = $1
      ORDER BY r.finished_at IS NULL DESC, r.started_at DESC LIMIT $2`,
    [member, limit],
  );
  return rows.map((r) => ({
    ...r,
    started_at: r.started_at.toISOString(),
    finished_at: r.finished_at ? r.finished_at.toISOString() : null,
    pct: pct(r.sets_done, r.sets_planned),
  }));
}

async function routineSteps(tx: Tx, run: string): Promise<RoutineStep[]> {
  const { rows } = await tx.query<RoutineStep>(
    `SELECT s.position, s.exercise_id, e.name AS exercise_name, s.sets, s.reps, s.rest_seconds,
            a.station_code, s.equipment_type,
            least(s.sets, (SELECT count(*)::int FROM app.set_log l
                            WHERE l.circuit_run_id = r.id AND l.exercise_id = s.exercise_id))::int AS done
       FROM app.circuit_run r JOIN app.circuit_step s ON s.circuit_id = r.circuit_id
       JOIN app.exercise e ON e.id = s.exercise_id
       LEFT JOIN app.asset a ON a.id = s.asset_id
      WHERE r.id = $1 ORDER BY s.position`,
    [run],
  );
  return rows;
}

/** The caller's member id in this org, or 403 (staff and guardians cannot register uses). */
async function myMember(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ id: string | null }>("SELECT app.floor_my_member_id() AS id");
  const id = rows[0]?.id;
  if (!id) throw fail(403, "forbidden");
  return id;
}

/** One use with its station and exercise, plus the member's open routine (with steps) when there is one. */
async function useView(tx: Tx, useId: string, member: string) {
  const { rows } = await tx.query<{
    id: string;
    asset_id: string;
    station_code: string;
    equipment_type: string;
    location_id: string;
    location_name: string;
    exercise_id: string | null;
    exercise_name: string | null;
    circuit_run_id: string | null;
    started_at: Date;
    ended_at: Date | null;
  }>(
    `SELECT u.id, u.asset_id, a.station_code, a.equipment_type, u.location_id, l.name AS location_name,
            u.exercise_id, e.name AS exercise_name, u.circuit_run_id, u.started_at, u.ended_at
       FROM app.equipment_use u JOIN app.asset a ON a.id = u.asset_id
       JOIN app.location l ON l.id = u.location_id
       LEFT JOIN app.exercise e ON e.id = u.exercise_id
      WHERE u.id = $1`,
    [useId],
  );
  const u = rows[0];
  if (!u) throw fail(404, "not_found");
  const open = (await routines(tx, member, 1)).find((r) => r.finished_at === null) ?? null;
  return {
    use: {
      ...u,
      started_at: u.started_at.toISOString(),
      ended_at: u.ended_at ? u.ended_at.toISOString() : null,
    },
    routine: open ? { ...open, steps: await routineSteps(tx, open.run_id) } : null,
  };
}

function requireCoach(req: FastifyRequest) {
  if (!COACHES.has(req.claims.app_role)) throw fail(403, "forbidden");
}

export async function routes(app: FastifyInstance): Promise<void> {
  // The member scanned (or typed) a station code: register the use and return it with the routine.
  app.post("/floor/stations/:code/use", async (req, reply) => {
    const { code } = z.object({ code: StationCode }).strict().parse(req.params);
    const b = UseBody.parse(req.body ?? {});
    const view = await app.asCaller(req, async (tx) => {
      const member = await myMember(tx);
      const { rows } = await mapUseErrors(
        tx.query<{ id: string }>("SELECT app.start_equipment_use($1, $2) AS id", [code, b.source]),
      );
      return useView(tx, rows[0]?.id as string, member);
    });
    return reply.code(201).send(view);
  });

  app.post("/floor/uses/:id/end", async (req) => {
    const { id } = z.object({ id: Id }).strict().parse(req.params);
    const at = await app.asCaller(req, async (tx) => {
      const { rows } = await tx.query<{ at: Date }>("SELECT app.end_equipment_use($1) AS at", [id]);
      return rows[0]?.at;
    });
    return { id, ended_at: at };
  });

  // The member's current use (any station) and open routine, for the station page and the portal.
  app.get("/floor/me/use", async (req) =>
    app.asCaller(req, async (tx) => {
      const member = await myMember(tx);
      const { rows } = await tx.query<{ id: string }>(
        `SELECT u.id FROM app.equipment_use u WHERE u.member_id = $1 AND ${ACTIVE}`,
        [member],
      );
      if (rows[0]) return useView(tx, rows[0].id, member);
      const open = (await routines(tx, member, 1)).find((r) => r.finished_at === null) ?? null;
      return {
        use: null,
        routine: open ? { ...open, steps: await routineSteps(tx, open.run_id) } : null,
      };
    }),
  );

  // Live board (owner / location manager / trainer): every station with who is on it now, today's totals, and
  // the members training a routine right now with their progress. RLS limits it to the caller's locations.
  app.get("/floor/live", async (req) => {
    requireCoach(req);
    const q = LiveQuery.parse(req.query);
    return app.asCaller(req, async (tx) => {
      const assets = await tx.query<{
        id: string;
        station_code: string;
        equipment_type: string;
        status: string;
        location_id: string;
        uses_today: number;
        members_today: number;
        minutes_today: number;
        sets_today: number;
      }>(
        `SELECT a.id, a.station_code, a.equipment_type, a.status, a.location_id,
                count(u.id)::int AS uses_today,
                count(DISTINCT u.member_id)::int AS members_today,
                coalesce(round(sum(extract(epoch FROM (
                  CASE WHEN u.ended_at IS NOT NULL THEN u.ended_at
                       WHEN u.last_activity_at > now() - interval '20 minutes' THEN now()
                       ELSE u.last_activity_at END) - u.started_at)) / 60), 0)::int AS minutes_today,
                (SELECT count(*)::int FROM app.set_log s
                  WHERE s.asset_id = a.id AND s.at >= (date_trunc('day', now() AT TIME ZONE l.timezone)
                                                       AT TIME ZONE l.timezone)) AS sets_today
           FROM app.asset a JOIN app.location l ON l.id = a.location_id
           LEFT JOIN app.equipment_use u ON u.asset_id = a.id
                 AND u.started_at >= (date_trunc('day', now() AT TIME ZONE l.timezone) AT TIME ZONE l.timezone)
          WHERE ($1::uuid IS NULL OR a.location_id = $1)
          GROUP BY a.id, l.timezone
          ORDER BY a.location_id, a.station_code LIMIT 500`,
        [q.location_id ?? null],
      );
      const active = await tx.query<{
        id: string;
        asset_id: string;
        member_id: string;
        name: string | null;
        started_at: Date;
        last_activity_at: Date;
        exercise_name: string | null;
        circuit_name: string | null;
      }>(
        `SELECT u.id, u.asset_id, u.member_id, m.full_name AS name, u.started_at, u.last_activity_at,
                e.name AS exercise_name, c.name AS circuit_name
           FROM app.equipment_use u
           LEFT JOIN app.member m ON m.id = u.member_id
           LEFT JOIN app.exercise e ON e.id = u.exercise_id
           LEFT JOIN app.circuit_run r ON r.id = u.circuit_run_id
           LEFT JOIN app.circuit c ON c.id = r.circuit_id
          WHERE ${ACTIVE} AND ($1::uuid IS NULL OR u.location_id = $1)
          ORDER BY u.started_at`,
        [q.location_id ?? null],
      );
      const training = await tx.query<{
        run_id: string;
        member_id: string;
        name: string | null;
        circuit_name: string;
        started_at: Date;
        sets_done: number;
        sets_planned: number;
        station_code: string | null;
      }>(
        `SELECT r.id AS run_id, r.member_id, m.full_name AS name, c.name AS circuit_name, r.started_at,
                (SELECT count(*)::int FROM app.set_log l WHERE l.circuit_run_id = r.id) AS sets_done,
                (SELECT coalesce(sum(s.sets), 0)::int FROM app.circuit_step s WHERE s.circuit_id = r.circuit_id)
                  AS sets_planned,
                (SELECT a.station_code FROM app.equipment_use u JOIN app.asset a ON a.id = u.asset_id
                  WHERE u.member_id = r.member_id AND ${ACTIVE} LIMIT 1) AS station_code
           FROM app.circuit_run r JOIN app.circuit c ON c.id = r.circuit_id
           LEFT JOIN app.member m ON m.id = r.member_id
          WHERE r.finished_at IS NULL AND r.started_at > now() - interval '12 hours'
            AND ($1::uuid IS NULL OR r.location_id = $1)
          ORDER BY r.started_at DESC LIMIT 100`,
        [q.location_id ?? null],
      );
      const byAsset = new Map<string, typeof active.rows>();
      for (const u of active.rows) byAsset.set(u.asset_id, [...(byAsset.get(u.asset_id) ?? []), u]);
      const data = assets.rows.map((a) => ({
        ...a,
        in_use: (byAsset.get(a.id) ?? []).map((u) => ({
          use_id: u.id,
          member_id: u.member_id,
          name: u.name,
          since: u.started_at.toISOString(),
          last_activity_at: u.last_activity_at.toISOString(),
          exercise_name: u.exercise_name,
          circuit_name: u.circuit_name,
        })),
      }));
      return {
        at: new Date().toISOString(),
        totals: {
          stations: data.length,
          in_use: data.filter((a) => a.in_use.length > 0).length,
          members_now: new Set(active.rows.map((u) => u.member_id)).size,
          uses_today: data.reduce((n, a) => n + a.uses_today, 0),
          down: data.filter((a) => a.status !== "ok").length,
        },
        assets: data,
        training: training.rows.map((r) => ({
          ...r,
          started_at: r.started_at.toISOString(),
          pct: pct(r.sets_done, r.sets_planned),
        })),
      };
    });
  });

  // Routine progress and equipment use of one member: the member themself (no member_id), or a coach (member_id).
  app.get("/floor/training", async (req) => {
    const q = TrainingQuery.parse(req.query);
    const role = req.claims.app_role;
    if (q.member_id ? !COACHES.has(role) : role !== "member") throw fail(403, "forbidden");
    return app.asCaller(req, async (tx) => {
      const member = q.member_id ?? (await myMember(tx));
      const runs = await routines(tx, member, 10);
      const open = runs.find((r) => r.finished_at === null) ?? null;
      const uses = await tx.query<{
        id: string;
        station_code: string;
        equipment_type: string;
        exercise_name: string | null;
        circuit_name: string | null;
        started_at: Date;
        ended_at: Date | null;
        active: boolean;
        minutes: number;
      }>(
        `SELECT u.id, a.station_code, a.equipment_type, e.name AS exercise_name, c.name AS circuit_name,
                u.started_at, u.ended_at, (${ACTIVE}) AS active,
                round(extract(epoch FROM (CASE WHEN u.ended_at IS NOT NULL THEN u.ended_at
                                               WHEN ${ACTIVE} THEN now() ELSE u.last_activity_at END)
                                         - u.started_at) / 60)::int AS minutes
           FROM app.equipment_use u JOIN app.asset a ON a.id = u.asset_id
           LEFT JOIN app.exercise e ON e.id = u.exercise_id
           LEFT JOIN app.circuit_run r ON r.id = u.circuit_run_id
           LEFT JOIN app.circuit c ON c.id = r.circuit_id
          WHERE u.member_id = $1 ORDER BY u.started_at DESC LIMIT 20`,
        [member],
      );
      const byEquipment = await tx.query<{ equipment_type: string; uses: number }>(
        `SELECT a.equipment_type, count(*)::int AS uses
           FROM app.equipment_use u JOIN app.asset a ON a.id = u.asset_id
          WHERE u.member_id = $1 AND u.started_at > now() - interval '30 days'
          GROUP BY a.equipment_type ORDER BY uses DESC, a.equipment_type LIMIT 8`,
        [member],
      );
      return {
        member_id: member,
        open: open ? { ...open, steps: await routineSteps(tx, open.run_id) } : null,
        routines: runs,
        uses: uses.rows.map((u) => ({
          ...u,
          started_at: u.started_at.toISOString(),
          ended_at: u.ended_at ? u.ended_at.toISOString() : null,
        })),
        by_equipment: byEquipment.rows,
      };
    });
  });
}
