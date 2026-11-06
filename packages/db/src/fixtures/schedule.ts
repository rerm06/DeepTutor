import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module schedule: at least one row per org in every table this module adds, so the isolation
 * matrix (packages/db/test/rls.test.ts) is never vacuous. Inserted by the superuser, outside RLS.
 * Shape per org: class type "Demo Spinning"; a future session at locations[0] taught by the trainer (capacity 2)
 * with members[0] booked; a future session at locations[1] with no instructor; a policy for locations[0];
 * a personal-training appointment (trainer × members[0]); one allowed check-in of members[0] at locations[0].
 */
export async function seed(c: pg.Client, org: OrgFixture, _label: "A" | "B"): Promise<void> {
  const q = async (sql: string, params: unknown[]) => {
    const { rows } = await c.query<{ id: string }>(sql, params);
    const id = rows[0]?.id;
    if (!id) throw new Error(`schedule fixture failed: ${sql}`);
    return id;
  };
  const trainer = await q(
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = 'trainer'",
    [org.orgId, org.people.trainer],
  );
  const classType = await q(
    "INSERT INTO app.class_type (org_id, name, duration_min, default_capacity) VALUES ($1, 'Demo Spinning', 45, 2) RETURNING id",
    [org.orgId],
  );
  const s0 = await q(
    `INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
     VALUES ($1, $2, $3, $4, 'Salon 1', now() + interval '2 days', now() + interval '2 days 45 minutes', 2, $5) RETURNING id`,
    [org.orgId, org.locations[0], classType, trainer, org.people.owner],
  );
  await q(
    `INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by)
     VALUES ($1, $2, $3, 'Salon B', now() + interval '3 days', now() + interval '3 days 45 minutes', 10, $4) RETURNING id`,
    [org.orgId, org.locations[1], classType, org.people.owner],
  );
  await q(
    "INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by) VALUES ($1, $2, $3, 'booked', $4) RETURNING id",
    [org.orgId, s0, org.members[0], org.people.member],
  );
  await c.query(
    "INSERT INTO app.location_policy (org_id, location_id, cancel_window_hours, updated_by) VALUES ($1, $2, 12, $3)",
    [org.orgId, org.locations[0], org.people.owner],
  );
  await q(
    `INSERT INTO app.appointment (org_id, location_id, kind, staff_member_id, member_id, starts_at, ends_at, created_by)
     VALUES ($1, $2, 'personal_training', $3, $4, now() + interval '4 days', now() + interval '4 days 1 hour', $5) RETURNING id`,
    [org.orgId, org.locations[0], trainer, org.members[0], org.people.front_desk],
  );
  await q(
    `INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by)
     VALUES ($1, $2, $3, 'front_desk', 'allowed', 'active', $4) RETURNING id`,
    [org.orgId, org.locations[0], org.members[0], org.people.front_desk],
  );
}
