-- Netlify Database bootstrap (runs first, as the database owner — not a superuser).
-- Same role model as packages/db/bootstrap/roles.sql, minus the separate login roles: Netlify provides one owner
-- connection, so request traffic connects as the owner and drops to app_authenticated per transaction
-- (withClaims → SET LOCAL ROLE). app_definer reaches rows via role-targeted policies (migration 0005).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_definer') THEN
    CREATE ROLE app_definer NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT app_authenticated TO CURRENT_USER;
GRANT app_definer TO CURRENT_USER;
