-- Module health (spec §6.1–6.2 onboarding + triage, §6.6–6.7 plans with licensed sign-off). Owned by the health
-- module agent; see docs/modules.md and docs/modules/health.md.
--
-- REGULATED DOMAIN. Everything here is a DRAFT WORKFLOW for licensed professionals: no AI generation, no health
-- claims, no diagnosis. The triage is a deterministic screening aid, rule_version 'v0-propuesta'
-- [VERIFICAR · equipo clínico], never a medical decision.
--
-- Visibility: the member (signed assessments, published plans), their guardian, and trainer / nutritionist /
-- clinician / location_manager of the member's home location; the owner org-wide. NEVER front_desk, chef or
-- accountant. Approval rules are enforced twice: in the definer functions (claims, role, location) and in a
-- BEFORE UPDATE guard trigger that no path can skip (state machine, licence, triage, immutability).

CREATE TYPE app.triage_level AS ENUM ('green', 'amber', 'red');           -- ordered: GREATEST() = most severe
CREATE TYPE app.assessment_status AS ENUM ('draft', 'signed');
CREATE TYPE app.care_plan_kind AS ENUM ('training', 'nutrition', 'treatment');
CREATE TYPE app.care_plan_status AS ENUM ('draft', 'review', 'approved', 'published', 'archived');

-- ── Pure validators (IMMUTABLE, used by CHECK constraints and by the triage function).
-- PAR-Q+ general section: exactly the 7 yes/no questions q1..q7, booleans only.
CREATE FUNCTION app.health_parq_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)
       IS DISTINCT FROM ARRAY['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value) <> 'boolean');
END $$;

-- The fixed list of declarable conditions (spec §6.2). Free text is never accepted.
CREATE FUNCTION app.health_conditions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['diabetes', 'ckd', 'cvd', 'pregnancy', 'lactation', 'glp1', 'eating_disorder_screen_positive',
               'advanced_ckd', 'active_ed', 'high_risk_pregnancy']
$$;

-- Fitness tests: a flat object of known numeric results.
CREATE FUNCTION app.health_fitness_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  e record;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  FOR e IN SELECT * FROM jsonb_each(p) LOOP
    IF e.key NOT IN ('pushups', 'plank_seconds', 'sit_reach_cm', 'chair_stand_30s', 'step_test_hr',
                     'walk_6min_m') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(e.value) <> 'number' THEN RETURN false; END IF;
    IF (e.value)::numeric < 0 OR (e.value)::numeric > 10000 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- Free text written by professionals into plans: no markup, no placeholders, no links, no control characters,
-- no regulated nutrition titles (Ley 82) and no outcome promises. [VERIFICAR · legal] list to be extended.
CREATE FUNCTION app.health_text_safe(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL OR NOT (
       p ~ '[<>{}]'
    OR p ~* '(https?:|www\.)'
    OR p ~* '\m(nutricionistas?|dietistas?|nutritionists?|dietitians?|garantiza(do|da|n|mos)?|guarantee[ds]?|curas?|cures?|curar)\M'
    OR p ~ '[\x01-\x09\x0B-\x1F\x7F]')
$$;

-- Plan body: {"sections":[{"heading": text, "items": [text, …]}, …]} with bounded sizes and safe text.
CREATE FUNCTION app.health_plan_body_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s jsonb;
  i jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF length(p::text) > 20000 THEN RETURN false; END IF;
  IF (SELECT array_agg(k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM ARRAY['sections'] THEN RETURN false; END IF;
  IF jsonb_typeof(p -> 'sections') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p -> 'sections') > 20 THEN RETURN false; END IF;
  FOR s IN SELECT x FROM jsonb_array_elements(p -> 'sections') x LOOP
    IF jsonb_typeof(s) <> 'object' THEN RETURN false; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM ARRAY['heading', 'items'] THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(s -> 'heading') <> 'string' THEN RETURN false; END IF;
    IF length(btrim(s ->> 'heading')) NOT BETWEEN 1 AND 120 OR NOT app.health_text_safe(s ->> 'heading') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(s -> 'items') <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(s -> 'items') > 30 THEN RETURN false; END IF;
    FOR i IN SELECT x FROM jsonb_array_elements(s -> 'items') x LOOP
      IF jsonb_typeof(i) <> 'string' THEN RETURN false; END IF;
      IF length(btrim(i #>> '{}')) NOT BETWEEN 1 AND 500 OR NOT app.health_text_safe(i #>> '{}') THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;

-- The caller's own active staff row for their current role (also the default evaluator / author).
CREATE FUNCTION app.health_staff_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.id FROM app.staff_member s
   WHERE s.org_id = app.org_id() AND s.person_id = app.person_id() AND s.role = app.role() AND s.active
   LIMIT 1
$$;

-- ── Tables
CREATE TABLE app.assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  evaluator_staff_id uuid NOT NULL DEFAULT app.health_staff_id(), -- caller's staff row (column not grantable)
  taken_at timestamptz NOT NULL DEFAULT now(),
  parq jsonb NOT NULL CHECK (app.health_parq_valid(parq)),
  parq_followup_resolved boolean NOT NULL DEFAULT false,
  declared_conditions text[] NOT NULL DEFAULT '{}'
    CHECK (declared_conditions <@ app.health_conditions() AND cardinality(declared_conditions) <= 10
           AND array_position(declared_conditions, NULL) IS NULL),
  resting_hr smallint CHECK (resting_hr BETWEEN 25 AND 250),
  bp_sys smallint CHECK (bp_sys BETWEEN 60 AND 260),
  bp_dia smallint CHECK (bp_dia BETWEEN 30 AND 160),
  height_cm numeric(5, 1) CHECK (height_cm BETWEEN 50 AND 250),
  weight_kg numeric(5, 1) CHECK (weight_kg BETWEEN 20 AND 350),
  waist_cm numeric(5, 1) CHECK (waist_cm BETWEEN 30 AND 250),
  fitness_tests jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (app.health_fitness_valid(fitness_tests)),
  acute_symptoms boolean NOT NULL DEFAULT false,
  status app.assessment_status NOT NULL DEFAULT 'draft',
  signed_by uuid,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, evaluator_staff_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, signed_by) REFERENCES app.staff_member (org_id, id),
  CHECK (bp_sys IS NULL OR bp_dia IS NULL OR bp_sys > bp_dia),
  CHECK ((status = 'signed') = (signed_by IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE INDEX assessment_member_idx ON app.assessment (org_id, member_id, signed_at DESC);

-- Written only by app.sign_assessment(); one per signed assessment.
CREATE TABLE app.triage_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  assessment_id uuid NOT NULL UNIQUE,
  member_id uuid NOT NULL,
  rule_version text NOT NULL DEFAULT 'v0-propuesta' CHECK (rule_version = 'v0-propuesta'),
  exercise_level app.triage_level NOT NULL,
  nutrition_level app.triage_level NOT NULL,
  requires_medical_referral boolean NOT NULL,
  emergency boolean NOT NULL DEFAULT false,         -- acute symptoms: UI shows "Llama al 911"
  no_calorie_counting boolean NOT NULL DEFAULT false, -- minors (guardian link): never count calories
  reasons text[] NOT NULL CHECK (cardinality(reasons) BETWEEN 1 AND 30),
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, assessment_id) REFERENCES app.assessment (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK (NOT emergency OR requires_medical_referral)
);
CREATE INDEX triage_member_idx ON app.triage_result (org_id, member_id, computed_at DESC);

CREATE TABLE app.care_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  series_id uuid NOT NULL,                  -- first version's id; versions share it
  kind app.care_plan_kind NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000),
  status app.care_plan_status NOT NULL DEFAULT 'draft',
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120 AND app.health_text_safe(title)),
  body jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb CHECK (app.health_plan_body_valid(body)),
  rationale text CHECK (length(rationale) <= 2000 AND app.health_text_safe(rationale)),
  created_by uuid NOT NULL DEFAULT app.health_staff_id(), -- caller's staff row (column not grantable)
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  approver_name text,                       -- snapshot shown to the member
  approver_license_no text,                 -- snapshot at approval (licensed kinds)
  triage_result_id uuid,                    -- triage the approval relied on
  referral_acknowledged boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (series_id, version),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, approved_by) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, triage_result_id) REFERENCES app.triage_result (org_id, id),
  -- Nothing past review exists without a named approver; licensed kinds also carry the licence snapshot.
  CHECK (status IN ('draft', 'review')
         OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approver_name IS NOT NULL)),
  CHECK (kind = 'training' OR status IN ('draft', 'review') OR approver_license_no IS NOT NULL),
  CHECK (kind <> 'nutrition' OR status IN ('draft', 'review') OR triage_result_id IS NOT NULL),
  CHECK (status <> 'published' OR published_at IS NOT NULL),
  CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);
CREATE INDEX care_plan_member_idx ON app.care_plan (org_id, member_id, kind, status);

-- ── Helpers (owned by app_definer: they read staff/member rows without RLS but apply the rules explicitly).
-- Health staff of the member's home location (owner: org-wide). Never front_desk, chef or accountant.
CREATE FUNCTION app.health_staff_can_see(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'trainer', 'nutritionist', 'clinician'), false)
     AND app.staff_can_see_member(p_member)
$$;

-- The member themself or their guardian (no staff).
CREATE FUNCTION app.health_self_or_guardian(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('member', 'guardian'), false) AND (
       EXISTS (SELECT 1 FROM app.member m
                WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id())
    OR EXISTS (SELECT 1 FROM app.guardian_link g
                WHERE g.member_id = p_member AND g.org_id = app.org_id() AND g.guardian_person_id = app.person_id()))
$$;

-- Who may write a draft of each plan kind (Ley 82: only the licensed role drafts nutrition; clinicians treatment).
CREATE FUNCTION app.health_can_author(p_kind app.care_plan_kind) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE p_kind
    WHEN 'training' THEN coalesce(app.role() IN ('trainer', 'location_manager'), false)
    WHEN 'nutrition' THEN coalesce(app.role() = 'nutritionist', false)
    WHEN 'treatment' THEN coalesce(app.role() = 'clinician', false)
  END
$$;

-- ── Deterministic triage (spec §6.2 table), rule_version 'v0-propuesta' [VERIFICAR · equipo clínico].
-- Pure: same input, same output. Severity per axis is the maximum over every rule that fires.
--   PAR-Q all no                        → exercise green, nutrition green
--   PAR-Q positive, follow-up resolved  → exercise green
--   PAR-Q positive, unresolved          → exercise amber
--   diabetes / ckd / cvd                → amber / amber + medical referral
--   pregnancy / lactation               → amber / amber
--   glp1                                → nutrition amber
--   eating_disorder_screen_positive     → nutrition red
--   advanced_ckd / active_ed / high_risk_pregnancy → nutrition red
--   minor (guardian link exists)        → no_calorie_counting flag
--   acute symptoms                      → emergency flag
-- Conservative readings (marked [VERIFICAR] in docs/modules/health.md): advanced_ckd also fires the ckd row and
-- high_risk_pregnancy the pregnancy row; any nutrition red and any emergency also require a medical referral;
-- acute symptoms set exercise red.
CREATE FUNCTION app.health_triage(p_parq jsonb, p_resolved boolean, p_conditions text[], p_acute boolean,
                                  p_minor boolean,
                                  OUT exercise_level app.triage_level, OUT nutrition_level app.triage_level,
                                  OUT requires_medical_referral boolean, OUT emergency boolean,
                                  OUT no_calorie_counting boolean, OUT reasons text[])
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c text[] := coalesce(p_conditions, '{}');
  v text;
BEGIN
  IF NOT app.health_parq_valid(p_parq) THEN RAISE EXCEPTION 'invalid_parq' USING ERRCODE = '22023'; END IF;
  IF NOT c <@ app.health_conditions() OR array_position(c, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_condition' USING ERRCODE = '22023';
  END IF;
  exercise_level := 'green'; nutrition_level := 'green';
  requires_medical_referral := false; emergency := false; no_calorie_counting := false; reasons := '{}';

  IF NOT EXISTS (SELECT 1 FROM jsonb_each(p_parq) e WHERE e.value = 'true'::jsonb) THEN
    reasons := reasons || 'parq_all_no'::text;
  ELSIF coalesce(p_resolved, false) THEN
    reasons := reasons || 'parq_positive_resolved'::text;
  ELSE
    exercise_level := GREATEST(exercise_level, 'amber'); reasons := reasons || 'parq_positive_unresolved'::text;
  END IF;

  FOREACH v IN ARRAY ARRAY['diabetes', 'ckd', 'cvd', 'advanced_ckd'] LOOP
    IF v = ANY (c) THEN
      exercise_level := GREATEST(exercise_level, 'amber'); nutrition_level := GREATEST(nutrition_level, 'amber');
      requires_medical_referral := true;
      IF v <> 'advanced_ckd' THEN reasons := reasons || ('condition_' || v); END IF;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['pregnancy', 'lactation', 'high_risk_pregnancy'] LOOP
    IF v = ANY (c) THEN
      exercise_level := GREATEST(exercise_level, 'amber'); nutrition_level := GREATEST(nutrition_level, 'amber');
      IF v <> 'high_risk_pregnancy' THEN reasons := reasons || ('condition_' || v); END IF;
    END IF;
  END LOOP;
  IF 'glp1' = ANY (c) THEN
    nutrition_level := GREATEST(nutrition_level, 'amber'); reasons := reasons || 'condition_glp1'::text;
  END IF;
  FOREACH v IN ARRAY ARRAY['eating_disorder_screen_positive', 'advanced_ckd', 'active_ed', 'high_risk_pregnancy'] LOOP
    IF v = ANY (c) THEN
      nutrition_level := 'red'; requires_medical_referral := true; reasons := reasons || ('condition_' || v);
    END IF;
  END LOOP;
  IF coalesce(p_minor, false) THEN
    no_calorie_counting := true; reasons := reasons || 'minor_guardian_link'::text;
  END IF;
  IF coalesce(p_acute, false) THEN
    emergency := true; exercise_level := 'red'; requires_medical_referral := true;
    reasons := reasons || 'acute_symptoms'::text;
  END IF;
END $$;

-- Latest triage of a member (by sign time). Internal.
CREATE FUNCTION app.health_latest_triage(p_member uuid) RETURNS app.triage_result
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT t.* FROM app.triage_result t WHERE t.member_id = p_member
   ORDER BY t.computed_at DESC, t.id DESC LIMIT 1
$$;

-- ── Guards (triggers fire on EVERY path, definer functions included).
CREATE FUNCTION app.assessment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'assessment_signed_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.evaluator_staff_id IS DISTINCT FROM OLD.evaluator_staff_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'assessment_identity_immutable' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_guard BEFORE UPDATE ON app.assessment
  FOR EACH ROW EXECUTE FUNCTION app.assessment_guard();
CREATE FUNCTION app.health_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'health_rows_are_append_only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER assessment_no_delete BEFORE DELETE ON app.assessment
  FOR EACH ROW EXECUTE FUNCTION app.health_no_delete();
CREATE TRIGGER triage_no_change BEFORE UPDATE OR DELETE ON app.triage_result
  FOR EACH ROW EXECUTE FUNCTION app.health_no_delete();
CREATE TRIGGER care_plan_no_delete BEFORE DELETE ON app.care_plan
  FOR EACH ROW EXECUTE FUNCTION app.health_no_delete();

CREATE FUNCTION app.care_plan_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.series_id := coalesce(NEW.series_id, NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER care_plan_before_insert BEFORE INSERT ON app.care_plan
  FOR EACH ROW EXECUTE FUNCTION app.care_plan_before_insert();

-- State machine, immutability and sign-off rules for care plans.
CREATE FUNCTION app.care_plan_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  s app.staff_member;
  tr app.triage_result;
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.series_id IS DISTINCT FROM OLD.series_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'plan_identity_immutable' USING ERRCODE = '42501';
  END IF;
  -- Content is editable only while draft; from review on, a change means returning to draft or a new version.
  IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
                                OR NEW.rationale IS DISTINCT FROM OLD.rationale) THEN
    RAISE EXCEPTION 'plan_immutable' USING ERRCODE = '42501';
  END IF;
  -- Sign-off fields are frozen once approved.
  IF OLD.status IN ('approved', 'published', 'archived') AND (
       NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approver_name IS DISTINCT FROM OLD.approver_name
    OR NEW.approver_license_no IS DISTINCT FROM OLD.approver_license_no
    OR NEW.triage_result_id IS DISTINCT FROM OLD.triage_result_id
    OR NEW.referral_acknowledged IS DISTINCT FROM OLD.referral_acknowledged
    OR NEW.published_at IS DISTINCT FROM OLD.published_at AND OLD.status <> 'approved') THEN
    RAISE EXCEPTION 'plan_immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'review')
    OR (OLD.status = 'review' AND NEW.status IN ('draft', 'approved'))
    OR (OLD.status = 'approved' AND NEW.status IN ('published', 'archived'))
    OR (OLD.status = 'published' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'approved' AND OLD.status = 'review' THEN
    SELECT * INTO s FROM app.staff_member WHERE id = NEW.approved_by AND org_id = NEW.org_id;
    IF s.id IS NULL OR NOT s.active THEN RAISE EXCEPTION 'approver_invalid' USING ERRCODE = '42501'; END IF;
    IF NEW.kind = 'training' AND s.role NOT IN ('trainer', 'location_manager') THEN
      RAISE EXCEPTION 'approver_role' USING ERRCODE = '42501';
    END IF;
    IF NEW.kind = 'nutrition' AND s.role <> 'nutritionist' THEN
      RAISE EXCEPTION 'approver_role' USING ERRCODE = '42501';
    END IF;
    IF NEW.kind = 'treatment' AND s.role <> 'clinician' THEN
      RAISE EXCEPTION 'approver_role' USING ERRCODE = '42501';
    END IF;
    IF NEW.kind IN ('nutrition', 'treatment') AND (s.license_verified_at IS NULL OR s.license_no IS NULL
         OR NEW.approver_license_no IS DISTINCT FROM s.license_no) THEN
      RAISE EXCEPTION 'license_not_verified' USING ERRCODE = '42501';
    END IF;
    IF NEW.kind = 'nutrition' THEN
      tr := app.health_latest_triage(NEW.member_id);
      IF tr.id IS NULL OR NEW.triage_result_id IS DISTINCT FROM tr.id THEN
        RAISE EXCEPTION 'triage_required' USING ERRCODE = '42501';
      END IF;
      IF tr.nutrition_level = 'red' THEN
        RAISE EXCEPTION 'triage_red_blocks_nutrition' USING ERRCODE = '42501';
      END IF;
      IF (tr.nutrition_level = 'amber' OR tr.requires_medical_referral) AND NOT NEW.referral_acknowledged THEN
        RAISE EXCEPTION 'referral_ack_required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER care_plan_guard BEFORE UPDATE ON app.care_plan
  FOR EACH ROW EXECUTE FUNCTION app.care_plan_guard();

-- ── Audit by trigger: every create and every status transition, with the real actor (no clinical data in meta).
CREATE FUNCTION app.health_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;  -- migrations / fixtures without claims
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = NEW.member_id;
  IF TG_TABLE_NAME = 'assessment' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM app.audit('health.assessment.create', 'assessment', NEW.id::text, v_loc, '{}'::jsonb);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM app.audit('health.assessment.' || NEW.status, 'assessment', NEW.id::text, v_loc, '{}'::jsonb);
    ELSE
      PERFORM app.audit('health.assessment.update', 'assessment', NEW.id::text, v_loc, '{}'::jsonb);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM app.audit('care_plan.create', 'care_plan', NEW.id::text, v_loc,
                      jsonb_build_object('kind', NEW.kind, 'version', NEW.version));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM app.audit('care_plan.' || NEW.status, 'care_plan', NEW.id::text, v_loc,
                      jsonb_build_object('kind', NEW.kind, 'version', NEW.version, 'from', OLD.status));
  ELSE
    PERFORM app.audit('care_plan.update', 'care_plan', NEW.id::text, v_loc,
                      jsonb_build_object('kind', NEW.kind, 'version', NEW.version));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assessment_audit AFTER INSERT OR UPDATE ON app.assessment
  FOR EACH ROW EXECUTE FUNCTION app.health_audit_trigger();
CREATE TRIGGER care_plan_audit AFTER INSERT OR UPDATE ON app.care_plan
  FOR EACH ROW EXECUTE FUNCTION app.health_audit_trigger();

-- ── Definer entry points. Each re-checks claims, role and location; serialises per member where triage and
--    approval compete (advisory lock), and locks the row it transitions.
CREATE FUNCTION app.health_lock_member(p_member uuid) RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('health:' || p_member::text, 0))
$$;

-- Sign a draft assessment: computes and stores the triage. Returns the triage_result id.
CREATE FUNCTION app.sign_assessment(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  a app.assessment;
  v_staff uuid := app.health_staff_id();
  v_minor boolean;
  tr record;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR v_staff IS NULL
     OR app.role() NOT IN ('owner', 'location_manager', 'trainer', 'nutritionist', 'clinician') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM app.assessment WHERE id = p_id AND org_id = app.org_id();
  IF a.id IS NULL OR NOT app.health_staff_can_see(a.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.health_lock_member(a.member_id);
  SELECT * INTO a FROM app.assessment WHERE id = p_id FOR UPDATE;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'assessment_signed_immutable' USING ERRCODE = '42501'; END IF;

  v_minor := EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = a.member_id AND g.org_id = a.org_id);
  SELECT * INTO tr FROM app.health_triage(a.parq, a.parq_followup_resolved, a.declared_conditions,
                                          a.acute_symptoms, v_minor);
  UPDATE app.assessment SET status = 'signed', signed_by = v_staff, signed_at = now() WHERE id = p_id;
  INSERT INTO app.triage_result (org_id, assessment_id, member_id, exercise_level, nutrition_level,
                                 requires_medical_referral, emergency, no_calorie_counting, reasons)
  VALUES (a.org_id, a.id, a.member_id, tr.exercise_level, tr.nutrition_level, tr.requires_medical_referral,
          tr.emergency, tr.no_calorie_counting, tr.reasons)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Load a plan for a transition (locked) after the caller's scope check.
CREATE FUNCTION app.health_plan_for_update(p_id uuid) RETURNS app.care_plan
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan;
BEGIN
  IF app.org_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM app.care_plan WHERE id = p_id AND org_id = app.org_id();
  IF p.id IS NULL OR NOT app.health_staff_can_see(p.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.health_lock_member(p.member_id);
  SELECT * INTO p FROM app.care_plan WHERE id = p_id FOR UPDATE;
  RETURN p;
END $$;

-- Roles that may approve each kind (licence is checked separately).
CREATE FUNCTION app.health_can_approve(p_kind app.care_plan_kind) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE p_kind
    WHEN 'training' THEN coalesce(app.role() IN ('trainer', 'location_manager'), false)
    WHEN 'nutrition' THEN coalesce(app.role() = 'nutritionist', false)
    WHEN 'treatment' THEN coalesce(app.role() = 'clinician', false)
  END
$$;

CREATE FUNCTION app.submit_care_plan(p_id uuid) RETURNS app.care_plan_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
BEGIN
  IF NOT app.health_can_author(p.kind) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p.status <> 'draft' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  UPDATE app.care_plan SET status = 'review', submitted_at = now() WHERE id = p_id;
  RETURN 'review';
END $$;

CREATE FUNCTION app.return_care_plan(p_id uuid) RETURNS app.care_plan_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
BEGIN
  IF NOT (app.health_can_approve(p.kind) OR app.health_can_author(p.kind)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status <> 'review' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  UPDATE app.care_plan SET status = 'draft' WHERE id = p_id;
  RETURN 'draft';
END $$;

-- Approve a plan in review. Training: trainer or location_manager. Nutrition: ONLY a nutritionist staff row with
-- a verified licence, never while the latest nutrition triage is red, amber/referral needs acknowledgement.
-- Treatment: ONLY a clinician with a verified licence. Snapshots name, licence and triage.
CREATE FUNCTION app.approve_care_plan(p_id uuid, p_referral_acknowledged boolean) RETURNS app.care_plan_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
  s app.staff_member;
  tr app.triage_result;
BEGIN
  IF NOT app.health_can_approve(p.kind) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM app.staff_member WHERE id = app.health_staff_id();
  IF s.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p.kind IN ('nutrition', 'treatment') AND (s.license_verified_at IS NULL OR s.license_no IS NULL) THEN
    RAISE EXCEPTION 'license_not_verified' USING ERRCODE = '42501';
  END IF;
  IF p.status <> 'review' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  IF p.kind IN ('training', 'nutrition') THEN
    tr := app.health_latest_triage(p.member_id);
    IF tr.id IS NULL THEN RAISE EXCEPTION 'triage_required' USING ERRCODE = '42501'; END IF;
    IF p.kind = 'training' AND tr.exercise_level = 'red' THEN
      RAISE EXCEPTION 'triage_red_blocks_training' USING ERRCODE = '42501';
    END IF;
    IF p.kind = 'nutrition' AND tr.nutrition_level = 'red' THEN
      RAISE EXCEPTION 'triage_red_blocks_nutrition' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE app.care_plan
     SET status = 'approved', approved_by = s.id, approved_at = now(), approver_name = s.display_name,
         approver_license_no = CASE WHEN p.kind = 'training' THEN NULL ELSE s.license_no END,
         triage_result_id = tr.id, referral_acknowledged = coalesce(p_referral_acknowledged, false)
   WHERE id = p_id;
  RETURN 'approved';
END $$;

-- Publish an approved plan; the previously published version of the same series is archived.
CREATE FUNCTION app.publish_care_plan(p_id uuid) RETURNS app.care_plan_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
BEGIN
  IF NOT (app.health_can_approve(p.kind) OR app.role() IN ('owner', 'location_manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status <> 'approved' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501'; END IF;
  UPDATE app.care_plan SET status = 'archived', archived_at = now()
   WHERE series_id = p.series_id AND status = 'published' AND id <> p_id;
  UPDATE app.care_plan SET status = 'published', published_at = now() WHERE id = p_id;
  RETURN 'published';
END $$;

CREATE FUNCTION app.archive_care_plan(p_id uuid) RETURNS app.care_plan_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
BEGIN
  IF NOT (app.health_can_approve(p.kind) OR app.role() IN ('owner', 'location_manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status NOT IN ('approved', 'published') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501';
  END IF;
  UPDATE app.care_plan SET status = 'archived', archived_at = now() WHERE id = p_id;
  RETURN 'archived';
END $$;

-- Approved/published plans are immutable: a change is a new draft version of the same series.
CREATE FUNCTION app.new_care_plan_version(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.care_plan := app.health_plan_for_update(p_id);
  v_staff uuid := app.health_staff_id();
  v_id uuid;
BEGIN
  IF NOT app.health_can_author(p.kind) OR v_staff IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status NOT IN ('approved', 'published', 'archived') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM app.care_plan WHERE series_id = p.series_id AND status IN ('draft', 'review')) THEN
    RAISE EXCEPTION 'open_version_exists' USING ERRCODE = '23505';
  END IF;
  INSERT INTO app.care_plan (org_id, member_id, series_id, kind, version, title, body, rationale, created_by)
  SELECT p.org_id, p.member_id, p.series_id, p.kind, max(c.version) + 1, p.title, p.body, p.rationale, v_staff
    FROM app.care_plan c WHERE c.series_id = p.series_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── RLS
ALTER TABLE app.assessment    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.assessment    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.triage_result ENABLE ROW LEVEL SECURITY; ALTER TABLE app.triage_result FORCE ROW LEVEL SECURITY;
ALTER TABLE app.care_plan     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.care_plan     FORCE ROW LEVEL SECURITY;

CREATE POLICY definer_all ON app.assessment    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.triage_result TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.care_plan     TO app_definer USING (true) WITH CHECK (true);

-- assessment: health staff of the member's location (owner org-wide); member/guardian only once signed.
CREATE POLICY assessment_select ON app.assessment FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.health_staff_can_see(member_id) OR (status = 'signed' AND app.health_self_or_guardian(member_id))));
CREATE POLICY assessment_insert ON app.assessment FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND status = 'draft' AND signed_by IS NULL
  AND evaluator_staff_id = (SELECT app.health_staff_id())
  AND app.health_staff_can_see(member_id));
CREATE POLICY assessment_update ON app.assessment FOR UPDATE TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND status = 'draft' AND app.health_staff_can_see(member_id))
  WITH CHECK (org_id = (SELECT app.org_id()) AND status = 'draft' AND app.health_staff_can_see(member_id));

-- triage_result: same audience (rows exist only for signed assessments).
CREATE POLICY triage_select ON app.triage_result FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.health_staff_can_see(member_id) OR app.health_self_or_guardian(member_id)));

-- care_plan: health staff see every state; member/guardian only published plans.
CREATE POLICY care_plan_select ON app.care_plan FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id())
  AND (app.health_staff_can_see(member_id) OR (status = 'published' AND app.health_self_or_guardian(member_id))));
CREATE POLICY care_plan_insert ON app.care_plan FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND status = 'draft' AND version = 1 AND approved_by IS NULL
  AND created_by = (SELECT app.health_staff_id())
  AND app.health_can_author(kind) AND app.health_staff_can_see(member_id));
CREATE POLICY care_plan_update ON app.care_plan FOR UPDATE TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND status = 'draft'
         AND app.health_can_author(kind) AND app.health_staff_can_see(member_id))
  WITH CHECK (org_id = (SELECT app.org_id()) AND status = 'draft'
         AND app.health_can_author(kind) AND app.health_staff_can_see(member_id));

-- ── Grants: reads plus draft columns; identity, status and sign-off columns only through definer functions.
REVOKE ALL ON app.assessment, app.triage_result, app.care_plan FROM PUBLIC;
GRANT SELECT ON app.assessment, app.triage_result, app.care_plan TO app_authenticated;
GRANT INSERT (member_id, taken_at, parq, parq_followup_resolved, declared_conditions, resting_hr, bp_sys, bp_dia,
              height_cm, weight_kg, waist_cm, fitness_tests, acute_symptoms) ON app.assessment TO app_authenticated;
GRANT UPDATE (taken_at, parq, parq_followup_resolved, declared_conditions, resting_hr, bp_sys, bp_dia,
              height_cm, weight_kg, waist_cm, fitness_tests, acute_symptoms) ON app.assessment TO app_authenticated;
GRANT INSERT (member_id, kind, title, body, rationale) ON app.care_plan TO app_authenticated;
GRANT UPDATE (title, body, rationale) ON app.care_plan TO app_authenticated;

GRANT SELECT, INSERT, UPDATE ON app.assessment, app.triage_result, app.care_plan TO app_definer;
GRANT SELECT ON app.guardian_link, app.staff_member, app.member TO app_definer;

ALTER FUNCTION app.health_staff_id() OWNER TO app_definer;
ALTER FUNCTION app.health_staff_can_see(uuid) OWNER TO app_definer;
ALTER FUNCTION app.health_self_or_guardian(uuid) OWNER TO app_definer;
ALTER FUNCTION app.health_latest_triage(uuid) OWNER TO app_definer;
ALTER FUNCTION app.assessment_guard() OWNER TO app_definer;
ALTER FUNCTION app.care_plan_guard() OWNER TO app_definer;
ALTER FUNCTION app.health_audit_trigger() OWNER TO app_definer;
ALTER FUNCTION app.sign_assessment(uuid) OWNER TO app_definer;
ALTER FUNCTION app.health_plan_for_update(uuid) OWNER TO app_definer;
ALTER FUNCTION app.submit_care_plan(uuid) OWNER TO app_definer;
ALTER FUNCTION app.return_care_plan(uuid) OWNER TO app_definer;
ALTER FUNCTION app.approve_care_plan(uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app.publish_care_plan(uuid) OWNER TO app_definer;
ALTER FUNCTION app.archive_care_plan(uuid) OWNER TO app_definer;
ALTER FUNCTION app.new_care_plan_version(uuid) OWNER TO app_definer;

REVOKE ALL ON FUNCTION
  app.health_parq_valid(jsonb), app.health_conditions(), app.health_fitness_valid(jsonb), app.health_text_safe(text),
  app.health_plan_body_valid(jsonb), app.health_staff_id(), app.health_staff_can_see(uuid),
  app.health_self_or_guardian(uuid), app.health_can_author(app.care_plan_kind),
  app.health_can_approve(app.care_plan_kind),
  app.health_triage(jsonb, boolean, text[], boolean, boolean), app.health_latest_triage(uuid),
  app.assessment_guard(), app.health_no_delete(), app.care_plan_before_insert(), app.care_plan_guard(),
  app.health_audit_trigger(), app.health_lock_member(uuid), app.sign_assessment(uuid),
  app.health_plan_for_update(uuid), app.submit_care_plan(uuid), app.return_care_plan(uuid),
  app.approve_care_plan(uuid, boolean), app.publish_care_plan(uuid), app.archive_care_plan(uuid),
  app.new_care_plan_version(uuid)
FROM PUBLIC;
-- Validators, defaults and policy helpers run in the caller's context; the pure triage is callable for previews.
GRANT EXECUTE ON FUNCTION
  app.health_parq_valid(jsonb), app.health_conditions(), app.health_fitness_valid(jsonb), app.health_text_safe(text),
  app.health_plan_body_valid(jsonb), app.health_staff_id(), app.health_staff_can_see(uuid),
  app.health_self_or_guardian(uuid), app.health_can_author(app.care_plan_kind),
  app.health_can_approve(app.care_plan_kind), app.health_triage(jsonb, boolean, text[], boolean, boolean),
  app.sign_assessment(uuid), app.submit_care_plan(uuid), app.return_care_plan(uuid),
  app.approve_care_plan(uuid, boolean), app.publish_care_plan(uuid), app.archive_care_plan(uuid),
  app.new_care_plan_version(uuid)
TO app_authenticated;
-- Internal helpers: only other app_definer functions may call them.
GRANT EXECUTE ON FUNCTION
  app.health_parq_valid(jsonb), app.health_conditions(), app.health_fitness_valid(jsonb), app.health_text_safe(text),
  app.health_plan_body_valid(jsonb), app.health_can_author(app.care_plan_kind),
  app.health_can_approve(app.care_plan_kind), app.health_triage(jsonb, boolean, text[], boolean, boolean),
  app.health_latest_triage(uuid), app.health_lock_member(uuid), app.health_plan_for_update(uuid),
  app.health_staff_id(), app.health_staff_can_see(uuid), app.health_self_or_guardian(uuid)
TO app_definer;
