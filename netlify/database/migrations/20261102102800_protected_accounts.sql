-- Production readiness: protected accounts, role switching, and the demo PII guard as a switch.
--   * app_private.setting: operator settings. 'pii_guard' (default true = demo rules): when true, online sign-up only
--     accepts @demo.invalid e-mails and 555-01xx phones; the production seed turns it off so real data is accepted.
--   * app_private.protected_person: accounts nobody else can change or remove (the platform's protected owner).
--     Through the app (definer functions on behalf of a signed-in person) another person can never deactivate,
--     re-role or delete their staff rows, nor toggle their password-change requirement. The person themself can
--     still change their own password. Operator SQL (schema owner) is not blocked.
--   * app.my_roles() / app.switch_role(): a person with several staff roles in the org switches the active role
--     without signing in again (new access + refresh token for that role).

CREATE TABLE app_private.setting (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.protected_person (
  person_id uuid PRIMARY KEY REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.setting, app_private.protected_person FROM PUBLIC;
GRANT SELECT ON app_private.setting, app_private.protected_person TO app_definer;

CREATE FUNCTION app.pii_guard() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT (s.value #>> '{}')::boolean FROM app_private.setting s WHERE s.key = 'pii_guard'), true)
$$;
CREATE FUNCTION app.is_protected(p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app_private.protected_person p WHERE p.person_id = p_person)
$$;

-- Sign-up validators follow the switch (demo rules while the guard is on).
CREATE OR REPLACE FUNCTION app.join_email_ok(p_email text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_email IS NOT NULL AND length(p_email) <= 254
     AND CASE WHEN app.pii_guard() THEN p_email ~ '^[a-z0-9][a-z0-9._+-]{0,63}@demo\.invalid$'
              ELSE p_email ~ '^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,24}$' END
$$;
CREATE OR REPLACE FUNCTION app.join_phone_ok(p_phone text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_phone IS NULL OR CASE WHEN app.pii_guard() THEN p_phone ~ '^\+1-(787|939)-555-01[0-9]{2}$'
                                 ELSE p_phone ~ '^\+1-[2-9][0-9]{2}-[2-9][0-9]{2}-[0-9]{4}$' END
$$;

-- Guard: through the app, nobody but the protected person touches their staff rows.
-- SECURITY INVOKER on purpose: current_user must be the role that runs the statement.
CREATE FUNCTION app.guard_protected_staff() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF current_user IN ('app_definer', 'app_authenticated') AND app.is_protected(OLD.person_id)
     AND app.person_id() IS DISTINCT FROM OLD.person_id THEN
    IF TG_OP = 'DELETE' OR NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'protected_account' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER staff_member_protected BEFORE UPDATE OR DELETE ON app.staff_member
  FOR EACH ROW EXECUTE FUNCTION app.guard_protected_staff();

-- 0027 plus the protection: an owner cannot toggle the protected person's password-change requirement.
CREATE OR REPLACE FUNCTION app.set_password_change_required(p_staff uuid, p_required boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_person uuid;
BEGIN
  IF app.org_id() IS NULL OR app.role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.person_id INTO v_person FROM app.staff_member s WHERE s.id = p_staff AND s.org_id = app.org_id();
  IF v_person IS NULL OR NOT EXISTS (SELECT 1 FROM app_private.password_credential c WHERE c.person_id = v_person) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF app.is_protected(v_person) AND v_person IS DISTINCT FROM app.person_id() THEN
    RAISE EXCEPTION 'protected_account' USING ERRCODE = '42501';
  END IF;
  UPDATE app_private.password_credential SET must_change = coalesce(p_required, true), updated_at = now()
   WHERE person_id = v_person;
  PERFORM app.audit('staff_account.change_required', 'staff_member', p_staff::text, NULL,
                    jsonb_build_object('required', coalesce(p_required, true)));
  RETURN coalesce(p_required, true);
END $$;

-- The team list also says who is protected.
DROP FUNCTION app.staff_accounts();
CREATE FUNCTION app.staff_accounts()
RETURNS TABLE (staff_id uuid, person_id uuid, display_name text, email text, role app.role_name, active boolean,
               has_password boolean, must_change boolean, protected boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.person_id, s.display_name, p.email, s.role, s.active, c.person_id IS NOT NULL,
           coalesce(c.must_change, false), app.is_protected(s.person_id)
      FROM app.staff_member s JOIN app.person p ON p.id = s.person_id
      LEFT JOIN app_private.password_credential c ON c.person_id = s.person_id
     WHERE s.org_id = app.org_id()
     ORDER BY app.is_protected(s.person_id) DESC,
              CASE s.role WHEN 'owner' THEN 0 WHEN 'location_manager' THEN 1 ELSE 2 END, s.display_name;
END $$;

-- The caller's active staff roles in the current org (for the role switcher).
CREATE FUNCTION app.my_roles() RETURNS TABLE (role app.role_name)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.role FROM app.staff_member s
   WHERE s.person_id = app.person_id() AND s.org_id = app.org_id() AND s.active
   ORDER BY CASE s.role WHEN 'owner' THEN 0 WHEN 'location_manager' THEN 1 WHEN 'front_desk' THEN 2 ELSE 3 END, s.role
$$;

-- Switch to another of the caller's roles: claims + a fresh refresh token for that role.
CREATE FUNCTION app.switch_role(p_role app.role_name) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_claims jsonb;
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR p_role IS NULL OR p_role IN ('member', 'guardian') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_claims := app.session_claims(app.person_id(), app.org_id(), p_role);
  IF v_claims IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('claims', v_claims, 'refresh', app.refresh_issue(app.person_id(), app.org_id(), p_role));
END $$;

DO $own$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.pii_guard()', 'app.is_protected(uuid)',
                           'app.staff_accounts()', 'app.my_roles()', 'app.switch_role(app.role_name)']
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_definer', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $own$;
GRANT EXECUTE ON FUNCTION app.pii_guard(), app.is_protected(uuid) TO app_definer, app_authenticated;
GRANT EXECUTE ON FUNCTION app.staff_accounts(), app.my_roles(), app.switch_role(app.role_name) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.join_email_ok(text), app.join_phone_ok(text) TO app_definer;
