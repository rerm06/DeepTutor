-- Security hardening after the independent review of the money modules (billing, store, engagement).
-- Most fixes live next to the code they fix (marked "Security review" in 0002/0006/0009/0012); this file adds the
-- pieces that are new objects.

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
