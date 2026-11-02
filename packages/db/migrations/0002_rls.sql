-- E1 · Row-level security. FORCE so even the table owner is subject to policies outside migrations.
-- Rule of thumb: org isolation first, then location scope, then role.
-- Claim helpers are wrapped in (SELECT …) so Postgres evaluates them once per statement (initplan), not per row:
-- app.claims() verifies an HMAC, so per-row evaluation would be costly.
-- Writes are limited twice: by policy (which rows) and by column-level GRANTs (which columns). Security review
-- HIGH-2/HIGH-3: without column grants a front desk could repoint member.person_id and an owner could change
-- their own SaaS plan (and therefore the platform commission).

ALTER TABLE app.organization   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.organization   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.legal_entity   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.legal_entity   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.brand          ENABLE ROW LEVEL SECURITY; ALTER TABLE app.brand          FORCE ROW LEVEL SECURITY;
ALTER TABLE app.location       ENABLE ROW LEVEL SECURITY; ALTER TABLE app.location       FORCE ROW LEVEL SECURITY;
ALTER TABLE app.person         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.person         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.member         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.member         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_member   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.staff_member   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_location ENABLE ROW LEVEL SECURITY; ALTER TABLE app.staff_location FORCE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_link  ENABLE ROW LEVEL SECURITY; ALTER TABLE app.guardian_link  FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.audit_log      FORCE ROW LEVEL SECURITY;

-- organization: everyone sees their own org; only the owner edits it (name only, see grants).
CREATE POLICY org_select ON app.organization FOR SELECT USING (id = (SELECT app.org_id()));
CREATE POLICY org_update ON app.organization FOR UPDATE
  USING (id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (id = (SELECT app.org_id()));

-- legal_entity: staff read (needed for invoices and Stripe), owner writes.
CREATE POLICY le_select ON app.legal_entity FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.is_staff()));
CREATE POLICY le_insert ON app.legal_entity FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY le_update ON app.legal_entity FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

-- brand: everyone in the org reads it (the member PWA needs the theme); owner writes.
CREATE POLICY brand_select ON app.brand FOR SELECT USING (org_id = (SELECT app.org_id()));
CREATE POLICY brand_insert ON app.brand FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY brand_update ON app.brand FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

-- location: members and guardians see every location of their org (to book); staff only assigned ones.
CREATE POLICY loc_select ON app.location FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (NOT (SELECT app.is_staff()) OR (SELECT app.org_wide()) OR id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY loc_insert ON app.location FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY loc_update ON app.location FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

-- member: staff of the home location (owner/accountant: whole org), the member themself, their guardian.
CREATE POLICY member_select ON app.member FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    ((SELECT app.is_staff()) AND ((SELECT app.org_wide()) OR home_location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR person_id = (SELECT app.person_id())
    OR EXISTS (SELECT 1 FROM app.guardian_link g
               WHERE g.member_id = member.id AND g.guardian_person_id = (SELECT app.person_id()))
  ));
-- Inserts go through app.register_member() (definer); no direct INSERT grant.
CREATE POLICY member_update ON app.member FOR UPDATE
  USING (org_id = (SELECT app.org_id())
         AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
         AND ((SELECT app.org_wide()) OR home_location_id = ANY ((SELECT app.location_ids())::uuid[])))
  WITH CHECK (org_id = (SELECT app.org_id())
         AND ((SELECT app.org_wide()) OR home_location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- person (global identity: id + email only): yourself; staff see people linked to rows they can already see;
-- guardians see their ward. Created only by app.register_member(); never updated by request traffic
-- (the identity provider owns email changes).
CREATE POLICY person_select ON app.person FOR SELECT USING (
  id = (SELECT app.person_id())
  OR ((SELECT app.is_staff()) AND (
        EXISTS (SELECT 1 FROM app.member m WHERE m.person_id = person.id)        -- member RLS applies
     OR EXISTS (SELECT 1 FROM app.staff_member s WHERE s.person_id = person.id)  -- staff RLS applies
  ))
  OR EXISTS (SELECT 1 FROM app.member m
             JOIN app.guardian_link g ON g.member_id = m.id
             WHERE m.person_id = person.id AND g.guardian_person_id = (SELECT app.person_id())));

-- staff_member: org-wide roles see all staff; scoped staff see themselves, colleagues who share a location,
-- and the owners (escalation). Security review LOW-8. Owner writes.
CREATE POLICY staff_select ON app.staff_member FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    person_id = (SELECT app.person_id())
    OR ((SELECT app.is_staff()) AND (
          (SELECT app.org_wide())
       OR role = 'owner'
       OR EXISTS (SELECT 1 FROM app.staff_location sl
                  WHERE sl.staff_member_id = staff_member.id
                    AND sl.location_id = ANY ((SELECT app.location_ids())::uuid[]))))));
CREATE POLICY staff_insert ON app.staff_member FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY staff_update ON app.staff_member FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

CREATE POLICY staffloc_select ON app.staff_location FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.is_staff())
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY staffloc_insert ON app.staff_location FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY staffloc_delete ON app.staff_location FOR DELETE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');

-- guardian_link: the ward must be a member the caller can see (security review MEDIUM-6).
CREATE POLICY guardian_select ON app.guardian_link FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (guardian_person_id = (SELECT app.person_id())
       OR app.staff_can_see_member(member_id)));
CREATE POLICY guardian_insert ON app.guardian_link FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
  AND app.staff_can_see_member(member_id));

-- audit_log: written only by app.audit() / definer functions (actor and time forced server-side, security
-- review MEDIUM-5). Owner reads all; managers read their locations. No UPDATE/DELETE for anyone.
CREATE POLICY audit_select ON app.audit_log FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND ((SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))));

-- ── Grants: request traffic only through app_authenticated, column by column for writes.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_authenticated;

GRANT SELECT ON app.organization, app.legal_entity, app.brand, app.location, app.person, app.member,
  app.staff_member, app.staff_location, app.guardian_link, app.audit_log TO app_authenticated;

GRANT UPDATE (name) ON app.organization TO app_authenticated;                       -- saas_plan: platform only
GRANT INSERT (legal_name, hacienda_merchant_no) ON app.legal_entity TO app_authenticated;
GRANT UPDATE (legal_name, hacienda_merchant_no) ON app.legal_entity TO app_authenticated; -- stripe_account_id: onboarding path only
GRANT INSERT (legal_entity_id, name, theme, custom_domain) ON app.brand TO app_authenticated;
GRANT UPDATE (name, theme, custom_domain) ON app.brand TO app_authenticated;
GRANT INSERT (brand_id, legal_entity_id, name, timezone, municipality) ON app.location TO app_authenticated;
GRANT UPDATE (name, timezone, municipality) ON app.location TO app_authenticated;
GRANT UPDATE (status, member_no, home_location_id, full_name, phone) ON app.member TO app_authenticated; -- never person_id/org_id
GRANT INSERT (person_id, role, display_name, license_no) ON app.staff_member TO app_authenticated;
GRANT UPDATE (display_name, license_no, active) ON app.staff_member TO app_authenticated; -- license_verified_at: platform only
GRANT INSERT (staff_member_id, location_id), DELETE ON app.staff_location TO app_authenticated;
GRANT INSERT (guardian_person_id, member_id) ON app.guardian_link TO app_authenticated;
