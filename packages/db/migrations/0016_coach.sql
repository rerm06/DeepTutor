-- Module coach (spec §6.3 coach diario, §6.7 límites Ley 82, §7.1–7.2 agentes, guardián, confirmación e
-- inyección). Owned by the coach module agent; see docs/modules.md and docs/modules/coach.md.
--
-- Concept credit: member memory, readiness check-in, energy-range calculator and the agent tool registry are
-- adapted from ZeroCoach (https://github.com/ntsd/zerocoach), Apache-2.0 (see NOTICE). The SQL here is new; the
-- adapted TypeScript lives in packages/shared/src/modules/coach.ts with its own header.
--
-- REGULATED DOMAIN. Nothing in this module diagnoses, prescribes or names a regulated nutrition title. The daily
-- check-in score is an estimate relative to the member's OWN history ("no es un dispositivo médico"). Energy-range
-- drafts are only care_plan DRAFTS of kind nutrition that a licensed specialist must approve (module health).
--
-- Tables (all org-scoped, RLS ENABLE + FORCE, composite FKs, definer_all for app_definer, no direct writes):
--   member_memory     facts about the member (visible, editable and deletable by the member/guardian; read by
--                     trainer / location_manager of the member's home location — nobody else)
--   daily_checkin     3-question PWA check-in (sleep 1–5, pain 0–10 + area, energy 1–5), score vs own baseline
--   coach_escalation  human follow-up (pain, acute symptoms, injury facts, "hablar con una persona")
--   coach_action      write proposals from the coach agent; executed only after the member confirms
-- Every write goes through a SECURITY DEFINER function owned by app_definer (search_path pinned, claims and scope
-- re-checked, REVOKE FROM PUBLIC) and every change is audited (app.audit, never with health content in meta).

CREATE TYPE app.coach_memory_category AS ENUM ('preference', 'restriction', 'injury', 'goal', 'equipment', 'schedule', 'other');
CREATE TYPE app.coach_memory_source AS ENUM ('member', 'staff', 'coach');
CREATE TYPE app.coach_body_area AS ENUM ('knee', 'shoulder', 'lower_back', 'upper_back', 'neck', 'hip', 'ankle', 'wrist',
                                         'elbow', 'chest', 'head', 'other');
CREATE TYPE app.coach_escalation_reason AS ENUM ('checkin_pain', 'checkin_acute', 'memory_injury', 'chat_acute',
                                                 'human_requested');
CREATE TYPE app.coach_escalation_status AS ENUM ('open', 'acknowledged', 'closed');
CREATE TYPE app.coach_action_status AS ENUM ('proposed', 'confirmed', 'rejected', 'executed', 'failed');

-- ── Pure validators ───────────────────────────────────────────────────────────────────────────────────────────
-- Member-written text that may later reach a prompt or a staff screen: one line, no markup, no braces (no JSON or
-- tool-call syntax can be smuggled in), no backticks/backslashes, no links, no control characters.
CREATE FUNCTION app.coach_text_safe(p text, p_max integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND length(btrim(p)) BETWEEN 1 AND p_max
     AND p !~ '[<>{}`\\]' AND p !~ '[[:cntrl:]]' AND p !~* '(https?:|www\.)'
$$;

-- Acute-symptom phrases (ES/EN) → emergency banner ("Llama al 911"). Accents ignored. Mirrored by ACUTE_PATTERN in
-- packages/shared/src/modules/coach.ts; a test keeps both in agreement. [VERIFICAR · equipo clínico] list.
CREATE FUNCTION app.coach_acute_keywords(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(lower(translate(p, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')) ~
    '(dolor (de|en el) pecho|(presion|opresion) en el pecho|desmay|perdi el conocimiento|falta de aire|me falta el aire|no puedo respirar|chest pain|faint|passed out|short(ness)? of breath|can.?t breathe|cannot breathe)',
    false)
$$;

-- ── Tables ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.member_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  category app.coach_memory_category NOT NULL,
  topic text NOT NULL CHECK (topic ~ '^[a-z0-9_]{1,80}$'),
  content text NOT NULL CHECK (app.coach_text_safe(content, 280)),
  source app.coach_memory_source NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);
-- One live fact per (member, category, topic): the reconciliation turns a repeat into UPDATE, never a duplicate.
CREATE UNIQUE INDEX member_memory_live_topic_uq ON app.member_memory (member_id, category, topic) WHERE deleted_at IS NULL;
CREATE INDEX member_memory_member_idx ON app.member_memory (org_id, member_id) WHERE deleted_at IS NULL;

CREATE TABLE app.daily_checkin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  local_date date NOT NULL,                       -- in the member's home-location time zone
  sleep smallint NOT NULL CHECK (sleep BETWEEN 1 AND 5),
  energy smallint NOT NULL CHECK (energy BETWEEN 1 AND 5),
  pain smallint NOT NULL CHECK (pain BETWEEN 0 AND 10),
  pain_area app.coach_body_area,
  pain_acute boolean NOT NULL DEFAULT false,      -- member flagged the pain as "agudo"
  note text CHECK (note IS NULL OR app.coach_text_safe(note, 280)),
  score smallint CHECK (score BETWEEN 0 AND 100), -- NULL while the personal baseline is being established
  baseline_days smallint NOT NULL CHECK (baseline_days BETWEEN 0 AND 28),
  escalated boolean NOT NULL DEFAULT false,
  emergency boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (member_id, local_date),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK ((pain = 0) = (pain_area IS NULL)),
  CHECK (score IS NULL OR baseline_days >= 7),
  CHECK (NOT emergency OR escalated)
);
CREATE INDEX daily_checkin_member_idx ON app.daily_checkin (org_id, member_id, local_date DESC);

CREATE TABLE app.coach_escalation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,                      -- member's home location at the time
  reason app.coach_escalation_reason NOT NULL,
  source_id uuid,                                 -- check-in or memory row that caused it (no FK: either table)
  assigned_staff_id uuid,
  crm_task_id uuid,
  status app.coach_escalation_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid,
  status_changed_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, assigned_staff_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, crm_task_id) REFERENCES app.crm_task (org_id, id),
  CHECK ((status = 'open') = (status_changed_at IS NULL))
);
CREATE INDEX coach_escalation_member_idx ON app.coach_escalation (org_id, member_id, created_at DESC);

CREATE TABLE app.coach_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  tool text NOT NULL CHECK (tool IN ('log_set', 'add_memory', 'book_class', 'register_checkin')),
  args jsonb NOT NULL CHECK (jsonb_typeof(args) = 'object' AND length(args::text) <= 2000),
  summary text NOT NULL CHECK (app.coach_text_safe(summary, 200)), -- built by the server, never by the model
  status app.coach_action_status NOT NULL DEFAULT 'proposed',
  proposed_by uuid NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  decided_by uuid,
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text CHECK (error IS NULL OR error ~ '^[a-z_]{1,60}$'),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK ((status = 'proposed') = (decided_at IS NULL)),
  CHECK ((status IN ('executed', 'failed')) = (executed_at IS NOT NULL))
);
CREATE INDEX coach_action_member_idx ON app.coach_action (org_id, member_id, proposed_at DESC);

-- ── Scope helpers (owned by app_definer; they read rows without RLS but apply the rule explicitly) ────────────
-- Staff who may read a member's coach data: trainer or location_manager of the member's home location. Owner,
-- front_desk, chef, accountant and clinical roles: never (spec: "compartida con el entrenador").
CREATE FUNCTION app.coach_staff_can_see(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('trainer', 'location_manager'), false) AND app.staff_can_see_member(p_member)
$$;

-- Serialise every coach write for one member (memory reconciliation reads, then writes).
CREATE FUNCTION app.coach_lock(p_member uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('coach:' || p_member::text, 0))
$$;

-- Internal: escalate to a human. Assignee = trainer of the member's most recent appointment at the home location,
-- else an active location_manager there, else nobody (the escalation is still listed in the Coach tab). The CRM
-- task title is neutral (front desk can read CRM tasks; health detail stays in coach_escalation). A repeat of the
-- same reason within 24 h reuses the open escalation instead of creating another task.
CREATE FUNCTION app.coach_escalate(p_member uuid, p_reason app.coach_escalation_reason, p_source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  m app.member;
  v_staff uuid;
  v_task uuid;
  v_id uuid;
BEGIN
  SELECT * INTO m FROM app.member WHERE id = p_member AND org_id = v_org;
  IF m.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT e.id INTO v_id FROM app.coach_escalation e
   WHERE e.member_id = p_member AND e.reason = p_reason AND e.status = 'open'
     AND e.created_at > now() - interval '24 hours'
   ORDER BY e.created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT a.staff_member_id INTO v_staff
    FROM app.appointment a JOIN app.staff_member s ON s.id = a.staff_member_id
   WHERE a.member_id = p_member AND a.org_id = v_org AND s.role = 'trainer' AND s.active
     AND EXISTS (SELECT 1 FROM app.staff_location sl WHERE sl.staff_member_id = s.id AND sl.location_id = m.home_location_id)
   ORDER BY a.starts_at DESC LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT s.id INTO v_staff FROM app.staff_member s
     WHERE s.org_id = v_org AND s.role = 'location_manager' AND s.active
       AND EXISTS (SELECT 1 FROM app.staff_location sl WHERE sl.staff_member_id = s.id AND sl.location_id = m.home_location_id)
     ORDER BY s.created_at, s.id LIMIT 1;
  END IF;
  IF v_staff IS NOT NULL THEN
    -- member_id stays NULL: the CRM guard only links members the (staff) caller can see; the escalation row links it.
    INSERT INTO app.crm_task (org_id, location_id, title, due_at, assigned_staff_id)
    VALUES (v_org, m.home_location_id,
            'Coach: seguimiento con socio ' || coalesce(m.member_no, split_part(m.full_name, ' ', 1)) || ' (ver pestaña Coach)',
            now() + CASE WHEN p_reason IN ('checkin_acute', 'chat_acute') THEN interval '1 hour' ELSE interval '1 day' END,
            v_staff)
    RETURNING id INTO v_task;
  END IF;
  INSERT INTO app.coach_escalation (org_id, member_id, location_id, reason, source_id, assigned_staff_id, crm_task_id)
  VALUES (v_org, p_member, m.home_location_id, p_reason, p_source, v_staff, v_task)
  RETURNING id INTO v_id;
  PERFORM app.audit('coach.escalation.create', 'coach_escalation', v_id::text, m.home_location_id,
                    jsonb_build_object('reason', p_reason, 'crm_task', v_task IS NOT NULL));
  RETURN v_id;
END $$;

-- ── Memory ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Take the per-member lock after checking that the caller is the member or their guardian. The API calls this
-- first, then reads the live facts, reconciles them in TypeScript and writes through app.coach_memory_write.
CREATE FUNCTION app.coach_memory_lock(p_member uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_self_or_guardian(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.coach_lock(p_member);
END $$;

-- Apply one reconciliation decision (ADD / UPDATE / DELETE). Caller: the member or their guardian (staff read
-- only). Source 'staff' is never accepted from this path. Injury facts escalate to a human. Max 50 live facts.
CREATE FUNCTION app.coach_memory_write(p_member uuid, p_op text, p_target uuid, p_category app.coach_memory_category,
                                       p_topic text, p_content text, p_source app.coach_memory_source)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_loc uuid;
  v_id uuid;
  v_old app.member_memory;
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_self_or_guardian(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source = 'staff' THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023'; END IF;
  PERFORM app.coach_lock(p_member);
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;

  IF p_op = 'ADD' THEN
    IF (SELECT count(*) FROM app.member_memory WHERE member_id = p_member AND deleted_at IS NULL) >= 50 THEN
      RAISE EXCEPTION 'memory_full' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.member_memory (org_id, member_id, category, topic, content, source, created_by)
    VALUES (app.org_id(), p_member, p_category, p_topic, btrim(p_content), p_source, app.person_id())
    RETURNING id INTO v_id;
  ELSIF p_op IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO v_old FROM app.member_memory
     WHERE id = p_target AND member_id = p_member AND org_id = app.org_id() AND deleted_at IS NULL FOR UPDATE;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_id := v_old.id;
    IF p_op = 'UPDATE' THEN
      UPDATE app.member_memory
         SET category = p_category, topic = p_topic, content = btrim(p_content), source = p_source, updated_at = now()
       WHERE id = v_id;
    ELSE
      -- Deleting really forgets: the text is scrubbed, only the tombstone (for the audit trail) remains.
      UPDATE app.member_memory SET content = '(borrado)', deleted_at = now(), updated_at = now() WHERE id = v_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_operation' USING ERRCODE = '22023';
  END IF;

  PERFORM app.audit('coach.memory.' || lower(p_op), 'member_memory', v_id::text, v_loc,
                    jsonb_build_object('category', coalesce(p_category, v_old.category), 'source', p_source));
  IF p_op IN ('ADD', 'UPDATE') AND p_category = 'injury' THEN
    PERFORM app.coach_escalate(p_member, 'memory_injury', v_id);
  END IF;
  RETURN v_id;
END $$;

-- ── Daily check-in ────────────────────────────────────────────────────────────────────────────────────────────
-- Register today's check-in (member or guardian). The score (computed by the API from the member's own rolling
-- 28-day medians) is stored only once 7 prior check-ins exist; the count is taken here, not trusted from the
-- caller. Pain ≥ 4, pain flagged acute, acute-symptom words or any chest pain → escalation; acute words or chest
-- pain also set `emergency` (UI: "Llama al 911"). One check-in per local day.
CREATE FUNCTION app.coach_register_checkin(p_member uuid, p_sleep integer, p_energy integer, p_pain integer,
                                           p_pain_area app.coach_body_area, p_pain_acute boolean, p_note text,
                                           p_score integer,
                                           OUT id uuid, OUT local_date date, OUT baseline_days integer,
                                           OUT score integer, OUT escalated boolean, OUT emergency boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  v_loc uuid;
  v_tz text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_self_or_guardian(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_score IS NOT NULL AND p_score NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_score' USING ERRCODE = '22023'; END IF;
  PERFORM app.coach_lock(p_member);
  SELECT m.home_location_id, l.timezone INTO v_loc, v_tz
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id WHERE m.id = p_member;
  local_date := (now() AT TIME ZONE v_tz)::date;
  SELECT count(*) INTO baseline_days FROM app.daily_checkin c
   WHERE c.member_id = p_member AND c.local_date >= local_date - 28 AND c.local_date < local_date;
  score := CASE WHEN baseline_days >= 7 THEN p_score END;
  emergency := app.coach_acute_keywords(v_note) OR coalesce(p_pain_area = 'chest' AND p_pain > 0, false);
  escalated := emergency OR coalesce(p_pain >= 4, false) OR coalesce(p_pain_acute, false);
  INSERT INTO app.daily_checkin (org_id, member_id, local_date, sleep, energy, pain, pain_area, pain_acute, note,
                                 score, baseline_days, escalated, emergency, created_by)
  VALUES (app.org_id(), p_member, local_date, p_sleep, p_energy, p_pain, p_pain_area, coalesce(p_pain_acute, false),
          v_note, score, baseline_days, escalated, emergency, app.person_id())
  RETURNING daily_checkin.id INTO id;
  PERFORM app.audit('coach.checkin.create', 'daily_checkin', id::text, v_loc,
                    jsonb_build_object('escalated', escalated, 'emergency', emergency));
  IF escalated THEN
    PERFORM app.coach_escalate(p_member, CASE WHEN emergency THEN 'checkin_acute' ELSE 'checkin_pain' END
                                         ::app.coach_escalation_reason, id);
  END IF;
END $$;

-- Staff acknowledge / close an escalation (trainer or location_manager of the member's location).
CREATE FUNCTION app.coach_escalation_set_status(p_id uuid, p_status app.coach_escalation_status)
RETURNS app.coach_escalation_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  e app.coach_escalation;
BEGIN
  SELECT * INTO e FROM app.coach_escalation WHERE id = p_id AND org_id = app.org_id() FOR UPDATE;
  IF e.id IS NULL OR NOT app.coach_staff_can_see(e.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT ((e.status = 'open' AND p_status IN ('acknowledged', 'closed'))
          OR (e.status = 'acknowledged' AND p_status = 'closed')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501';
  END IF;
  UPDATE app.coach_escalation SET status = p_status, status_changed_by = app.person_id(), status_changed_at = now()
   WHERE id = p_id;
  PERFORM app.audit('coach.escalation.' || p_status, 'coach_escalation', p_id::text, e.location_id,
                    jsonb_build_object('from', e.status));
  RETURN p_status;
END $$;

-- ── Agent actions (write tools) ───────────────────────────────────────────────────────────────────────────────
-- The model never writes: a write tool call only becomes a proposal, which the member confirms or rejects.
CREATE FUNCTION app.coach_action_propose(p_member uuid, p_tool text, p_args jsonb, p_summary text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_id uuid;
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_self_or_guardian(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.coach_lock(p_member);
  IF (SELECT count(*) FROM app.coach_action
       WHERE member_id = p_member AND status = 'proposed' AND expires_at > now()) >= 5 THEN
    RAISE EXCEPTION 'too_many_proposals' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.coach_action (org_id, member_id, tool, args, summary, proposed_by)
  VALUES (app.org_id(), p_member, p_tool, p_args, p_summary, app.person_id())
  RETURNING id INTO v_id;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit('coach.action.propose', 'coach_action', v_id::text, v_loc, jsonb_build_object('tool', p_tool));
  RETURN v_id;
END $$;

-- Confirm or reject a proposal (the member or their guardian; never staff, never the model). Locks the row, so
-- two concurrent confirmations execute at most once. Returns the row for the API to execute.
CREATE FUNCTION app.coach_action_decide(p_id uuid, p_confirm boolean) RETURNS app.coach_action
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.coach_action;
  v_loc uuid;
BEGIN
  SELECT * INTO a FROM app.coach_action WHERE id = p_id AND org_id = app.org_id() FOR UPDATE;
  IF a.id IS NULL OR NOT app.health_self_or_guardian(a.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'proposed' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  IF a.expires_at <= now() THEN RAISE EXCEPTION 'action_expired' USING ERRCODE = '42501'; END IF;
  UPDATE app.coach_action
     SET status = CASE WHEN p_confirm THEN 'confirmed' ELSE 'rejected' END::app.coach_action_status,
         decided_by = app.person_id(), decided_at = now()
   WHERE id = p_id
  RETURNING * INTO a;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = a.member_id;
  PERFORM app.audit('coach.action.' || a.status, 'coach_action', p_id::text, v_loc, jsonb_build_object('tool', a.tool));
  RETURN a;
END $$;

-- Record the outcome after the owning module executed a confirmed action.
CREATE FUNCTION app.coach_action_finish(p_id uuid, p_ok boolean, p_result jsonb, p_error text)
RETURNS app.coach_action_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.coach_action;
  v_loc uuid;
  v_status app.coach_action_status := CASE WHEN p_ok THEN 'executed' ELSE 'failed' END;
BEGIN
  SELECT * INTO a FROM app.coach_action WHERE id = p_id AND org_id = app.org_id() FOR UPDATE;
  IF a.id IS NULL OR NOT app.health_self_or_guardian(a.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'confirmed' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  UPDATE app.coach_action SET status = v_status, executed_at = now(), result = p_result,
         error = CASE WHEN p_ok THEN NULL ELSE coalesce(p_error, 'failed') END
   WHERE id = p_id;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = a.member_id;
  PERFORM app.audit('coach.action.' || v_status, 'coach_action', p_id::text, v_loc, jsonb_build_object('tool', a.tool));
  RETURN v_status;
END $$;

-- Chat turn bookkeeping: audit (no content) and, for acute symptoms or a request for a person, escalate.
CREATE FUNCTION app.coach_chat_event(p_member uuid, p_kind text, p_blocked boolean, p_proposals integer,
                                     p_blocked_tools integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_self_or_guardian(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('turn', 'emergency', 'human') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023'; END IF;
  PERFORM app.coach_lock(p_member);  -- concurrent turns never open two escalations for the same reason
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit('coach.chat.' || p_kind, 'member', p_member::text, v_loc,
                    jsonb_build_object('blocked', coalesce(p_blocked, false),
                                       'proposals', greatest(0, least(coalesce(p_proposals, 0), 10)),
                                       'blocked_tools', greatest(0, least(coalesce(p_blocked_tools, 0), 10))));
  IF p_kind = 'emergency' THEN PERFORM app.coach_escalate(p_member, 'chat_acute', NULL); END IF;
  IF p_kind = 'human' THEN PERFORM app.coach_escalate(p_member, 'human_requested', NULL); END IF;
END $$;

-- ── Energy-range drafts (spec §6.7 mode A) ────────────────────────────────────────────────────────────────────
-- Days with logged activity (floor set logs or allowed check-ins) in the last p_days, for health staff of the
-- member's location. Returns a count only.
CREATE FUNCTION app.coach_activity_days(p_member uuid, p_days integer) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  IF app.org_id() IS NULL OR NOT app.health_staff_can_see(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'invalid_days' USING ERRCODE = '22023'; END IF;
  SELECT count(DISTINCT d) INTO v_n FROM (
    SELECT s.at::date AS d FROM app.set_log s WHERE s.member_id = p_member AND s.at > now() - make_interval(days => p_days)
    UNION
    SELECT c.at::date FROM app.check_in c
     WHERE c.member_id = p_member AND c.result = 'allowed' AND c.at > now() - make_interval(days => p_days)) x;
  RETURN v_n;
END $$;

-- Store a calculated energy-range DRAFT as a nutrition care_plan in status draft. Only the licensed-nutrition
-- role drafts nutrition plans (health rules); approval stays in module health (licence, triage, referral ack).
-- Refusals (re-checked here whatever the API computed): no signed triage; nutrition triage red; minors (guardian
-- link, no_calorie_counting flag or age < 18): no numeric draft at all; a calorie DEFICIT for pregnancy,
-- lactation or eating-disorder flags. The member sees nothing until a licensed approval and publication.
CREATE FUNCTION app.coach_nutrition_draft(p_member uuid, p_goal text, p_birth_date date, p_title text, p_body jsonb,
                                          p_rationale text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  tr app.triage_result;
  v_conditions text[];
  v_staff uuid := app.health_staff_id();
  v_loc uuid;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR v_staff IS NULL OR NOT app.health_can_author('nutrition')
     OR NOT app.health_staff_can_see(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_goal NOT IN ('maintenance', 'deficit', 'surplus') THEN RAISE EXCEPTION 'invalid_goal' USING ERRCODE = '22023'; END IF;
  IF p_birth_date IS NULL OR p_birth_date > current_date OR p_birth_date < current_date - interval '110 years' THEN
    RAISE EXCEPTION 'invalid_birth_date' USING ERRCODE = '22023';
  END IF;
  PERFORM app.health_lock_member(p_member);
  tr := app.health_latest_triage(p_member);
  IF tr.id IS NULL THEN RAISE EXCEPTION 'triage_required' USING ERRCODE = '42501'; END IF;
  IF tr.nutrition_level = 'red' THEN RAISE EXCEPTION 'triage_red_blocks_nutrition' USING ERRCODE = '42501'; END IF;
  IF tr.no_calorie_counting OR age(current_date, p_birth_date) < interval '18 years'
     OR EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = p_member AND g.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'minor_no_calorie_counting' USING ERRCODE = '42501';
  END IF;
  SELECT a.declared_conditions INTO v_conditions FROM app.assessment a WHERE a.id = tr.assessment_id;
  IF p_goal = 'deficit' AND coalesce(v_conditions, '{}') && ARRAY['pregnancy', 'lactation', 'high_risk_pregnancy',
       'eating_disorder_screen_positive', 'active_ed'] THEN
    RAISE EXCEPTION 'deficit_not_allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.care_plan (org_id, member_id, kind, title, body, rationale, created_by)
  VALUES (app.org_id(), p_member, 'nutrition', p_title, p_body, p_rationale, v_staff)
  RETURNING id INTO v_id;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit('coach.nutrition_draft', 'care_plan', v_id::text, v_loc, jsonb_build_object('goal', p_goal));
  RETURN v_id;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.member_memory    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.member_memory    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.daily_checkin    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.daily_checkin    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.coach_escalation ENABLE ROW LEVEL SECURITY; ALTER TABLE app.coach_escalation FORCE ROW LEVEL SECURITY;
ALTER TABLE app.coach_action     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.coach_action     FORCE ROW LEVEL SECURITY;

-- app_definer reaches these rows only through its role-targeted policy (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.member_memory    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.daily_checkin    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.coach_escalation TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.coach_action     TO app_definer USING (true) WITH CHECK (true);

-- Read-only for request traffic; every write is a definer function above.
CREATE POLICY member_memory_select ON app.member_memory FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND deleted_at IS NULL
  AND (app.health_self_or_guardian(member_id) OR app.coach_staff_can_see(member_id)));
CREATE POLICY daily_checkin_select ON app.daily_checkin FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.health_self_or_guardian(member_id) OR app.coach_staff_can_see(member_id)));
CREATE POLICY coach_escalation_select ON app.coach_escalation FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.health_self_or_guardian(member_id) OR app.coach_staff_can_see(member_id)));
-- Proposals are private to the member (and guardian): staff never see chat-derived actions.
CREATE POLICY coach_action_select ON app.coach_action FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND app.health_self_or_guardian(member_id));

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.member_memory, app.daily_checkin, app.coach_escalation, app.coach_action FROM PUBLIC;
GRANT SELECT ON app.member_memory, app.daily_checkin, app.coach_escalation, app.coach_action TO app_authenticated;
GRANT SELECT, INSERT, UPDATE ON app.member_memory, app.daily_checkin, app.coach_escalation, app.coach_action
  TO app_definer;
GRANT INSERT ON app.crm_task TO app_definer;  -- escalations open a CRM follow-up task (crm guard + audit still run)
GRANT SELECT ON app.appointment, app.staff_location, app.staff_member, app.member, app.location, app.guardian_link,
  app.set_log, app.check_in, app.assessment, app.triage_result TO app_definer;

ALTER FUNCTION app.coach_staff_can_see(uuid) OWNER TO app_definer;
ALTER FUNCTION app.coach_escalate(uuid, app.coach_escalation_reason, uuid) OWNER TO app_definer;
ALTER FUNCTION app.coach_memory_lock(uuid) OWNER TO app_definer;
ALTER FUNCTION app.coach_memory_write(uuid, text, uuid, app.coach_memory_category, text, text, app.coach_memory_source)
  OWNER TO app_definer;
ALTER FUNCTION app.coach_register_checkin(uuid, integer, integer, integer, app.coach_body_area, boolean, text, integer)
  OWNER TO app_definer;
ALTER FUNCTION app.coach_escalation_set_status(uuid, app.coach_escalation_status) OWNER TO app_definer;
ALTER FUNCTION app.coach_action_propose(uuid, text, jsonb, text) OWNER TO app_definer;
ALTER FUNCTION app.coach_action_decide(uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app.coach_action_finish(uuid, boolean, jsonb, text) OWNER TO app_definer;
ALTER FUNCTION app.coach_chat_event(uuid, text, boolean, integer, integer) OWNER TO app_definer;
ALTER FUNCTION app.coach_activity_days(uuid, integer) OWNER TO app_definer;
ALTER FUNCTION app.coach_nutrition_draft(uuid, text, date, text, jsonb, text) OWNER TO app_definer;

REVOKE ALL ON FUNCTION
  app.coach_text_safe(text, integer), app.coach_acute_keywords(text), app.coach_staff_can_see(uuid),
  app.coach_lock(uuid), app.coach_escalate(uuid, app.coach_escalation_reason, uuid), app.coach_memory_lock(uuid),
  app.coach_memory_write(uuid, text, uuid, app.coach_memory_category, text, text, app.coach_memory_source),
  app.coach_register_checkin(uuid, integer, integer, integer, app.coach_body_area, boolean, text, integer),
  app.coach_escalation_set_status(uuid, app.coach_escalation_status),
  app.coach_action_propose(uuid, text, jsonb, text), app.coach_action_decide(uuid, boolean),
  app.coach_action_finish(uuid, boolean, jsonb, text), app.coach_chat_event(uuid, text, boolean, integer, integer),
  app.coach_activity_days(uuid, integer), app.coach_nutrition_draft(uuid, text, date, text, jsonb, text)
FROM PUBLIC;
-- Entry points and the helpers policies/CHECKs evaluate in the caller's context.
GRANT EXECUTE ON FUNCTION
  app.coach_text_safe(text, integer), app.coach_acute_keywords(text), app.coach_staff_can_see(uuid),
  app.coach_memory_lock(uuid),
  app.coach_memory_write(uuid, text, uuid, app.coach_memory_category, text, text, app.coach_memory_source),
  app.coach_register_checkin(uuid, integer, integer, integer, app.coach_body_area, boolean, text, integer),
  app.coach_escalation_set_status(uuid, app.coach_escalation_status),
  app.coach_action_propose(uuid, text, jsonb, text), app.coach_action_decide(uuid, boolean),
  app.coach_action_finish(uuid, boolean, jsonb, text), app.coach_chat_event(uuid, text, boolean, integer, integer),
  app.coach_activity_days(uuid, integer), app.coach_nutrition_draft(uuid, text, date, text, jsonb, text)
TO app_authenticated;
-- Internal helpers: only other app_definer functions may call them (escalation is never a direct entry point).
GRANT EXECUTE ON FUNCTION
  app.coach_text_safe(text, integer), app.coach_acute_keywords(text), app.coach_staff_can_see(uuid),
  app.coach_lock(uuid), app.coach_escalate(uuid, app.coach_escalation_reason, uuid)
TO app_definer;
