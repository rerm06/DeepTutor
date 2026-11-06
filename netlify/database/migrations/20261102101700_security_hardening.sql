-- Security hardening after the independent review of the money modules (billing, store, engagement).
-- Fixes to module migrations that were never deployed live next to the code they fix (marked "Security review" in
-- 0006/0009/0012/0013/0007). Migrations 0000-0005 are already applied in production and are never edited: their
-- fixes go here as forward changes.

-- L6 (0002 is applied): request traffic loses table-wide SELECT on organization and keeps only these columns, so
-- organization.saas_plan (the platform fee rate) is not readable through RLS'd queries.
REVOKE SELECT ON app.organization FROM app_authenticated;
GRANT SELECT (id, name, created_at) ON app.organization TO app_authenticated;

-- L6: organization.saas_plan is not a readable column for request traffic (it reveals the platform fee rate).
-- Staff read the plan through this function; members and guardians get NULL.
CREATE FUNCTION app.org_saas_plan() RETURNS app.saas_plan
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT o.saas_plan FROM app.organization o
   WHERE o.id = app.org_id() AND app.is_staff()
$$;
ALTER FUNCTION app.org_saas_plan() OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.org_saas_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_saas_plan() TO app_authenticated;

-- Security review (health/finance/schedule) M3: changing a licence number invalidates its verification, so a care
-- plan can never be approved under a licence nobody verified. Re-verification is a platform step.
CREATE FUNCTION app.staff_license_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.license_no IS DISTINCT FROM OLD.license_no AND NEW.license_verified_at IS NOT DISTINCT FROM OLD.license_verified_at THEN
    NEW.license_verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_license_guard BEFORE UPDATE OF license_no ON app.staff_member
  FOR EACH ROW EXECUTE FUNCTION app.staff_license_guard();
