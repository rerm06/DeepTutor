-- Access: every way a member gets in (and out). Builds on the schedule module's check_in (0007).
--   1. Door QR (self check-in / check-out). A tablet at the door shows two rotating QR codes, ENTRADA and SALIDA,
--      for its location (30-second windows, HMAC with the existing qr_key under a separate "door|" domain). The
--      member scans with their phone; app.door_pass() records the entry (source 'door', same access rule as the
--      front desk) or closes the open visit. A photo of the code expires within 60 s.
--   2. Check-out: app.check_out closes a visit, so the gym knows who is inside now (occupancy) and for how long.
--   3. Sign-in code (passwordless): app_public.login_start() issues a 6-digit code for a member's e-mail (10 minutes,
--      5 attempts, 5 codes per 15 minutes); app_public.login_verify() returns the member to sign in. The API decides
--      how the code is delivered (DEMO MODE shows it on screen; otherwise a mail/SMS provider is required).
--   4. Face access through the gym's cameras — OFF by default, per location, and only for members who opt in:
--      * location_policy.face_access: switched on by the owner only [VERIFICAR · legal review before enabling].
--      * biometric_consent: given or withdrawn ONLY by the member themself (never by staff on their behalf).
--      * door_device: a camera gateway at one location; authenticates with a secret shown once (stored hashed).
--      * The database never stores face templates. The device downloads the photos of consenting members of its
--        location, computes templates on the device, matches people at the door locally and sends only
--        (member, score, direction). Faces that match nobody never leave the device.
--      * face_event: every recognition the device reports. score ≥ 0.62 → automatic entry/exit; 0.45–0.62 → the
--        front desk confirms or dismisses; lower scores are rejected and not stored
--        [VERIFICAR · thresholds must be calibrated for the model actually deployed].

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.check_out (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  member_id uuid NOT NULL,
  check_in_id uuid NOT NULL UNIQUE,                 -- the visit it closes (one exit per entry)
  source app.checkin_source NOT NULL,
  recorded_by uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, check_in_id) REFERENCES app.check_in (org_id, id)
);
CREATE INDEX check_out_loc_at_idx ON app.check_out (org_id, location_id, at DESC);

ALTER TABLE app.location_policy ADD COLUMN face_access boolean NOT NULL DEFAULT false;

CREATE TABLE app.biometric_consent (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid PRIMARY KEY,
  version text NOT NULL CHECK (version ~ '^face-v[0-9]{1,3}$'),
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (org_id, member_id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE TABLE app.door_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  direction text NOT NULL CHECK (direction IN ('in', 'out', 'both')),
  secret_hash bytea NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_seen_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

CREATE TABLE app.face_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  device_id uuid NOT NULL,
  member_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  score real NOT NULL CHECK (score BETWEEN 0 AND 1),
  outcome text NOT NULL CHECK (outcome IN ('checked_in', 'denied', 'already_in', 'checked_out', 'not_in',
                                           'review', 'confirmed', 'dismissed')),
  reason text,                                      -- access reason when denied (frozen, cancelled, …)
  check_in_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, device_id) REFERENCES app.door_device (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK ((outcome IN ('confirmed', 'dismissed')) = (reviewed_at IS NOT NULL))
);
CREATE INDEX face_event_loc_at_idx ON app.face_event (org_id, location_id, at DESC);
CREATE INDEX face_event_review_idx ON app.face_event (org_id, location_id) WHERE outcome = 'review';

CREATE TABLE app_private.login_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  person_id uuid NOT NULL,
  code_hash bytea NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX login_code_person_idx ON app_private.login_code (person_id, created_at DESC);
REVOKE ALL ON app_private.login_code FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON app_private.login_code TO app_definer;

-- ── Visit helpers ───────────────────────────────────────────────────────────────────────────────────────
-- The member's open visit at a location: their latest allowed check-in there in the last 16 hours with no exit.
CREATE FUNCTION app.access_open_visit(p_org uuid, p_location uuid, p_member uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT c.id FROM app.check_in c
   WHERE c.org_id = p_org AND c.location_id = p_location AND c.member_id = p_member AND c.result = 'allowed'
     AND c.at > now() - interval '16 hours'
     AND NOT EXISTS (SELECT 1 FROM app.check_out o WHERE o.check_in_id = c.id)
   ORDER BY c.at DESC LIMIT 1
$$;

-- Record an entry with the location's access rule; returns (check-in id, result, reason). recorded_by = p_by.
CREATE FUNCTION app.access_enter(p_org uuid, p_location uuid, p_member uuid, p_source app.checkin_source,
                                 p_by uuid, OUT o_id uuid, OUT o_result app.checkin_result, OUT o_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_status app.member_status;
  v_deny boolean;
BEGIN
  SELECT m.status INTO v_status FROM app.member m WHERE m.id = p_member AND m.org_id = p_org;
  SELECT coalesce(lp.deny_past_due, false) INTO v_deny
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = p_location AND lp.org_id = p_org;
  SELECT d.result, d.reason INTO o_result, o_reason FROM app.access_decision(v_status, v_deny) d;
  INSERT INTO app.check_in (org_id, location_id, member_id, source, result, reason, recorded_by)
  VALUES (p_org, p_location, p_member, p_source, o_result, o_reason, p_by)
  RETURNING id INTO o_id;
END $$;

-- Close the open visit; returns the check-out id, or NULL when the member is not inside.
CREATE FUNCTION app.access_exit(p_org uuid, p_location uuid, p_member uuid, p_source app.checkin_source,
                                p_by uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_visit uuid;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_member::text, 0));
  v_visit := app.access_open_visit(p_org, p_location, p_member);
  IF v_visit IS NULL THEN RETURN NULL; END IF;
  INSERT INTO app.check_out (org_id, location_id, member_id, check_in_id, source, recorded_by)
  VALUES (p_org, p_location, p_member, v_visit, p_source, p_by) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── Door QR ─────────────────────────────────────────────────────────────────────────────────────────────
-- d1.<location uuid>.<i|o>.<30-second window>.<first 32 hex of HMAC-SHA256('door|'||org|location|dir|window)>
CREATE FUNCTION app.door_token_for(p_org uuid, p_location uuid, p_dir text, p_window bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT 'd1.' || p_location::text || '.' || p_dir || '.' || p_window::text || '.'
         || left(encode(app_private.hmac(convert_to('door|' || p_org::text || '|' || p_location::text || '|' || p_dir
                                                    || '|' || p_window::text, 'UTF8'), k.key, 'sha256'), 'hex'), 32)
    FROM app_private.qr_key k
$$;

-- The two codes the door tablet shows now. Front of house of the location (owner, manager, front desk).
CREATE FUNCTION app.door_kiosk(p_location uuid)
RETURNS TABLE (direction text, token text, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_window bigint := app.qr_window(clock_timestamp());
BEGIN
  IF app.org_id() IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT d.dir, app.door_token_for(app.org_id(), p_location, left(d.dir, 1), v_window), to_timestamp((v_window + 1) * 30)
      FROM (VALUES ('in'), ('out')) AS d(dir);
END $$;

-- The member scans the door code: entry or exit at that location, for themself only.
-- result: 'allowed' | 'denied' | 'already_in' | 'checked_out' | 'not_in' | 'invalid' | 'expired'.
CREATE FUNCTION app.door_pass(p_token text)
RETURNS TABLE (result text, reason text, direction text, location_id uuid, location_name text, member_id uuid,
               full_name text, at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_parts text[];
  v_loc uuid;
  v_dir text;
  v_window bigint;
  v_now bigint := app.qr_window(clock_timestamp());
  v_member uuid;
  v_name text;
  v_lname text;
  v_res app.checkin_result;
  v_reason text;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL OR app.role() IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.id, m.full_name INTO v_member, v_name FROM app.member m WHERE m.org_id = v_org AND m.person_id = app.person_id();
  IF v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  IF p_token IS NULL OR length(p_token) > 120
     OR p_token !~ '^d1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[io]\.[0-9]{1,12}\.[0-9a-f]{32}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, NULL::uuid, NULL::text, v_member, v_name, now();
    RETURN;
  END IF;
  v_parts := string_to_array(p_token, '.');
  v_loc := v_parts[2]::uuid;
  v_dir := v_parts[3];
  v_window := v_parts[4]::bigint;
  -- A code of another organisation (or forged) fails the HMAC for this org.
  IF app.door_token_for(v_org, v_loc, v_dir, v_window) <> p_token THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, NULL::uuid, NULL::text, v_member, v_name, now();
    RETURN;
  END IF;
  SELECT l.name INTO v_lname FROM app.location l WHERE l.id = v_loc AND l.org_id = v_org;
  IF v_window NOT IN (v_now, v_now - 1) THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, CASE v_dir WHEN 'i' THEN 'in' ELSE 'out' END, v_loc, v_lname,
                        v_member, v_name, now();
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || v_member::text, 0));
  IF v_dir = 'i' THEN
    IF app.access_open_visit(v_org, v_loc, v_member) IS NOT NULL THEN
      RETURN QUERY SELECT 'already_in'::text, NULL::text, 'in'::text, v_loc, v_lname, v_member, v_name, now();
      RETURN;
    END IF;
    SELECT e.o_id, e.o_result, e.o_reason INTO v_id, v_res, v_reason
      FROM app.access_enter(v_org, v_loc, v_member, 'door', app.person_id()) e;
    RETURN QUERY SELECT v_res::text, v_reason, 'in'::text, v_loc, v_lname, v_member, v_name, now();
  ELSE
    v_id := app.access_exit(v_org, v_loc, v_member, 'door', app.person_id());
    RETURN QUERY SELECT CASE WHEN v_id IS NULL THEN 'not_in' ELSE 'checked_out' END, NULL::text, 'out'::text, v_loc,
                        v_lname, v_member, v_name, now();
  END IF;
END $$;

-- Front of house closes a visit by hand (forgot to scan out). Same staff rule as check-in.
CREATE FUNCTION app.check_out_member(p_location uuid, p_member uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN app.access_exit(app.org_id(), p_location, p_member, 'front_desk', app.person_id());
END $$;

-- Who is inside now (open visits today), newest first. Front of house of the location.
CREATE FUNCTION app.location_inside(p_location uuid)
RETURNS TABLE (member_id uuid, full_name text, member_no text, since timestamptz, source app.checkin_source)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.can_see_location(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (c.member_id) c.member_id, m.full_name, m.member_no, c.at, c.source
      FROM app.check_in c JOIN app.member m ON m.id = c.member_id
     WHERE c.org_id = app.org_id() AND c.location_id = p_location AND c.result = 'allowed'
       AND c.at > now() - interval '16 hours'
       AND NOT EXISTS (SELECT 1 FROM app.check_out o WHERE o.check_in_id = c.id)
     ORDER BY c.member_id, c.at DESC;
END $$;

-- ── Sign-in code ───────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.login_code_hash(p_code_id uuid, p_code text) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app_private.hmac(convert_to('login|' || p_code_id::text || '|' || p_code, 'UTF8'), k.key, 'sha256')
    FROM app_private.qr_key k
$$;

-- Issue a code for a member e-mail of the org. Unknown e-mail → {"sent": false} (the API answers the same way).
CREATE FUNCTION app_public.login_start(p_org uuid, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_person uuid;
  v_id uuid := gen_random_uuid();
  v_code text;
  v_b bytea := app_private.gen_random_bytes(4);
BEGIN
  IF p_org IS NULL OR p_email IS NULL OR length(p_email) > 254 THEN RETURN jsonb_build_object('sent', false); END IF;
  SELECT p.id INTO v_person FROM app.person p
   WHERE lower(p.email) = lower(btrim(p_email))
     AND EXISTS (SELECT 1 FROM app.member m WHERE m.person_id = p.id AND m.org_id = p_org);
  IF v_person IS NULL THEN RETURN jsonb_build_object('sent', false); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('login:' || v_person::text, 0));
  IF (SELECT count(*) FROM app_private.login_code c
       WHERE c.person_id = v_person AND c.created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;
  -- 6 digits from 32 random bits (bias < 0.03 %).
  v_code := lpad(((get_byte(v_b, 0)::bigint * 16777216 + get_byte(v_b, 1) * 65536 + get_byte(v_b, 2) * 256
                   + get_byte(v_b, 3)) % 1000000)::text, 6, '0');
  -- A new code replaces the earlier ones.
  UPDATE app_private.login_code SET used_at = now() WHERE person_id = v_person AND org_id = p_org AND used_at IS NULL;
  INSERT INTO app_private.login_code (id, org_id, person_id, code_hash, expires_at)
  VALUES (v_id, p_org, v_person, app.login_code_hash(v_id, v_code), now() + interval '10 minutes');
  RETURN jsonb_build_object('sent', true, 'code', v_code, 'expires_in', 600);
END $$;

-- Check a code. Success marks it used and returns who signs in; a failure counts an attempt (5 per code).
CREATE FUNCTION app_public.login_verify(p_org uuid, p_email text, p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_person uuid;
  v_c app_private.login_code;
  v_m record;
BEGIN
  IF p_org IS NULL OR p_email IS NULL OR p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  SELECT p.id INTO v_person FROM app.person p WHERE lower(p.email) = lower(btrim(p_email));
  IF v_person IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO v_c FROM app_private.login_code c
   WHERE c.person_id = v_person AND c.org_id = p_org AND c.used_at IS NULL AND c.expires_at > now()
   ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE;
  IF v_c.id IS NULL OR v_c.attempts >= 5 THEN RETURN jsonb_build_object('ok', false); END IF;
  IF app.login_code_hash(v_c.id, p_code) <> v_c.code_hash THEN
    UPDATE app_private.login_code SET attempts = attempts + 1 WHERE id = v_c.id;
    RETURN jsonb_build_object('ok', false, 'left', 4 - v_c.attempts);
  END IF;
  UPDATE app_private.login_code SET used_at = now() WHERE id = v_c.id;
  SELECT m.id, m.full_name, l.name AS location_name, b.name AS brand_name INTO v_m
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id JOIN app.brand b ON b.id = l.brand_id
   WHERE m.person_id = v_person AND m.org_id = p_org
   ORDER BY m.created_at LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'person_id', v_person, 'member_id', v_m.id, 'org_id', p_org,
                            'full_name', v_m.full_name, 'location_name', v_m.location_name,
                            'brand_name', v_m.brand_name);
END $$;

-- ── Face access (cameras) ───────────────────────────────────────────────────────────────────────────────
-- Owner only, per location. Turning it off stops devices at once (enrolment returns nothing, events are refused).
CREATE FUNCTION app.set_face_access(p_location uuid, p_on boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS DISTINCT FROM 'owner'
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.location_policy (org_id, location_id, face_access, updated_by)
  VALUES (app.org_id(), p_location, coalesce(p_on, false), app.person_id())
  ON CONFLICT (location_id) DO UPDATE SET face_access = EXCLUDED.face_access, updated_by = EXCLUDED.updated_by,
                                          updated_at = now();
  PERFORM app.audit('face_access.set', 'location', p_location::text, p_location,
                    jsonb_build_object('on', coalesce(p_on, false)));
  RETURN coalesce(p_on, false);
END $$;

-- The member gives or withdraws their own biometric consent. Withdrawal takes effect at the next device sync and
-- immediately for events (an event for a member without active consent is refused).
CREATE FUNCTION app.set_biometric_consent(p_grant boolean, p_version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_member uuid;
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR app.role() IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.id, m.home_location_id INTO v_member, v_loc
    FROM app.member m WHERE m.org_id = app.org_id() AND m.person_id = app.person_id();
  IF v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_grant THEN
    IF p_version IS NULL OR p_version !~ '^face-v[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'biometric_consent_version' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.biometric_consent (org_id, member_id, version, granted_at)
    VALUES (app.org_id(), v_member, p_version, now())
    ON CONFLICT (member_id) DO UPDATE SET version = EXCLUDED.version, granted_at = now(), revoked_at = NULL;
  ELSE
    UPDATE app.biometric_consent SET revoked_at = now() WHERE member_id = v_member AND revoked_at IS NULL;
  END IF;
  PERFORM app.audit(CASE WHEN p_grant THEN 'biometric_consent.grant' ELSE 'biometric_consent.revoke' END,
                    'biometric_consent', v_member::text, v_loc,
                    jsonb_build_object('version', CASE WHEN p_grant THEN p_version END));
  RETURN coalesce(p_grant, false);
END $$;

CREATE FUNCTION app.device_secret_hash(p_device uuid, p_secret text) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app_private.hmac(convert_to('device|' || p_device::text || '|' || p_secret, 'UTF8'), k.key, 'sha256')
    FROM app_private.qr_key k
$$;

-- Register a camera gateway. Owner (any location) or the location's manager. The secret is returned ONCE.
CREATE FUNCTION app.create_door_device(p_location uuid, p_name text, p_direction text)
RETURNS TABLE (id uuid, secret text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_secret text := encode(app_private.gen_random_bytes(24), 'hex');
BEGIN
  IF app.org_id() IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager')
     OR NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 60 OR p_direction NOT IN ('in', 'out', 'both') THEN
    RAISE EXCEPTION 'invalid_device' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.door_device (id, org_id, location_id, name, direction, secret_hash, created_by)
  VALUES (v_id, app.org_id(), p_location, btrim(p_name), p_direction, app.device_secret_hash(v_id, v_secret),
          app.person_id());
  PERFORM app.audit('door_device.create', 'door_device', v_id::text, p_location,
                    jsonb_build_object('name', btrim(p_name), 'direction', p_direction));
  RETURN QUERY SELECT v_id, v_secret;
END $$;

CREATE FUNCTION app.revoke_door_device(p_device uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_loc uuid;
BEGIN
  SELECT d.location_id INTO v_loc FROM app.door_device d WHERE d.id = p_device AND d.org_id = app.org_id();
  IF v_loc IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager')
     OR NOT app.can_see_location(v_loc) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE app.door_device SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_device;
  PERFORM app.audit('door_device.revoke', 'door_device', p_device::text, v_loc, '{}'::jsonb);
  RETURN true;
END $$;

-- Device authentication for the public device endpoints (no claims exist there). NULL when unknown/revoked/wrong.
CREATE FUNCTION app.device_auth(p_device uuid, p_secret text) RETURNS app.door_device
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_d app.door_device;
BEGIN
  IF p_device IS NULL OR p_secret IS NULL OR p_secret !~ '^[0-9a-f]{48}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_d FROM app.door_device d WHERE d.id = p_device AND d.revoked_at IS NULL;
  IF v_d.id IS NULL OR app.device_secret_hash(p_device, p_secret) <> v_d.secret_hash THEN RETURN NULL; END IF;
  UPDATE app.door_device SET last_seen_at = now() WHERE id = p_device;
  RETURN v_d;
END $$;

-- What a device may know: the photos of members of its location who opted in, while the location has face access.
CREATE FUNCTION app_public.device_enrolment(p_device uuid, p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_d app.door_device := app.device_auth(p_device, p_secret);
  v_on boolean;
BEGIN
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(lp.face_access, false) INTO v_on
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_d.location_id;
  IF NOT v_on THEN
    RETURN jsonb_build_object('enabled', false, 'direction', v_d.direction, 'members', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('enabled', true, 'direction', v_d.direction, 'members', coalesce((
    SELECT jsonb_agg(jsonb_build_object('member_id', m.id, 'full_name', m.full_name, 'mime', ph.mime,
                                        'photo', encode(ph.data, 'base64'), 'updated_at', ph.updated_at)
                     ORDER BY m.id)
      FROM app.member m
      JOIN app.member_photo ph ON ph.member_id = m.id
      JOIN app.biometric_consent bc ON bc.member_id = m.id AND bc.revoked_at IS NULL
     WHERE m.org_id = v_d.org_id AND m.home_location_id = v_d.location_id), '[]'::jsonb));
END $$;

-- A device reports a recognition. Thresholds: ≥ 0.62 automatic, 0.45–0.62 front-desk review, below → refused.
CREATE FUNCTION app_public.device_recognition(p_device uuid, p_secret text, p_member uuid, p_score real,
                                              p_direction text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_d app.door_device := app.device_auth(p_device, p_secret);
  v_dir text;
  v_on boolean;
  v_outcome text;
  v_reason text;
  v_ci uuid;
  v_res app.checkin_result;
  v_name text;
BEGIN
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_dir := CASE WHEN v_d.direction = 'both' THEN p_direction ELSE v_d.direction END;
  IF v_dir IS NULL OR v_dir NOT IN ('in', 'out') OR p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RAISE EXCEPTION 'invalid_recognition' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(lp.face_access, false) INTO v_on
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_d.location_id;
  -- Face access off, a member of another location or org, or no active consent: refused and NOT stored.
  IF NOT v_on OR NOT EXISTS (
       SELECT 1 FROM app.member m JOIN app.biometric_consent bc ON bc.member_id = m.id AND bc.revoked_at IS NULL
        WHERE m.id = p_member AND m.org_id = v_d.org_id AND m.home_location_id = v_d.location_id) THEN
    RETURN jsonb_build_object('outcome', 'refused');
  END IF;
  IF p_score < 0.45 THEN RETURN jsonb_build_object('outcome', 'refused'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_member::text, 0));
  -- The same face seen again by the same device within 60 s is one event.
  IF EXISTS (SELECT 1 FROM app.face_event e WHERE e.device_id = v_d.id AND e.member_id = p_member
                AND e.at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  SELECT m.full_name INTO v_name FROM app.member m WHERE m.id = p_member;
  IF p_score < 0.62 THEN
    v_outcome := 'review';
  ELSIF v_dir = 'in' THEN
    IF app.access_open_visit(v_d.org_id, v_d.location_id, p_member) IS NOT NULL THEN
      v_outcome := 'already_in';
    ELSE
      SELECT e.o_id, e.o_result, e.o_reason INTO v_ci, v_res, v_reason
        FROM app.access_enter(v_d.org_id, v_d.location_id, p_member, 'door', v_d.created_by) e;
      v_outcome := CASE WHEN v_res = 'allowed' THEN 'checked_in' ELSE 'denied' END;
      IF v_res = 'allowed' THEN v_reason := NULL; END IF;
    END IF;
  ELSE
    v_outcome := CASE WHEN app.access_exit(v_d.org_id, v_d.location_id, p_member, 'door', v_d.created_by) IS NULL
                      THEN 'not_in' ELSE 'checked_out' END;
  END IF;
  INSERT INTO app.face_event (org_id, location_id, device_id, member_id, direction, score, outcome, reason, check_in_id)
  VALUES (v_d.org_id, v_d.location_id, v_d.id, p_member, v_dir, p_score, v_outcome, v_reason, v_ci);
  RETURN jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'full_name', v_name);
END $$;

-- Front of house confirms (performs the entry/exit) or dismisses an event under review.
CREATE FUNCTION app.review_face_event(p_event uuid, p_accept boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_e app.face_event;
  v_res app.checkin_result;
  v_reason text;
  v_ci uuid;
BEGIN
  SELECT * INTO v_e FROM app.face_event e WHERE e.id = p_event AND e.org_id = app.org_id() FOR UPDATE;
  IF v_e.id IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.can_see_location(v_e.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_e.outcome <> 'review' THEN RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '22023'; END IF;
  IF p_accept THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('access:' || v_e.member_id::text, 0));
    IF v_e.direction = 'in' AND app.access_open_visit(v_e.org_id, v_e.location_id, v_e.member_id) IS NULL THEN
      SELECT e.o_id, e.o_result, e.o_reason INTO v_ci, v_res, v_reason
        FROM app.access_enter(v_e.org_id, v_e.location_id, v_e.member_id, 'door', app.person_id()) e;
    ELSIF v_e.direction = 'out' THEN
      PERFORM app.access_exit(v_e.org_id, v_e.location_id, v_e.member_id, 'door', app.person_id());
    END IF;
  END IF;
  UPDATE app.face_event
     SET outcome = CASE WHEN p_accept THEN 'confirmed' ELSE 'dismissed' END, reason = v_reason, check_in_id = v_ci,
         reviewed_by = app.person_id(), reviewed_at = now()
   WHERE id = p_event;
  RETURN CASE WHEN p_accept THEN coalesce(v_res::text, 'confirmed') ELSE 'dismissed' END;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.check_out         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.check_out         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.biometric_consent ENABLE ROW LEVEL SECURITY; ALTER TABLE app.biometric_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE app.door_device       ENABLE ROW LEVEL SECURITY; ALTER TABLE app.door_device       FORCE ROW LEVEL SECURITY;
ALTER TABLE app.face_event        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.face_event        FORCE ROW LEVEL SECURITY;
CREATE POLICY definer_all ON app.check_out         TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.biometric_consent TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.door_device       TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.face_event        TO app_definer USING (true) WITH CHECK (true);

-- check_out: same visibility as check_in (front of house at the location; the member or guardian).
CREATE POLICY check_out_select ON app.check_out FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(location_id))
    OR app.sched_self_or_ward(member_id)));
-- biometric_consent: the member (or guardian) and front of house of the home location.
CREATE POLICY biometric_consent_select ON app.biometric_consent FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    app.sched_self_or_ward(member_id)
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND app.staff_can_see_member(member_id))));
-- door_device and face_event: front of house of the location.
CREATE POLICY door_device_select ON app.door_device FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(location_id));
CREATE POLICY face_event_select ON app.face_event FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(location_id));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.check_out, app.biometric_consent, app.door_device, app.face_event FROM PUBLIC;
GRANT SELECT ON app.check_out, app.biometric_consent, app.face_event TO app_authenticated;
-- Never the secret hash.
GRANT SELECT (id, org_id, location_id, name, direction, created_by, created_at, revoked_at, last_seen_at)
  ON app.door_device TO app_authenticated;
GRANT SELECT, INSERT ON app.check_out TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.biometric_consent, app.door_device, app.face_event TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.location_policy TO app_definer;
GRANT SELECT ON app.member_photo, app.brand, app.person TO app_definer;

DO $own$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.access_open_visit(uuid, uuid, uuid)',
    'app.access_enter(uuid, uuid, uuid, app.checkin_source, uuid)',
    'app.access_exit(uuid, uuid, uuid, app.checkin_source, uuid)',
    'app.door_token_for(uuid, uuid, text, bigint)',
    'app.door_kiosk(uuid)', 'app.door_pass(text)', 'app.check_out_member(uuid, uuid)', 'app.location_inside(uuid)',
    'app.login_code_hash(uuid, text)', 'app_public.login_start(uuid, text)',
    'app_public.login_verify(uuid, text, text)',
    'app.set_face_access(uuid, boolean)', 'app.set_biometric_consent(boolean, text)',
    'app.device_secret_hash(uuid, text)', 'app.create_door_device(uuid, text, text)',
    'app.revoke_door_device(uuid)', 'app.device_auth(uuid, text)',
    'app_public.device_enrolment(uuid, text)', 'app_public.device_recognition(uuid, text, uuid, real, text)',
    'app.review_face_event(uuid, boolean)']
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_definer', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $own$;

-- Request traffic (claims) may call only the guarded entry points.
GRANT EXECUTE ON FUNCTION app.door_kiosk(uuid), app.door_pass(text), app.check_out_member(uuid, uuid),
  app.location_inside(uuid), app.set_face_access(uuid, boolean), app.set_biometric_consent(boolean, text),
  app.create_door_device(uuid, text, text), app.revoke_door_device(uuid), app.review_face_event(uuid, boolean)
  TO app_authenticated;
-- Internals reachable only from other definer functions.
GRANT EXECUTE ON FUNCTION app.access_open_visit(uuid, uuid, uuid),
  app.access_enter(uuid, uuid, uuid, app.checkin_source, uuid),
  app.access_exit(uuid, uuid, uuid, app.checkin_source, uuid), app.door_token_for(uuid, uuid, text, bigint),
  app.login_code_hash(uuid, text), app.device_secret_hash(uuid, text), app.device_auth(uuid, text),
  app.access_decision(app.member_status, boolean), app.qr_window(timestamptz), app.can_see_location(uuid),
  app.staff_can_see_member(uuid), app.sched_self_or_ward(uuid)
  TO app_definer;

-- Public entry points: the API login role only, before any claims exist (same pattern as 0018).
DO $grant$
DECLARE v_login text := CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN 'app_api' ELSE current_user END;
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION app_public.login_start(uuid, text), '
                 'app_public.login_verify(uuid, text, text), app_public.device_enrolment(uuid, text), '
                 'app_public.device_recognition(uuid, text, uuid, real, text) TO %I', v_login);
END $grant$;
