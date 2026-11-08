-- Module floor · equipment use (owner request 2026-11-08): station codes generated automatically, a member's scan of
-- a station QR registers an equipment use mapped to the member, the exercise and the open routine (circuit run), and
-- coaching staff see per-equipment use as it happens.
--
-- This deliberately revises one rule of 0011: equipment occupancy is now recorded, but only as part of the member's
-- OWN training log (same visibility as set_log: the member, their guardians, and owner / location_manager / trainer
-- of the location). Front desk, accountant, chef and clinical roles never see it. A use is started only by the
-- member's own scan; nothing is inferred from cameras or devices.
--
--   app.station_code_prefix(type)   short Spanish prefix per equipment type (BAR, MAN, LP, ...)
--   asset_station_code trigger      fills a missing station_code with <PREFIX>-<NN>, unique per org
--   app.equipment_use               one row per scan: member, asset, location, run + exercise when it maps
--   app.start_equipment_use(code)   the member's scan (closes their previous open use)
--   app.end_equipment_use(id)       the member stops using it
--   app.log_set (replaced)          a set on an asset keeps that use alive
--
-- A use is "active" while ended_at IS NULL and last_activity_at is within 20 minutes; stale uses are closed at their
-- last activity the next time the member scans. The 20-minute window is a product default, not a measurement.

CREATE TYPE app.equipment_use_source AS ENUM ('scan', 'code');

-- ── Station codes ────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.station_code_prefix(p app.equipment_type) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'barbell' THEN 'BAR' WHEN 'dumbbell' THEN 'MAN' WHEN 'kettlebell' THEN 'KB' WHEN 'cable' THEN 'CAB'
    WHEN 'leg_press' THEN 'LP' WHEN 'chest_press' THEN 'CP' WHEN 'lat_pulldown' THEN 'LAT'
    WHEN 'row_machine' THEN 'ROW' WHEN 'treadmill' THEN 'TM' WHEN 'bike' THEN 'BIC' WHEN 'rower' THEN 'REM'
    WHEN 'bench' THEN 'BAN' WHEN 'rack' THEN 'RACK' WHEN 'smith' THEN 'SMI' WHEN 'bodyweight_station' THEN 'EST'
    ELSE 'EQ' END
$$;

-- Fills NEW.station_code when the caller leaves it out. Definer so it sees every asset of the org (a trainer scoped
-- to one location must not collide with a code used at another). Serialised per org; UNIQUE (org_id, station_code)
-- stays the final guard.
CREATE FUNCTION app.asset_station_code_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_prefix text := app.station_code_prefix(NEW.equipment_type);
  v_next integer;
BEGIN
  IF NEW.station_code IS NOT NULL AND btrim(NEW.station_code) <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('floor.code:' || NEW.org_id::text, 0));
  SELECT coalesce(max(substring(a.station_code FROM '^' || v_prefix || '-([0-9]{1,6})$')::integer), 0) + 1
    INTO v_next
    FROM app.asset a
   WHERE a.org_id = NEW.org_id AND a.station_code ~ ('^' || v_prefix || '-[0-9]{1,6}$');
  NEW.station_code := v_prefix || '-' || lpad(v_next::text, 2, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER asset_station_code BEFORE INSERT ON app.asset
  FOR EACH ROW EXECUTE FUNCTION app.asset_station_code_trigger();

-- ── Equipment use ────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.equipment_use (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  circuit_run_id uuid,
  exercise_id uuid,
  source app.equipment_use_source NOT NULL DEFAULT 'scan',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (org_id, id),
  CHECK (last_activity_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id, asset_id) REFERENCES app.asset (org_id, location_id, id),
  FOREIGN KEY (org_id, exercise_id) REFERENCES app.exercise (org_id, id),
  -- The run must be the same member's, at the same location.
  FOREIGN KEY (org_id, member_id, location_id, circuit_run_id)
    REFERENCES app.circuit_run (org_id, member_id, location_id, id)
);
-- At most one open use per member (a new scan closes the previous one).
CREATE UNIQUE INDEX equipment_use_open_uq ON app.equipment_use (member_id) WHERE ended_at IS NULL;
CREATE INDEX equipment_use_live_idx ON app.equipment_use (org_id, location_id, asset_id, started_at DESC);
CREATE INDEX equipment_use_member_idx ON app.equipment_use (member_id, started_at DESC);

ALTER TABLE app.equipment_use ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.equipment_use FORCE ROW LEVEL SECURITY;
-- Same rule as set_log (0011): the member's own training log.
CREATE POLICY equipment_use_select ON app.equipment_use FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    EXISTS (SELECT 1 FROM app.member m
            WHERE m.id = equipment_use.member_id AND m.person_id = (SELECT app.person_id()))
    OR EXISTS (SELECT 1 FROM app.guardian_link g
               WHERE g.member_id = equipment_use.member_id AND g.guardian_person_id = (SELECT app.person_id()))
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
        AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));
CREATE POLICY definer_all ON app.equipment_use TO app_definer USING (true) WITH CHECK (true);

REVOKE ALL ON app.equipment_use FROM PUBLIC;
GRANT SELECT ON app.equipment_use TO app_authenticated;
GRANT SELECT, INSERT, UPDATE ON app.equipment_use TO app_definer;
GRANT SELECT ON app.circuit_step TO app_definer;  -- start_equipment_use maps a scan to the routine step

-- ── Definer functions ────────────────────────────────────────────────────────────────────────────────────────
-- The member scans a station. The asset must be in service. Closes the member's previous open use (at its last
-- activity when stale, now otherwise), then opens a new one. When the member has an open circuit run at that
-- location, the use maps to the first step of that circuit on this asset (or on its equipment type) that still
-- has sets left — that is the routine progress the screens show.
CREATE FUNCTION app.start_equipment_use(p_code text, p_source app.equipment_use_source) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid := app.floor_my_member_id();
  v_asset app.asset%ROWTYPE;
  v_run uuid;
  v_exercise uuid;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_asset FROM app.asset a WHERE a.org_id = v_org AND a.station_code = upper(btrim(p_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_asset.status <> 'ok' THEN RAISE EXCEPTION 'asset_unavailable' USING ERRCODE = '55000'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('floor.use:' || v_member::text, 0));
  -- Same station scanned again while active: keep the open use (repeat scans are not new uses).
  SELECT u.id INTO v_id FROM app.equipment_use u
   WHERE u.member_id = v_member AND u.ended_at IS NULL AND u.asset_id = v_asset.id
     AND u.last_activity_at > now() - interval '20 minutes';
  IF v_id IS NOT NULL THEN
    UPDATE app.equipment_use SET last_activity_at = now() WHERE id = v_id;
    RETURN v_id;
  END IF;
  UPDATE app.equipment_use
     SET ended_at = CASE WHEN last_activity_at > now() - interval '20 minutes' THEN now() ELSE last_activity_at END
   WHERE member_id = v_member AND ended_at IS NULL;

  SELECT r.id INTO v_run FROM app.circuit_run r
   WHERE r.member_id = v_member AND r.finished_at IS NULL AND r.location_id = v_asset.location_id;
  IF v_run IS NOT NULL THEN
    SELECT s.exercise_id INTO v_exercise
      FROM app.circuit_run r JOIN app.circuit_step s ON s.circuit_id = r.circuit_id
     WHERE r.id = v_run
       AND (s.asset_id = v_asset.id OR (s.asset_id IS NULL AND s.equipment_type = v_asset.equipment_type))
     ORDER BY (SELECT count(*) FROM app.set_log l
                WHERE l.circuit_run_id = v_run AND l.exercise_id = s.exercise_id) >= s.sets,
              s.asset_id IS NULL, s.position
     LIMIT 1;
    IF v_exercise IS NULL THEN v_run := NULL; END IF;  -- this station is not part of the open routine
  END IF;

  INSERT INTO app.equipment_use (org_id, member_id, location_id, asset_id, circuit_run_id, exercise_id, source)
  VALUES (v_org, v_member, v_asset.location_id, v_asset.id, v_run, v_exercise, coalesce(p_source, 'scan'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION app.end_equipment_use(p_use uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_member uuid := app.floor_my_member_id();
  v_at timestamptz;
BEGIN
  IF app.org_id() IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE app.equipment_use SET ended_at = coalesce(ended_at, now())
   WHERE id = p_use AND member_id = v_member AND org_id = app.org_id()
  RETURNING ended_at INTO v_at;
  IF v_at IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN v_at;
END $$;

-- log_set (0011) plus: a set logged on an asset keeps the member's open use of that asset active, and fills its
-- exercise when the scan could not map one. Same signature, rules and errors as before.
CREATE OR REPLACE FUNCTION app.log_set(p_exercise uuid, p_location uuid, p_asset uuid, p_run uuid, p_reps integer,
                                       p_weight_kg numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid := app.floor_my_member_id();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org)
     OR NOT EXISTS (SELECT 1 FROM app.exercise e WHERE e.id = p_exercise AND e.org_id = v_org)
     OR (p_asset IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM app.asset a WHERE a.id = p_asset AND a.org_id = v_org AND a.location_id = p_location)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_run IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.circuit_run r
        WHERE r.id = p_run AND r.member_id = v_member AND r.location_id = p_location AND r.finished_at IS NULL) THEN
    RAISE EXCEPTION 'run_not_open' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, circuit_run_id, reps, weight_kg)
  VALUES (v_org, v_member, p_location, p_exercise, p_asset, p_run, p_reps, p_weight_kg)
  RETURNING id INTO v_id;
  IF p_asset IS NOT NULL THEN
    UPDATE app.equipment_use
       SET last_activity_at = now(), exercise_id = coalesce(exercise_id, p_exercise)
     WHERE member_id = v_member AND asset_id = p_asset AND ended_at IS NULL;
  END IF;
  RETURN v_id;
END $$;

ALTER FUNCTION app.asset_station_code_trigger() OWNER TO app_definer;
ALTER FUNCTION app.start_equipment_use(text, app.equipment_use_source) OWNER TO app_definer;
ALTER FUNCTION app.end_equipment_use(uuid) OWNER TO app_definer;
ALTER FUNCTION app.log_set(uuid, uuid, uuid, uuid, integer, numeric) OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.asset_station_code_trigger(), app.start_equipment_use(text, app.equipment_use_source),
  app.end_equipment_use(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.station_code_prefix(app.equipment_type) TO app_authenticated, app_definer;
GRANT EXECUTE ON FUNCTION app.start_equipment_use(text, app.equipment_use_source), app.end_equipment_use(uuid)
  TO app_authenticated;
