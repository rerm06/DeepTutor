-- Module crm · E9 leads, pipeline, activities, tasks and lead → member conversion (spec E9, §7 retention).
-- Owned by the crm module agent; see docs/modules.md and docs/modules/crm.md.
--
-- Rules
--  * Leads are managed by front-of-house roles (owner, location_manager, front_desk) at their locations.
--    Trainers see only the tasks assigned to them. Accountant, chef, clinical roles, members and guardians: nothing.
--  * Capturing a lead NEVER creates messaging consent: consent stays in the E8 model (app.consent / set_consent).
--  * A lead becomes a member only through app.convert_lead(), which calls app.register_member() and links the row.
--    `stage = 'won'` is impossible without `member_id` (CHECK), and member_id is not writable by request traffic.
--  * Every stage change is logged as an append-only `stage_change` activity and audited, by trigger, so no request
--    path can forget it or forge it. Task status changes are audited by trigger as well.

CREATE TYPE app.crm_lead_source AS ENUM ('web', 'whatsapp', 'instagram', 'referral', 'walk_in', 'other');
CREATE TYPE app.crm_lead_stage AS ENUM ('new', 'contacted', 'tour_booked', 'trial', 'won', 'lost');
CREATE TYPE app.crm_activity_kind AS ENUM ('call', 'message', 'tour', 'note', 'stage_change');
CREATE TYPE app.crm_task_status AS ENUM ('open', 'done', 'cancelled');

CREATE TABLE app.lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  source app.crm_lead_source NOT NULL,
  stage app.crm_lead_stage NOT NULL DEFAULT 'new',
  lost_reason text CHECK (length(lost_reason) BETWEEN 1 AND 300 AND lost_reason !~ '[[:cntrl:]]'),
  owner_staff_id uuid,
  -- No control characters in single-line fields: the name becomes member.full_name on conversion.
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200 AND full_name !~ '[[:cntrl:]]'),
  email text CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text CHECK (phone ~ '^\+?[0-9 ().-]{7,20}$'),
  notes text CHECK (length(notes) <= 2000),
  member_id uuid,
  created_by uuid NOT NULL DEFAULT app.person_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, owner_staff_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  -- 'won' only through app.convert_lead (which links the member); a linked lead is always 'won'.
  CONSTRAINT lead_won_iff_member CHECK ((stage = 'won') = (member_id IS NOT NULL)),
  -- 'lost' needs a reason; any other stage carries none.
  CONSTRAINT lead_lost_reason CHECK ((stage = 'lost') = (lost_reason IS NOT NULL)),
  -- A lead must be reachable somehow (walk-ins may leave only a phone).
  CONSTRAINT lead_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX lead_org_location_stage_idx ON app.lead (org_id, location_id, stage);
CREATE INDEX lead_created_idx ON app.lead (org_id, created_at);
-- A member is the conversion of at most one lead.
CREATE UNIQUE INDEX lead_member_uq ON app.lead (member_id) WHERE member_id IS NOT NULL;

-- Append-only timeline. `stage_change` rows are written only by the lead trigger (never by request traffic).
CREATE TABLE app.lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  lead_id uuid NOT NULL,
  kind app.crm_activity_kind NOT NULL,
  body text CHECK (length(body) <= 2000),
  from_stage app.crm_lead_stage,
  to_stage app.crm_lead_stage,
  at timestamptz NOT NULL DEFAULT now(),
  by_person_id uuid NOT NULL DEFAULT app.person_id(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, lead_id) REFERENCES app.lead (org_id, id),
  CHECK ((kind = 'stage_change') = (to_stage IS NOT NULL)),
  CHECK (kind = 'stage_change' OR length(btrim(body)) >= 1)
);
CREATE INDEX lead_activity_lead_idx ON app.lead_activity (lead_id, at DESC);

CREATE TABLE app.crm_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200 AND title !~ '[[:cntrl:]]'),
  due_at timestamptz NOT NULL,
  status app.crm_task_status NOT NULL DEFAULT 'open',
  assigned_staff_id uuid NOT NULL,
  lead_id uuid,
  member_id uuid,
  created_by uuid NOT NULL DEFAULT app.person_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, assigned_staff_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, lead_id) REFERENCES app.lead (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CONSTRAINT crm_task_one_subject CHECK (num_nonnulls(lead_id, member_id) <= 1),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX crm_task_assignee_idx ON app.crm_task (assigned_staff_id, status, due_at);
CREATE INDEX crm_task_location_idx ON app.crm_task (org_id, location_id, status, due_at);
CREATE INDEX crm_task_member_idx ON app.crm_task (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX crm_task_lead_idx ON app.crm_task (lead_id) WHERE lead_id IS NOT NULL;

-- ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Roles that manage leads and tasks (front of house).
CREATE FUNCTION app.crm_is_manager() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'front_desk'), false)
$$;
-- The caller's own staff_member ids in the current org (staff_member RLS lets everyone see themselves).
CREATE FUNCTION app.crm_my_staff_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array(SELECT s.id FROM app.staff_member s
                         WHERE s.person_id = app.person_id() AND s.org_id = app.org_id()), '{}'::uuid[])
$$;

-- Staff that may own a lead (front of house) or be assigned a task (front of house + trainer) at a location: active,
-- same org, one of p_roles, and either an owner (org-wide) or assigned to that location. Roles that can never see a
-- lead or a task (chef, accountant, clinical roles) are therefore never owners or assignees.
-- Definer: reads staff rows the caller may not see, returns only a boolean.
CREATE FUNCTION app.crm_staff_at_location(p_staff uuid, p_location uuid, p_roles app.role_name[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.staff_member s
     WHERE s.id = p_staff AND s.org_id = app.org_id() AND s.active
       AND s.role = ANY (p_roles)
       AND (s.role = 'owner' OR EXISTS (SELECT 1 FROM app.staff_location sl
                                          WHERE sl.staff_member_id = s.id AND sl.location_id = p_location)))
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.lead          ENABLE ROW LEVEL SECURITY; ALTER TABLE app.lead          FORCE ROW LEVEL SECURITY;
ALTER TABLE app.lead_activity ENABLE ROW LEVEL SECURITY; ALTER TABLE app.lead_activity FORCE ROW LEVEL SECURITY;
ALTER TABLE app.crm_task      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.crm_task      FORCE ROW LEVEL SECURITY;

-- lead: front of house at the lead's location (owner: whole org). No DELETE: leads are closed as 'lost'.
CREATE POLICY lead_select ON app.lead FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY lead_insert ON app.lead FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY lead_update ON app.lead FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
         AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
         AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- lead_activity: visible when the lead is (lead RLS applies inside the subquery; no recursion: lead's policies
-- never read lead_activity). Request traffic may add call/message/tour/note only; no UPDATE/DELETE.
CREATE POLICY lead_activity_select ON app.lead_activity FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.lead l WHERE l.id = lead_activity.lead_id));
CREATE POLICY lead_activity_insert ON app.lead_activity FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
  AND kind IN ('call', 'message', 'tour', 'note')
  AND by_person_id = (SELECT app.person_id())
  AND EXISTS (SELECT 1 FROM app.lead l WHERE l.id = lead_activity.lead_id));

-- crm_task: managers at the task's location; trainers only tasks assigned to them; every other role nothing.
CREATE POLICY crm_task_select ON app.crm_task FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.is_staff()) AND (
    ((SELECT app.crm_is_manager())
       AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR ((SELECT app.role()) = 'trainer' AND assigned_staff_id = ANY ((SELECT app.crm_my_staff_ids())::uuid[]))));
CREATE POLICY crm_task_insert ON app.crm_task FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.crm_is_manager())
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY crm_task_update ON app.crm_task FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (
    ((SELECT app.crm_is_manager())
       AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR ((SELECT app.role()) = 'trainer' AND assigned_staff_id = ANY ((SELECT app.crm_my_staff_ids())::uuid[]))))
  WITH CHECK (org_id = (SELECT app.org_id()) AND (
    ((SELECT app.crm_is_manager())
       AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR ((SELECT app.role()) = 'trainer' AND assigned_staff_id = ANY ((SELECT app.crm_my_staff_ids())::uuid[]))));

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.lead          TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.lead_activity TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.crm_task      TO app_definer USING (true) WITH CHECK (true);

-- ── Triggers (definer: validate cross-row rules the caller cannot see, log and audit) ──────────────────────────
-- System paths (migrations, demo seed, test fixtures) run without claims and skip validation; request traffic
-- always carries claims, and without them every policy above denies anyway.
CREATE FUNCTION app.crm_lead_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A converted lead is closed: it cannot be reopened or moved back (the member already exists).
    IF OLD.stage = 'won' AND NEW.stage IS DISTINCT FROM 'won' THEN
      RAISE EXCEPTION 'lead_converted' USING ERRCODE = '22023';
    END IF;
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN NEW.stage_changed_at := now(); END IF;
    NEW.updated_at := now();
  END IF;
  -- Leaving 'lost' clears the reason; entering it requires one (lead_lost_reason CHECK backs this up).
  IF NEW.stage <> 'lost' THEN NEW.lost_reason := NULL; END IF;
  IF NEW.stage = 'lost' AND coalesce(btrim(NEW.lost_reason), '') = '' THEN
    RAISE EXCEPTION 'lost_reason_required' USING ERRCODE = '22023';
  END IF;
  IF NEW.owner_staff_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.owner_staff_id IS DISTINCT FROM OLD.owner_staff_id OR NEW.location_id IS DISTINCT FROM OLD.location_id)
     AND NOT app.crm_staff_at_location(NEW.owner_staff_id, NEW.location_id,
                                       '{owner,location_manager,front_desk}'::app.role_name[]) THEN
    RAISE EXCEPTION 'invalid_owner' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_guard BEFORE INSERT OR UPDATE ON app.lead FOR EACH ROW EXECUTE FUNCTION app.crm_lead_guard();

CREATE FUNCTION app.crm_lead_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app.audit('lead.create', 'lead', NEW.id::text, NEW.location_id,
                      jsonb_build_object('source', NEW.source, 'stage', NEW.stage));
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO app.lead_activity (org_id, lead_id, kind, body, from_stage, to_stage, at, by_person_id)
    VALUES (NEW.org_id, NEW.id, 'stage_change', NEW.lost_reason, OLD.stage, NEW.stage, now(), app.person_id());
    PERFORM app.audit('lead.stage', 'lead', NEW.id::text, NEW.location_id,
                      jsonb_strip_nulls(jsonb_build_object('from', OLD.stage, 'to', NEW.stage,
                                                           'lost_reason', NEW.lost_reason, 'member_id', NEW.member_id)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER lead_log AFTER INSERT OR UPDATE ON app.lead FOR EACH ROW EXECUTE FUNCTION app.crm_lead_log();

CREATE FUNCTION app.crm_task_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT app.crm_is_manager() THEN
    -- Assignees outside front of house (trainers) may only move the status of their own task.
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.due_at IS DISTINCT FROM OLD.due_at
       OR NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Same error whether the referenced row is elsewhere or missing: BEFORE triggers run ahead of the FK checks,
  -- so callers learn nothing about rows outside their scope.
  IF TG_OP = 'INSERT' OR NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id THEN
    IF NOT app.crm_staff_at_location(NEW.assigned_staff_id, NEW.location_id,
                                     '{owner,location_manager,front_desk,trainer}'::app.role_name[]) THEN
      RAISE EXCEPTION 'invalid_assignee' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM app.lead l WHERE l.id = NEW.lead_id AND l.org_id = app.org_id() AND l.location_id = NEW.location_id) THEN
      RAISE EXCEPTION 'invalid_lead' USING ERRCODE = '22023';
    END IF;
    IF NEW.member_id IS NOT NULL AND NOT app.staff_can_see_member(NEW.member_id) THEN
      RAISE EXCEPTION 'invalid_member' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.completed_at := CASE WHEN NEW.status = 'done'
                           THEN CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'done' THEN OLD.completed_at ELSE now() END
                      END;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_task_guard BEFORE INSERT OR UPDATE ON app.crm_task FOR EACH ROW EXECUTE FUNCTION app.crm_task_guard();

CREATE FUNCTION app.crm_task_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app.audit('crm_task.create', 'crm_task', NEW.id::text, NEW.location_id,
                      jsonb_build_object('assigned_staff_id', NEW.assigned_staff_id));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id THEN
    PERFORM app.audit('crm_task.update', 'crm_task', NEW.id::text, NEW.location_id,
      jsonb_strip_nulls(jsonb_build_object(
        'status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN NEW.status END,
        'assigned_staff_id', CASE WHEN NEW.assigned_staff_id IS DISTINCT FROM OLD.assigned_staff_id THEN NEW.assigned_staff_id END)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER crm_task_audit AFTER INSERT OR UPDATE ON app.crm_task FOR EACH ROW EXECUTE FUNCTION app.crm_task_audit();

-- ── Conversion ────────────────────────────────────────────────────────────────────────────────────────────────
-- Lead → member. Creates the member through app.register_member (same email, name and phone; it re-checks role and
-- location), links it, moves the lead to 'won' (the lead trigger logs the stage_change activity and audits it) and
-- audits the conversion. The lead row is locked FOR UPDATE, so two concurrent conversions serialise and the second
-- fails with 'already_converted' (409). Creates NO messaging consent.
CREATE FUNCTION app.convert_lead(p_lead uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_lead app.lead;
  v_member uuid;
BEGIN
  IF v_org IS NULL OR NOT app.crm_is_manager() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_lead FROM app.lead WHERE id = p_lead AND org_id = v_org FOR UPDATE;
  -- Missing, other org and other location are indistinguishable.
  IF v_lead.id IS NULL OR NOT app.can_see_location(v_lead.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_lead.member_id IS NOT NULL OR v_lead.stage = 'won' THEN
    RAISE EXCEPTION 'already_converted' USING ERRCODE = '23505';
  END IF;
  IF v_lead.email IS NULL THEN
    RAISE EXCEPTION 'email_required' USING ERRCODE = '22023';
  END IF;
  v_member := app.register_member(v_lead.email, btrim(v_lead.full_name), v_lead.phone, v_lead.location_id);
  UPDATE app.lead SET member_id = v_member, stage = 'won' WHERE id = p_lead;
  PERFORM app.audit('lead.convert', 'lead', p_lead::text, v_lead.location_id,
                    jsonb_build_object('member_id', v_member, 'from', v_lead.stage));
  RETURN v_member;
END $$;

-- ── Funnel report (SECURITY INVOKER: lead RLS decides what is counted) ────────────────────────────────────────
-- Cohort of leads CREATED in [p_from, p_to] (local date of the lead's location), grouped by location and source,
-- with the CURRENT stage of each lead. conversion_pct = won / total × 100, one decimal. Owner and managers only.
CREATE FUNCTION app.crm_funnel(p_from date, p_to date, p_location uuid DEFAULT NULL)
RETURNS TABLE (location_id uuid, source app.crm_lead_source, total bigint, new bigint, contacted bigint,
               tour_booked bigint, trial bigint, won bigint, lost bigint, conversion_pct numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT l.location_id, l.source,
         count(*), count(*) FILTER (WHERE l.stage = 'new'), count(*) FILTER (WHERE l.stage = 'contacted'),
         count(*) FILTER (WHERE l.stage = 'tour_booked'), count(*) FILTER (WHERE l.stage = 'trial'),
         count(*) FILTER (WHERE l.stage = 'won'), count(*) FILTER (WHERE l.stage = 'lost'),
         round(100.0 * count(*) FILTER (WHERE l.stage = 'won') / count(*), 1)
    FROM app.lead l JOIN app.location loc ON loc.id = l.location_id AND loc.org_id = l.org_id
   WHERE (l.created_at AT TIME ZONE loc.timezone)::date BETWEEN p_from AND p_to
     AND (p_location IS NULL OR l.location_id = p_location)
   GROUP BY l.location_id, l.source
   ORDER BY l.location_id, l.source;
END $$;

-- ── Ownership and privileges ──────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, UPDATE (member_id, stage, lost_reason, updated_at, stage_changed_at) ON app.lead TO app_definer;
GRANT SELECT, INSERT ON app.lead_activity TO app_definer;
GRANT SELECT ON app.crm_task TO app_definer;
GRANT SELECT ON app.staff_location TO app_definer;

ALTER FUNCTION app.crm_staff_at_location(uuid, uuid, app.role_name[]) OWNER TO app_definer;
ALTER FUNCTION app.crm_lead_guard() OWNER TO app_definer;
ALTER FUNCTION app.crm_lead_log() OWNER TO app_definer;
ALTER FUNCTION app.crm_task_guard() OWNER TO app_definer;
ALTER FUNCTION app.crm_task_audit() OWNER TO app_definer;
ALTER FUNCTION app.convert_lead(uuid) OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.crm_is_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_my_staff_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_staff_at_location(uuid, uuid, app.role_name[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_lead_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_lead_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_task_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_task_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.convert_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.crm_funnel(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crm_is_manager() TO app_authenticated, app_definer;
GRANT EXECUTE ON FUNCTION app.crm_my_staff_ids() TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.crm_staff_at_location(uuid, uuid, app.role_name[]) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.convert_lead(uuid) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.crm_funnel(date, date, uuid) TO app_authenticated;

-- Request traffic: read, and write column by column. Never org_id, stage on insert, member_id, created_by,
-- timestamps or by_person_id; tasks never change location or subject after creation.
REVOKE ALL ON app.lead, app.lead_activity, app.crm_task FROM PUBLIC;
GRANT SELECT ON app.lead, app.lead_activity, app.crm_task TO app_authenticated;
GRANT INSERT (location_id, source, full_name, email, phone, notes, owner_staff_id) ON app.lead TO app_authenticated;
GRANT UPDATE (source, stage, lost_reason, full_name, email, phone, notes, owner_staff_id) ON app.lead TO app_authenticated;
GRANT INSERT (lead_id, kind, body) ON app.lead_activity TO app_authenticated;
GRANT INSERT (location_id, title, due_at, assigned_staff_id, lead_id, member_id) ON app.crm_task TO app_authenticated;
GRANT UPDATE (title, due_at, status, assigned_staff_id) ON app.crm_task TO app_authenticated;
