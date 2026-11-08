-- Portability for managed Postgres (Netlify Database / Neon), where creating a BYPASSRLS role is not guaranteed.
-- app_definer no longer relies on the BYPASSRLS attribute: it reaches rows through role-targeted policies that
-- apply ONLY to app_definer. Request traffic runs as app_authenticated and never matches these policies, and
-- app_authenticated cannot SET ROLE app_definer (it is not a member). Security is unchanged; portability improves.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('CREATE POLICY definer_all ON app.%I TO app_definer USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Secrets generated inside the database, readable only by the owner (system path at API start-up) and, for the
-- claims key, by app_definer through app.claims(). Nothing secret lives in the repository or in env files.
CREATE TABLE app_private.jwt_secret (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret bytea NOT NULL CHECK (length(secret) >= 32)
);
INSERT INTO app_private.jwt_secret (secret) VALUES (app_private.gen_random_bytes(32));
INSERT INTO app_private.claims_key (key)
  SELECT app_private.gen_random_bytes(32) WHERE NOT EXISTS (SELECT 1 FROM app_private.claims_key);
REVOKE ALL ON app_private.jwt_secret FROM PUBLIC;
