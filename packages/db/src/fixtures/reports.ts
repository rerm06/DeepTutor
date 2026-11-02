import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module reports. The only table is `ivu_municipality`; every report is a read model over the
 * other modules' tables, so no rows are added there (other modules' tests count their own rows).
 * Per org: locations[0]'s municipality ("San Juan") recorded as a SURI participant by the owner; "Bayamón"
 * (locations[1]) is left unrecorded, so the IVU report flags it as unverified.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  await c.query(
    `INSERT INTO app.ivu_municipality (org_id, municipality, suri_status, note, updated_by)
     VALUES ($1, 'San Juan', 'participant', $2, $3)`,
    [org.orgId, `Demo ${label}: confirmado con CPA (fixture)`, org.people.owner],
  );
}
