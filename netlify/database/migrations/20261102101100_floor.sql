-- Module floor · Sala, equipos y circuitos (spec §6.4). No hardware integration: station codes are printed labels.
-- Model: asset (equipment at a location, with a per-org station code for its QR label) · asset_issue (member/staff
-- reports: out_of_service, or a short-lived "busy" signal that is never kept as occupancy history) · exercise (org
-- library, classified by movement pattern) · circuit + circuit_step (ordered routine at one location) ·
-- circuit_run + set_log (a member's own training log).
-- Rules that span rows live in composite FKs (an asset in a step or a set log must be at the same location) and in
-- SECURITY DEFINER functions owned by app_definer that re-check claims (issue workflow, runs, set logging).

CREATE TYPE app.equipment_type AS ENUM (
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'leg_press', 'chest_press', 'lat_pulldown', 'row_machine',
  'treadmill', 'bike', 'rower', 'bench', 'rack', 'smith', 'bodyweight_station', 'other',
  'none'  -- exercises only: needs no equipment (always available as a substitute); never an asset type
);
CREATE TYPE app.movement_pattern AS ENUM (
  'squat', 'hinge', 'push_horizontal', 'push_vertical', 'pull_horizontal', 'pull_vertical', 'lunge', 'carry',
  'core', 'cardio'
);
CREATE TYPE app.asset_status AS ENUM ('ok', 'out_of_service', 'maintenance');
CREATE TYPE app.asset_issue_kind AS ENUM ('out_of_service', 'busy');
CREATE TYPE app.asset_issue_status AS ENUM ('reported', 'confirmed', 'resolved');

-- ── Tables
CREATE TABLE app.asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  equipment_type app.equipment_type NOT NULL CHECK (equipment_type <> 'none'),
  brand text CHECK (brand ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''().,/+-]{1,80}$'),
  model text CHECK (model ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''().,/+-]{1,80}$'),
  -- Printed on the QR label; uppercase letters, digits and dashes only (no URLs, no free text on the label).
  station_code text NOT NULL CHECK (station_code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  status app.asset_status NOT NULL DEFAULT 'ok',
  notes text CHECK (length(notes) <= 500 AND notes !~ '[[:cntrl:]<>{}]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, location_id, id),
  UNIQUE (org_id, station_code),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);
CREATE INDEX asset_org_location_idx ON app.asset (org_id, location_id, equipment_type);

CREATE TABLE app.asset_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  reported_by uuid NOT NULL REFERENCES app.person (id),
  kind app.asset_issue_kind NOT NULL,
  status app.asset_issue_status NOT NULL DEFAULT 'reported',
  note text CHECK (length(note) <= 500 AND note !~ '[[:cntrl:]<>{}]'),
  reported_at timestamptz NOT NULL DEFAULT now(),
  -- "busy" is a signal, not occupancy tracking: it expires on its own and is purged after a day.
  expires_at timestamptz,
  confirmed_by uuid REFERENCES app.person (id),
  confirmed_at timestamptz,
  resolved_by uuid REFERENCES app.person (id),
  resolved_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id, asset_id) REFERENCES app.asset (org_id, location_id, id),
  CHECK ((kind = 'busy') = (expires_at IS NOT NULL)),
  CHECK (kind = 'out_of_service' OR status <> 'confirmed'),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL) OR status = 'resolved'),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
-- One open report per person, asset and kind (repeat taps are idempotent, not spam).
CREATE UNIQUE INDEX asset_issue_open_uq ON app.asset_issue (asset_id, reported_by, kind) WHERE status = 'reported';
CREATE INDEX asset_issue_queue_idx ON app.asset_issue (org_id, location_id, status, reported_at DESC);

CREATE TABLE app.exercise (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''().,/+-]{2,80}$'),
  movement_pattern app.movement_pattern NOT NULL,
  equipment_type app.equipment_type NOT NULL,
  -- Technique cues only (no health claims). Newlines allowed; markup and template braces are not.
  cues text NOT NULL DEFAULT '' CHECK (length(cues) <= 1000 AND cues !~ '[<>{}]'
                                       AND cues !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);
CREATE INDEX exercise_pattern_idx ON app.exercise (org_id, movement_pattern, equipment_type);

CREATE TABLE app.circuit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''().,/+-]{2,80}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, location_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

CREATE TABLE app.circuit_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  circuit_id uuid NOT NULL,
  location_id uuid NOT NULL,  -- = the circuit's location; the composite FKs force a step's asset to be there too
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  exercise_id uuid NOT NULL,
  asset_id uuid,
  equipment_type app.equipment_type,
  sets smallint NOT NULL CHECK (sets BETWEEN 1 AND 20),
  reps smallint NOT NULL CHECK (reps BETWEEN 1 AND 100),
  rest_seconds smallint NOT NULL DEFAULT 60 CHECK (rest_seconds BETWEEN 0 AND 900),
  UNIQUE (org_id, id),
  UNIQUE (circuit_id, position),
  CHECK (num_nonnulls(asset_id, equipment_type) = 1),
  FOREIGN KEY (org_id, location_id, circuit_id) REFERENCES app.circuit (org_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, location_id, asset_id) REFERENCES app.asset (org_id, location_id, id),
  FOREIGN KEY (org_id, exercise_id) REFERENCES app.exercise (org_id, id)
);

CREATE TABLE app.circuit_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  circuit_id uuid NOT NULL,
  location_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (org_id, id),
  UNIQUE (org_id, member_id, location_id, id),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id, circuit_id) REFERENCES app.circuit (org_id, location_id, id)
);
-- At most one open run per member.
CREATE UNIQUE INDEX circuit_run_open_uq ON app.circuit_run (member_id) WHERE finished_at IS NULL;

CREATE TABLE app.set_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  asset_id uuid,
  circuit_run_id uuid,
  reps smallint NOT NULL CHECK (reps BETWEEN 0 AND 1000),
  weight_kg numeric(6, 2) NOT NULL DEFAULT 0 CHECK (weight_kg BETWEEN 0 AND 1000),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, exercise_id) REFERENCES app.exercise (org_id, id),
  FOREIGN KEY (org_id, location_id, asset_id) REFERENCES app.asset (org_id, location_id, id),
  -- The run must belong to the same member and location as the set.
  FOREIGN KEY (org_id, member_id, location_id, circuit_run_id)
    REFERENCES app.circuit_run (org_id, member_id, location_id, id)
);
CREATE INDEX set_log_member_idx ON app.set_log (member_id, at DESC);

-- ── RLS
ALTER TABLE app.asset        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.asset        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.asset_issue  ENABLE ROW LEVEL SECURITY; ALTER TABLE app.asset_issue  FORCE ROW LEVEL SECURITY;
ALTER TABLE app.exercise     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.exercise     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.circuit      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.circuit      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.circuit_step ENABLE ROW LEVEL SECURITY; ALTER TABLE app.circuit_step FORCE ROW LEVEL SECURITY;
ALTER TABLE app.circuit_run  ENABLE ROW LEVEL SECURITY; ALTER TABLE app.circuit_run  FORCE ROW LEVEL SECURITY;
ALTER TABLE app.set_log      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.set_log      FORCE ROW LEVEL SECURITY;

-- asset: staff of the location read; members/guardians read every location of their org (core policy: they may
-- train anywhere in the org). Owner / location_manager / trainer manage equipment at their locations.
CREATE POLICY asset_select ON app.asset FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (NOT (SELECT app.is_staff()) OR (SELECT app.org_wide())
       OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY asset_insert ON app.asset FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY asset_update ON app.asset FOR UPDATE
  USING (org_id = (SELECT app.org_id())
         AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
         AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
  WITH CHECK (org_id = (SELECT app.org_id())
         AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- asset_issue: the issues queue is for staff who work the floor at that location; reporters see their own reports.
-- Writes only through the definer functions below.
CREATE POLICY asset_issue_select ON app.asset_issue FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    reported_by = (SELECT app.person_id())
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'trainer', 'front_desk')
        AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));

-- exercise: org library, readable by everyone in the org; owner / location_manager / trainer curate it.
CREATE POLICY exercise_select ON app.exercise FOR SELECT USING (org_id = (SELECT app.org_id()));
CREATE POLICY exercise_insert ON app.exercise FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer'));
CREATE POLICY exercise_update ON app.exercise FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer'))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- circuit: staff of the location; members/guardians see active circuits anywhere in their org.
CREATE POLICY circuit_select ON app.circuit FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (((SELECT app.is_staff()) AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
       OR (NOT (SELECT app.is_staff()) AND active)));
CREATE POLICY circuit_insert ON app.circuit FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY circuit_update ON app.circuit FOR UPDATE
  USING (org_id = (SELECT app.org_id())
         AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
         AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- circuit_step: visible with its circuit (circuit RLS applies inside the EXISTS); same managers write.
CREATE POLICY circuit_step_select ON app.circuit_step FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.circuit c WHERE c.id = circuit_step.circuit_id));
CREATE POLICY circuit_step_insert ON app.circuit_step FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY circuit_step_delete ON app.circuit_step FOR DELETE USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- circuit_run and set_log: the member's own training log. Guardians read their ward's. Coaching staff
-- (owner / location_manager / trainer) read logs made at their locations. Front desk, accountant, chef and
-- clinical roles never see training logs. Writes only through the definer functions below.
CREATE POLICY circuit_run_select ON app.circuit_run FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    EXISTS (SELECT 1 FROM app.member m
            WHERE m.id = circuit_run.member_id AND m.person_id = (SELECT app.person_id()))
    OR EXISTS (SELECT 1 FROM app.guardian_link g
               WHERE g.member_id = circuit_run.member_id AND g.guardian_person_id = (SELECT app.person_id()))
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
        AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));
CREATE POLICY set_log_select ON app.set_log FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    EXISTS (SELECT 1 FROM app.member m
            WHERE m.id = set_log.member_id AND m.person_id = (SELECT app.person_id()))
    OR EXISTS (SELECT 1 FROM app.guardian_link g
               WHERE g.member_id = set_log.member_id AND g.guardian_person_id = (SELECT app.person_id()))
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'trainer')
        AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));

-- app_definer reaches these rows only through its role-targeted policy (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.asset        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.asset_issue  TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.exercise     TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.circuit      TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.circuit_step TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.circuit_run  TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.set_log      TO app_definer USING (true) WITH CHECK (true);

-- ── Grants: reads by table, writes column by column; identity columns (org_id, member_id, reported_by) never.
REVOKE ALL ON app.asset, app.asset_issue, app.exercise, app.circuit, app.circuit_step, app.circuit_run,
  app.set_log FROM PUBLIC;
GRANT SELECT ON app.asset, app.asset_issue, app.exercise, app.circuit, app.circuit_step, app.circuit_run,
  app.set_log TO app_authenticated;
GRANT INSERT (location_id, equipment_type, brand, model, station_code, status, notes) ON app.asset TO app_authenticated;
GRANT UPDATE (equipment_type, brand, model, station_code, status, notes) ON app.asset TO app_authenticated;
GRANT INSERT (name, movement_pattern, equipment_type, cues, active) ON app.exercise TO app_authenticated;
GRANT UPDATE (name, movement_pattern, equipment_type, cues, active) ON app.exercise TO app_authenticated;
GRANT INSERT (location_id, name, active) ON app.circuit TO app_authenticated;
GRANT UPDATE (name, active) ON app.circuit TO app_authenticated;
GRANT INSERT (circuit_id, location_id, position, exercise_id, asset_id, equipment_type, sets, reps, rest_seconds),
  DELETE ON app.circuit_step TO app_authenticated;

GRANT SELECT, UPDATE ON app.asset TO app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.asset_issue TO app_definer;
GRANT SELECT ON app.exercise, app.circuit TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.circuit_run TO app_definer;
GRANT SELECT, INSERT ON app.set_log TO app_definer;

-- ── Audit: every asset status change, whoever makes it (direct update or issue workflow).
CREATE FUNCTION app.asset_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM app.audit('asset.status', 'asset', NEW.id::text, NEW.location_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_audit AFTER UPDATE OF status ON app.asset
  FOR EACH ROW EXECUTE FUNCTION app.asset_audit_trigger();

-- ── Definer functions
-- The caller's member row in this org (NULL if the caller is not a member here).
CREATE FUNCTION app.floor_my_member_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT m.id FROM app.member m
   WHERE m.org_id = app.org_id() AND m.person_id = app.person_id() AND app.role() = 'member'
$$;

-- Report a problem with an asset. Members (any location of their org) and floor staff (their locations).
-- 'busy' is a 15-minute signal that never changes the asset and is not audited (no occupancy tracking);
-- 'out_of_service' waits for staff confirmation. Repeat reports by the same person return the open one.
CREATE FUNCTION app.report_asset_issue(p_asset uuid, p_kind app.asset_issue_kind, p_note text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
  v_person uuid := app.person_id();
  v_loc uuid;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_person IS NULL
     OR v_role IS NULL OR v_role NOT IN ('owner', 'location_manager', 'trainer', 'front_desk', 'member') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT a.location_id INTO v_loc FROM app.asset a WHERE a.id = p_asset AND a.org_id = v_org;
  IF v_loc IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_role = 'member' THEN
    IF app.floor_my_member_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  ELSIF NOT app.can_see_location(v_loc) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;

  -- Expire stale busy signals and forget old ones (they are never history).
  UPDATE app.asset_issue SET status = 'resolved', resolved_at = now()
   WHERE org_id = v_org AND kind = 'busy' AND status = 'reported' AND expires_at <= now();
  DELETE FROM app.asset_issue
   WHERE org_id = v_org AND kind = 'busy' AND reported_at < now() - interval '1 day';

  INSERT INTO app.asset_issue (org_id, location_id, asset_id, reported_by, kind, note, expires_at)
  VALUES (v_org, v_loc, p_asset, v_person, p_kind, nullif(btrim(p_note), ''),
          CASE WHEN p_kind = 'busy' THEN now() + interval '15 minutes' END)
  ON CONFLICT (asset_id, reported_by, kind) WHERE status = 'reported' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT i.id INTO v_id FROM app.asset_issue i
     WHERE i.asset_id = p_asset AND i.reported_by = v_person AND i.kind = p_kind AND i.status = 'reported';
    RETURN v_id;
  END IF;
  IF p_kind = 'out_of_service' THEN
    PERFORM app.audit('asset_issue.report', 'asset_issue', v_id::text, v_loc,
      jsonb_build_object('asset_id', p_asset, 'kind', p_kind));
  END IF;
  RETURN v_id;
END $$;

-- Confirm an out-of-service report (floor staff incl. front desk, at the asset's location). The asset leaves
-- service in the same transaction. Rows are locked so two confirmations cannot both win.
CREATE FUNCTION app.confirm_asset_issue(p_issue uuid) RETURNS app.asset_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_issue app.asset_issue%ROWTYPE;
  v_status app.asset_status;
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL
     OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'trainer', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_issue FROM app.asset_issue i WHERE i.id = p_issue AND i.org_id = v_org FOR UPDATE;
  IF NOT FOUND OR NOT app.can_see_location(v_issue.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_issue.kind <> 'out_of_service' THEN RAISE EXCEPTION 'not_confirmable' USING ERRCODE = '22023'; END IF;
  IF v_issue.status <> 'reported' THEN RAISE EXCEPTION 'issue_not_open' USING ERRCODE = '55000'; END IF;

  UPDATE app.asset_issue SET status = 'confirmed', confirmed_by = app.person_id(), confirmed_at = now()
   WHERE id = p_issue;
  SELECT a.status INTO v_status FROM app.asset a WHERE a.id = v_issue.asset_id FOR UPDATE;
  IF v_status = 'ok' THEN
    UPDATE app.asset SET status = 'out_of_service' WHERE id = v_issue.asset_id;  -- audited by asset_audit
    v_status := 'out_of_service';
  END IF;
  PERFORM app.audit('asset_issue.confirm', 'asset_issue', p_issue::text, v_issue.location_id,
    jsonb_build_object('asset_id', v_issue.asset_id));
  RETURN v_status;
END $$;

-- Resolve an issue (equipment managers at the location). Resolving the last confirmed out-of-service issue puts
-- the asset back in service unless p_restore is false.
CREATE FUNCTION app.resolve_asset_issue(p_issue uuid, p_restore boolean) RETURNS app.asset_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_issue app.asset_issue%ROWTYPE;
  v_status app.asset_status;
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL
     OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'trainer'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_issue FROM app.asset_issue i WHERE i.id = p_issue AND i.org_id = v_org FOR UPDATE;
  IF NOT FOUND OR NOT app.can_see_location(v_issue.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_issue.status = 'resolved' THEN RAISE EXCEPTION 'issue_not_open' USING ERRCODE = '55000'; END IF;

  UPDATE app.asset_issue SET status = 'resolved', resolved_by = app.person_id(), resolved_at = now()
   WHERE id = p_issue;
  SELECT a.status INTO v_status FROM app.asset a WHERE a.id = v_issue.asset_id FOR UPDATE;
  IF coalesce(p_restore, true) AND v_issue.kind = 'out_of_service' AND v_status = 'out_of_service'
     AND NOT EXISTS (SELECT 1 FROM app.asset_issue o
                      WHERE o.asset_id = v_issue.asset_id AND o.id <> p_issue
                        AND o.kind = 'out_of_service' AND o.status = 'confirmed') THEN
    UPDATE app.asset SET status = 'ok' WHERE id = v_issue.asset_id;  -- audited by asset_audit
    v_status := 'ok';
  END IF;
  PERFORM app.audit('asset_issue.resolve', 'asset_issue', p_issue::text, v_issue.location_id,
    jsonb_build_object('asset_id', v_issue.asset_id, 'kind', v_issue.kind));
  RETURN v_status;
END $$;

-- Start (or resume) a circuit run for the calling member. One open run per member: starting another circuit
-- closes the open one. Serialised per member so two taps cannot open two runs.
CREATE FUNCTION app.start_circuit_run(p_circuit uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid := app.floor_my_member_id();
  v_loc uuid;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT c.location_id INTO v_loc FROM app.circuit c WHERE c.id = p_circuit AND c.org_id = v_org AND c.active;
  IF v_loc IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('floor.run:' || v_member::text, 0));
  SELECT r.id INTO v_id FROM app.circuit_run r
   WHERE r.member_id = v_member AND r.finished_at IS NULL AND r.circuit_id = p_circuit;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  UPDATE app.circuit_run SET finished_at = now() WHERE member_id = v_member AND finished_at IS NULL;
  INSERT INTO app.circuit_run (org_id, member_id, circuit_id, location_id)
  VALUES (v_org, v_member, p_circuit, v_loc) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION app.finish_circuit_run(p_run uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_member uuid := app.floor_my_member_id();
  v_at timestamptz;
BEGIN
  IF app.org_id() IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE app.circuit_run SET finished_at = coalesce(finished_at, now())
   WHERE id = p_run AND member_id = v_member AND org_id = app.org_id()
  RETURNING finished_at INTO v_at;
  IF v_at IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN v_at;
END $$;

-- Log one set for the calling member. Location must be in the org; asset and run consistency is enforced by the
-- composite FKs (same location, same member); an open run is required when a run is given.
CREATE FUNCTION app.log_set(p_exercise uuid, p_location uuid, p_asset uuid, p_run uuid, p_reps integer,
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
  RETURN v_id;
END $$;

-- Substitutes for an exercise at a location (SECURITY INVOKER: the caller's RLS decides which assets and
-- exercises exist for them). Same movement pattern; equipment present at the location in status 'ok', excluding
-- the reported asset; exercises that need no equipment always qualify. The original exercise is included when
-- another station of its type is free (same_exercise = true).
CREATE FUNCTION app.substitute_exercise(p_exercise uuid, p_location uuid, p_exclude_asset uuid)
RETURNS TABLE (exercise_id uuid, name text, movement_pattern app.movement_pattern,
               equipment_type app.equipment_type, cues text, asset_id uuid, station_code text,
               same_exercise boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
  SELECT e.id, e.name, e.movement_pattern, e.equipment_type, e.cues, a.id, a.station_code, e.id = src.id
    FROM app.exercise src
    JOIN app.exercise e ON e.org_id = src.org_id AND e.movement_pattern = src.movement_pattern AND e.active
    LEFT JOIN LATERAL (
      SELECT x.id, x.station_code FROM app.asset x
       WHERE x.org_id = src.org_id AND x.location_id = p_location AND x.equipment_type = e.equipment_type
         AND x.status = 'ok' AND x.id IS DISTINCT FROM p_exclude_asset
       ORDER BY x.station_code LIMIT 1) a ON true
   WHERE src.id = p_exercise
     AND (a.id IS NOT NULL OR (e.equipment_type = 'none' AND e.id <> src.id))
   ORDER BY e.id = src.id DESC, e.name
$$;

ALTER FUNCTION app.asset_audit_trigger() OWNER TO app_definer;
ALTER FUNCTION app.floor_my_member_id() OWNER TO app_definer;
ALTER FUNCTION app.report_asset_issue(uuid, app.asset_issue_kind, text) OWNER TO app_definer;
ALTER FUNCTION app.confirm_asset_issue(uuid) OWNER TO app_definer;
ALTER FUNCTION app.resolve_asset_issue(uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app.start_circuit_run(uuid) OWNER TO app_definer;
ALTER FUNCTION app.finish_circuit_run(uuid) OWNER TO app_definer;
ALTER FUNCTION app.log_set(uuid, uuid, uuid, uuid, integer, numeric) OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.asset_audit_trigger(), app.floor_my_member_id(),
  app.report_asset_issue(uuid, app.asset_issue_kind, text), app.confirm_asset_issue(uuid),
  app.resolve_asset_issue(uuid, boolean), app.start_circuit_run(uuid), app.finish_circuit_run(uuid),
  app.log_set(uuid, uuid, uuid, uuid, integer, numeric), app.substitute_exercise(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.floor_my_member_id(),
  app.report_asset_issue(uuid, app.asset_issue_kind, text), app.confirm_asset_issue(uuid),
  app.resolve_asset_issue(uuid, boolean), app.start_circuit_run(uuid), app.finish_circuit_run(uuid),
  app.log_set(uuid, uuid, uuid, uuid, integer, numeric), app.substitute_exercise(uuid, uuid, uuid)
  TO app_authenticated;
