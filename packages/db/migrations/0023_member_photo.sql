-- Member photo (identification at the front desk). One small JPEG/WebP per member, taken with the camera from the
-- public join page, the member portal or the front desk. Not a biometric template: the image is only SHOWN to staff
-- next to a check-in; nothing here extracts or compares facial features [VERIFICAR · legal: Ley 81-2019 / consent copy].
--   * Written ONLY through app.set_member_photo() / app.clear_member_photo():
--       - the member themself (role member, own row);
--       - front-desk roles of the member's home location (owner org-wide, location_manager, front_desk), who attest
--         that the member consented in person (consent_version is required either way).
--     A guardian reads the ward's photo but does not replace it; trainers and other staff never write.
--   * Read by the member, their guardian, and owner / location_manager / front_desk / trainer of the member's home
--     location (owner org-wide). Accountant, nutritionist, clinician and chef do not need it and do not see it.
--   * Size and type are enforced here (1 KiB–150 KiB, JPEG or WebP magic bytes), not only in the API.
--   * Every change is audited WITHOUT the image (bytes, mime, consent version, role).

-- ── Table ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.member_photo (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid PRIMARY KEY,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1024 AND 153600),
  consent_version text NOT NULL CHECK (consent_version ~ '^photo-v[0-9]{1,3}$'),
  taken_by uuid NOT NULL,
  taken_by_role app.role_name NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  -- The declared type must match the bytes: JPEG starts FF D8 FF; WebP is RIFF....WEBP.
  CONSTRAINT member_photo_magic CHECK (
       (mime = 'image/jpeg' AND substring(data FROM 1 FOR 3) = '\xffd8ff'::bytea)
    OR (mime = 'image/webp' AND substring(data FROM 1 FOR 4) = '\x52494646'::bytea
                            AND substring(data FROM 9 FOR 4) = '\x57454250'::bytea))
);

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────
-- Who may READ a member's photo (used by the RLS policy). Owned by app_definer: reads member without RLS but applies
-- the rule explicitly.
CREATE FUNCTION app.photo_can_see(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p_member IS NOT NULL AND (
       app.portal_self_or_ward(p_member)
    OR (app.role() IN ('owner', 'location_manager', 'front_desk', 'trainer') AND app.staff_can_see_member(p_member)))
$$;

-- Resolve the member a WRITE targets and check the caller may write it. p_member NULL = the caller's own row
-- (members only). Returns (member_id, home_location_id); raises forbidden otherwise.
CREATE FUNCTION app.photo_write_target(p_member uuid, OUT o_member uuid, OUT o_location uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'member' THEN
    SELECT m.id, m.home_location_id INTO o_member, o_location
      FROM app.member m WHERE m.org_id = v_org AND m.person_id = app.person_id();
    IF o_member IS NULL OR (p_member IS NOT NULL AND p_member <> o_member) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  IF v_role NOT IN ('owner', 'location_manager', 'front_desk') OR p_member IS NULL
     OR NOT app.staff_can_see_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.id, m.home_location_id INTO o_member, o_location FROM app.member m WHERE m.id = p_member;
END $$;

-- Store (or replace) the photo. Returns the stored timestamp. Invalid size/type → invalid_photo (22023).
CREATE FUNCTION app.set_member_photo(p_member uuid, p_mime text, p_data bytea, p_consent_version text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_member uuid;
  v_loc uuid;
  v_at timestamptz := now();
  v_had boolean;
BEGIN
  SELECT o_member, o_location INTO v_member, v_loc FROM app.photo_write_target(p_member);
  IF p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/webp') OR p_data IS NULL
     OR octet_length(p_data) NOT BETWEEN 1024 AND 153600 THEN
    RAISE EXCEPTION 'invalid_photo' USING ERRCODE = '22023';
  END IF;
  IF p_consent_version IS NULL OR p_consent_version !~ '^photo-v[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'photo_consent_required' USING ERRCODE = '22023';
  END IF;
  IF NOT ((p_mime = 'image/jpeg' AND substring(p_data FROM 1 FOR 3) = '\xffd8ff'::bytea)
       OR (p_mime = 'image/webp' AND substring(p_data FROM 1 FOR 4) = '\x52494646'::bytea
                                 AND substring(p_data FROM 9 FOR 4) = '\x57454250'::bytea)) THEN
    RAISE EXCEPTION 'invalid_photo' USING ERRCODE = '22023';
  END IF;
  SELECT true INTO v_had FROM app.member_photo WHERE member_id = v_member FOR UPDATE;
  INSERT INTO app.member_photo (org_id, member_id, mime, data, consent_version, taken_by, taken_by_role, updated_at)
  VALUES (app.org_id(), v_member, p_mime, p_data, p_consent_version, app.person_id(), app.role(), v_at)
  ON CONFLICT (member_id) DO UPDATE
    SET mime = EXCLUDED.mime, data = EXCLUDED.data, consent_version = EXCLUDED.consent_version,
        taken_by = EXCLUDED.taken_by, taken_by_role = EXCLUDED.taken_by_role, updated_at = EXCLUDED.updated_at;
  PERFORM app.audit(CASE WHEN v_had THEN 'member_photo.replace' ELSE 'member_photo.set' END,
                    'member_photo', v_member::text, v_loc,
                    jsonb_build_object('bytes', octet_length(p_data), 'mime', p_mime,
                                       'consent_version', p_consent_version));
  RETURN v_at;
END $$;

-- Remove the photo (withdrawal of consent or a bad picture). Returns true when a photo existed.
CREATE FUNCTION app.clear_member_photo(p_member uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_member uuid;
  v_loc uuid;
  v_n integer;
BEGIN
  SELECT o_member, o_location INTO v_member, v_loc FROM app.photo_write_target(p_member);
  DELETE FROM app.member_photo WHERE member_id = v_member;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM app.audit('member_photo.clear', 'member_photo', v_member::text, v_loc, '{}'::jsonb);
  END IF;
  RETURN v_n > 0;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.member_photo ENABLE ROW LEVEL SECURITY; ALTER TABLE app.member_photo FORCE ROW LEVEL SECURITY;
CREATE POLICY definer_all ON app.member_photo TO app_definer USING (true) WITH CHECK (true);
-- No INSERT/UPDATE/DELETE policy or grant for request traffic: writes only through the functions above.
CREATE POLICY member_photo_select ON app.member_photo FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND app.photo_can_see(member_id));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.member_photo FROM PUBLIC;
GRANT SELECT ON app.member_photo TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.member_photo TO app_definer;
GRANT SELECT ON app.member, app.guardian_link TO app_definer;

ALTER FUNCTION app.photo_can_see(uuid) OWNER TO app_definer;
ALTER FUNCTION app.photo_write_target(uuid) OWNER TO app_definer;
ALTER FUNCTION app.set_member_photo(uuid, text, bytea, text) OWNER TO app_definer;
ALTER FUNCTION app.clear_member_photo(uuid) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.photo_can_see(uuid), app.photo_write_target(uuid),
  app.set_member_photo(uuid, text, bytea, text), app.clear_member_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.photo_can_see(uuid), app.set_member_photo(uuid, text, bytea, text),
  app.clear_member_photo(uuid) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.photo_write_target(uuid), app.portal_self_or_ward(uuid),
  app.staff_can_see_member(uuid) TO app_definer;
