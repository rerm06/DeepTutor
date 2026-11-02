-- DEMO seed for module reports (spec E13). Synthetic data only ("Demo", @demo.invalid). Runs as the schema owner
-- after the core demo seed and the wave-A module seeds; uses the core UUIDs (packages/shared/src/demo.ts,
-- packages/db/seed/demo.sql). Idempotent: does nothing when the demo org is missing or this module was already
-- seeded. FORCE RLS is lifted only on this module's table for the duration of the seed and restored at the end.
-- Module UUID namespace: ...-8014-... (org A: a0000000-…, org B: b0000000-…).
--
-- Every panel and report figure is computed live from the other modules' demo rows; the only data this module
-- owns is the owner's record of SURI participation per municipality. Demo values only: whether a real
-- municipality files through SURI (SC 2915) must be confirmed with a CPA [VERIFICAR · SC 2915 format, CPA].
-- Bayamón (org A) is intentionally left unrecorded so the IVU report shows the "sin verificar" flag.
DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = 'a0000000-0000-4000-8000-000000000001') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.ivu_municipality WHERE id = 'a0000000-0000-4000-8014-000000000001') THEN RETURN; END IF;
  ALTER TABLE app.ivu_municipality NO FORCE ROW LEVEL SECURITY;

  INSERT INTO app.ivu_municipality (id, org_id, municipality, suri_status, note, updated_by, updated_at) VALUES
    ('a0000000-0000-4000-8014-000000000001', 'a0000000-0000-4000-8000-000000000001', 'San Juan', 'participant',
     'Demo: registrado por la dueña; confirmar con CPA', 'a0000000-0000-4000-8000-000000000101',
     now() - interval '20 days');

  IF EXISTS (SELECT 1 FROM app.organization WHERE id = 'b0000000-0000-4000-8000-000000000001') THEN
    INSERT INTO app.ivu_municipality (id, org_id, municipality, suri_status, note, updated_by, updated_at) VALUES
      ('b0000000-0000-4000-8014-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Ponce', 'participant',
       'Demo: confirmar con CPA', 'b0000000-0000-4000-8000-000000000101', now() - interval '12 days');
  END IF;

  ALTER TABLE app.ivu_municipality FORCE ROW LEVEL SECURITY;
END
$seed$;
