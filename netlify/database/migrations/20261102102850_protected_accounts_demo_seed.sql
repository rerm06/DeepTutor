-- PRODUCTION data (not demo): the real organisation and its accounts. Idempotent. Runs as the schema owner after
-- the demo seeds; lifts FORCE RLS only on the tables it writes and restores it at the end.
--   * Operator setting: the demo PII guard is OFF (online sign-up accepts real e-mails and phones).
--   * Organisation "Fitness R Us" (pro) with one location: Toa Baja. The brand reuses the Fitness R Us look of the
--     demo brand (logo, colours, images). No members, plans, prices or history are created: the owner sets them up.
--   * Accounts (only when the people exist, i.e. on the deployed database where the owner created them):
--       rerm06@gmail.com        PROTECTED, every staff role (owner … accountant), location roles at Toa Baja.
--       nmaysonet1811@gmail.com owner.
--     Their passwords stay as they are and no change is required until they choose to change them. Their staff
--     rows in the demo organisations are deactivated so they always sign in to production.
DO $prod$
DECLARE
  v_org constant uuid := 'f1000000-0000-4000-8000-000000000001';
  v_le constant uuid := 'f1000000-0000-4000-8000-000000000002';
  v_brand constant uuid := 'f1000000-0000-4000-8000-000000000003';
  v_loc constant uuid := 'f1000000-0000-4000-8000-000000000011';
  v_demo_brand constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_root uuid;
  v_owner2 uuid;
  v_staff uuid;
  r text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization', 'legal_entity', 'brand', 'location', 'join_location', 'staff_member',
                           'staff_location', 'person'] LOOP
    EXECUTE format('ALTER TABLE app.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  INSERT INTO app_private.setting (key, value) VALUES ('pii_guard', 'false')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  INSERT INTO app.organization (id, name, saas_plan) VALUES (v_org, 'Fitness R Us', 'pro') ON CONFLICT (id) DO NOTHING;
  INSERT INTO app.legal_entity (id, org_id, legal_name) VALUES (v_le, v_org, 'Fitness R Us')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO app.brand (id, org_id, legal_entity_id, name, theme)
  VALUES (v_brand, v_org, v_le, 'Fitness R Us',
          coalesce((SELECT b.theme FROM app.brand b WHERE b.id = v_demo_brand), '{}'::jsonb))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO app.location (id, org_id, brand_id, legal_entity_id, name, municipality)
  VALUES (v_loc, v_org, v_brand, v_le, 'Fitness R Us Toa Baja', 'Toa Baja')
  ON CONFLICT (id) DO NOTHING;

  SELECT p.id INTO v_root FROM app.person p WHERE lower(p.email) = 'rerm06@gmail.com';
  SELECT p.id INTO v_owner2 FROM app.person p WHERE lower(p.email) = 'nmaysonet1811@gmail.com';

  IF v_root IS NOT NULL THEN
    UPDATE app.staff_member SET active = false WHERE person_id = v_root AND org_id <> v_org;
    INSERT INTO app_private.protected_person (person_id) VALUES (v_root) ON CONFLICT DO NOTHING;
    FOREACH r IN ARRAY ARRAY['owner', 'location_manager', 'front_desk', 'trainer', 'nutritionist', 'chef',
                             'clinician', 'accountant'] LOOP
      INSERT INTO app.staff_member (org_id, person_id, role, display_name)
      VALUES (v_org, v_root, r::app.role_name, 'rerm06')
      ON CONFLICT (org_id, person_id, role) DO UPDATE SET active = true
      RETURNING id INTO v_staff;
      IF r NOT IN ('owner', 'accountant') THEN
        INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES (v_org, v_staff, v_loc)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    UPDATE app_private.password_credential SET must_change = false, updated_at = now() WHERE person_id = v_root;
  END IF;

  IF v_owner2 IS NOT NULL THEN
    UPDATE app.staff_member SET active = false WHERE person_id = v_owner2 AND org_id <> v_org;
    INSERT INTO app.staff_member (org_id, person_id, role, display_name)
    VALUES (v_org, v_owner2, 'owner', 'nmaysonet1811')
    ON CONFLICT (org_id, person_id, role) DO UPDATE SET active = true;
    UPDATE app_private.password_credential SET must_change = false, updated_at = now() WHERE person_id = v_owner2;
  END IF;

  -- Online sign-up open at Toa Baja (needs a person for the audit column: the protected owner when present).
  IF coalesce(v_root, v_owner2) IS NOT NULL THEN
    INSERT INTO app.join_location (org_id, location_id, enabled, updated_by, updated_at)
    VALUES (v_org, v_loc, true, coalesce(v_root, v_owner2), now())
    ON CONFLICT (location_id) DO NOTHING;
  END IF;

  FOREACH t IN ARRAY ARRAY['organization', 'legal_entity', 'brand', 'location', 'join_location', 'staff_member',
                           'staff_location', 'person'] LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $prod$;
