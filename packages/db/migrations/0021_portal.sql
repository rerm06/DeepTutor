-- Module portal (member portal: home, progress, programs, nutrition, documents). Owned by the portal module agent;
-- see docs/modules.md and docs/modules/portal.md.
-- The portal READS what other modules own (check-ins and bookings from schedule, credits and invoices from billing,
-- circuit runs from floor, published care plans from health, challenges from engagement, agreements from signup)
-- under the caller's own RLS. It adds only two small tables:
--   * member_goal: the member's weekly training goal (1–14 trainings per local ISO week; 4 when no row exists).
--     Written ONLY through app.set_member_goal() by the member themself (a guardian reads, never writes);
--     read by the member, their guardian and staff of the member's home location (owner/accountant: org-wide).
--   * challenge_perk: the short list of what a challenge includes ("Entrenamiento guiado", …), shown on the
--     member home. Same visibility as the challenge; owner (any) / location manager (own location) maintain it.
-- Health rule: nothing here stores or exposes health data. Nutrition plans stay in care_plan (0010), authored and
-- approved by the licensed professional; the portal only shows the member their own PUBLISHED plan.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.member_goal (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid PRIMARY KEY,
  weekly_trainings integer NOT NULL CHECK (weekly_trainings BETWEEN 1 AND 14),
  updated_by uuid NOT NULL,                     -- person who set it (the member)
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, member_id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);

CREATE TABLE app.challenge_perk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  challenge_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
  -- Shown to every member: same content screen as rendered messages (no links, phones, health promises,
  -- regulated nutrition titles or exotic characters).
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 80 AND NOT app.has_forbidden_terms(label)),
  created_by uuid NOT NULL DEFAULT app.person_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (challenge_id, position),
  FOREIGN KEY (org_id, challenge_id) REFERENCES app.challenge (org_id, id)
);

-- ── Helpers (owned by app_definer: they read member / guardian_link without RLS but apply the rule explicitly) ──
-- The caller is the member themself (role member) or their guardian (role guardian). Never staff.
CREATE FUNCTION app.portal_self_or_ward(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p_member IS NOT NULL AND (
       EXISTS (SELECT 1 FROM app.member m
                WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id()
                  AND app.role() = 'member')
    OR EXISTS (SELECT 1 FROM app.guardian_link g
                WHERE g.member_id = p_member AND g.org_id = app.org_id()
                  AND g.guardian_person_id = app.person_id() AND app.role() = 'guardian'))
$$;

-- The member the caller acts for in the portal: a member gets their own row (p_member, when given, must be it);
-- a guardian gets the ward named by p_member, or their first ward when p_member is NULL. Staff and callers
-- without claims are refused. Returns NULL when p_member names someone the caller may not act for (→ 404).
CREATE FUNCTION app.portal_acting_member(p_member uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL OR v_role IS NULL OR v_role NOT IN ('member', 'guardian') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_member IS NOT NULL THEN
    RETURN CASE WHEN app.portal_self_or_ward(p_member) THEN p_member END;
  END IF;
  IF v_role = 'member' THEN
    SELECT m.id INTO v_id FROM app.member m WHERE m.org_id = v_org AND m.person_id = app.person_id();
  ELSE
    SELECT g.member_id INTO v_id FROM app.guardian_link g JOIN app.member m ON m.id = g.member_id
     WHERE g.org_id = v_org AND g.guardian_person_id = app.person_id()
     ORDER BY m.created_at, m.id LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN v_id;
END $$;

-- Set the caller's weekly training goal. Members only (a guardian reads the ward's goal but does not set it);
-- 1–14 trainings per week. Upsert, so two concurrent saves queue on the row and the last one wins; audited.
CREATE FUNCTION app.set_member_goal(p_weekly_trainings integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid;
  v_loc uuid;
  v_old integer;
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL OR app.role() IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.id, m.home_location_id INTO v_member, v_loc
    FROM app.member m WHERE m.org_id = v_org AND m.person_id = app.person_id();
  IF v_member IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_weekly_trainings IS NULL OR p_weekly_trainings NOT BETWEEN 1 AND 14 THEN
    RAISE EXCEPTION 'invalid_goal' USING ERRCODE = '22023';
  END IF;
  SELECT g.weekly_trainings INTO v_old FROM app.member_goal g WHERE g.member_id = v_member FOR UPDATE;
  INSERT INTO app.member_goal (org_id, member_id, weekly_trainings, updated_by, updated_at)
  VALUES (v_org, v_member, p_weekly_trainings, app.person_id(), now())
  ON CONFLICT (member_id) DO UPDATE
    SET weekly_trainings = EXCLUDED.weekly_trainings, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app.audit('member_goal.set', 'member_goal', v_member::text, v_loc,
                    jsonb_build_object('weekly_trainings', p_weekly_trainings, 'from', v_old));
  RETURN p_weekly_trainings;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.member_goal    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.member_goal    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_perk ENABLE ROW LEVEL SECURITY; ALTER TABLE app.challenge_perk FORCE ROW LEVEL SECURITY;

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.member_goal    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.challenge_perk TO app_definer USING (true) WITH CHECK (true);

-- member_goal: the member or their guardian; staff of the member's home location (owner/accountant: org-wide).
-- No INSERT/UPDATE/DELETE policy or grant: writes only through app.set_member_goal().
CREATE POLICY member_goal_select ON app.member_goal FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.portal_self_or_ward(member_id) OR app.staff_can_see_member(member_id)));

-- challenge_perk: whoever can see the challenge (the challenge's own RLS applies inside the subquery).
CREATE POLICY challenge_perk_select ON app.challenge_perk FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.challenge c WHERE c.id = challenge_perk.challenge_id));
-- Owner for any challenge; a location manager only for a challenge of one of their locations (never org-wide).
CREATE POLICY challenge_perk_insert ON app.challenge_perk FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id())
  AND created_by = (SELECT app.person_id())
  AND EXISTS (SELECT 1 FROM app.challenge c
               WHERE c.id = challenge_perk.challenge_id AND c.org_id = (SELECT app.org_id())
                 AND ((SELECT app.role()) = 'owner'
                      OR ((SELECT app.role()) = 'location_manager'
                          AND c.location_id = ANY ((SELECT app.location_ids())::uuid[])))));
CREATE POLICY challenge_perk_delete ON app.challenge_perk FOR DELETE TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.challenge c
               WHERE c.id = challenge_perk.challenge_id AND c.org_id = (SELECT app.org_id())
                 AND ((SELECT app.role()) = 'owner'
                      OR ((SELECT app.role()) = 'location_manager'
                          AND c.location_id = ANY ((SELECT app.location_ids())::uuid[])))));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.member_goal, app.challenge_perk FROM PUBLIC;
GRANT SELECT ON app.member_goal, app.challenge_perk TO app_authenticated;
-- Perks: column by column (never org_id, id, created_by, created_at); no UPDATE (replace = delete + insert).
GRANT INSERT (challenge_id, position, label), DELETE ON app.challenge_perk TO app_authenticated;
GRANT SELECT, INSERT, UPDATE ON app.member_goal TO app_definer;
GRANT SELECT ON app.challenge_perk TO app_definer;
GRANT SELECT ON app.member, app.guardian_link, app.location TO app_definer;

ALTER FUNCTION app.portal_self_or_ward(uuid) OWNER TO app_definer;
ALTER FUNCTION app.portal_acting_member(uuid) OWNER TO app_definer;
ALTER FUNCTION app.set_member_goal(integer) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.portal_self_or_ward(uuid), app.portal_acting_member(uuid), app.set_member_goal(integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.portal_self_or_ward(uuid), app.portal_acting_member(uuid), app.set_member_goal(integer)
  TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.portal_self_or_ward(uuid) TO app_definer;
