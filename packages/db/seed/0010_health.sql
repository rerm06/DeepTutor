-- Demo seed for module health. SYNTHETIC data only ("Demo", @demo.invalid); idempotent; see docs/modules/health.md.
-- Runs as the schema owner after the core demo seed. FORCE RLS is lifted only while seeding and restored at the end:
-- on the health tables, and on person / staff_member / staff_location to add the two licensed demo professionals
-- (nutrition specialist 507 and clinician 508 at Demo Sede San Juan). Triage values are computed by
-- app.health_triage() itself so the demo never disagrees with the rules (rule_version 'v0-propuesta').
DO $seed$
DECLARE
  v_org constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_loc constant uuid := 'a0000000-0000-4000-8000-000000000011';
  v_trainer constant uuid := 'a0000000-0000-4000-8000-000000000505';
  v_nutri constant uuid := 'a0000000-0000-4000-8000-000000000507';
  v_clin constant uuid := 'a0000000-0000-4000-8000-000000000508';
  v_no constant jsonb := '{"q1":false,"q2":false,"q3":false,"q4":false,"q5":false,"q6":false,"q7":false}';
  r record;
  tr record;
  v_a uuid;
  v_t uuid;
  v_triage jsonb := '{}'::jsonb;  -- member id → triage id
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = v_org) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.staff_member WHERE id = v_nutri) THEN RETURN; END IF;

  ALTER TABLE app.person NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.staff_member NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.staff_location NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.assessment NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.triage_result NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.care_plan NO FORCE ROW LEVEL SECURITY;

  -- Licensed professionals (synthetic licence numbers, verified for the demo).
  INSERT INTO app.person (id, email) VALUES
    ('a0000000-0000-4000-8000-000000000107', 'nutrition.107.seed.a@demo.invalid'),
    ('a0000000-0000-4000-8000-000000000108', 'clinician.108.seed.a@demo.invalid');
  INSERT INTO app.staff_member (id, org_id, person_id, role, display_name, license_no, license_verified_at) VALUES
    (v_nutri, v_org, 'a0000000-0000-4000-8000-000000000107', 'nutritionist', 'Valeria Quiñones', 'DEMO-N-0001', now()),
    (v_clin, v_org, 'a0000000-0000-4000-8000-000000000108', 'clinician', 'Rafael Benítez', 'DEMO-C-0001', now());
  INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES
    (v_org, v_nutri, v_loc), (v_org, v_clin, v_loc);

  -- Signed assessments (trainer Ricardo Santos) covering the triage rows.
  FOR r IN SELECT * FROM (VALUES
      ('a0000000-0000-4000-8000-000000000210'::uuid, v_no, false, '{}'::text[], false, 40,  64::smallint, 116::smallint, 74::smallint, 162.0, 61.5, 74.0),
      ('a0000000-0000-4000-8000-000000000211'::uuid, v_no || '{"q4":true,"q5":true}', false, '{diabetes}'::text[], false, 25, 78::smallint, 134::smallint, 86::smallint, 175.0, 92.0, 101.0),
      ('a0000000-0000-4000-8000-000000000212'::uuid, v_no, false, '{eating_disorder_screen_positive}'::text[], false, 12, 70::smallint, 112::smallint, 70::smallint, 158.0, 50.0, 66.0),
      ('a0000000-0000-4000-8000-000000000213'::uuid, v_no || '{"q2":true}', false, '{cvd}'::text[], true, 2, 96::smallint, 150::smallint, 95::smallint, 180.0, 88.0, 98.0),
      ('a0000000-0000-4000-8000-000000000230'::uuid, v_no || '{"q6":true}', true, '{}'::text[], false, 20, 80::smallint, 105::smallint, 68::smallint, 150.0, 42.0, 62.0)
    ) AS x(member_id, parq, resolved, conditions, acute, days_ago, hr, sys, dia, height, weight, waist)
  LOOP
    INSERT INTO app.assessment (org_id, member_id, evaluator_staff_id, taken_at, parq, parq_followup_resolved,
      declared_conditions, resting_hr, bp_sys, bp_dia, height_cm, weight_kg, waist_cm, fitness_tests,
      acute_symptoms, status, signed_by, signed_at)
    VALUES (v_org, r.member_id, v_trainer, now() - make_interval(days => r.days_ago), r.parq, r.resolved,
      r.conditions, r.hr, r.sys, r.dia, r.height, r.weight, r.waist, '{"pushups": 15, "plank_seconds": 45}',
      r.acute, 'signed', v_trainer, now() - make_interval(days => r.days_ago))
    RETURNING id INTO v_a;
    SELECT * INTO tr FROM app.health_triage(r.parq, r.resolved, r.conditions, r.acute,
      EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = r.member_id));
    INSERT INTO app.triage_result (org_id, assessment_id, member_id, exercise_level, nutrition_level,
      requires_medical_referral, emergency, no_calorie_counting, reasons, computed_at)
    VALUES (v_org, v_a, r.member_id, tr.exercise_level, tr.nutrition_level, tr.requires_medical_referral,
      tr.emergency, tr.no_calorie_counting, tr.reasons, now() - make_interval(days => r.days_ago))
    RETURNING id INTO v_t;
    v_triage := v_triage || jsonb_build_object(r.member_id::text, v_t);
  END LOOP;

  -- A draft assessment still being filled in (Andrés, Demo Sede Bayamón: visible to the owner only).
  INSERT INTO app.assessment (org_id, member_id, evaluator_staff_id, parq, status)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000217', 'a0000000-0000-4000-8000-000000000501', v_no, 'draft');

  -- Ana Rivera: published training plan + published nutrition plan signed by the licensed specialist.
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, rationale, created_by, status, submitted_at,
    approved_by, approved_at, approver_name, triage_result_id, published_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000210', 'training', 'Demo plan de fuerza inicial',
    '{"sections":[{"heading":"Semanas 1 y 2","items":["Calentamiento 10 minutos","Sentadilla a cajón 3x10","Remo con banda 3x12","Caminata 20 minutos"]},{"heading":"Semanas 3 y 4","items":["Peso muerto rumano con mancuernas 3x10","Press de pecho en máquina 3x10","Plancha 3x30 segundos"]}]}',
    'Demo: PAR-Q+ sin hallazgos; progresión gradual.', v_trainer, 'published', now() - interval '35 days',
    v_trainer, now() - interval '34 days', 'Ricardo Santos',
    (v_triage ->> 'a0000000-0000-4000-8000-000000000210')::uuid, now() - interval '34 days');
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, rationale, created_by, status, submitted_at,
    approved_by, approved_at, approver_name, approver_license_no, triage_result_id, published_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000210', 'nutrition', 'Demo plan alimentario base',
    '{"sections":[{"heading":"Estructura del día","items":["Tres comidas y una merienda en horarios regulares","Incluir vegetales en almuerzo y cena","Agua como bebida principal"]},{"heading":"Seguimiento","items":["Revisión con la especialista en cuatro semanas"]}]}',
    'Demo: triaje nutricional verde.', v_nutri, 'published', now() - interval '30 days',
    v_nutri, now() - interval '29 days', 'Valeria Quiñones', 'DEMO-N-0001',
    (v_triage ->> 'a0000000-0000-4000-8000-000000000210')::uuid, now() - interval '29 days');

  -- Pedro Morales (diabetes → amber/amber + referral): nutrition plan waiting for review and acknowledgement.
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status, submitted_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000211', 'nutrition', 'Demo plan alimentario coordinado',
    '{"sections":[{"heading":"Coordinación","items":["Coordinar con su médico antes de cambios","Registrar horarios de comida"]}]}',
    v_nutri, 'review', now() - interval '3 days');
  -- Sofía Delgado (ED screen positive → nutrition red): the plan in review cannot be approved.
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status, submitted_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000212', 'nutrition', 'Demo borrador alimentario',
    '{"sections":[{"heading":"Pendiente","items":["Referido a profesional de la salud antes de cualquier plan"]}]}',
    v_nutri, 'review', now() - interval '1 day');
  -- Diego Méndez (minor with guardian): published training plan.
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status, submitted_at,
    approved_by, approved_at, approver_name, triage_result_id, published_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000230', 'training', 'Demo plan juvenil de movilidad',
    '{"sections":[{"heading":"Dos veces por semana","items":["Juegos de agilidad 15 minutos","Movilidad de cadera y hombro","Técnica de sentadilla sin carga"]}]}',
    v_trainer, 'published', now() - interval '18 days', v_trainer, now() - interval '18 days', 'Ricardo Santos',
    (v_triage ->> 'a0000000-0000-4000-8000-000000000230')::uuid, now() - interval '18 days');
  -- Lucía Font: treatment plan drafted by the clinician, in review.
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, created_by, status, submitted_at)
  VALUES (v_org, 'a0000000-0000-4000-8000-000000000214', 'treatment', 'Demo plan de readaptación de rodilla',
    '{"sections":[{"heading":"Fase 1","items":["Movilidad sin dolor","Isométricos de cuádriceps 3x20 segundos"]}]}',
    v_clin, 'review', now() - interval '2 days');

  -- Org B (Demo Club Sur): one signed assessment by the owner, so the second tenant has health rows too.
  IF EXISTS (SELECT 1 FROM app.member WHERE id = 'b0000000-0000-4000-8000-000000000210') THEN
    INSERT INTO app.assessment (org_id, member_id, evaluator_staff_id, taken_at, parq, resting_hr, bp_sys, bp_dia,
      height_cm, weight_kg, status, signed_by, signed_at)
    VALUES ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000210',
      'b0000000-0000-4000-8000-000000000501', now() - interval '10 days', v_no, 66, 118, 76, 166.0, 63.0, 'signed',
      'b0000000-0000-4000-8000-000000000501', now() - interval '10 days')
    RETURNING id INTO v_a;
    SELECT * INTO tr FROM app.health_triage(v_no, false, '{}', false, false);
    INSERT INTO app.triage_result (org_id, assessment_id, member_id, exercise_level, nutrition_level,
      requires_medical_referral, emergency, no_calorie_counting, reasons, computed_at)
    VALUES ('b0000000-0000-4000-8000-000000000001', v_a, 'b0000000-0000-4000-8000-000000000210',
      tr.exercise_level, tr.nutrition_level, tr.requires_medical_referral, tr.emergency, tr.no_calorie_counting,
      tr.reasons, now() - interval '10 days');
  END IF;

  ALTER TABLE app.person FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.staff_member FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.staff_location FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.assessment FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.triage_result FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.care_plan FORCE ROW LEVEL SECURITY;
END $seed$;
