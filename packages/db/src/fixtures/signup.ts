import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module signup (synthetic). Per org: locations[0] open for online sign-up, locations[1] closed;
 * members[0] carries accepted terms and liability release (front desk); two old join attempts (one "created" for
 * members[0], one generic "existing"), both outside the one-hour rate-cap window. Inserted by the admin connection.
 */
export async function seed(c: pg.Client, org: OrgFixture, _label: "A" | "B"): Promise<void> {
  await c.query(
    `INSERT INTO app.join_location (org_id, location_id, enabled, updated_by)
     VALUES ($1, $2, true, $4), ($1, $3, false, $4)`,
    [org.orgId, org.locations[0], org.locations[1], org.people.owner],
  );
  await c.query(
    `INSERT INTO app.member_agreement (org_id, member_id, kind, version, locale, source, accepted_by, evidence)
     VALUES ($1, $2, 'terms', 'v2026-11', 'es', 'front_desk', $3, 'Demo fixture'),
            ($1, $2, 'waiver', 'v2026-11', 'es', 'front_desk', $3, 'Demo fixture')`,
    [org.orgId, org.members[0], org.people.member],
  );
  await c.query(
    `INSERT INTO app.join_attempt (org_id, location_id, outcome, member_id, at)
     VALUES ($1, $2, 'created', $3, now() - interval '2 days'), ($1, $2, 'existing', NULL, now() - interval '2 days')`,
    [org.orgId, org.locations[0], org.members[0]],
  );
}
