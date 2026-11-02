import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for module engagement: at least one row per org in every table this module adds, so the
 * isolation matrix (packages/db/test/rls.test.ts) is never vacuous. Runs as the admin connection (no claims).
 * members[0] (location 0): rules-based history, a requested redemption, an opted-in challenge entry, a pending
 * referral, an achievement and an APPROVED post. members[1] (location 1): a team entry (not listed) and a PENDING post.
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const { orgId } = org;
  const [m0, m1] = org.members;
  const by = org.people.front_desk;
  const id = async (sql: string, params: unknown[]) => {
    const { rows } = await c.query<{ id: string }>(sql, params);
    const v = rows[0]?.id;
    if (!v) throw new Error(`engagement fixture failed: ${sql}`);
    return v;
  };

  await c.query(
    `INSERT INTO app.points_rule (org_id, event, points) VALUES
       ($1,'visit',10), ($1,'class',15), ($1,'purchase',5), ($1,'challenge_goal',100), ($1,'referral',200),
       ($1,'comeback_bonus',50)`,
    [orgId],
  );
  const shake = await id(
    "INSERT INTO app.reward (org_id, name, description, points_cost) VALUES ($1, $2, 'Demo', 100) RETURNING id",
    [orgId, `Batido Demo ${label}`],
  );
  await c.query(
    "INSERT INTO app.reward (org_id, name, points_cost, restricted_for_minors) VALUES ($1, $2, 300, true)",
    [orgId, `Suplemento Demo ${label}`],
  );

  const ledger = (
    member: string,
    delta: number,
    reason: string,
    ref: string | null,
    note: string | null,
    at: string,
  ) =>
    c.query(
      `INSERT INTO app.points_ledger (org_id, member_id, delta, reason, ref, note, created_by, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - $8::interval)`,
      [orgId, member, delta, reason, ref, note, by, at],
    );
  await ledger(m0, 500, "manual", null, "Demo saldo inicial", "30 days");
  await ledger(m0, 10, "visit", null, null, "8 days");
  await ledger(m0, 15, "class", "fixture-class-1", null, "8 days");
  await ledger(m1, 10, "visit", null, null, "3 days");

  const redemption = await id(
    `INSERT INTO app.redemption (org_id, member_id, reward_id, points, requested_by)
     VALUES ($1,$2,$3,100,$4) RETURNING id`,
    [orgId, m0, shake, org.people.member],
  );
  await ledger(m0, -100, "redemption", redemption, null, "1 day");

  const challenge = await id(
    `INSERT INTO app.challenge (org_id, name, kind, metric, starts_on, ends_on, goal, created_by)
     VALUES ($1, $2, 'individual', 'visits', current_date - 7, current_date + 21, 8, $3) RETURNING id`,
    [orgId, `Reto Demo Noviembre ${label}`, org.people.owner],
  );
  const teamChallenge = await id(
    `INSERT INTO app.challenge (org_id, name, kind, metric, starts_on, ends_on, goal, created_by)
     VALUES ($1, $2, 'team', 'classes', current_date - 7, current_date + 21, 20, $3) RETURNING id`,
    [orgId, `Equipos Demo ${label}`, org.people.owner],
  );
  const team = await id(
    "INSERT INTO app.challenge_team (org_id, challenge_id, name) VALUES ($1,$2,'Equipo Demo Rojo') RETURNING id",
    [orgId, teamChallenge],
  );
  await c.query(
    `INSERT INTO app.challenge_participant (org_id, challenge_id, member_id, show_on_leaderboard, compare_mode, progress)
     VALUES ($1,$2,$3,true,'ranked',1)`,
    [orgId, challenge, m0],
  );
  await c.query(
    `INSERT INTO app.challenge_participant (org_id, challenge_id, member_id, team_id, progress)
     VALUES ($1,$2,$3,$4,0)`,
    [orgId, teamChallenge, m1, team],
  );

  await c.query(
    "INSERT INTO app.referral (org_id, referrer_member_id, referred_email) VALUES ($1,$2,$3)",
    [orgId, m0, `amigo.${label.toLowerCase()}@demo.invalid`],
  );
  await c.query(
    "INSERT INTO app.achievement (org_id, member_id, code) VALUES ($1,$2,'first_visit')",
    [orgId, m0],
  );
  await c.query(
    `INSERT INTO app.community_post (org_id, author_member_id, location_id, author_label, body, status, moderated_by, moderated_at)
     VALUES ($1,$2,$3,'Demo m.','Demo: gran clase hoy, gracias a todos.','approved',$4, now())`,
    [orgId, m0, org.locations[0], by],
  );
  await c.query(
    `INSERT INTO app.community_post (org_id, author_member_id, location_id, author_label, body)
     VALUES ($1,$2,$3,'Demo m.','Demo: pendiente de moderación.')`,
    [orgId, m1, org.locations[1]],
  );
}
