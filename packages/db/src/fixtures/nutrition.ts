import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/**
 * Test fixtures for nutrition (0030/0031). Per org: members[0] has a complete profile (adult, fat-loss goal, peanut
 * allergy, no pork, questionnaire all "no", disclaimer accepted), a declared measurement (weight, height) and a draft
 * plan of two items whose values the trigger computes from the USDA catalog. members[1] keeps the empty profile the
 * migration links to every member.
 */
export async function seed(c: pg.Client, org: OrgFixture): Promise<void> {
  const m = org.members[0];
  const person = (await c.query("SELECT person_id FROM app.member WHERE id = $1", [m])).rows[0]
    .person_id;
  await c.query(
    `UPDATE app.nutrition_profile SET goal = 'perder_grasa', rate_pct_week = 0.5, birth_date = DATE '1990-05-10',
       sex_for_equations = 'femenino', daily_activity = 'ligero', allergens = ARRAY['mani'], diet_exclusions = ARRAY['cerdo'],
       health_answers = '{"embarazo":false,"lactancia":false,"diabetes":false,"enfermedad_renal":false,
         "enfermedad_cardiovascular":false,"tca_actual":false,"tca_pasado":false,"medicamento_apetito_peso":false}'::jsonb,
       health_answered_at = now(), disclaimer_accepted_at = now(), status = 'apto'
     WHERE member_id = $1`,
    [m],
  );
  await c.query(
    `INSERT INTO app.nutrition_measurement (org_id, member_id, source, weight_kg, height_cm, recorded_by)
     VALUES ($1, $2, 'declarado', 72.0, 165.0, $3)`,
    [org.orgId, m, person],
  );
  const plan = (
    await c.query(
      `INSERT INTO app.nutrition_plan (id, org_id, member_id, series_id, version, week_start, origin, inputs, calc,
         verifier, model, prompt_version, created_by)
       VALUES ($4, $1, $2, $4, 1, date_trunc('week', now())::date, 'manual', '{}'::jsonb, '{}'::jsonb,
         '{"ok":true}'::jsonb, NULL, NULL, $3)
       RETURNING id`,
      [org.orgId, m, person, randomUUID()],
    )
  ).rows[0].id;
  for (const [pos, fdc, grams] of [
    [1, 173904, 40],
    [2, 173944, 118],
  ] as const) {
    await c.query(
      `INSERT INTO app.nutrition_plan_item (org_id, plan_id, day, meal, dish, position, fdc_id, grams, kcal, protein_g,
         carb_g, fat_g)
       VALUES ($1, $2, 1, 'desayuno', 'Avena con guineo', $3, $4, $5, 0, 0, 0, 0)`,
      [org.orgId, plan, pos, fdc, grams],
    );
  }
}
