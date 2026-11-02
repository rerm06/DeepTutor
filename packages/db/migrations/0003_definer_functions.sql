-- Audited cross-RLS entry points. Each one validates the caller's claims before doing anything,
-- runs with a pinned search_path, and writes its own audit row.

GRANT USAGE, CREATE ON SCHEMA app TO app_definer;  -- CREATE is required to own functions in the schema.
GRANT SELECT, INSERT ON app.person TO app_definer;
GRANT SELECT, INSERT ON app.member TO app_definer;
GRANT SELECT ON app.location TO app_definer;
GRANT INSERT ON app.audit_log TO app_definer;

-- Register a member at a location. Links an existing global Person by email (spec §3.1: one Person can be a
-- member of two organisations) without revealing anything about the other organisation.
CREATE FUNCTION app.register_member(p_email text, p_full_name text, p_phone text, p_home_location_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_person uuid;
  v_member uuid;
BEGIN
  IF v_org IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_see_location(p_home_location_id)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_home_location_id AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_person FROM app.person WHERE lower(email) = lower(p_email);
  IF v_person IS NULL THEN
    INSERT INTO app.person (email, full_name, phone) VALUES (p_email, p_full_name, p_phone)
    RETURNING id INTO v_person;
  END IF;

  INSERT INTO app.member (org_id, person_id, home_location_id, status)
  VALUES (v_org, v_person, p_home_location_id, 'lead')
  RETURNING id INTO v_member;

  INSERT INTO app.audit_log (org_id, actor_person_id, actor_role, action, entity, entity_id, location_id)
  VALUES (v_org, app.person_id(), app.role(), 'member.register', 'member', v_member::text, p_home_location_id);
  RETURN v_member;
END $$;

ALTER FUNCTION app.register_member(text, text, text, uuid) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.register_member(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_member(text, text, text, uuid) TO app_authenticated;
