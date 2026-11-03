-- Camera gateways that must ALWAYS be confirmed by the front desk. Consumer cameras (e.g. Wyze over RTSP) have no
-- liveness / anti-spoofing: a printed photo or a phone screen could match. For those devices every recognition with
-- score >= 0.45 goes to the review queue; nothing is recorded automatically. Default for new devices created from the
-- app: ON (the owner turns it off only for cameras with liveness detection). Existing rows keep their behaviour.
ALTER TABLE app.door_device ADD COLUMN requires_review boolean NOT NULL DEFAULT false;
GRANT SELECT (requires_review) ON app.door_device TO app_authenticated;

CREATE FUNCTION app.create_door_device(p_location uuid, p_name text, p_direction text, p_requires_review boolean)
RETURNS TABLE (id uuid, secret text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM app.create_door_device(p_location, p_name, p_direction) c;
  UPDATE app.door_device SET requires_review = coalesce(p_requires_review, true) WHERE door_device.id = r.id;
  RETURN QUERY SELECT r.id, r.secret;
END $$;

-- Owner or the location's manager switches the policy of an existing device.
CREATE FUNCTION app.set_device_review(p_device uuid, p_requires_review boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_loc uuid;
BEGIN
  SELECT d.location_id INTO v_loc FROM app.door_device d WHERE d.id = p_device AND d.org_id = app.org_id();
  IF v_loc IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager')
     OR NOT app.can_see_location(v_loc) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE app.door_device SET requires_review = coalesce(p_requires_review, true) WHERE id = p_device;
  PERFORM app.audit('door_device.review_policy', 'door_device', p_device::text, v_loc,
                    jsonb_build_object('requires_review', coalesce(p_requires_review, true)));
  RETURN coalesce(p_requires_review, true);
END $$;

-- Same as 0024, plus: a device that requires review never records automatically.
CREATE OR REPLACE FUNCTION app_public.device_recognition(p_device uuid, p_secret text, p_member uuid, p_score real,
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
  IF NOT v_on OR NOT EXISTS (
       SELECT 1 FROM app.member m JOIN app.biometric_consent bc ON bc.member_id = m.id AND bc.revoked_at IS NULL
        WHERE m.id = p_member AND m.org_id = v_d.org_id AND m.home_location_id = v_d.location_id) THEN
    RETURN jsonb_build_object('outcome', 'refused');
  END IF;
  IF p_score < 0.45 THEN RETURN jsonb_build_object('outcome', 'refused'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('access:' || p_member::text, 0));
  IF EXISTS (SELECT 1 FROM app.face_event e WHERE e.device_id = v_d.id AND e.member_id = p_member
                AND e.at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  SELECT m.full_name INTO v_name FROM app.member m WHERE m.id = p_member;
  IF p_score < 0.62 OR v_d.requires_review THEN
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

-- The device learns its policy at sync (the agent shows it in its log).
CREATE OR REPLACE FUNCTION app_public.device_enrolment(p_device uuid, p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_d app.door_device := app.device_auth(p_device, p_secret);
  v_on boolean;
BEGIN
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(lp.face_access, false) INTO v_on
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_d.location_id;
  IF NOT v_on THEN
    RETURN jsonb_build_object('enabled', false, 'direction', v_d.direction, 'requires_review', v_d.requires_review,
                              'members', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('enabled', true, 'direction', v_d.direction, 'requires_review', v_d.requires_review,
    'members', coalesce((
    SELECT jsonb_agg(jsonb_build_object('member_id', m.id, 'full_name', m.full_name, 'mime', ph.mime,
                                        'photo', encode(ph.data, 'base64'), 'updated_at', ph.updated_at)
                     ORDER BY m.id)
      FROM app.member m
      JOIN app.member_photo ph ON ph.member_id = m.id
      JOIN app.biometric_consent bc ON bc.member_id = m.id AND bc.revoked_at IS NULL
     WHERE m.org_id = v_d.org_id AND m.home_location_id = v_d.location_id), '[]'::jsonb));
END $$;

ALTER FUNCTION app.create_door_device(uuid, text, text, boolean) OWNER TO app_definer;
ALTER FUNCTION app.set_device_review(uuid, boolean) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.create_door_device(uuid, text, text, boolean), app.set_device_review(uuid, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_door_device(uuid, text, text, boolean), app.set_device_review(uuid, boolean)
  TO app_authenticated;
-- The 4-argument version calls the 3-argument one as app_definer.
GRANT EXECUTE ON FUNCTION app.create_door_device(uuid, text, text) TO app_definer;
