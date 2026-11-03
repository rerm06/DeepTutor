import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for the member photo (0023, synthetic). Per org: members[1] (second location) has a 1.1 KiB
 * placeholder JPEG (magic bytes only, not a real image), taken by the owner with consent photo-v1.
 */
export async function seed(c: pg.Client, org: OrgFixture): Promise<void> {
  await c.query(
    `INSERT INTO app.member_photo (org_id, member_id, mime, data, consent_version, taken_by, taken_by_role)
     VALUES ($1, $2, 'image/jpeg', decode('ffd8ff' || repeat('00', 1100), 'hex'), 'photo-v1', $3, 'owner')`,
    [org.orgId, org.members[1], org.people.owner],
  );
}
