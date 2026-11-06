-- The owner decides per account whether the next sign-in must replace the password (0026 always required it).
-- Turning the requirement off keeps the current password valid until the person changes it voluntarily
-- ("Cambiar mi contraseña"). The owner never sees or sets the password itself here. Audited.
CREATE FUNCTION app.set_password_change_required(p_staff uuid, p_required boolean) RETURNS boolean
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
  UPDATE app_private.password_credential SET must_change = coalesce(p_required, true), updated_at = now()
   WHERE person_id = v_person;
  PERFORM app.audit('staff_account.change_required', 'staff_member', p_staff::text, NULL,
                    jsonb_build_object('required', coalesce(p_required, true)));
  RETURN coalesce(p_required, true);
END $$;

ALTER FUNCTION app.set_password_change_required(uuid, boolean) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.set_password_change_required(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_password_change_required(uuid, boolean) TO app_authenticated;
