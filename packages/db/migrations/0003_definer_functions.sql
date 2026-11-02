-- Audited cross-RLS entry points, owned by app_definer (BYPASSRLS). Each one re-validates the caller's claims,
-- runs with a pinned search_path, and writes its own audit row.

GRANT USAGE, CREATE ON SCHEMA app TO app_definer;  -- CREATE is required to own functions in the schema.
GRANT USAGE ON SCHEMA app_private TO app_definer;
GRANT SELECT ON app_private.claims_key TO app_definer;
GRANT SELECT, INSERT ON app.person TO app_definer;
GRANT SELECT, INSERT ON app.member TO app_definer;
GRANT SELECT ON app.location TO app_definer;
GRANT INSERT ON app.audit_log TO app_definer;

-- app.claims() must be able to read the HMAC key that request traffic cannot.
ALTER FUNCTION app.claims() OWNER TO app_definer;
ALTER FUNCTION app.staff_can_see_member(uuid) OWNER TO app_definer;

-- Append an audit row as the caller. Actor, role, org and time are forced from verified claims.
CREATE FUNCTION app.audit(p_action text, p_entity text, p_entity_id text, p_location_id uuid, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR app.role() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.location l WHERE l.id = p_location_id AND l.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.audit_log (org_id, actor_person_id, actor_role, action, entity, entity_id, location_id, meta, at)
  VALUES (app.org_id(), app.person_id(), app.role(), p_action, p_entity, p_entity_id, p_location_id,
          coalesce(p_meta, '{}'::jsonb), now());
END $$;

-- Register a member at a location. Links an existing global Person by email (spec §3.1) without returning
-- or changing anything another organisation stored: name and phone live on this org's member row.
CREATE FUNCTION app.register_member(p_email text, p_full_name text, p_phone text, p_home_location_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
  v_person uuid;
  v_member uuid;
BEGIN
  IF v_org IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'location_manager', 'front_desk') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_see_location(p_home_location_id)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_home_location_id AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(p_email) > 254 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_person FROM app.person WHERE lower(email) = lower(p_email);
  IF v_person IS NULL THEN
    INSERT INTO app.person (email) VALUES (p_email) RETURNING id INTO v_person;
  END IF;

  INSERT INTO app.member (org_id, person_id, home_location_id, full_name, phone, status)
  VALUES (v_org, v_person, p_home_location_id, p_full_name, p_phone, 'lead')
  RETURNING id INTO v_member;

  PERFORM app.audit('member.register', 'member', v_member::text, p_home_location_id, '{}'::jsonb);
  RETURN v_member;
END $$;

ALTER FUNCTION app.audit(text, text, text, uuid, jsonb) OWNER TO app_definer;
ALTER FUNCTION app.register_member(text, text, text, uuid) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.audit(text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_member(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit(text, text, text, uuid, jsonb) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.register_member(text, text, text, uuid) TO app_authenticated;
