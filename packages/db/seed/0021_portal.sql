-- Demo seed for module portal (member portal home). SYNTHETIC data only ("Demo", @demo.invalid); idempotent; see
-- docs/modules/portal.md. Runs as the schema owner after the core and module demo seeds; dates are relative to the
-- day the seed runs, in each location's time zone (America/Puerto_Rico), like the other module seeds.
-- Makes the A-member persona (Ana Rivera, pay-per-session at Fitness R Us) look alive on the home screen, through the
-- real module tables with the rules their definer functions apply:
--   * a 12-day check-in streak (one allowed QR check-in per local day, never on a day that already has one, never in
--     the future) and therefore this week's trainings;
--   * a weekly goal of 5 trainings (member_goal, as if she had saved it);
--   * a class booked later today or tomorrow (the schedule seed already books her; topped up only if missing);
--   * the session pack she bought (billing seed: 10 sessions, 6 left, expiring in ~100 days) is left as is;
--   * one circuit in progress (an open run at San Juan with 7 of its 15 sets logged);
--   * her training plan becomes an 8-week version (v2 of the same series, approved by her trainer and published
--     16 days ago, so she is in week 3); v1 is archived exactly as app.publish_care_plan() would do;
--   * an org-wide challenge "8 semanas de transformación" running for 2 of its 8 weeks with four perks; Ana has NOT
--     joined (two other members have);
--   * her signed agreements already exist (signup seed).
-- Org B (Demo Club Sur, monthly membership): Isabel Rosario gets a goal of 3, a 5-day streak and perks on the
-- running club challenge. FORCE RLS is lifted only on the tables written here and restored at the end.
DO $seed$
DECLARE
  tz constant text := 'America/Puerto_Rico';
  oa constant uuid := 'a0000000-0000-4000-8000-000000000001';
  ob constant uuid := 'b0000000-0000-4000-8000-000000000001';
  la1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  lb1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  ana constant uuid := 'a0000000-0000-4000-8000-000000000210';
  ana_p constant uuid := 'a0000000-0000-4000-8000-000000000110';
  pedro constant uuid := 'a0000000-0000-4000-8000-000000000211';
  jose constant uuid := 'a0000000-0000-4000-8000-000000000215';
  isabel constant uuid := 'b0000000-0000-4000-8000-000000000210';
  isabel_p constant uuid := 'b0000000-0000-4000-8000-000000000110';
  owner_a constant uuid := 'a0000000-0000-4000-8000-000000000101';
  front_a1 constant uuid := 'a0000000-0000-4000-8000-000000000103';
  front_b constant uuid := 'b0000000-0000-4000-8000-000000000103';
  trainer_a constant uuid := 'a0000000-0000-4000-8000-000000000505';   -- staff_member: Ricardo Santos
  ch_8w constant uuid := 'a0000000-0000-4000-8021-000000000301';
  ch_b constant uuid := 'b0000000-0000-4000-8012-000000000301';        -- "Reto Sur Demo" (engagement seed)
  seeded_tables constant text[] := ARRAY['member_goal', 'challenge_perk', 'check_in', 'booking', 'circuit_run',
                                         'set_log', 'care_plan', 'challenge', 'challenge_participant'];
  today_a date := (now() AT TIME ZONE 'America/Puerto_Rico')::date;
  t text;
  k integer;
  v_day date;
  v_at timestamptz;
  v_circuit uuid;
  v_run uuid;
  v_v1 app.care_plan;
  v_triage uuid;
  v_session uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.member WHERE id = ana) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.challenge WHERE id = ch_8w) THEN RETURN; END IF;

  FOREACH t IN ARRAY seeded_tables LOOP
    EXECUTE format('ALTER TABLE app.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- ── Weekly goals
  INSERT INTO app.member_goal (org_id, member_id, weekly_trainings, updated_by, updated_at)
  VALUES (oa, ana, 5, ana_p, now() - interval '20 days');

  -- ── Ana's streak: 12 local days ending today (today's check-in only once 05:52 local has passed: never future).
  FOR k IN 0..11 LOOP
    v_day := today_a - k;
    CONTINUE WHEN EXISTS (SELECT 1 FROM app.check_in c
                           WHERE c.member_id = ana AND c.result = 'allowed' AND (c.at AT TIME ZONE tz)::date = v_day);
    v_at := (v_day + CASE WHEN k % 3 = 0 THEN time '05:52' ELSE time '17:41' END) AT TIME ZONE tz;
    CONTINUE WHEN v_at > now();
    INSERT INTO app.check_in (id, org_id, location_id, member_id, source, result, reason, recorded_by, at)
    VALUES (md5('portal:ci:' || ana || ':' || v_day)::uuid, oa, la1, ana, 'qr', 'allowed', 'active', front_a1, v_at);
  END LOOP;

  -- ── A class later today or tomorrow (the schedule seed books her; top up only if that ever changes).
  IF NOT EXISTS (SELECT 1 FROM app.booking b JOIN app.class_session s ON s.id = b.session_id
                  WHERE b.member_id = ana AND b.status = 'booked' AND NOT s.cancelled
                    AND s.starts_at > now() AND s.starts_at < now() + interval '36 hours') THEN
    SELECT s.id INTO v_session FROM app.class_session s
     WHERE s.org_id = oa AND s.location_id = la1 AND NOT s.cancelled
       AND s.starts_at > now() + interval '1 hour' AND s.starts_at < now() + interval '36 hours'
       AND NOT EXISTS (SELECT 1 FROM app.booking b WHERE b.session_id = s.id AND b.member_id = ana AND b.status <> 'cancelled')
       AND (SELECT count(*) FROM app.booking b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) < s.capacity
     ORDER BY s.starts_at LIMIT 1;
    IF v_session IS NOT NULL THEN
      INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by, created_at)
      VALUES (oa, v_session, ana, 'booked', ana_p, now() - interval '5 hours');
    END IF;
  END IF;

  -- ── A circuit in progress: open run at San Juan, first two stations done and one set of the third.
  SELECT c.id INTO v_circuit FROM app.circuit c
   WHERE c.org_id = oa AND c.location_id = la1 AND c.active ORDER BY c.created_at, c.id LIMIT 1;
  IF v_circuit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.circuit_run r WHERE r.member_id = ana AND r.finished_at IS NULL) THEN
    INSERT INTO app.circuit_run (org_id, member_id, circuit_id, location_id, started_at)
    VALUES (oa, ana, v_circuit, la1, now() - interval '35 minutes')
    RETURNING id INTO v_run;
    INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, circuit_run_id, reps, weight_kg, at)
    SELECT oa, ana, la1, s.exercise_id, s.asset_id, v_run, s.reps,
           CASE s.position WHEN 1 THEN 42.5 WHEN 2 THEN 25.0 ELSE 30.0 END,
           now() - interval '33 minutes' + make_interval(mins => (s.position - 1) * 9 + n * 3)
      FROM app.circuit_step s
      CROSS JOIN generate_series(0, 2) AS n
     WHERE s.circuit_id = v_circuit AND (s.position IN (1, 2) OR (s.position = 3 AND n = 0));
  END IF;

  -- ── Training plan, 8 weeks: v2 of her published series (week 3 today); v1 archived like publish_care_plan().
  SELECT * INTO v_v1 FROM app.care_plan
   WHERE member_id = ana AND kind = 'training' AND status = 'published' ORDER BY published_at DESC LIMIT 1;
  SELECT id INTO v_triage FROM app.triage_result WHERE member_id = ana ORDER BY computed_at DESC, id DESC LIMIT 1;
  INSERT INTO app.care_plan (org_id, member_id, series_id, kind, version, title, body, rationale, created_by, status,
    submitted_at, approved_by, approved_at, approver_name, triage_result_id, published_at, created_at)
  VALUES (oa, ana, v_v1.series_id, 'training', coalesce(v_v1.version, 0) + 1, 'Demo plan de fuerza 8 semanas',
    '{"sections":[{"heading":"Semanas 1 y 2","items":["Calentamiento 10 minutos","Sentadilla a cajón 3x10","Remo con banda 3x12","Caminata 20 minutos"]},{"heading":"Semanas 3 y 4","items":["Sentadilla con barra 3x8","Press de pecho en máquina 3x10","Jalón al pecho 3x10","Plancha 3x30 segundos"]},{"heading":"Semanas 5 y 6","items":["Peso muerto rumano con mancuernas 3x10","Press de hombro sentado 3x10","Remo sentado en máquina 3x12"]},{"heading":"Semanas 7 y 8","items":["Circuito Fuerza Total dos veces por semana","Caminata rápida 25 minutos","Revisión de progreso con su entrenador"]}]}',
    'Demo: PAR-Q+ sin hallazgos; progresión gradual en ocho semanas.', trainer_a, 'published',
    now() - interval '17 days', trainer_a, now() - interval '16 days 2 hours', 'Ricardo Santos', v_triage,
    now() - interval '16 days', now() - interval '17 days');
  IF v_v1.id IS NOT NULL THEN
    UPDATE app.care_plan SET status = 'archived', archived_at = now() - interval '16 days' WHERE id = v_v1.id;
  END IF;

  -- ── Org-wide challenge with perks, two weeks in; Ana has not joined (Pedro and José have).
  INSERT INTO app.challenge (id, org_id, name, kind, metric, location_id, starts_on, ends_on, goal,
                             leaderboard_opt_in_default, created_by, created_at)
  VALUES (ch_8w, oa, '8 semanas de transformación', 'individual', 'visits', NULL, today_a - 14, today_a - 14 + 55,
          24, false, owner_a, now() - interval '20 days');
  INSERT INTO app.challenge_perk (org_id, challenge_id, position, label, created_by, created_at) VALUES
    (oa, ch_8w, 1, 'Entrenamiento guiado', owner_a, now() - interval '20 days'),
    (oa, ch_8w, 2, 'Nutrición sugerida por especialista con licencia', owner_a, now() - interval '20 days'),
    (oa, ch_8w, 3, 'Seguimiento de progreso', owner_a, now() - interval '20 days'),
    (oa, ch_8w, 4, 'Reconocimiento y premios', owner_a, now() - interval '20 days');
  INSERT INTO app.challenge_participant (org_id, challenge_id, member_id, show_on_leaderboard, compare_mode, progress, joined_at)
  SELECT oa, ch_8w, m.id, false, 'self', x.progress, now() - x.ago
    FROM (VALUES (pedro, 5, interval '13 days'), (jose, 3, interval '9 days')) AS x(mid, progress, ago)
    JOIN app.member m ON m.id = x.mid;

  -- ── Org B: Isabel (monthly membership) — goal, a 5-day streak around her evening class, perks on the club challenge.
  IF EXISTS (SELECT 1 FROM app.member WHERE id = isabel) THEN
    INSERT INTO app.member_goal (org_id, member_id, weekly_trainings, updated_by, updated_at)
    VALUES (ob, isabel, 3, isabel_p, now() - interval '9 days');
    FOR k IN 0..4 LOOP
      v_day := today_a - k;
      CONTINUE WHEN EXISTS (SELECT 1 FROM app.check_in c
                             WHERE c.member_id = isabel AND c.result = 'allowed' AND (c.at AT TIME ZONE tz)::date = v_day);
      v_at := (v_day + time '17:48') AT TIME ZONE tz;
      CONTINUE WHEN v_at > now();
      INSERT INTO app.check_in (id, org_id, location_id, member_id, source, result, reason, recorded_by, at)
      VALUES (md5('portal:ci:' || isabel || ':' || v_day)::uuid, ob, lb1, isabel, 'qr', 'allowed', 'active', front_b, v_at);
    END LOOP;
    IF EXISTS (SELECT 1 FROM app.challenge WHERE id = ch_b) THEN
      INSERT INTO app.challenge_perk (org_id, challenge_id, position, label, created_by) VALUES
        (ob, ch_b, 1, 'Seguimiento de progreso', 'b0000000-0000-4000-8000-000000000101'),
        (ob, ch_b, 2, 'Reconocimiento y premios', 'b0000000-0000-4000-8000-000000000101');
    END IF;
  END IF;

  FOREACH t IN ARRAY seeded_tables LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $seed$;

ANALYZE;
