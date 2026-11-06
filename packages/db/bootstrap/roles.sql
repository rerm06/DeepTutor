-- Run ONCE per cluster by a superuser (local script, CI service, or the managed provider's console).
-- Three roles, least privilege (spec §3.1):
--   app_owner         owns the schema; runs migrations only. Never used by the API or the agents.
--   app_authenticated NOLOGIN; the only role that holds table privileges for request traffic. RLS applies.
--   app_api           LOGIN NOINHERIT; holds nothing itself and must SET LOCAL ROLE app_authenticated
--                     inside each transaction, after the verified JWT claims are set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner LOGIN PASSWORD 'app_owner_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  -- Owns only the few SECURITY DEFINER functions that must look across RLS (e.g. "does this email
  -- already have a global Person?"). Each such function re-checks the caller's claims itself.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_definer') THEN
    CREATE ROLE app_definer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN PASSWORD 'app_api_dev' NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT app_authenticated TO app_api;
GRANT app_definer TO app_owner;  -- lets migrations hand function ownership to app_definer; BYPASSRLS is not inherited.
-- app_definer reaches rows through role-targeted policies (migration 0005), not BYPASSRLS, so local tests prove
-- the same model that runs on managed Postgres.
ALTER ROLE app_definer NOBYPASSRLS;
