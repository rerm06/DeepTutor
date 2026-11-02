import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module coach (synthetic). Per org, for members[0] (location 0): two memory facts (one deleted
 * tombstone), one daily check-in from yesterday, one open escalation (pain) and one proposed coach action.
 * Inserted directly by the admin connection (no claims), so no audit rows and no CRM task are created here.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const member = org.members[0];
  const by = org.people.member;
  await c.query(
    `INSERT INTO app.member_memory (org_id, member_id, category, topic, content, source, created_by)
     VALUES ($1, $2, 'preference', 'training_schedule', $3, 'member', $4),
            ($1, $2, 'equipment', 'equipment_home', $5, 'coach', $4)`,
    [
      org.orgId,
      member,
      `Demo ${label}: prefiere entrenar temprano en la mañana`,
      by,
      "Demo: tiene bandas elásticas en casa",
    ],
  );
  await c.query(
    `INSERT INTO app.member_memory (org_id, member_id, category, topic, content, source, created_by, deleted_at)
     VALUES ($1, $2, 'other', 'deleted_fact', '(borrado)', 'member', $3, now())`,
    [org.orgId, member, by],
  );
  const ci = await c.query<{ id: string }>(
    `INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, pain_area, baseline_days,
       escalated, created_by)
     VALUES ($1, $2, (now() AT TIME ZONE 'America/Puerto_Rico')::date - 1, 3, 3, 5, 'knee', 0, true, $3)
     RETURNING id`,
    [org.orgId, member, by],
  );
  await c.query(
    `INSERT INTO app.coach_escalation (org_id, member_id, location_id, reason, source_id)
     VALUES ($1, $2, $3, 'checkin_pain', $4)`,
    [org.orgId, member, org.locations[0], ci.rows[0]?.id],
  );
  await c.query(
    `INSERT INTO app.coach_action (org_id, member_id, tool, args, summary, proposed_by)
     VALUES ($1, $2, 'add_memory', $3, 'Recordar: Demo prefiere clases cortas', $4)`,
    [
      org.orgId,
      member,
      JSON.stringify({ category: "preference", content: "Demo prefiere clases cortas" }),
      by,
    ],
  );
}
