import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for equipment use (0029). Per org: members[0] used <L>1-BAR-01 yesterday inside their (finished)
 * circuit run, and members[1] has an open use of <L>2-LP-01 right now (no routine).
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const v = (await c.query<{ id: string }>(sql, params)).rows[0]?.id;
    if (!v) throw new Error(`equipment fixture failed: ${sql}`);
    return v;
  };
  const asset = (code: string) =>
    one("SELECT id FROM app.asset WHERE org_id = $1 AND station_code = $2", [org.orgId, code]);
  const [loc1, loc2] = org.locations;
  const run = await one(
    "SELECT id FROM app.circuit_run WHERE org_id = $1 AND member_id = $2 ORDER BY started_at LIMIT 1",
    [org.orgId, org.members[0]],
  );
  const squat = await one("SELECT id FROM app.exercise WHERE org_id = $1 AND name = $2", [
    org.orgId,
    "Sentadilla con barra",
  ]);
  await c.query(
    `INSERT INTO app.equipment_use (org_id, member_id, location_id, asset_id, circuit_run_id, exercise_id,
       started_at, last_activity_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '1 day', now() - interval '1 day' + interval '6 minutes',
       now() - interval '1 day' + interval '8 minutes')`,
    [org.orgId, org.members[0], loc1, await asset(`${label}1-BAR-01`), run, squat],
  );
  await c.query(
    `INSERT INTO app.equipment_use (org_id, member_id, location_id, asset_id, started_at, last_activity_at)
     VALUES ($1, $2, $3, $4, now() - interval '3 minutes', now() - interval '1 minute')`,
    [org.orgId, org.members[1], loc2, await asset(`${label}2-LP-01`)],
  );
}
