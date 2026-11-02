-- Demo seed for module schedule (E6). Synthetic data only; references the core demo UUIDs
-- (packages/shared/src/demo.ts). Runs as the schema owner after the core demo seed. Idempotent: returns if the
-- core demo org is missing or this seed already ran. FORCE RLS is lifted only on this module's tables and restored.
-- Sessions are laid out relative to the day the seed runs (one week back, two weeks ahead), in Puerto Rico time.
DO $seed$
DECLARE
  tz constant text := 'America/Puerto_Rico';
  org_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  loc_a1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  loc_a2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  loc_b1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  owner_a constant uuid := 'a0000000-0000-4000-8000-000000000101';
  front_a1 constant uuid := 'a0000000-0000-4000-8000-000000000103';
  front_a2 constant uuid := 'a0000000-0000-4000-8000-000000000104';
  owner_b constant uuid := 'b0000000-0000-4000-8000-000000000101';
  front_b constant uuid := 'b0000000-0000-4000-8000-000000000103';
  trainer_a constant uuid := 'a0000000-0000-4000-8000-000000000505';
  -- Class types
  ct_spin constant uuid := 'a0000000-0000-4000-8000-000000007001';
  ct_yoga constant uuid := 'a0000000-0000-4000-8000-000000007002';
  ct_func constant uuid := 'a0000000-0000-4000-8000-000000007003';
  ct_zumba constant uuid := 'a0000000-0000-4000-8000-000000007004';
  ct_hiit constant uuid := 'a0000000-0000-4000-8000-000000007005';
  ct_b_spin constant uuid := 'b0000000-0000-4000-8000-000000007001';
  -- Members at San Juan (A1): Ana, Pedro, Sofía (trial), Miguel (past_due), Diego (ward of the guardian persona).
  a1_members constant uuid[] := ARRAY['a0000000-0000-4000-8000-000000000210', 'a0000000-0000-4000-8000-000000000211',
    'a0000000-0000-4000-8000-000000000212', 'a0000000-0000-4000-8000-000000000213',
    'a0000000-0000-4000-8000-000000000230']::uuid[];
  ana constant uuid := 'a0000000-0000-4000-8000-000000000210';
  pedro constant uuid := 'a0000000-0000-4000-8000-000000000211';
  sofia constant uuid := 'a0000000-0000-4000-8000-000000000212';
  miguel constant uuid := 'a0000000-0000-4000-8000-000000000213';
  lucia constant uuid := 'a0000000-0000-4000-8000-000000000214';
  jose constant uuid := 'a0000000-0000-4000-8000-000000000215';
  gabriela constant uuid := 'a0000000-0000-4000-8000-000000000216';
  andres constant uuid := 'a0000000-0000-4000-8000-000000000217';
  diego constant uuid := 'a0000000-0000-4000-8000-000000000230';
  isabel constant uuid := 'b0000000-0000-4000-8000-000000000210';
  tomas constant uuid := 'b0000000-0000-4000-8000-000000000211';
  today date := (now() AT TIME ZONE 'America/Puerto_Rico')::date;
  d integer;
  v_day date;
  v_dow integer;
  v_s uuid;
  v_start timestamptz;
  i integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = org_a) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.class_type WHERE id = ct_spin) THEN RETURN; END IF;

  ALTER TABLE app.class_type NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.class_session NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.booking NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.location_policy NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.appointment NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.check_in NO FORCE ROW LEVEL SECURITY;

  INSERT INTO app.class_type (id, org_id, name, description, duration_min, default_capacity) VALUES
    (ct_spin, org_a, 'Spinning', 'Ciclismo bajo techo con intervalos.', 45, 20),
    (ct_yoga, org_a, 'Yoga Flow', 'Movilidad y respiración.', 60, 15),
    (ct_func, org_a, 'Funcional', 'Circuito de fuerza con peso corporal.', 50, 12),
    (ct_zumba, org_a, 'Zumba', 'Baile aeróbico.', 55, 25),
    (ct_hiit, org_a, 'HIIT Express', 'Intervalos cortos de alta intensidad.', 30, 10),
    (ct_b_spin, org_b, 'Spinning', 'Ciclismo bajo techo.', 45, 16);

  -- Policies: San Juan flags no-shows; nobody denies entry for late payment (an owner decision).
  INSERT INTO app.location_policy (org_id, location_id, cancel_window_hours, no_show_penalty, deny_past_due, updated_by) VALUES
    (org_a, loc_a1, 12, true, false, owner_a),
    (org_a, loc_a2, 6, false, false, owner_a),
    (org_b, loc_b1, 8, false, false, owner_b);

  FOR d IN -7..13 LOOP
    v_day := today + d;
    v_dow := extract(isodow FROM v_day)::integer;  -- 1 = Monday … 7 = Sunday
    CONTINUE WHEN v_dow = 7;

    -- San Juan: 06:00 Spinning and 12:00 Funcional with the demo trainer; evening Yoga (M/W/F) or Zumba (T/Th/Sa).
    INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
    VALUES (org_a, loc_a1, ct_spin, trainer_a, 'Salon Ciclismo', (v_day + time '06:00') AT TIME ZONE tz,
            (v_day + time '06:45') AT TIME ZONE tz, 20, owner_a)
    RETURNING id INTO v_s;
    FOR i IN 1..array_length(a1_members, 1) LOOP
      CONTINUE WHEN (d + i) % 3 = 0;
      v_start := (v_day + time '06:00') AT TIME ZONE tz;
      INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by, cancelled_at, late_cancel)
      VALUES (org_a, v_s, a1_members[i],
              CASE WHEN v_start > now() THEN 'booked' WHEN (d + i) % 7 = 0 THEN 'no_show' ELSE 'attended' END::app.booking_status,
              owner_a, NULL, false);
    END LOOP;

    INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
    VALUES (org_a, loc_a1, ct_func, trainer_a, 'Area Funcional', (v_day + time '12:00') AT TIME ZONE tz,
            (v_day + time '12:50') AT TIME ZONE tz, 12, owner_a)
    RETURNING id INTO v_s;
    IF d % 2 = 0 THEN
      INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by)
      VALUES (org_a, v_s, ana, CASE WHEN d < 0 THEN 'attended' ELSE 'booked' END::app.booking_status, owner_a),
             (org_a, v_s, pedro, CASE WHEN d < 0 THEN 'attended' ELSE 'booked' END::app.booking_status, owner_a);
    END IF;

    IF v_dow IN (1, 3, 5) THEN
      INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
      VALUES (org_a, loc_a1, ct_yoga, trainer_a, 'Salon 2', (v_day + time '18:00') AT TIME ZONE tz,
              (v_day + time '19:00') AT TIME ZONE tz, 15, owner_a);
    ELSE
      INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
      VALUES (org_a, loc_a1, ct_zumba, NULL, 'Salon 1', (v_day + time '19:00') AT TIME ZONE tz,
              (v_day + time '19:55') AT TIME ZONE tz, 25, owner_a);
    END IF;

    -- Bayamón: morning HIIT and evening Spinning, instructor to be assigned.
    INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by)
    VALUES (org_a, loc_a2, ct_hiit, 'Salon A', (v_day + time '07:00') AT TIME ZONE tz,
            (v_day + time '07:30') AT TIME ZONE tz, 10, owner_a),
           (org_a, loc_a2, ct_spin, 'Salon B', (v_day + time '18:30') AT TIME ZONE tz,
            (v_day + time '19:15') AT TIME ZONE tz, 16, owner_a);

    -- Org B (Ponce): one evening Spinning class per day.
    INSERT INTO app.class_session (org_id, location_id, class_type_id, room, starts_at, ends_at, capacity, created_by)
    VALUES (org_b, loc_b1, ct_b_spin, 'Salon Principal', (v_day + time '18:00') AT TIME ZONE tz,
            (v_day + time '18:45') AT TIME ZONE tz, 16, owner_b)
    RETURNING id INTO v_s;
    INSERT INTO app.booking (org_id, session_id, member_id, status, booked_by)
    VALUES (org_b, v_s, isabel, CASE WHEN d < 0 THEN 'attended' ELSE 'booked' END::app.booking_status, owner_b);
  END LOOP;

  -- A full class with a waitlist (tomorrow 17:00, San Juan): 3 seats taken, Sofía and Diego waiting.
  INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at, capacity, created_by)
  VALUES (org_a, loc_a1, ct_hiit, trainer_a, 'Area Funcional', ((today + 1) + time '17:00') AT TIME ZONE tz,
          ((today + 1) + time '17:30') AT TIME ZONE tz, 3, owner_a)
  RETURNING id INTO v_s;
  INSERT INTO app.booking (org_id, session_id, member_id, status, waitlist_position, booked_by, created_at) VALUES
    (org_a, v_s, ana, 'booked', NULL, owner_a, now() - interval '3 hours'),
    (org_a, v_s, pedro, 'booked', NULL, owner_a, now() - interval '170 minutes'),
    (org_a, v_s, miguel, 'booked', NULL, owner_a, now() - interval '160 minutes'),
    (org_a, v_s, sofia, 'waitlisted', 1, owner_a, now() - interval '2 hours'),
    (org_a, v_s, diego, 'waitlisted', 2, owner_a, now() - interval '1 hour');
  -- A late cancellation from last week (shows in Pedro's history and the roster).
  SELECT s.id INTO v_s FROM app.class_session s
   WHERE s.location_id = loc_a1 AND s.class_type_id = ct_spin AND s.starts_at < now() - interval '2 days'
   ORDER BY s.starts_at DESC LIMIT 1;
  IF v_s IS NOT NULL THEN
    DELETE FROM app.booking WHERE session_id = v_s AND member_id = pedro;
    INSERT INTO app.booking (org_id, session_id, member_id, status, late_cancel, booked_by, cancelled_at)
    VALUES (org_a, v_s, pedro, 'cancelled', true, pedro, (SELECT starts_at FROM app.class_session WHERE id = v_s) - interval '2 hours');
  END IF;

  -- Personal training with the demo trainer (outside the hours he teaches).
  INSERT INTO app.appointment (org_id, location_id, kind, staff_member_id, member_id, starts_at, ends_at, created_by) VALUES
    (org_a, loc_a1, 'personal_training', trainer_a, ana, ((today + 1) + time '10:00') AT TIME ZONE tz,
     ((today + 1) + time '11:00') AT TIME ZONE tz, front_a1),
    (org_a, loc_a1, 'personal_training', trainer_a, pedro, ((today + 3) + time '09:00') AT TIME ZONE tz,
     ((today + 3) + time '10:00') AT TIME ZONE tz, front_a1),
    (org_a, loc_a1, 'personal_training', trainer_a, miguel, ((today - 2) + time '15:00') AT TIME ZONE tz,
     ((today - 2) + time '16:00') AT TIME ZONE tz, front_a1);

  -- Access log: allowed, allowed with payment warning, and denied attempts with their reasons.
  INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by, at) VALUES
    (org_a, loc_a1, ana, 'qr', 'allowed', 'active', front_a1, now() - interval '1 day 2 hours'),
    (org_a, loc_a1, pedro, 'front_desk', 'allowed', 'active', front_a1, now() - interval '1 day 90 minutes'),
    (org_a, loc_a1, sofia, 'qr', 'allowed', 'trial', front_a1, now() - interval '1 day 1 hour'),
    (org_a, loc_a1, miguel, 'front_desk', 'allowed', 'past_due', front_a1, now() - interval '20 hours'),
    (org_a, loc_a1, lucia, 'front_desk', 'denied', 'frozen', front_a1, now() - interval '19 hours'),
    (org_a, loc_a1, NULL, 'qr', 'denied', 'invalid_token', front_a1, now() - interval '18 hours'),
    (org_a, loc_a1, diego, 'qr', 'denied', 'expired_token', front_a1, now() - interval '5 hours'),
    (org_a, loc_a1, diego, 'qr', 'allowed', 'active', front_a1, now() - interval '299 minutes'),
    (org_a, loc_a1, ana, 'qr', 'allowed', 'active', front_a1, now() - interval '3 hours'),
    (org_a, loc_a2, jose, 'qr', 'allowed', 'active', front_a2, now() - interval '1 day 3 hours'),
    (org_a, loc_a2, andres, 'front_desk', 'allowed', 'active', front_a2, now() - interval '4 hours'),
    (org_a, loc_a2, gabriela, 'front_desk', 'denied', 'lead', front_a2, now() - interval '2 hours'),
    (org_b, loc_b1, isabel, 'qr', 'allowed', 'active', front_b, now() - interval '1 day'),
    (org_b, loc_b1, tomas, 'front_desk', 'allowed', 'trial', front_b, now() - interval '6 hours');

  ALTER TABLE app.class_type FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.class_session FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.booking FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.location_policy FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.appointment FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.check_in FORCE ROW LEVEL SECURITY;
END $seed$;
