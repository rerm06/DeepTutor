-- Demo seed for module signup ("Únete"). SYNTHETIC data only ("Demo", @demo.invalid); idempotent; see
-- docs/modules/signup.md. Runs as the schema owner after the core and module demo seeds. FORCE RLS is lifted only on
-- the signup tables while seeding and restored at the end; no core table is written (new online members are created
-- by visitors through the public form, never by the seed).
--   * Org A (Fitness R Us): both locations accept online sign-ups. Org B (Demo Club Sur): Ponce does.
--   * Existing demo members carry the terms and liability release they signed at the front desk (Diego is a minor:
--     his guardian Rosa Méndez signed for him).
--   * Two old "existing e-mail" attempts (outside the one-hour cap window) feed the owner's abuse view.
DO $seed$
DECLARE
  v_org constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_loc1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  v_loc2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  v_owner_p constant uuid := 'a0000000-0000-4000-8000-000000000101';
  v_rosa_p constant uuid := 'a0000000-0000-4000-8000-000000000120';
  v_org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_loc_b constant uuid := 'b0000000-0000-4000-8000-000000000011';
  v_owner_b constant uuid := 'b0000000-0000-4000-8000-000000000101';
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = v_org) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.join_location WHERE location_id = v_loc1) THEN RETURN; END IF;

  ALTER TABLE app.join_location NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.member_agreement NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.join_attempt NO FORCE ROW LEVEL SECURITY;

  INSERT INTO app.join_location (org_id, location_id, enabled, updated_by, updated_at) VALUES
    (v_org, v_loc1, true, v_owner_p, now() - interval '10 days'),
    (v_org, v_loc2, true, v_owner_p, now() - interval '10 days');
  IF EXISTS (SELECT 1 FROM app.location WHERE id = v_loc_b) THEN
    INSERT INTO app.join_location (org_id, location_id, enabled, updated_by, updated_at)
    VALUES (v_org_b, v_loc_b, true, v_owner_b, now() - interval '8 days');
  END IF;

  -- Paper agreements recorded at the front desk for the existing demo members (source front_desk).
  FOR r IN
    SELECT m.id, m.org_id, m.person_id, m.created_at FROM app.member m
     WHERE m.id IN ('a0000000-0000-4000-8000-000000000210', 'a0000000-0000-4000-8000-000000000211',
                    'a0000000-0000-4000-8000-000000000212', 'a0000000-0000-4000-8000-000000000215',
                    'a0000000-0000-4000-8000-000000000216', 'b0000000-0000-4000-8000-000000000210')
  LOOP
    INSERT INTO app.member_agreement (org_id, member_id, kind, version, locale, source, accepted_by, evidence, accepted_at)
    VALUES (r.org_id, r.id, 'terms', 'v2026-11', 'es', 'front_desk', r.person_id, 'Demo: firmado en papel en recepción', r.created_at),
           (r.org_id, r.id, 'waiver', 'v2026-11', 'es', 'front_desk', r.person_id, 'Demo: firmado en papel en recepción', r.created_at);
  END LOOP;
  IF EXISTS (SELECT 1 FROM app.member WHERE id = 'a0000000-0000-4000-8000-000000000230') THEN
    INSERT INTO app.member_agreement (org_id, member_id, kind, version, locale, source, accepted_by, evidence)
    VALUES (v_org, 'a0000000-0000-4000-8000-000000000230', 'terms', 'v2026-11', 'es', 'front_desk', v_rosa_p,
            'Demo: menor de edad; firmó su tutora en recepción'),
           (v_org, 'a0000000-0000-4000-8000-000000000230', 'waiver', 'v2026-11', 'es', 'front_desk', v_rosa_p,
            'Demo: menor de edad; firmó su tutora en recepción');
  END IF;

  INSERT INTO app.join_attempt (org_id, location_id, outcome, at) VALUES
    (v_org, v_loc1, 'existing', now() - interval '3 days'),
    (v_org, v_loc2, 'existing', now() - interval '26 hours');
  IF EXISTS (SELECT 1 FROM app.location WHERE id = v_loc_b) THEN
    INSERT INTO app.join_attempt (org_id, location_id, outcome, at) VALUES (v_org_b, v_loc_b, 'existing', now() - interval '2 days');
  END IF;

  ALTER TABLE app.join_location FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.member_agreement FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.join_attempt FORCE ROW LEVEL SECURITY;
END $seed$;
