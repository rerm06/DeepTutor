-- Staff sign-in with e-mail and password, and long-lived sessions through rotating refresh tokens.
--   * password_credential: bcrypt hash (pgcrypto crypt/gen_salt('bf', 10)), never readable by request traffic.
--     5 wrong passwords lock the account for 15 minutes. An account created by an owner starts with
--     must_change = true: the first sign-in asks for a new password (an owner-chosen password is known to two people).
--   * New passwords: at least 10 characters, not a common password, not the e-mail's name, not the old one.
--   * refresh_token: opaque 256-bit token (only its HMAC is stored), 12 hours, rotated on every use, revoked when the
--     person loses the role. Issued by a successful password sign-in or member code sign-in (0024 login_verify).
--   * Owners create staff accounts (any staff role, including owner) for NEW e-mails only: nobody can set or reset
--     the password of an existing account from the app (no take-over through the demo owner persona).
-- Accounts belong to people (app.person); the role comes from app.staff_member in the organisation.

CREATE TABLE app_private.password_credential (
  person_id uuid PRIMARY KEY REFERENCES app.person (id),
  hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT true,
  failed smallint NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.refresh_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES app.person (id),
  org_id uuid NOT NULL,
  role app.role_name NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX refresh_token_person_idx ON app_private.refresh_token (person_id);
REVOKE ALL ON app_private.password_credential, app_private.refresh_token FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON app_private.password_credential, app_private.refresh_token TO app_definer;

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.password_ok(p_email text, p_password text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_password IS NOT NULL
     AND length(p_password) BETWEEN 10 AND 128
     AND lower(p_password) NOT IN ('password', 'password1', 'password12', 'password123', 'password1234',
                                   'contrasena', 'contraseña', '1234567890', '0123456789', 'qwertyuiop',
                                   'qwerty1234', 'abcdefghij', 'iloveyou12', 'admin12345', 'welcome123',
                                   'bienvenido1', 'fitnessrus1', 'gimnasio123')
     AND position(lower(split_part(coalesce(p_email, ''), '@', 1)) IN lower(p_password)) = 0
     AND p_password !~ '^(.)\1+$'
$$;

CREATE FUNCTION app.refresh_hash(p_token text) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app_private.hmac(convert_to('refresh|' || p_token, 'UTF8'), k.key, 'sha256') FROM app_private.qr_key k
$$;

-- New refresh token for (person, org, role). Returns the token (shown once to the client).
CREATE FUNCTION app.refresh_issue(p_person uuid, p_org uuid, p_role app.role_name) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_tok text := encode(app_private.gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO app_private.refresh_token (person_id, org_id, role, token_hash, expires_at)
  VALUES (p_person, p_org, p_role, app.refresh_hash(v_tok), now() + interval '12 hours');
  RETURN v_tok;
END $$;

-- The session a person gets in an org: owner/staff role first (owner > manager > others), else member.
CREATE FUNCTION app.session_claims(p_person uuid, p_org uuid, p_role app.role_name) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_staff app.staff_member;
  v_member app.member;
  v_locs uuid[];
  v_brand text;
  v_home text;
BEGIN
  IF p_role IN ('member', 'guardian') THEN
    SELECT * INTO v_member FROM app.member m WHERE m.person_id = p_person AND m.org_id = p_org
     ORDER BY m.created_at LIMIT 1;
    IF v_member.id IS NULL THEN RETURN NULL; END IF;
    SELECT l.name, b.name INTO v_home, v_brand
      FROM app.location l JOIN app.brand b ON b.id = l.brand_id WHERE l.id = v_member.home_location_id;
    RETURN jsonb_build_object('person_id', p_person, 'org_id', p_org, 'role', 'member', 'location_ids', '[]'::jsonb,
                              'display_name', v_member.full_name, 'home', v_home, 'org_name', v_brand);
  END IF;
  SELECT * INTO v_staff FROM app.staff_member s
   WHERE s.person_id = p_person AND s.org_id = p_org AND s.role = p_role AND s.active;
  IF v_staff.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(array_agg(sl.location_id ORDER BY sl.location_id), '{}') INTO v_locs
    FROM app.staff_location sl WHERE sl.staff_member_id = v_staff.id;
  SELECT b.name INTO v_brand FROM app.brand b WHERE b.org_id = p_org ORDER BY b.created_at LIMIT 1;
  SELECT l.name INTO v_home FROM app.location l WHERE l.id = v_locs[1];
  RETURN jsonb_build_object('person_id', p_person, 'org_id', p_org, 'role', p_role,
                            'location_ids', CASE WHEN p_role IN ('owner', 'accountant') THEN '[]'::jsonb
                                                 ELSE to_jsonb(v_locs) END,
                            'display_name', v_staff.display_name, 'home', v_home, 'org_name', v_brand);
END $$;

-- ── Password sign-in ─────────────────────────────────────────────────────────────────────────────────────
-- {ok:false} for unknown e-mail / wrong password / no staff role (same answer); {ok:false, locked:true} while
-- locked; {ok:true, must_change:true} when the password must be replaced first; else {ok:true, claims, refresh}.
CREATE FUNCTION app_public.password_login(p_email text, p_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_person uuid;
  v_c app_private.password_credential;
  v_s app.staff_member;
  v_claims jsonb;
BEGIN
  IF p_email IS NULL OR p_password IS NULL OR length(p_password) > 128 OR length(p_email) > 254 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  SELECT p.id INTO v_person FROM app.person p WHERE lower(p.email) = lower(btrim(p_email));
  IF v_person IS NULL THEN
    PERFORM app_private.crypt(p_password, app_private.gen_salt('bf', 10)); -- same cost as a real check
    RETURN jsonb_build_object('ok', false);
  END IF;
  SELECT * INTO v_c FROM app_private.password_credential c WHERE c.person_id = v_person FOR UPDATE;
  IF v_c.person_id IS NULL THEN
    PERFORM app_private.crypt(p_password, app_private.gen_salt('bf', 10));
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF v_c.locked_until IS NOT NULL AND v_c.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'locked', true);
  END IF;
  IF app_private.crypt(p_password, v_c.hash) <> v_c.hash THEN
    UPDATE app_private.password_credential
       SET locked_until = CASE WHEN failed + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
           failed = CASE WHEN failed + 1 >= 5 THEN 0 ELSE failed + 1 END
     WHERE person_id = v_person;
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE app_private.password_credential SET failed = 0, locked_until = NULL WHERE person_id = v_person;
  IF v_c.must_change THEN RETURN jsonb_build_object('ok', true, 'must_change', true); END IF;
  SELECT * INTO v_s FROM app.staff_member s WHERE s.person_id = v_person AND s.active
   ORDER BY CASE s.role WHEN 'owner' THEN 0 WHEN 'location_manager' THEN 1 ELSE 2 END, s.created_at LIMIT 1;
  IF v_s.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  v_claims := app.session_claims(v_person, v_s.org_id, v_s.role);
  RETURN jsonb_build_object('ok', true, 'must_change', false, 'claims', v_claims,
                            'refresh', app.refresh_issue(v_person, v_s.org_id, v_s.role));
END $$;

-- Replace the password (first sign-in or by choice) and sign in. Wrong old password counts as a failed attempt.
CREATE FUNCTION app_public.password_change(p_email text, p_password text, p_new text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_first jsonb := app_public.password_login(p_email, p_password);
  v_person uuid;
BEGIN
  IF NOT coalesce((v_first ->> 'ok')::boolean, false) THEN RETURN v_first; END IF;
  IF NOT app.password_ok(p_email, p_new) OR p_new = p_password THEN
    RETURN jsonb_build_object('ok', false, 'weak', true);
  END IF;
  SELECT p.id INTO v_person FROM app.person p WHERE lower(p.email) = lower(btrim(p_email));
  UPDATE app_private.password_credential
     SET hash = app_private.crypt(p_new, app_private.gen_salt('bf', 10)), must_change = false, updated_at = now()
   WHERE person_id = v_person;
  -- Every session issued with the old password ends.
  UPDATE app_private.refresh_token SET revoked_at = now() WHERE person_id = v_person AND revoked_at IS NULL;
  RETURN app_public.password_login(p_email, p_new);
END $$;

-- Rotate a refresh token: the old one is revoked; claims are recomputed (a removed role ends the session).
CREATE FUNCTION app_public.session_refresh(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_r app_private.refresh_token;
  v_claims jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO v_r FROM app_private.refresh_token t WHERE t.token_hash = app.refresh_hash(p_token) FOR UPDATE;
  IF v_r.id IS NULL OR v_r.revoked_at IS NOT NULL OR v_r.expires_at <= now() THEN
    -- A revoked token presented again means it was copied: end every session of that person.
    IF v_r.id IS NOT NULL AND v_r.revoked_at IS NOT NULL THEN
      UPDATE app_private.refresh_token SET revoked_at = coalesce(revoked_at, now()) WHERE person_id = v_r.person_id;
    END IF;
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE app_private.refresh_token SET revoked_at = now() WHERE id = v_r.id;
  v_claims := app.session_claims(v_r.person_id, v_r.org_id, v_r.role);
  IF v_claims IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN jsonb_build_object('ok', true, 'claims', v_claims,
                            'refresh', app.refresh_issue(v_r.person_id, v_r.org_id, v_r.role));
END $$;

-- Member code sign-in (0024) now also returns a refresh token.
CREATE OR REPLACE FUNCTION app_public.login_verify(p_org uuid, p_email text, p_code text) RETURNS jsonb
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
                            'brand_name', v_m.brand_name,
                            'refresh', app.refresh_issue(v_person, p_org, 'member'));
END $$;

-- ── Owner: create staff accounts ─────────────────────────────────────────────────────────────────────────
-- New e-mails only. Location roles need a location of the org; owner and accountant are org-wide.
CREATE FUNCTION app.create_staff_account(p_email text, p_name text, p_role app.role_name, p_location uuid,
                                         p_password text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_person uuid;
  v_staff uuid;
BEGIN
  IF v_org IS NULL OR app.role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role IN ('member', 'guardian') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF p_role NOT IN ('owner', 'accountant') AND (p_location IS NULL OR NOT EXISTS (
       SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org)) THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- The initial password only has to be usable once: it must be changed at the first sign-in.
  IF p_password IS NULL OR length(p_password) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'invalid_password' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account:' || v_email, 0));
  SELECT p.id INTO v_person FROM app.person p WHERE lower(p.email) = v_email;
  IF v_person IS NOT NULL AND EXISTS (SELECT 1 FROM app_private.password_credential c WHERE c.person_id = v_person) THEN
    RAISE EXCEPTION 'account_exists' USING ERRCODE = '23505';
  END IF;
  IF v_person IS NULL THEN
    INSERT INTO app.person (email) VALUES (v_email) RETURNING id INTO v_person;
  END IF;
  INSERT INTO app.staff_member (org_id, person_id, role, display_name)
  VALUES (v_org, v_person, p_role, btrim(p_name))
  ON CONFLICT (org_id, person_id, role) DO UPDATE SET active = true
  RETURNING id INTO v_staff;
  IF p_role NOT IN ('owner', 'accountant') THEN
    INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES (v_org, v_staff, p_location)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO app_private.password_credential (person_id, hash, must_change, created_by)
  VALUES (v_person, app_private.crypt(p_password, app_private.gen_salt('bf', 10)), true, app.person_id());
  PERFORM app.audit('staff_account.create', 'staff_member', v_staff::text, p_location,
                    jsonb_build_object('role', p_role));
  RETURN v_staff;
END $$;

-- The org's staff for the owner's "Equipo" screen, with whether each person can sign in with a password.
CREATE FUNCTION app.staff_accounts()
RETURNS TABLE (staff_id uuid, person_id uuid, display_name text, email text, role app.role_name, active boolean,
               has_password boolean, must_change boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.person_id, s.display_name, p.email, s.role, s.active, c.person_id IS NOT NULL,
           coalesce(c.must_change, false)
      FROM app.staff_member s JOIN app.person p ON p.id = s.person_id
      LEFT JOIN app_private.password_credential c ON c.person_id = s.person_id
     WHERE s.org_id = app.org_id()
     ORDER BY CASE s.role WHEN 'owner' THEN 0 WHEN 'location_manager' THEN 1 ELSE 2 END, s.display_name;
END $$;

-- ── Ownership and grants ─────────────────────────────────────────────────────────────────────────────────
DO $own$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.refresh_hash(text)', 'app.refresh_issue(uuid, uuid, app.role_name)',
    'app.session_claims(uuid, uuid, app.role_name)', 'app_public.password_login(text, text)',
    'app_public.password_change(text, text, text)', 'app_public.session_refresh(text)',
    'app.create_staff_account(text, text, app.role_name, uuid, text)', 'app.staff_accounts()']
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_definer', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $own$;
GRANT EXECUTE ON FUNCTION app.password_ok(text, text) TO app_definer, app_authenticated;
GRANT EXECUTE ON FUNCTION app.refresh_hash(text), app.refresh_issue(uuid, uuid, app.role_name),
  app.session_claims(uuid, uuid, app.role_name) TO app_definer;
GRANT EXECUTE ON FUNCTION app.create_staff_account(text, text, app.role_name, uuid, text), app.staff_accounts()
  TO app_authenticated;
GRANT SELECT, INSERT ON app.person TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.staff_member TO app_definer;
GRANT SELECT, INSERT ON app.staff_location TO app_definer;
GRANT SELECT ON app.brand, app.location, app.member TO app_definer;

DO $grant$
DECLARE v_login text := CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN 'app_api' ELSE current_user END;
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION app_public.password_login(text, text), '
                 'app_public.password_change(text, text, text), app_public.session_refresh(text) TO %I', v_login);
END $grant$;
