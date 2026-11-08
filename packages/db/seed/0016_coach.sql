-- Demo seed for module coach. SYNTHETIC data only ("Demo", @demo.invalid); idempotent; see docs/modules/coach.md.
-- Runs as the schema owner after the core, health and floor demo seeds. FORCE RLS is lifted only on the coach tables
-- while seeding and restored at the end. No CRM tasks or audit rows are created here (those tables stay untouched);
-- the demo escalations are assigned to trainer Ricardo Santos (staff 505) or left unassigned in org B.
DO $seed$
DECLARE
  v_org constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_loc constant uuid := 'a0000000-0000-4000-8000-000000000011';
  v_ana constant uuid := 'a0000000-0000-4000-8000-000000000210';        -- persona "A-member"
  v_ana_p constant uuid := 'a0000000-0000-4000-8000-000000000110';
  v_pedro constant uuid := 'a0000000-0000-4000-8000-000000000211';
  v_pedro_p constant uuid := 'a0000000-0000-4000-8000-000000000111';
  v_diego constant uuid := 'a0000000-0000-4000-8000-000000000230';      -- minor, guardian Rosa Méndez (120)
  v_rosa_p constant uuid := 'a0000000-0000-4000-8000-000000000120';
  v_trainer constant uuid := 'a0000000-0000-4000-8000-000000000505';
  v_trainer_p constant uuid := 'a0000000-0000-4000-8000-000000000105';
  v_org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_loc_b constant uuid := 'b0000000-0000-4000-8000-000000000011';
  v_isabel constant uuid := 'b0000000-0000-4000-8000-000000000210';
  v_isabel_p constant uuid := 'b0000000-0000-4000-8000-000000000110';
  v_today date := (now() AT TIME ZONE 'America/Puerto_Rico')::date;
  v_ci uuid;
  r record;
  n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = v_org) THEN RETURN; END IF;

  ALTER TABLE app.member_memory NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.daily_checkin NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.coach_escalation NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.coach_action NO FORCE ROW LEVEL SECURITY;

  IF NOT EXISTS (SELECT 1 FROM app.member_memory WHERE id = 'a0000000-0000-4000-8000-000000001601') THEN
    -- Memory: Ana (member persona), Pedro (knee), Diego (written by his guardian).
    INSERT INTO app.member_memory (id, org_id, member_id, category, topic, content, source, created_by, created_at, updated_at) VALUES
      ('a0000000-0000-4000-8000-000000001601', v_org, v_ana, 'schedule', 'training_schedule',
       'Prefiere entrenar temprano, antes del trabajo (6:00 a 7:00)', 'member', v_ana_p, now() - interval '20 days', now() - interval '20 days'),
      ('a0000000-0000-4000-8000-000000001602', v_org, v_ana, 'equipment', 'equipment_home',
       'Tiene mancuernas de 10 lb y bandas elásticas en casa', 'coach', v_ana_p, now() - interval '12 days', now() - interval '12 days'),
      ('a0000000-0000-4000-8000-000000001603', v_org, v_ana, 'goal', 'goal_correr_5k_marzo',
       'Quiere correr un 5k en marzo', 'member', v_ana_p, now() - interval '9 days', now() - interval '9 days'),
      ('a0000000-0000-4000-8000-000000001604', v_org, v_ana, 'restriction', 'restriction_evita_gluten',
       'Evita el gluten', 'member', v_ana_p, now() - interval '5 days', now() - interval '5 days'),
      ('a0000000-0000-4000-8000-000000001605', v_org, v_pedro, 'injury', 'injury_knee',
       'Molestia en la rodilla izquierda al bajar escaleras', 'member', v_pedro_p, now() - interval '3 days', now() - interval '3 days'),
      ('a0000000-0000-4000-8000-000000001606', v_org, v_diego, 'schedule', 'training_schedule',
       'Juega pelota los sábados por la mañana', 'member', v_rosa_p, now() - interval '7 days', now() - interval '7 days');

    -- Ana: 12 prior daily check-ins (no check-in today, so the persona sees the form). Scores exist once 7 prior
    -- days exist (same formula as the API, against her typical 3/3/0 day; 50 = a typical day for her).
    FOR r IN SELECT * FROM (VALUES
        (12, 3, 3, 0), (11, 4, 3, 0), (10, 3, 4, 1), (9, 2, 3, 0), (8, 4, 4, 0), (7, 3, 3, 2), (6, 4, 3, 0),
        (5, 3, 3, 0), (4, 5, 4, 0), (3, 2, 2, 1), (2, 4, 4, 0), (1, 3, 4, 0)) AS x(days_ago, sleep, energy, pain)
    LOOP
      INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, pain_area, score, baseline_days,
                                     created_by, created_at)
      VALUES (v_org, v_ana, v_today - r.days_ago, r.sleep, r.energy, r.pain,
              CASE WHEN r.pain > 0 THEN 'lower_back'::app.coach_body_area END,
              CASE WHEN n >= 7 THEN greatest(0, least(100, round(50 + 50 * (0.4 * (r.sleep - 3) / 4.0
                                     + 0.4 * (r.energy - 3) / 4.0 + 0.2 * (0 - r.pain) / 10.0)))) END,
              n, v_ana_p, now() - make_interval(days => r.days_ago));
      n := n + 1;
    END LOOP;

    -- Pedro: yesterday's check-in with knee pain 5 → follow-up (acknowledged by Ricardo); the injury fact → open.
    INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, pain_area, baseline_days,
                                   escalated, created_by, created_at)
    VALUES (v_org, v_pedro, v_today - 1, 3, 2, 5, 'knee', 0, true, v_pedro_p, now() - interval '1 day')
    RETURNING id INTO v_ci;
    INSERT INTO app.coach_escalation (org_id, member_id, location_id, reason, source_id, assigned_staff_id, status,
                                      created_at, status_changed_by, status_changed_at) VALUES
      (v_org, v_pedro, v_loc, 'checkin_pain', v_ci, v_trainer, 'acknowledged', now() - interval '1 day', v_trainer_p,
       now() - interval '20 hours'),
      (v_org, v_pedro, v_loc, 'memory_injury', 'a0000000-0000-4000-8000-000000001605', v_trainer, 'open',
       now() - interval '3 days', NULL, NULL);

    -- Ana: one pending proposal from the coach and one she rejected.
    INSERT INTO app.coach_action (org_id, member_id, tool, args, summary, status, proposed_by, proposed_at, expires_at,
                                  decided_by, decided_at) VALUES
      (v_org, v_ana, 'add_memory', '{"category": "preference", "content": "Prefiere clases de 30 minutos"}',
       'Recordar: Prefiere clases de 30 minutos', 'proposed', v_ana_p, now() - interval '1 hour',
       now() + interval '23 hours', NULL, NULL),
      (v_org, v_ana, 'register_checkin', '{"sleep": 2, "energy": 2, "pain": 0}',
       'Registrar check-in de hoy: sueño 2/5, energía 2/5, dolor 0/10', 'rejected', v_ana_p,
       now() - interval '2 days', now() - interval '1 day', v_ana_p, now() - interval '2 days');
  END IF;

  -- Org B: a little data so its personas see the module too.
  IF EXISTS (SELECT 1 FROM app.member WHERE id = v_isabel)
     AND NOT EXISTS (SELECT 1 FROM app.member_memory WHERE id = 'b0000000-0000-4000-8000-000000001601') THEN
    INSERT INTO app.member_memory (id, org_id, member_id, category, topic, content, source, created_by) VALUES
      ('b0000000-0000-4000-8000-000000001601', v_org_b, v_isabel, 'preference', 'coaching_style',
       'Prefiere un tono directo y breve', 'member', v_isabel_p);
    INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, pain_area, baseline_days,
                                   escalated, created_by)
    VALUES (v_org_b, v_isabel, v_today - 1, 4, 3, 4, 'shoulder', 0, true, v_isabel_p)
    RETURNING id INTO v_ci;
    INSERT INTO app.coach_escalation (org_id, member_id, location_id, reason, source_id)
    VALUES (v_org_b, v_isabel, v_loc_b, 'checkin_pain', v_ci);
    INSERT INTO app.coach_action (org_id, member_id, tool, args, summary, proposed_by)
    VALUES (v_org_b, v_isabel, 'add_memory', '{"category": "schedule", "content": "Entrena los martes y jueves"}',
            'Recordar: Entrena los martes y jueves', v_isabel_p);
  END IF;

  ALTER TABLE app.member_memory FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.daily_checkin FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.coach_escalation FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.coach_action FORCE ROW LEVEL SECURITY;
END $seed$;
