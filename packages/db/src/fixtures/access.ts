import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/** Known secret of each org's fixture camera gateway (tests authenticate with it). */
export const DEVICE_SECRET = "a1".repeat(24);
export const deviceIdFor = (label: "A" | "B") =>
  label === "A" ? "d0000000-0000-4000-8000-00000000000a" : "d0000000-0000-4000-8000-00000000000b";

/**
 * Test fixtures for access (0024, synthetic). Per org: the schedule fixture's check-in of members[0] is closed by a
 * check-out; members[1] (second location, has a photo) opted in to face access; one camera gateway "Puerta
 * principal" (direction in) at the second location; one recognition of members[1] waiting for front-desk review.
 * Face access itself stays OFF for every location (tests switch it on).
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const device = deviceIdFor(label);
  await c.query(
    `INSERT INTO app.check_out (org_id, location_id, member_id, check_in_id, source, recorded_by)
     SELECT c.org_id, c.location_id, c.member_id, c.id, 'front_desk', $2
       FROM app.check_in c WHERE c.org_id = $1 AND c.member_id = $3 ORDER BY c.at DESC LIMIT 1`,
    [org.orgId, org.people.front_desk, org.members[0]],
  );
  await c.query(
    `INSERT INTO app.biometric_consent (org_id, member_id, version, granted_at)
     VALUES ($1, $2, 'face-v1', now() - interval '1 day')`,
    [org.orgId, org.members[1]],
  );
  await c.query(
    `INSERT INTO app.door_device (id, org_id, location_id, name, direction, secret_hash, created_by)
     VALUES ($1, $2, $3, 'Puerta principal', 'in', app.device_secret_hash($1, $4), $5)`,
    [device, org.orgId, org.locations[1], DEVICE_SECRET, org.people.owner],
  );
  await c.query(
    `INSERT INTO app.face_event (org_id, location_id, device_id, member_id, direction, score, outcome, at)
     VALUES ($1, $2, $3, $4, 'in', 0.5, 'review', now() - interval '10 minutes')`,
    [org.orgId, org.locations[1], device, org.members[1]],
  );
}
