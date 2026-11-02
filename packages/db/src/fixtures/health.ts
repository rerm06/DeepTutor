import type pg from "pg";
import type { OrgFixture } from "../testing.js";

const ALL_NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false };

/**
 * Test fixtures for module health (synthetic). Per org, for members[0] (location 0):
 * one SIGNED assessment with its triage (green/green), one DRAFT assessment, and one PUBLISHED training plan.
 * The fixture nutritionist and clinician keep NO verified licence (tests add licensed staff where needed).
 */
export async function seed(c: pg.Client, org: OrgFixture, _label: "A" | "B"): Promise<void> {
  const staff = async (role: string) =>
    (
      await c.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
        [org.orgId, org.people[role as keyof OrgFixture["people"]], role],
      )
    ).rows[0] as { id: string; display_name: string };
  const trainer = await staff("trainer");
  const member = org.members[0];

  const signed = await c.query<{ id: string }>(
    `INSERT INTO app.assessment (org_id, member_id, evaluator_staff_id, taken_at, parq, declared_conditions,
       resting_hr, bp_sys, bp_dia, height_cm, weight_kg, waist_cm, fitness_tests, status, signed_by, signed_at)
     VALUES ($1, $2, $3, now() - interval '30 days', $4, '{}', 64, 118, 76, 168.0, 70.5, 82.0,
             '{"pushups": 18, "plank_seconds": 60}', 'signed', $3, now() - interval '30 days')
     RETURNING id`,
    [org.orgId, member, trainer.id, JSON.stringify(ALL_NO)],
  );
  const triage = await c.query<{ id: string }>(
    `INSERT INTO app.triage_result (org_id, assessment_id, member_id, exercise_level, nutrition_level,
       requires_medical_referral, reasons, computed_at)
     VALUES ($1, $2, $3, 'green', 'green', false, '{parq_all_no}', now() - interval '30 days') RETURNING id`,
    [org.orgId, signed.rows[0]?.id, member],
  );
  await c.query(
    `INSERT INTO app.assessment (org_id, member_id, evaluator_staff_id, parq, status)
     VALUES ($1, $2, $3, $4, 'draft')`,
    [org.orgId, member, trainer.id, JSON.stringify({ ...ALL_NO, q6: true })],
  );
  await c.query(
    `INSERT INTO app.care_plan (org_id, member_id, kind, title, body, rationale, created_by, status, submitted_at,
       approved_by, approved_at, approver_name, triage_result_id, published_at)
     VALUES ($1, $2, 'training', 'Demo plan de fuerza inicial', $3, 'Demo: progresión gradual', $4, 'published',
             now() - interval '20 days', $4, now() - interval '20 days', $5, $6, now() - interval '20 days')`,
    [
      org.orgId,
      member,
      JSON.stringify({
        sections: [{ heading: "Semana 1", items: ["Caminata 20 minutos", "Sentadilla 2x10"] }],
      }),
      trainer.id,
      trainer.display_name,
      triage.rows[0]?.id,
    ],
  );
}
