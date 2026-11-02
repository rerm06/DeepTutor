import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module floor (one or more rows per org in every table). Station codes are prefixed with the
 * org label and location number (e.g. "A1-BAR-01") so tests can find rows without extra exports.
 * Location 1 = org.locations[0], location 2 = org.locations[1].
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const id = async (sql: string, params: unknown[]): Promise<string> => {
    const { rows } = await c.query<{ id: string }>(sql, params);
    const v = rows[0]?.id;
    if (!v) throw new Error(`floor fixture failed: ${sql}`);
    return v;
  };
  const [loc1, loc2] = org.locations;

  const ex: Record<string, string> = {};
  for (const [key, name, pattern, equipment] of [
    ["squat", "Sentadilla con barra", "squat", "barbell"],
    ["legpress", "Prensa de piernas", "squat", "leg_press"],
    ["goblet", "Sentadilla goblet", "squat", "kettlebell"],
    ["airsquat", "Sentadilla al aire", "squat", "none"],
    ["bench", "Press de banca", "push_horizontal", "barbell"],
    ["chestpress", "Press de pecho en máquina", "push_horizontal", "chest_press"],
    ["pushup", "Flexiones", "push_horizontal", "none"],
    ["latpull", "Jalón al pecho", "pull_vertical", "lat_pulldown"],
    ["row", "Remo en máquina", "pull_horizontal", "row_machine"],
    ["rdl", "Peso muerto rumano", "hinge", "barbell"],
    ["walk", "Caminata en caminadora", "cardio", "treadmill"],
  ] as const) {
    ex[key] = await id(
      `INSERT INTO app.exercise (org_id, name, movement_pattern, equipment_type, cues)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org.orgId, name, pattern, equipment, `Demo: técnica de ${name.toLowerCase()}.`],
    );
  }

  const asset: Record<string, string> = {};
  for (const [code, loc, type, status] of [
    [`${label}1-BAR-01`, loc1, "barbell", "ok"],
    [`${label}1-LP-01`, loc1, "leg_press", "ok"],
    [`${label}1-LP-02`, loc1, "leg_press", "out_of_service"],
    [`${label}1-CP-01`, loc1, "chest_press", "ok"],
    [`${label}1-LAT-01`, loc1, "lat_pulldown", "ok"],
    [`${label}1-TM-01`, loc1, "treadmill", "maintenance"],
    [`${label}2-KB-01`, loc2, "kettlebell", "ok"],
    [`${label}2-LP-01`, loc2, "leg_press", "ok"],
    [`${label}2-ROW-01`, loc2, "row_machine", "ok"],
  ] as const) {
    asset[code] = await id(
      `INSERT INTO app.asset (org_id, location_id, equipment_type, brand, model, station_code, status)
       VALUES ($1, $2, $3, 'Demo Equipos', 'Serie D', $4, $5) RETURNING id`,
      [org.orgId, loc, type, code, status],
    );
  }

  await c.query(
    `INSERT INTO app.asset_issue (org_id, location_id, asset_id, reported_by, kind, note)
     VALUES ($1, $2, $3, $4, 'out_of_service', 'Demo: el cable hace ruido')`,
    [org.orgId, loc1, asset[`${label}1-CP-01`], org.people.member],
  );

  const circuit = await id(
    "INSERT INTO app.circuit (org_id, location_id, name) VALUES ($1, $2, $3) RETURNING id",
    [org.orgId, loc1, `Circuito Fuerza ${label}`],
  );
  const steps: Array<[number, string, string | null, string | null]> = [
    [1, ex.squat as string, asset[`${label}1-BAR-01`] as string, null],
    [2, ex.chestpress as string, null, "chest_press"],
    [3, ex.latpull as string, asset[`${label}1-LAT-01`] as string, null],
  ];
  for (const [position, exercise, assetId, equipment] of steps) {
    await c.query(
      `INSERT INTO app.circuit_step (org_id, circuit_id, location_id, position, exercise_id, asset_id,
         equipment_type, sets, reps, rest_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 3, 10, 60)`,
      [org.orgId, circuit, loc1, position, exercise, assetId, equipment],
    );
  }

  const run = await id(
    `INSERT INTO app.circuit_run (org_id, member_id, circuit_id, location_id, started_at, finished_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 day', now() - interval '23 hours') RETURNING id`,
    [org.orgId, org.members[0], circuit, loc1],
  );
  await c.query(
    `INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, circuit_run_id, reps, weight_kg, at)
     VALUES ($1, $2, $3, $4, $5, $6, 8, 60, now() - interval '1 day')`,
    [org.orgId, org.members[0], loc1, ex.squat, asset[`${label}1-BAR-01`], run],
  );
  await c.query(
    `INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, reps, weight_kg)
     VALUES ($1, $2, $3, $4, $5, 10, 100)`,
    [org.orgId, org.members[1], loc2, ex.legpress, asset[`${label}2-LP-01`]],
  );
}
