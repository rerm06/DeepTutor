import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module portal (synthetic). Per org: members[0] has a weekly goal of 3 trainings (members[1] has
 * none, so the API default of 4 applies); the engagement fixture's individual challenge carries two perks.
 * Inserted by the admin connection after the engagement fixture.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  await c.query(
    `INSERT INTO app.member_goal (org_id, member_id, weekly_trainings, updated_by)
     VALUES ($1, $2, 3, $3)`,
    [org.orgId, org.members[0], org.people.member],
  );
  await c.query(
    `INSERT INTO app.challenge_perk (org_id, challenge_id, position, label, created_by)
     SELECT c.org_id, c.id, p.position, p.label, $3
       FROM app.challenge c,
            (VALUES (1, 'Entrenamiento guiado'), (2, 'Seguimiento de progreso')) AS p(position, label)
      WHERE c.org_id = $1 AND c.name = $2`,
    [org.orgId, `Reto Demo Noviembre ${label}`, org.people.owner],
  );
}
