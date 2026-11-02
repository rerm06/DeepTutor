-- E1 · Row-level security. FORCE so even the table owner is subject to policies outside migrations.
-- Rule of thumb: org isolation first (org_id = app.org_id()), then location scope, then role.

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

-- organization: everyone sees their own org; only the owner edits it.
CREATE POLICY org_select ON app.organization FOR SELECT USING (id = app.org_id());
CREATE POLICY org_update ON app.organization FOR UPDATE
  USING (id = app.org_id() AND app.role() = 'owner') WITH CHECK (id = app.org_id());

-- legal_entity: staff read (needed for invoices and Stripe), owner writes.
CREATE POLICY le_select ON app.legal_entity FOR SELECT USING (org_id = app.org_id() AND app.is_staff());
CREATE POLICY le_insert ON app.legal_entity FOR INSERT WITH CHECK (org_id = app.org_id() AND app.role() = 'owner');
CREATE POLICY le_update ON app.legal_entity FOR UPDATE
  USING (org_id = app.org_id() AND app.role() = 'owner') WITH CHECK (org_id = app.org_id());

-- brand: everyone in the org reads it (the member PWA needs the theme); owner writes.
CREATE POLICY brand_select ON app.brand FOR SELECT USING (org_id = app.org_id());
CREATE POLICY brand_insert ON app.brand FOR INSERT WITH CHECK (org_id = app.org_id() AND app.role() = 'owner');
CREATE POLICY brand_update ON app.brand FOR UPDATE
  USING (org_id = app.org_id() AND app.role() = 'owner') WITH CHECK (org_id = app.org_id());

-- location: members and guardians see every location of their org (to book); staff only assigned ones.
CREATE POLICY loc_select ON app.location FOR SELECT
  USING (org_id = app.org_id() AND (NOT app.is_staff() OR app.can_see_location(id)));
CREATE POLICY loc_insert ON app.location FOR INSERT WITH CHECK (org_id = app.org_id() AND app.role() = 'owner');
CREATE POLICY loc_update ON app.location FOR UPDATE
  USING (org_id = app.org_id() AND app.role() = 'owner') WITH CHECK (org_id = app.org_id());

-- member: staff of the home location (owner/accountant: whole org), the member themself, their guardian.
CREATE POLICY member_select ON app.member FOR SELECT USING (
  org_id = app.org_id() AND (
    (app.is_staff() AND app.can_see_location(home_location_id))
    OR person_id = app.person_id()
    OR EXISTS (SELECT 1 FROM app.guardian_link g
               WHERE g.member_id = member.id AND g.guardian_person_id = app.person_id()
                 AND g.org_id = app.org_id())
  ));
CREATE POLICY member_insert ON app.member FOR INSERT WITH CHECK (
  org_id = app.org_id()
  AND app.role() IN ('owner', 'location_manager', 'front_desk')
  AND app.can_see_location(home_location_id));
CREATE POLICY member_update ON app.member FOR UPDATE
  USING (org_id = app.org_id() AND app.role() IN ('owner', 'location_manager', 'front_desk')
         AND app.can_see_location(home_location_id))
  WITH CHECK (org_id = app.org_id() AND app.can_see_location(home_location_id));

-- person (global): yourself; staff see people linked to their org (members of visible locations, colleagues);
-- guardians see their ward. Inserts only by front-of-house roles; updates only by the person themself.
CREATE POLICY person_select ON app.person FOR SELECT USING (
  id = app.person_id()
  OR (app.is_staff() AND (
        EXISTS (SELECT 1 FROM app.member m WHERE m.person_id = person.id)        -- member RLS applies
     OR EXISTS (SELECT 1 FROM app.staff_member s WHERE s.person_id = person.id)  -- staff RLS applies
  ))
  OR EXISTS (SELECT 1 FROM app.member m
             JOIN app.guardian_link g ON g.member_id = m.id
             WHERE m.person_id = person.id AND g.guardian_person_id = app.person_id()));
CREATE POLICY person_insert ON app.person FOR INSERT
  WITH CHECK (app.org_id() IS NOT NULL AND app.role() IN ('owner', 'location_manager', 'front_desk'));
CREATE POLICY person_update ON app.person FOR UPDATE
  USING (id = app.person_id()) WITH CHECK (id = app.person_id());

-- staff_member: staff see colleagues in their org; anyone sees their own staff rows; owner writes.
CREATE POLICY staff_select ON app.staff_member FOR SELECT
  USING (org_id = app.org_id() AND (app.is_staff() OR person_id = app.person_id()));
CREATE POLICY staff_insert ON app.staff_member FOR INSERT WITH CHECK (org_id = app.org_id() AND app.role() = 'owner');
CREATE POLICY staff_update ON app.staff_member FOR UPDATE
  USING (org_id = app.org_id() AND app.role() = 'owner') WITH CHECK (org_id = app.org_id());

CREATE POLICY staffloc_select ON app.staff_location FOR SELECT USING (org_id = app.org_id() AND app.is_staff());
CREATE POLICY staffloc_insert ON app.staff_location FOR INSERT WITH CHECK (org_id = app.org_id() AND app.role() = 'owner');
CREATE POLICY staffloc_delete ON app.staff_location FOR DELETE USING (org_id = app.org_id() AND app.role() = 'owner');

CREATE POLICY guardian_select ON app.guardian_link FOR SELECT
  USING (org_id = app.org_id() AND (app.is_staff() OR guardian_person_id = app.person_id()));
CREATE POLICY guardian_insert ON app.guardian_link FOR INSERT
  WITH CHECK (org_id = app.org_id() AND app.role() IN ('owner', 'location_manager', 'front_desk'));

-- audit_log: anyone authenticated appends rows for themself in their org; owner and managers read.
-- No UPDATE/DELETE policy and no grant → the trail is append-only for request traffic.
CREATE POLICY audit_insert ON app.audit_log FOR INSERT WITH CHECK (
  org_id = app.org_id() AND actor_person_id = app.person_id() AND actor_role = app.role());
CREATE POLICY audit_select ON app.audit_log FOR SELECT USING (
  org_id = app.org_id() AND (app.role() = 'owner'
    OR (app.role() = 'location_manager' AND location_id = ANY (app.location_ids()))));

-- ── Grants: request traffic only through app_authenticated.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_authenticated;
GRANT SELECT, INSERT, UPDATE ON app.organization, app.legal_entity, app.brand, app.location,
  app.person, app.member, app.staff_member, app.guardian_link TO app_authenticated;
GRANT SELECT, INSERT, DELETE ON app.staff_location TO app_authenticated;
GRANT SELECT, INSERT ON app.audit_log TO app_authenticated;
