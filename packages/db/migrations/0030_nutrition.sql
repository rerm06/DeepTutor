-- Module nutrition (owner request 2026-11-08, docs/nutricion/). Structured weekly eating plans linked to every
-- member, drafted with AI inside numbers computed by code, reviewed by people before the member sees anything.
--
-- REGULATED DOMAIN (Puerto Rico, Ley 82 de 1972; spec v0.5 §6.7). Nothing here diagnoses or prescribes on its own:
--   * blocks (minor, pregnancy, lactation, diabetes, kidney, cardiovascular, eating disorder current or past, appetite
--     or weight medication, BMI < 18.5, unsafe loss rate, missing weight or height) are re-checked in SQL whatever the
--     API computed;
--   * a plan reaches the member only after the owner (or location manager) approves it AND a nutritionist with a
--     verified licence approves it (Ley 82; AGENTS.md rule 4: no plan published without a licensed signature);
--   * every food value comes from app.food (USDA FoodData Central, migration 0031); item calories and macros are
--     computed here from grams × per-100 g values, never taken from a model;
--   * nothing is overwritten: an edit is a new version of the plan series; items are insert-only.
--
--   app.food / app.food_portion           global reference catalog (no tenant data), read-only for everyone
--   app.nutrition_settings                per organisation: safety limits and models
--   app.nutrition_profile                 one per member (created for every existing member here)
--   app.nutrition_measurement             body measurements with provenance (assessment / declared / staff)
--   app.nutrition_plan / _plan_item       versioned weekly plan and its foods

-- ── Reference catalog ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.food (
  fdc_id integer PRIMARY KEY CHECK (fdc_id > 0),
  source text NOT NULL CHECK (source = 'usda_fdc'),
  source_release text NOT NULL CHECK (source_release ~ '^[a-z_]+_[0-9]{4}-[0-9]{2}$'),
  name_es text NOT NULL CHECK (length(name_es) BETWEEN 2 AND 120),
  name_usda text NOT NULL CHECK (length(name_usda) BETWEEN 2 AND 300),
  food_group text NOT NULL CHECK (food_group IN ('cereal', 'pan', 'legumbre', 'vianda', 'fruta', 'vegetal', 'ave',
    'cerdo', 'res', 'pescado', 'marisco', 'huevo', 'lacteo', 'grasa', 'nuez', 'azucar', 'bebida')),
  allergens text[] NOT NULL DEFAULT '{}' CHECK (allergens <@ ARRAY['leche', 'huevo', 'pescado', 'marisco',
    'nuez_arbol', 'mani', 'trigo', 'soya', 'sesamo']::text[]),
  diet_tags text[] NOT NULL DEFAULT '{}' CHECK (diet_tags <@ ARRAY['ave', 'cerdo', 'res', 'pescado', 'marisco',
    'huevo', 'lacteo', 'miel']::text[]),
  -- per 100 g of edible portion
  kcal numeric(7, 2) NOT NULL CHECK (kcal BETWEEN 0 AND 950),
  protein_g numeric(6, 2) NOT NULL CHECK (protein_g BETWEEN 0 AND 100),
  carb_g numeric(6, 2) NOT NULL CHECK (carb_g BETWEEN 0 AND 100),
  fat_g numeric(6, 2) NOT NULL CHECK (fat_g BETWEEN 0 AND 100),
  fiber_g numeric(6, 2) CHECK (fiber_g BETWEEN 0 AND 100),
  sugar_g numeric(6, 2) CHECK (sugar_g BETWEEN 0 AND 100),
  sodium_mg numeric(8, 2) CHECK (sodium_mg BETWEEN 0 AND 40000),
  sat_fat_g numeric(6, 2) CHECK (sat_fat_g BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE app.food_portion (
  fdc_id integer NOT NULL REFERENCES app.food (fdc_id),
  seq integer NOT NULL CHECK (seq BETWEEN 0 AND 1000),
  amount numeric(8, 3) NOT NULL CHECK (amount > 0),
  label_usda text NOT NULL CHECK (length(label_usda) BETWEEN 1 AND 200),
  label_es text NOT NULL CHECK (length(label_es) BETWEEN 1 AND 200),
  gram_weight numeric(8, 2) NOT NULL CHECK (gram_weight > 0),
  PRIMARY KEY (fdc_id, seq)
);

-- ── Organisation settings (defaults are the decisions in docs/nutricion/STATE.md, all editable by the owner) ──
CREATE TABLE app.nutrition_settings (
  org_id uuid PRIMARY KEY DEFAULT app.org_id() REFERENCES app.organization (id),
  max_loss_pct_week numeric(4, 2) NOT NULL DEFAULT 1.00 CHECK (max_loss_pct_week BETWEEN 0.10 AND 1.00),
  max_gain_pct_week numeric(4, 2) NOT NULL DEFAULT 0.50 CHECK (max_gain_pct_week BETWEEN 0.10 AND 1.00),
  protein_min_g_kg numeric(3, 1) NOT NULL DEFAULT 1.4 CHECK (protein_min_g_kg BETWEEN 1.4 AND 2.0),
  protein_max_g_kg numeric(3, 1) NOT NULL DEFAULT 2.0 CHECK (protein_max_g_kg BETWEEN 1.4 AND 2.0),
  fat_min_pct numeric(4, 1) NOT NULL DEFAULT 20.0 CHECK (fat_min_pct BETWEEN 20 AND 35),
  day_tolerance_pct numeric(4, 1) NOT NULL DEFAULT 5.0 CHECK (day_tolerance_pct BETWEEN 1 AND 15),
  plan_model text NOT NULL DEFAULT 'gemini-3.8-flash' CHECK (plan_model ~ '^[a-z0-9][a-z0-9.\-]{2,60}$'),
  light_model text NOT NULL DEFAULT 'gemini-3.1-flash-lite' CHECK (light_model ~ '^[a-z0-9][a-z0-9.\-]{2,60}$'),
  fallback_model text CHECK (fallback_model ~ '^[a-z0-9][a-z0-9.\-]{2,60}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (protein_min_g_kg <= protein_max_g_kg)
);

-- Health questionnaire answers: a closed set of yes/no keys (no free text).
CREATE FUNCTION app.nutrition_answers_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e record;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  -- All 8 questions must be answered: an empty or partial questionnaire never counts as "no".
  IF (SELECT count(*) FROM jsonb_object_keys(p)) <> 8 THEN RETURN false; END IF;
  FOR e IN SELECT * FROM jsonb_each(p) LOOP
    IF e.key NOT IN ('embarazo', 'lactancia', 'diabetes', 'enfermedad_renal', 'enfermedad_cardiovascular',
                     'tca_actual', 'tca_pasado', 'medicamento_apetito_peso') OR jsonb_typeof(e.value) <> 'boolean' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- ── Member profile ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.nutrition_profile (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  goal text CHECK (goal IN ('perder_grasa', 'ganar_masa', 'mantener', 'rendimiento')),
  rate_pct_week numeric(4, 2) CHECK (rate_pct_week BETWEEN 0 AND 2),
  target_date date,
  birth_date date CHECK (birth_date BETWEEN DATE '1900-01-01' AND DATE '2100-01-01'),
  -- Sex used by the predictive equations (Mifflin-St Jeor, Deurenberg), declared and explained to the member.
  sex_for_equations text CHECK (sex_for_equations IN ('femenino', 'masculino')),
  -- Daily movement outside planned exercise.
  daily_activity text CHECK (daily_activity IN ('sedentario', 'ligero', 'activo')),
  allergens text[] NOT NULL DEFAULT '{}' CHECK (allergens <@ ARRAY['leche', 'huevo', 'pescado', 'marisco',
    'nuez_arbol', 'mani', 'trigo', 'soya', 'sesamo']::text[]),
  diet_exclusions text[] NOT NULL DEFAULT '{}' CHECK (diet_exclusions <@ ARRAY['ave', 'cerdo', 'res', 'pescado',
    'marisco', 'huevo', 'lacteo', 'miel']::text[]),
  liked_foods integer[] NOT NULL DEFAULT '{}' CHECK (cardinality(liked_foods) <= 200),
  disliked_foods integer[] NOT NULL DEFAULT '{}' CHECK (cardinality(disliked_foods) <= 200),
  -- Health questionnaire: closed set of yes/no answers, never free text.
  health_answers jsonb CHECK (health_answers IS NULL OR app.nutrition_answers_valid(health_answers)),
  health_answered_at timestamptz,
  disclaimer_accepted_at timestamptz,
  status text NOT NULL DEFAULT 'incompleto' CHECK (status IN ('incompleto', 'apto', 'requiere_profesional')),
  status_reasons text[] NOT NULL DEFAULT '{}',
  -- Safety blocks seen at any time (fifth iteration): a block enters as soon as any input raises it and leaves only
  -- through app.nutrition_sync with a releaser allowed to lift it — never because another module overwrote an input.
  held_blocks text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (member_id),
  UNIQUE (org_id, member_id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);

CREATE TABLE app.nutrition_measurement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('declarado', 'personal')),
  weight_kg numeric(5, 1) CHECK (weight_kg BETWEEN 20 AND 350),
  height_cm numeric(5, 1) CHECK (height_cm BETWEEN 50 AND 250),
  body_fat_pct numeric(4, 1) CHECK (body_fat_pct BETWEEN 3 AND 70),
  body_fat_method text CHECK (body_fat_method IN ('bioimpedancia', 'pliegues', 'dexa', 'otro')),
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK (num_nonnulls(weight_kg, height_cm, body_fat_pct) >= 1),
  CHECK ((body_fat_pct IS NULL) = (body_fat_method IS NULL))
);
CREATE INDEX nutrition_measurement_member_idx ON app.nutrition_measurement (member_id, taken_at DESC);

-- ── Plans ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE app.nutrition_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  series_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status text NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador', 'en_revision', 'aprobado', 'enviado', 'archivado', 'rechazado')),
  origin text NOT NULL CHECK (origin IN ('manual', 'ia', 'formulario_socio', 'cambio_rutina', 'cambio_evaluacion')),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),        -- snapshot of the data used, with provenance
  calc jsonb NOT NULL CHECK (jsonb_typeof(calc) = 'object'),            -- per-day targets computed by code
  justification jsonb CHECK (justification IS NULL OR jsonb_typeof(justification) = 'object'),
  verifier jsonb CHECK (verifier IS NULL OR jsonb_typeof(verifier) = 'object'),
  model text CHECK (model ~ '^[a-z0-9][a-z0-9.\-]{2,60}$'),
  prompt_version text CHECK (prompt_version ~ '^[a-z0-9._-]{1,40}$'),
  previous_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  licensed_by uuid,
  licensed_at timestamptz,
  license_no text,
  sent_at timestamptz,
  archived_at timestamptz,
  rejected_reason text CHECK (rejected_reason IS NULL OR length(rejected_reason) BETWEEN 3 AND 500),
  outdated_reason text CHECK (outdated_reason IS NULL OR length(outdated_reason) BETWEEN 3 AND 200),
  UNIQUE (org_id, id),
  UNIQUE (series_id, version),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, previous_id) REFERENCES app.nutrition_plan (org_id, id),
  CHECK (status IN ('borrador', 'en_revision', 'rechazado') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'enviado' OR sent_at IS NOT NULL),
  CHECK ((licensed_by IS NULL) = (licensed_at IS NULL) AND (licensed_by IS NULL) = (license_no IS NULL)),
  CHECK ((status = 'rechazado') = (rejected_reason IS NOT NULL)),
  -- Nothing reaches the member without the licensed approval (Ley 82; AGENTS.md rule 4), whatever path writes it.
  CHECK (status <> 'enviado' OR licensed_by IS NOT NULL),
  CHECK (sent_at IS NULL OR licensed_by IS NOT NULL),
  CHECK (origin NOT IN ('ia', 'formulario_socio', 'cambio_rutina', 'cambio_evaluacion')
         OR (model IS NOT NULL AND prompt_version IS NOT NULL))
);
CREATE INDEX nutrition_plan_member_idx ON app.nutrition_plan (org_id, member_id, week_start DESC, version DESC);
CREATE INDEX nutrition_plan_queue_idx ON app.nutrition_plan (org_id, status, created_at);

CREATE TABLE app.nutrition_plan_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  plan_id uuid NOT NULL,
  day smallint NOT NULL CHECK (day BETWEEN 1 AND 7),          -- ISO weekday of week_start's week
  meal text NOT NULL CHECK (meal IN ('desayuno', 'merienda_am', 'almuerzo', 'merienda_pm', 'cena')),
  dish text NOT NULL CHECK (length(dish) BETWEEN 2 AND 120 AND dish !~ '[<>{}\r\n]'),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 40),
  fdc_id integer NOT NULL REFERENCES app.food (fdc_id),
  grams numeric(6, 1) NOT NULL CHECK (grams > 0 AND grams <= 1500),
  household text CHECK (household IS NULL OR (length(household) <= 80 AND household !~ '[<>{}\r\n]')),
  -- Computed from app.food at insert (trigger); never from a model.
  kcal numeric(7, 1) NOT NULL,
  protein_g numeric(6, 1) NOT NULL,
  carb_g numeric(6, 1) NOT NULL,
  fat_g numeric(6, 1) NOT NULL,
  UNIQUE (plan_id, day, meal, position),
  FOREIGN KEY (org_id, plan_id) REFERENCES app.nutrition_plan (org_id, id) ON DELETE CASCADE
);

-- ── Pure validators and helpers ────────────────────────────────────────────────────────────────────────────────

-- Item values from the catalog (grams × per-100 g), rounded to 0.1.
CREATE FUNCTION app.nutrition_item_compute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE f app.food;
BEGIN
  SELECT * INTO f FROM app.food WHERE fdc_id = NEW.fdc_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'food_not_in_catalog' USING ERRCODE = '22023'; END IF;
  NEW.kcal := round(f.kcal * NEW.grams / 100, 1);
  NEW.protein_g := round(f.protein_g * NEW.grams / 100, 1);
  NEW.carb_g := round(f.carb_g * NEW.grams / 100, 1);
  NEW.fat_g := round(f.fat_g * NEW.grams / 100, 1);
  RETURN NEW;
END $$;
CREATE TRIGGER nutrition_item_compute BEFORE INSERT ON app.nutrition_plan_item
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_item_compute();
-- Items are insert-only: an edit is a new plan version.
CREATE FUNCTION app.nutrition_item_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plan_items_are_immutable' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER nutrition_item_frozen BEFORE UPDATE ON app.nutrition_plan_item
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_item_frozen();

-- Staff who may write a member's nutrition data: owner, location_manager, nutritionist of the member's location
-- (owner org-wide). Readers follow the health rule (app.health_staff_can_see) plus the member and guardian.
CREATE FUNCTION app.nutrition_can_write(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'nutritionist'), false) AND app.health_staff_can_see(p_member)
$$;

-- Every function that returns health data about a member checks this first (no cross-org, no front desk, chef or
-- accountant). Raises instead of returning nothing so a wrong caller is visible.
CREATE FUNCTION app.nutrition_assert_reader(p_member uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR NOT EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id())
     OR NOT (app.health_staff_can_see(p_member) OR app.health_self_or_guardian(p_member)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END $$;

-- Latest weight, height and body fat with provenance: the newest of the signed assessment and the nutrition
-- measurements, per field.
CREATE FUNCTION app.nutrition_latest_body(p_member uuid)
RETURNS TABLE (weight_kg numeric, weight_source text, weight_at timestamptz, height_cm numeric, height_source text,
               height_at timestamptz, body_fat_pct numeric, body_fat_method text, body_fat_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.nutrition_assert_reader(p_member);
  RETURN QUERY
  WITH src AS (
    SELECT a.weight_kg, a.height_cm, NULL::numeric AS body_fat_pct, NULL::text AS body_fat_method,
           'evaluacion'::text AS source, a.signed_at AS at
      FROM app.assessment a WHERE a.member_id = p_member AND a.status = 'signed'
    UNION ALL
    SELECT m.weight_kg, m.height_cm, m.body_fat_pct, m.body_fat_method,
           CASE m.source WHEN 'personal' THEN 'medido_personal' ELSE 'declarado' END, m.taken_at
      FROM app.nutrition_measurement m WHERE m.member_id = p_member)
  SELECT w.weight_kg, w.source, w.at, h.height_cm, h.source, h.at, f.body_fat_pct, f.body_fat_method, f.at
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT * FROM src WHERE src.weight_kg IS NOT NULL ORDER BY src.at DESC LIMIT 1) w ON true
    LEFT JOIN LATERAL (SELECT * FROM src WHERE src.height_cm IS NOT NULL ORDER BY src.at DESC LIMIT 1) h ON true
    LEFT JOIN LATERAL (SELECT * FROM src WHERE src.body_fat_pct IS NOT NULL ORDER BY src.at DESC LIMIT 1) f ON true;
END $$;

-- Hard blocks (the API shows the same list with its explanation). BMI is checked against BOTH the latest value of
-- any provenance and the latest value measured by staff or a signed assessment in the last 365 days, and the more
-- conservative one wins: a newer declared weight never lifts a low-BMI block that a measurement raised.
CREATE FUNCTION app.nutrition_blocks_raw(p_member uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  p app.nutrition_profile;
  tr app.triage_result;
  v_conditions text[];
  r text[] := '{}';
  w numeric; h numeric; mw numeric; mh numeric; hmax numeric;
BEGIN
  SELECT * INTO p FROM app.nutrition_profile WHERE member_id = p_member;
  IF NOT FOUND THEN RETURN ARRAY['sin_perfil']; END IF;
  IF p.health_answers IS NULL THEN r := array_append(r, 'cuestionario_pendiente'); END IF;
  IF p.disclaimer_accepted_at IS NULL THEN r := array_append(r, 'aviso_pendiente'); END IF;
  IF p.birth_date IS NULL OR p.sex_for_equations IS NULL OR p.goal IS NULL OR p.daily_activity IS NULL THEN
    r := array_append(r, 'datos_insuficientes');
  END IF;
  IF p.birth_date IS NOT NULL AND age(current_date, p.birth_date) < interval '18 years' THEN r := array_append(r, 'menor_de_edad'); END IF;
  IF EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = p_member) THEN r := array_append(r, 'menor_de_edad'); END IF;
  IF coalesce((p.health_answers ->> 'embarazo')::boolean, false) THEN r := array_append(r, 'embarazo'); END IF;
  IF coalesce((p.health_answers ->> 'lactancia')::boolean, false) THEN r := array_append(r, 'lactancia'); END IF;
  IF coalesce((p.health_answers ->> 'diabetes')::boolean, false) THEN r := array_append(r, 'diabetes'); END IF;
  IF coalesce((p.health_answers ->> 'enfermedad_renal')::boolean, false) THEN r := array_append(r, 'enfermedad_renal'); END IF;
  IF coalesce((p.health_answers ->> 'enfermedad_cardiovascular')::boolean, false) THEN r := array_append(r, 'enfermedad_cardiovascular'); END IF;
  IF coalesce((p.health_answers ->> 'tca_actual')::boolean, false)
     OR coalesce((p.health_answers ->> 'tca_pasado')::boolean, false) THEN r := array_append(r, 'tca'); END IF;
  IF coalesce((p.health_answers ->> 'medicamento_apetito_peso')::boolean, false) THEN r := array_append(r, 'medicamento_apetito_peso'); END IF;
  tr := app.health_latest_triage(p_member);
  IF tr.id IS NOT NULL THEN
    IF tr.nutrition_level = 'red' OR tr.requires_medical_referral OR tr.no_calorie_counting THEN
      r := array_append(r, 'triaje_requiere_profesional');
    END IF;
    SELECT a.declared_conditions INTO v_conditions FROM app.assessment a WHERE a.id = tr.assessment_id;
    IF coalesce(v_conditions, '{}') && ARRAY['diabetes', 'ckd', 'advanced_ckd', 'cvd', 'pregnancy', 'lactation',
         'high_risk_pregnancy', 'glp1', 'eating_disorder_screen_positive', 'active_ed'] THEN
      r := array_append(r, 'condicion_en_evaluacion');
    END IF;
  END IF;
  -- Latest weight of any provenance, divided by the TALLEST height ever recorded (any provenance): the lowest,
  -- most cautious BMI, so declaring a shorter height never lifts the block (third review, B3).
  SELECT x.weight_kg FROM (
    SELECT a.weight_kg, a.signed_at AS at FROM app.assessment a
     WHERE a.member_id = p_member AND a.status = 'signed' AND a.weight_kg IS NOT NULL
    UNION ALL SELECT m.weight_kg, m.taken_at FROM app.nutrition_measurement m
     WHERE m.member_id = p_member AND m.weight_kg IS NOT NULL) x ORDER BY x.at DESC LIMIT 1 INTO w;
  SELECT max(x.height_cm) INTO hmax FROM (
    SELECT a.height_cm FROM app.assessment a WHERE a.member_id = p_member AND a.status = 'signed'
    UNION ALL SELECT m.height_cm FROM app.nutrition_measurement m WHERE m.member_id = p_member) x;
  h := hmax;
  IF w IS NULL OR h IS NULL THEN
    r := array_append(r, 'falta_peso_o_estatura');
  ELSIF w / ((h / 100) ^ 2) < 18.5 THEN
    r := array_append(r, 'imc_bajo');
  END IF;
  WITH measured AS (
    SELECT a.weight_kg, a.height_cm, a.signed_at AS at FROM app.assessment a
     WHERE a.member_id = p_member AND a.status = 'signed' AND a.signed_at > now() - interval '365 days'
    UNION ALL
    SELECT m.weight_kg, m.height_cm, m.taken_at FROM app.nutrition_measurement m
     WHERE m.member_id = p_member AND m.source = 'personal' AND m.taken_at > now() - interval '365 days')
  SELECT (SELECT weight_kg FROM measured WHERE weight_kg IS NOT NULL ORDER BY at DESC LIMIT 1) INTO mw;
  -- The measured weight, also over the tallest height on record.
  mh := hmax;
  IF mw IS NOT NULL AND mh IS NOT NULL AND mw / ((mh / 100) ^ 2) < 18.5 THEN
    r := array_append(r, 'imc_bajo');
  END IF;
  IF p.goal = 'perder_grasa' AND p.rate_pct_week IS NOT NULL AND p.rate_pct_week >
       (SELECT coalesce(max(s.max_loss_pct_week), 1.00) FROM app.nutrition_settings s WHERE s.org_id = p.org_id) THEN
    r := array_append(r, 'ritmo_inseguro');
  END IF;
  RETURN ARRAY(SELECT DISTINCT unnest(r) ORDER BY 1);
END $$;

-- Safety blocks that are held once seen (all but ritmo_inseguro, which compares two live settings and is re-checked
-- on every plan), and the subset the member may release by correcting their own questionnaire.
CREATE FUNCTION app.nutrition_held_reasons() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['menor_de_edad', 'embarazo', 'lactancia', 'diabetes', 'enfermedad_renal', 'enfermedad_cardiovascular',
               'tca', 'medicamento_apetito_peso', 'triaje_requiere_profesional', 'condicion_en_evaluacion', 'imc_bajo']
$$;
CREATE FUNCTION app.nutrition_self_releasable() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['embarazo', 'lactancia', 'diabetes', 'enfermedad_renal', 'enfermedad_cardiovascular', 'tca',
               'medicamento_apetito_peso']
$$;

-- Effective blocks: what the inputs say now plus every safety block held since it was first seen. A later input
-- from another module (a clean assessment signed by a trainer, a heavier weight) can change the first part only.
CREATE FUNCTION app.nutrition_blocks_internal(p_member uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT ARRAY(SELECT DISTINCT b FROM (
    SELECT unnest(app.nutrition_blocks_raw(p_member)) AS b
    UNION ALL SELECT unnest(p.held_blocks) FROM app.nutrition_profile p WHERE p.member_id = p_member) x
    WHERE b IS NOT NULL ORDER BY 1)
$$;

-- Public reader: same list, only for the member, their guardian and health staff of their location.
CREATE FUNCTION app.nutrition_blocks(p_member uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.nutrition_assert_reader(p_member);
  RETURN app.nutrition_blocks_internal(p_member);
END $$;

-- Safety blocks (not the completeness ones) that a change may not lift unless it comes from the member themself or
-- a nutritionist / clinician of their location — the "ratchet" chosen after the third review (approach B): one rule
-- for every input, present and future, instead of guarding fields one by one.
CREATE FUNCTION app.nutrition_safety_reasons() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['menor_de_edad', 'embarazo', 'lactancia', 'diabetes', 'enfermedad_renal', 'enfermedad_cardiovascular',
               'tca', 'medicamento_apetito_peso', 'triaje_requiere_profesional', 'condicion_en_evaluacion', 'imc_bajo',
               'ritmo_inseguro']
$$;
CREATE FUNCTION app.nutrition_is_professional(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('nutritionist', 'clinician'), false) AND app.health_staff_can_see(p_member)
$$;
CREATE FUNCTION app.nutrition_ratchet(p_member uuid, p_before text[], p_self boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_lifted text[];
BEGIN
  -- Compared on the live inputs (p_before is app.nutrition_blocks_raw before the write), so a direct write that
  -- would lift a block fails loudly; the held list (app.nutrition_sync) is what keeps it for every other path.
  v_lifted := ARRAY(SELECT unnest(p_before) INTERSECT SELECT unnest(app.nutrition_safety_reasons())
                    EXCEPT SELECT unnest(app.nutrition_blocks_raw(p_member)));
  IF cardinality(v_lifted) > 0 AND NOT (p_self OR app.nutrition_is_professional(p_member)) THEN
    RAISE EXCEPTION 'forbidden_block_removal:%', array_to_string(v_lifted, ',') USING ERRCODE = '42501';
  END IF;
  -- Lifts of blocks that were not held yet are audited here; releases of held ones by app.nutrition_sync.
  v_lifted := ARRAY(SELECT unnest(v_lifted) EXCEPT SELECT unnest(held_blocks)
                      FROM app.nutrition_profile WHERE member_id = p_member);
  IF cardinality(v_lifted) > 0 THEN
    PERFORM app.audit('nutrition.block_lifted', 'nutrition_profile', p_member::text,
      (SELECT home_location_id FROM app.member WHERE id = p_member),
      jsonb_build_object('by', CASE WHEN p_self THEN 'socio' ELSE app.role()::text END, 'blocks', to_jsonb(v_lifted)));
  END IF;
END $$;

-- Recompute the profile status. Every safety block the inputs raise now is added to the held list; a held block
-- leaves it only when the inputs no longer raise it AND the releaser may lift it: 'professional' (a nutritionist or
-- clinician of the member's location) any of them, 'self' (the member) only the answers of their own questionnaire,
-- 'none' nothing. Every release is audited. When the member needs a professional, the plan in front of them is
-- withdrawn at once and hidden (outdated_reason 'requiere_profesional', whatever reason it carried before).
CREATE FUNCTION app.nutrition_sync(p_member uuid, p_releaser text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_raw text[] := app.nutrition_blocks_raw(p_member);
  v_held text[];
  v_release text[];
  v_reasons text[];
BEGIN
  SELECT ARRAY(SELECT DISTINCT b FROM (SELECT unnest(held_blocks) b
                                       UNION ALL (SELECT unnest(v_raw) INTERSECT SELECT unnest(app.nutrition_held_reasons()))) x
                ORDER BY 1)
    INTO v_held FROM app.nutrition_profile WHERE member_id = p_member FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_release := ARRAY((SELECT unnest(v_held) EXCEPT SELECT unnest(v_raw))
                     INTERSECT SELECT unnest(CASE p_releaser WHEN 'professional' THEN app.nutrition_held_reasons()
                                                             WHEN 'self' THEN app.nutrition_self_releasable()
                                                             ELSE '{}'::text[] END));
  IF cardinality(v_release) > 0 THEN
    v_held := ARRAY(SELECT unnest(v_held) EXCEPT SELECT unnest(v_release) ORDER BY 1);
    PERFORM app.audit('nutrition.block_lifted', 'nutrition_profile', p_member::text,
      (SELECT home_location_id FROM app.member WHERE id = p_member),
      jsonb_build_object('by', CASE p_releaser WHEN 'self' THEN 'socio' ELSE app.role()::text END,
                         'blocks', to_jsonb(v_release)));
  END IF;
  v_reasons := ARRAY(SELECT DISTINCT b FROM (SELECT unnest(v_raw) b UNION ALL SELECT unnest(v_held)) x ORDER BY 1);
  IF v_reasons && app.nutrition_safety_reasons() THEN
    UPDATE app.nutrition_plan SET status = 'archivado', archived_at = now(), outdated_reason = 'requiere_profesional'
     WHERE member_id = p_member AND status = 'enviado';
  END IF;
  UPDATE app.nutrition_profile SET
    held_blocks = v_held,
    status = CASE
      WHEN v_reasons && app.nutrition_safety_reasons() THEN 'requiere_profesional'
      WHEN cardinality(v_reasons) = 0 THEN 'apto'
      ELSE 'incompleto' END,
    status_reasons = v_reasons
  WHERE member_id = p_member;
  RETURN (SELECT status FROM app.nutrition_profile WHERE member_id = p_member);
END $$;
CREATE FUNCTION app.nutrition_refresh_status(p_member uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.nutrition_sync(p_member, 'none')
$$;

-- A nutritionist or clinician of the member's location releases the held blocks the inputs no longer raise (for
-- example after a clean assessment signed by a trainer), with a stated reason. Returns the new status.
CREATE FUNCTION app.nutrition_release_blocks(p_member uuid, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF app.org_id() IS NULL OR NOT app.nutrition_is_professional(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  v_status := app.nutrition_sync(p_member, 'professional');
  PERFORM app.audit('nutrition.release_blocks', 'nutrition_profile', p_member::text,
    (SELECT home_location_id FROM app.member WHERE id = p_member),
    jsonb_build_object('reason', btrim(p_reason), 'status', v_status));
  RETURN v_status;
END $$;

-- ── Writes (definer functions; request traffic has no direct write grants) ─────────────────────────────────────
-- Save the profile (staff writer, or the member for themself). Health answers: only the member themself, or a
-- nutritionist / clinician of their location, may set them, and they merge into the existing answers (the CHECK
-- requires all 8). Any change that affects targets or exclusions marks the open plans outdated.
CREATE FUNCTION app.nutrition_profile_save(p_member uuid, p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_self boolean := EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id()
                             AND m.person_id = app.person_id() AND app.role() = 'member');
  v_loc uuid;
  v_old app.nutrition_profile;
  v_new app.nutrition_profile;
  v_before text[];
BEGIN
  IF app.org_id() IS NULL OR NOT (v_self OR app.nutrition_can_write(p_member)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.nutrition_profile (org_id, member_id) VALUES (app.org_id(), p_member) ON CONFLICT DO NOTHING;
  SELECT * INTO v_old FROM app.nutrition_profile WHERE member_id = p_member FOR UPDATE;
  v_before := app.nutrition_blocks_raw(p_member);
  IF p ? 'health_answers' AND NOT (v_self OR (app.role() IN ('nutritionist', 'clinician')
                                               AND app.health_staff_can_see(p_member))) THEN
    RAISE EXCEPTION 'forbidden_health_answers' USING ERRCODE = '42501';
  END IF;
  -- Removing an allergen or a diet exclusion loosens a hard safety exclusion: only the member themself, or a
  -- nutritionist / clinician of their location, may do it. Staff may always add.
  IF NOT (v_self OR (app.role() IN ('nutritionist', 'clinician') AND app.health_staff_can_see(p_member))) AND (
       (p ? 'allergens' AND EXISTS (SELECT 1 FROM unnest(v_old.allergens) a
                                     WHERE a NOT IN (SELECT jsonb_array_elements_text(p -> 'allergens'))))
    OR (p ? 'diet_exclusions' AND EXISTS (SELECT 1 FROM unnest(v_old.diet_exclusions) a
                                     WHERE a NOT IN (SELECT jsonb_array_elements_text(p -> 'diet_exclusions'))))) THEN
    RAISE EXCEPTION 'forbidden_exclusion_removal' USING ERRCODE = '42501';
  END IF;
  IF (p ? 'liked_foods' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p -> 'liked_foods') x
                                     WHERE NOT EXISTS (SELECT 1 FROM app.food f WHERE f.fdc_id = x::integer)))
     OR (p ? 'disliked_foods' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p -> 'disliked_foods') x
                                     WHERE NOT EXISTS (SELECT 1 FROM app.food f WHERE f.fdc_id = x::integer))) THEN
    RAISE EXCEPTION 'unknown_food' USING ERRCODE = '22023';
  END IF;
  UPDATE app.nutrition_profile SET
    goal = CASE WHEN p ? 'goal' THEN p ->> 'goal' ELSE goal END,
    rate_pct_week = CASE WHEN p ? 'rate_pct_week' THEN (p ->> 'rate_pct_week')::numeric ELSE rate_pct_week END,
    target_date = CASE WHEN p ? 'target_date' THEN (p ->> 'target_date')::date ELSE target_date END,
    birth_date = CASE WHEN p ? 'birth_date' THEN (p ->> 'birth_date')::date ELSE birth_date END,
    sex_for_equations = CASE WHEN p ? 'sex_for_equations' THEN p ->> 'sex_for_equations' ELSE sex_for_equations END,
    daily_activity = CASE WHEN p ? 'daily_activity' THEN p ->> 'daily_activity' ELSE daily_activity END,
    allergens = CASE WHEN p ? 'allergens' THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'allergens')) ELSE allergens END,
    diet_exclusions = CASE WHEN p ? 'diet_exclusions'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'diet_exclusions')) ELSE diet_exclusions END,
    liked_foods = CASE WHEN p ? 'liked_foods'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'liked_foods')::integer) ELSE liked_foods END,
    disliked_foods = CASE WHEN p ? 'disliked_foods'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'disliked_foods')::integer) ELSE disliked_foods END,
    health_answers = CASE WHEN p ? 'health_answers'
      THEN coalesce(health_answers, '{}'::jsonb) || (p -> 'health_answers') ELSE health_answers END,
    health_answered_at = CASE WHEN p ? 'health_answers' THEN now() ELSE health_answered_at END,
    disclaimer_accepted_at = CASE WHEN coalesce((p ->> 'accept_disclaimer')::boolean, false) AND v_self
      THEN coalesce(disclaimer_accepted_at, now()) ELSE disclaimer_accepted_at END,
    updated_at = now(),
    updated_by = app.person_id()
  WHERE member_id = p_member;
  IF p ?| ARRAY['goal', 'rate_pct_week', 'birth_date', 'sex_for_equations', 'daily_activity', 'allergens',
                'diet_exclusions', 'health_answers'] THEN
    UPDATE app.nutrition_plan SET outdated_reason = 'perfil_cambio'
     WHERE member_id = p_member AND status IN ('borrador', 'en_revision', 'aprobado', 'enviado')
       AND outdated_reason IS NULL;
  END IF;
  PERFORM app.nutrition_ratchet(p_member, v_before, v_self);
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  SELECT * INTO v_new FROM app.nutrition_profile WHERE member_id = p_member;
  -- The audit names the fields that changed and who changed them; for the hard exclusions it also keeps which codes
  -- were added and removed (so the licensed reviewer can see a loosened exclusion). Health answers: never values.
  PERFORM app.audit('nutrition.profile_save', 'nutrition_profile', p_member::text, v_loc,
    jsonb_build_object('by', CASE WHEN v_self THEN 'socio' ELSE app.role()::text END,
      'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k),
      'allergens_added', to_jsonb(ARRAY(SELECT unnest(v_new.allergens) EXCEPT SELECT unnest(v_old.allergens))),
      'allergens_removed', to_jsonb(ARRAY(SELECT unnest(v_old.allergens) EXCEPT SELECT unnest(v_new.allergens))),
      'exclusions_added', to_jsonb(ARRAY(SELECT unnest(v_new.diet_exclusions) EXCEPT SELECT unnest(v_old.diet_exclusions))),
      'exclusions_removed', to_jsonb(ARRAY(SELECT unnest(v_old.diet_exclusions) EXCEPT SELECT unnest(v_new.diet_exclusions)))));
  RETURN app.nutrition_sync(p_member, CASE WHEN v_self THEN 'self'
                                          WHEN app.nutrition_is_professional(p_member) THEN 'professional'
                                          ELSE 'none' END);
END $$;

CREATE FUNCTION app.nutrition_measure(p_member uuid, p_weight numeric, p_height numeric, p_fat numeric,
                                      p_fat_method text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_self boolean := EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id()
                             AND m.person_id = app.person_id() AND app.role() = 'member');
  v_id uuid;
  v_before text[];
BEGIN
  IF app.org_id() IS NULL OR NOT (v_self OR app.nutrition_can_write(p_member)
       OR (app.role() = 'trainer' AND app.health_staff_can_see(p_member))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_before := app.nutrition_blocks_raw(p_member);
  INSERT INTO app.nutrition_measurement (org_id, member_id, source, weight_kg, height_cm, body_fat_pct,
                                         body_fat_method, recorded_by)
  VALUES (app.org_id(), p_member, CASE WHEN v_self THEN 'declarado' ELSE 'personal' END, p_weight, p_height, p_fat,
          p_fat_method, app.person_id())
  RETURNING id INTO v_id;
  -- A new body value makes the open plans outdated (a plan is never regenerated by itself).
  UPDATE app.nutrition_plan SET outdated_reason = 'nueva_medicion'
   WHERE member_id = p_member AND status IN ('borrador', 'en_revision', 'aprobado', 'enviado')
     AND outdated_reason IS NULL;
  PERFORM app.nutrition_ratchet(p_member, v_before, v_self);
  PERFORM app.nutrition_sync(p_member, CASE WHEN v_self THEN 'self'
                                            WHEN app.nutrition_is_professional(p_member) THEN 'professional'
                                            ELSE 'none' END);
  PERFORM app.audit('nutrition.measure', 'nutrition_measurement', v_id::text,
    (SELECT home_location_id FROM app.member WHERE id = p_member),
    jsonb_build_object('source', CASE WHEN v_self THEN 'declarado' ELSE 'personal' END));
  RETURN v_id;
END $$;

-- Everything that must hold before a plan may be approved, licensed or sent, recomputed in SQL from the stored
-- items and the CURRENT profile (whatever the caller's JSON says): no block, not outdated, no excluded food, all 7
-- days, every day at or above the resting expenditure (Mifflin-St Jeor recomputed here) and within the day
-- tolerance of its stored target, which itself may not be under that floor.
CREATE FUNCTION app.nutrition_plan_issues(p_plan uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  pl app.nutrition_plan;
  p app.nutrition_profile;
  r text[] := '{}';
  w numeric; h numeric;
  v_bmr numeric;
  v_tol numeric;
  d record;
  v_target numeric;
  v_tdee numeric;
  v_maxloss numeric;
  v_maxgain numeric;
BEGIN
  SELECT * INTO pl FROM app.nutrition_plan WHERE id = p_plan;
  IF NOT FOUND THEN RETURN ARRAY['plan_inexistente']; END IF;
  SELECT * INTO p FROM app.nutrition_profile WHERE member_id = pl.member_id;
  r := r || app.nutrition_blocks_internal(pl.member_id);
  IF pl.outdated_reason IS NOT NULL THEN r := array_append(r, 'plan_desactualizado'); END IF;
  IF EXISTS (SELECT 1 FROM app.nutrition_plan_item i JOIN app.food f ON f.fdc_id = i.fdc_id
              WHERE i.plan_id = p_plan AND (f.allergens && p.allergens OR f.diet_tags && p.diet_exclusions)) THEN
    r := array_append(r, 'alimento_excluido');
  END IF;
  IF (SELECT count(DISTINCT day) FROM app.nutrition_plan_item WHERE plan_id = p_plan) < 7 THEN
    r := array_append(r, 'faltan_dias');
  END IF;
  -- Latest weight and height of any provenance (same rule as app.nutrition_latest_body, without its reader check:
  -- this function is internal and also runs from the settings trigger).
  SELECT x.weight_kg INTO w FROM (
    SELECT a.weight_kg, a.signed_at AS at FROM app.assessment a
     WHERE a.member_id = pl.member_id AND a.status = 'signed' AND a.weight_kg IS NOT NULL
    UNION ALL SELECT m.weight_kg, m.taken_at FROM app.nutrition_measurement m
     WHERE m.member_id = pl.member_id AND m.weight_kg IS NOT NULL) x ORDER BY x.at DESC LIMIT 1;
  SELECT x.height_cm INTO h FROM (
    SELECT a.height_cm, a.signed_at AS at FROM app.assessment a
     WHERE a.member_id = pl.member_id AND a.status = 'signed' AND a.height_cm IS NOT NULL
    UNION ALL SELECT m.height_cm, m.taken_at FROM app.nutrition_measurement m
     WHERE m.member_id = pl.member_id AND m.height_cm IS NOT NULL) x ORDER BY x.at DESC LIMIT 1;
  IF w IS NOT NULL AND h IS NOT NULL AND p.birth_date IS NOT NULL AND p.sex_for_equations IS NOT NULL THEN
    v_bmr := round(10 * w + 6.25 * h - 5 * extract(year FROM age(current_date, p.birth_date))
                   + CASE p.sex_for_equations WHEN 'masculino' THEN 5 ELSE -161 END);
    SELECT coalesce(max(s.day_tolerance_pct), 5), coalesce(max(s.max_loss_pct_week), 1), coalesce(max(s.max_gain_pct_week), 0.5)
      INTO v_tol, v_maxloss, v_maxgain FROM app.nutrition_settings s WHERE s.org_id = pl.org_id;
    FOR d IN SELECT day, sum(kcal) AS kcal FROM app.nutrition_plan_item WHERE plan_id = p_plan GROUP BY day LOOP
      IF d.kcal < v_bmr THEN r := array_append(r, 'debajo_del_piso'); END IF;
      SELECT (e ->> 'target_kcal')::numeric INTO v_target
        FROM jsonb_array_elements(coalesce(pl.calc -> 'days', '[]'::jsonb)) e WHERE (e ->> 'day')::int = d.day LIMIT 1;
      SELECT (e ->> 'tdee')::numeric INTO v_tdee
        FROM jsonb_array_elements(coalesce(pl.calc -> 'days', '[]'::jsonb)) e WHERE (e ->> 'day')::int = d.day LIMIT 1;
      IF v_target IS NULL OR v_target <= 0 OR v_tdee IS NULL OR v_tdee <= 0 THEN
        r := array_append(r, 'meta_ausente');
      ELSE

        -- The weekly change the targets imply (deficit or surplus × 7 / 7700 kcal per kg, as % of body weight) must
        -- respect the organisation's limits — whatever rate the profile declares.
        -- For the loss check the caller's expenditure is never believed below the resting expenditure × the
        -- profile's daily-activity factor (1.2 / 1.3 / 1.4, apps/api/src/nutrition/calc.ts): an understated
        -- expenditure cannot hide a deficit (fourth review, R2). The gain check keeps the caller's value, which
        -- understated only makes the surplus look larger.
        IF (greatest(v_tdee, v_bmr * CASE p.daily_activity WHEN 'activo' THEN 1.4 WHEN 'ligero' THEN 1.3 ELSE 1.2 END)
            - v_target) * 7 / 7700 / w * 100 > v_maxloss + 0.01 THEN r := array_append(r, 'ritmo_inseguro'); END IF;
        IF (v_target - v_tdee) * 7 / 7700 / w * 100 > v_maxgain + 0.01 THEN r := array_append(r, 'ritmo_inseguro'); END IF;
        IF v_target < v_bmr THEN r := array_append(r, 'meta_debajo_del_piso'); END IF;
        IF abs(d.kcal - v_target) / v_target * 100 > v_tol THEN r := array_append(r, 'fuera_de_tolerancia'); END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN ARRAY(SELECT DISTINCT unnest(r) ORDER BY 1);
END $$;

-- Request entry point: staff only (a member never probes drafts that row security hides from them).
CREATE FUNCTION app.nutrition_plan_check(p_plan uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_member uuid;
BEGIN
  SELECT member_id INTO v_member FROM app.nutrition_plan WHERE id = p_plan AND org_id = app.org_id();
  IF NOT FOUND OR NOT app.health_staff_can_see(v_member) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN app.nutrition_plan_issues(p_plan);
END $$;

-- Store a generated (or manually built) draft. Items arrive as [{day, meal, dish, position, fdc_id, grams,
-- household}]; their values are computed by the item trigger. Blocks are re-checked; foods carrying one of the
-- member's allergens or excluded diet tags are refused. A draft created by the member (their own form) never
-- carries a verifier result: staff must run the verifier before approving.
CREATE FUNCTION app.nutrition_plan_create(p_member uuid, p_week date, p_origin text, p_inputs jsonb, p_calc jsonb,
                                          p_justification jsonb, p_verifier jsonb, p_model text, p_prompt_version text,
                                          p_items jsonb, p_previous uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_self boolean := EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id()
                             AND m.person_id = app.person_id() AND app.role() = 'member');
  p app.nutrition_profile;
  v_reasons text[];
  v_prev app.nutrition_plan;
  v_series uuid;
  v_version integer := 1;
  v_id uuid := gen_random_uuid();
  it jsonb;
BEGIN
  -- Staff writers create drafts; a member's own form submission creates one too (origin formulario_socio).
  IF app.org_id() IS NULL OR NOT (app.nutrition_can_write(p_member) OR (v_self AND p_origin = 'formulario_socio')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_week IS NULL OR p_week < current_date - 7 OR p_week > current_date + 56 THEN
    RAISE EXCEPTION 'invalid_week' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM app.nutrition_profile WHERE member_id = p_member AND org_id = app.org_id();
  v_reasons := app.nutrition_blocks(p_member);
  IF cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'requiere_evaluacion_profesional:%', array_to_string(v_reasons, ',') USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'plan_without_items' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nutrition.plan:' || p_member::text, 0));
  IF p_previous IS NOT NULL THEN
    SELECT * INTO v_prev FROM app.nutrition_plan WHERE id = p_previous AND member_id = p_member AND org_id = app.org_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_series := v_prev.series_id;
    SELECT max(version) + 1 INTO v_version FROM app.nutrition_plan WHERE series_id = v_series;
  ELSE
    v_series := v_id;
  END IF;
  INSERT INTO app.nutrition_plan (id, org_id, member_id, series_id, version, week_start, origin, inputs, calc,
                                  justification, verifier, model, prompt_version, previous_id, created_by)
  VALUES (v_id, app.org_id(), p_member, v_series, v_version, p_week, p_origin, p_inputs, p_calc, p_justification,
          CASE WHEN v_self THEN NULL ELSE p_verifier END, p_model, p_prompt_version, p_previous, app.person_id());
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF EXISTS (SELECT 1 FROM app.food f WHERE f.fdc_id = (it ->> 'fdc_id')::integer
                 AND (f.allergens && p.allergens OR f.diet_tags && p.diet_exclusions)) THEN
      RAISE EXCEPTION 'food_excluded_for_member:%', it ->> 'fdc_id' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.nutrition_plan_item (org_id, plan_id, day, meal, dish, position, fdc_id, grams, household,
                                         kcal, protein_g, carb_g, fat_g)
    VALUES (app.org_id(), v_id, (it ->> 'day')::smallint, it ->> 'meal', it ->> 'dish',
            (it ->> 'position')::smallint, (it ->> 'fdc_id')::integer, (it ->> 'grams')::numeric,
            nullif(it ->> 'household', ''), 0, 0, 0, 0);
  END LOOP;
  PERFORM app.audit('nutrition.plan_create', 'nutrition_plan', v_id::text,
    (SELECT home_location_id FROM app.member WHERE id = p_member),
    jsonb_build_object('origin', p_origin, 'version', v_version, 'model', p_model, 'prompt_version', p_prompt_version));
  RETURN v_id;
END $$;

-- Staff writers record the verifier result for a draft (the API runs the verifier with the staff member's claims;
-- used for drafts the member created from their form).
CREATE FUNCTION app.nutrition_plan_verify(p_plan uuid, p_verifier jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE pl app.nutrition_plan;
BEGIN
  SELECT * INTO pl FROM app.nutrition_plan WHERE id = p_plan AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.nutrition_can_write(pl.member_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF pl.status NOT IN ('borrador', 'en_revision') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
  IF p_verifier IS NULL OR jsonb_typeof(p_verifier) <> 'object' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  UPDATE app.nutrition_plan SET verifier = p_verifier WHERE id = p_plan;
  PERFORM app.audit('nutrition.plan_verify', 'nutrition_plan', p_plan::text,
    (SELECT home_location_id FROM app.member WHERE id = pl.member_id),
    jsonb_build_object('ok', coalesce((p_verifier ->> 'ok')::boolean, false)));
END $$;

-- State machine. submit: borrador → en_revision. approve (owner / location_manager): → aprobado. license
-- (nutritionist with a verified licence; Ley 82 and AGENTS.md rule 4): adds the licensed approval. send: aprobado →
-- enviado, only with the licensed approval and the member's accepted disclaimer. reject: borrador|en_revision →
-- rechazado (reason). archive: aprobado|enviado → archivado. approve, license and send re-run
-- app.nutrition_plan_check against the current profile and body: any change since the draft stops the plan.
-- Sending a version archives the version of the SAME series the member had.
CREATE FUNCTION app.nutrition_plan_transition(p_plan uuid, p_action text, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  pl app.nutrition_plan;
  s app.staff_member;
  v_loc uuid;
  v_problems text[];
BEGIN
  SELECT * INTO pl FROM app.nutrition_plan WHERE id = p_plan AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.health_staff_can_see(pl.member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = pl.member_id;
  IF p_action IN ('approve', 'license', 'send') THEN
    v_problems := app.nutrition_plan_check(p_plan);
    IF cardinality(v_problems) > 0 THEN
      RAISE EXCEPTION 'plan_no_valido:%', array_to_string(v_problems, ',') USING ERRCODE = '55000';
    END IF;
  END IF;
  IF p_action = 'submit' THEN
    IF NOT app.nutrition_can_write(pl.member_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    IF pl.status <> 'borrador' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    UPDATE app.nutrition_plan SET status = 'en_revision', submitted_at = now() WHERE id = p_plan;
  ELSIF p_action = 'approve' THEN
    IF coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF pl.status NOT IN ('borrador', 'en_revision') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    IF coalesce((pl.verifier ->> 'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'verifier_not_passed' USING ERRCODE = '55000';
    END IF;
    IF pl.licensed_by = app.person_id() THEN RAISE EXCEPTION 'same_person_cannot_license' USING ERRCODE = '42501'; END IF;
    UPDATE app.nutrition_plan SET status = 'aprobado', approved_by = app.person_id(), approved_at = now(),
      submitted_at = coalesce(submitted_at, now()) WHERE id = p_plan;
  ELSIF p_action = 'license' THEN
    SELECT * INTO s FROM app.staff_member WHERE org_id = pl.org_id AND person_id = app.person_id()
       AND role = 'nutritionist' AND active LIMIT 1;
    IF app.role() <> 'nutritionist' OR s.id IS NULL OR s.license_no IS NULL OR s.license_verified_at IS NULL THEN
      RAISE EXCEPTION 'license_not_verified' USING ERRCODE = '42501';
    END IF;
    IF pl.status NOT IN ('en_revision', 'aprobado') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    -- Two different people: the one who approves for the gym and the licensed professional.
    IF pl.approved_by = app.person_id() THEN RAISE EXCEPTION 'same_person_cannot_license' USING ERRCODE = '42501'; END IF;
    UPDATE app.nutrition_plan SET licensed_by = app.person_id(), licensed_at = now(), license_no = s.license_no
     WHERE id = p_plan;
  ELSIF p_action = 'send' THEN
    IF coalesce(app.role() NOT IN ('owner', 'location_manager', 'nutritionist'), true) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF pl.status <> 'aprobado' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    IF pl.licensed_by IS NULL THEN RAISE EXCEPTION 'licensed_approval_required' USING ERRCODE = '55000'; END IF;
    -- The licence that approved it must still be valid now.
    IF NOT EXISTS (SELECT 1 FROM app.staff_member st WHERE st.org_id = pl.org_id AND st.person_id = pl.licensed_by
                     AND st.role = 'nutritionist' AND st.active AND st.license_verified_at IS NOT NULL
                     AND st.license_no = pl.license_no) THEN
      RAISE EXCEPTION 'license_no_longer_valid' USING ERRCODE = '55000';
    END IF;
    IF (SELECT disclaimer_accepted_at FROM app.nutrition_profile WHERE member_id = pl.member_id) IS NULL THEN
      RAISE EXCEPTION 'disclaimer_not_accepted' USING ERRCODE = '55000';
    END IF;
    UPDATE app.nutrition_plan SET status = 'archivado', archived_at = now()
     WHERE series_id = pl.series_id AND status = 'enviado' AND id <> p_plan;
    UPDATE app.nutrition_plan SET status = 'enviado', sent_at = now() WHERE id = p_plan;
  ELSIF p_action = 'reject' THEN
    IF coalesce(app.role() NOT IN ('owner', 'location_manager', 'nutritionist'), true) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF pl.status NOT IN ('borrador', 'en_revision') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
    UPDATE app.nutrition_plan SET status = 'rechazado', rejected_reason = btrim(p_reason) WHERE id = p_plan;
  ELSIF p_action = 'archive' THEN
    IF coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF pl.status NOT IN ('aprobado', 'enviado') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000'; END IF;
    UPDATE app.nutrition_plan SET status = 'archivado', archived_at = now() WHERE id = p_plan;
  ELSE
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  PERFORM app.audit('nutrition.plan_' || p_action, 'nutrition_plan', p_plan::text, v_loc, '{}'::jsonb);
  RETURN (SELECT status FROM app.nutrition_plan WHERE id = p_plan);
END $$;

-- Plan rows are append-only except the review columns, and only along the state machine. Any other change is an
-- error whoever attempts it (a corrected plan is a new version).
CREATE FUNCTION app.nutrition_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.org_id, NEW.member_id, NEW.series_id, NEW.version, NEW.week_start, NEW.origin, NEW.inputs, NEW.calc,
      NEW.justification, NEW.model, NEW.prompt_version, NEW.previous_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.org_id, OLD.member_id, OLD.series_id, OLD.version, OLD.week_start, OLD.origin, OLD.inputs, OLD.calc,
      OLD.justification, OLD.model, OLD.prompt_version, OLD.previous_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'plan_is_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.verifier IS DISTINCT FROM OLD.verifier AND OLD.status NOT IN ('borrador', 'en_revision') THEN
    RAISE EXCEPTION 'plan_is_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'borrador' AND NEW.status IN ('en_revision', 'aprobado', 'rechazado'))
    OR (OLD.status = 'en_revision' AND NEW.status IN ('aprobado', 'rechazado'))
    OR (OLD.status = 'aprobado' AND NEW.status IN ('enviado', 'archivado'))
    OR (OLD.status = 'enviado' AND NEW.status = 'archivado')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nutrition_plan_guard BEFORE UPDATE ON app.nutrition_plan
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_plan_guard();
-- Plans and items are never deleted (history of what a member was given).
CREATE FUNCTION app.nutrition_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'nutrition_history_is_permanent' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER nutrition_plan_no_delete BEFORE DELETE ON app.nutrition_plan
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_no_delete();
CREATE TRIGGER nutrition_plan_item_no_delete BEFORE DELETE ON app.nutrition_plan_item
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_no_delete();

-- M3: a newly signed assessment (its triage row) makes the member's open plans outdated.
CREATE FUNCTION app.nutrition_on_triage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  UPDATE app.nutrition_plan SET outdated_reason = 'nueva_evaluacion'
   WHERE member_id = NEW.member_id AND status IN ('borrador', 'en_revision', 'aprobado', 'enviado')
     AND outdated_reason IS NULL;
  -- Whoever signs, the blocks the assessment raises are held; only a nutritionist or clinician signing releases
  -- the held ones it no longer raises (fourth review, N1: a trainer, owner or manager cannot clear them this way).
  PERFORM app.nutrition_sync(NEW.member_id, CASE WHEN app.nutrition_is_professional(NEW.member_id)
                                                 THEN 'professional' ELSE 'none' END);
  RETURN NEW;
END $$;
CREATE TRIGGER triage_nutrition_outdated AFTER INSERT ON app.triage_result
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_on_triage();

-- A guardian link means a minor: refresh (and withdraw any sent plan) at once, whoever created the link.
CREATE FUNCTION app.nutrition_on_guardian() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.nutrition_refresh_status(NEW.member_id);
  RETURN NEW;
END $$;
CREATE TRIGGER guardian_nutrition_refresh AFTER INSERT ON app.guardian_link
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_on_guardian();

-- Lowering a safety limit re-evaluates every member of the organisation that has a plan in front of them.
CREATE FUNCTION app.nutrition_on_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE m uuid; pl uuid;
BEGIN
  FOR m IN SELECT DISTINCT member_id FROM app.nutrition_plan WHERE org_id = NEW.org_id AND status = 'enviado' LOOP
    PERFORM app.nutrition_refresh_status(m);
  END LOOP;
  -- A sent plan that no longer passes the full check under the new limits (for example its implied weekly rate)
  -- is withdrawn and hidden as well (fourth review, R1).
  FOR pl IN SELECT id FROM app.nutrition_plan WHERE org_id = NEW.org_id AND status = 'enviado' LOOP
    IF cardinality(ARRAY(SELECT unnest(app.nutrition_plan_issues(pl)) EXCEPT SELECT 'plan_desactualizado')) > 0 THEN
      UPDATE app.nutrition_plan SET status = 'archivado', archived_at = now(), outdated_reason = 'limites_cambio'
       WHERE id = pl;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER nutrition_settings_refresh AFTER UPDATE ON app.nutrition_settings
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_on_settings();

-- Owner-only settings change (limits stay inside the source ranges enforced by the table CHECKs).
CREATE FUNCTION app.nutrition_settings_save(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() <> 'owner', true) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.nutrition_settings (org_id) VALUES (app.org_id()) ON CONFLICT DO NOTHING;
  UPDATE app.nutrition_settings SET
    max_loss_pct_week = coalesce((p ->> 'max_loss_pct_week')::numeric, max_loss_pct_week),
    max_gain_pct_week = coalesce((p ->> 'max_gain_pct_week')::numeric, max_gain_pct_week),
    protein_min_g_kg = coalesce((p ->> 'protein_min_g_kg')::numeric, protein_min_g_kg),
    protein_max_g_kg = coalesce((p ->> 'protein_max_g_kg')::numeric, protein_max_g_kg),
    fat_min_pct = coalesce((p ->> 'fat_min_pct')::numeric, fat_min_pct),
    day_tolerance_pct = coalesce((p ->> 'day_tolerance_pct')::numeric, day_tolerance_pct),
    plan_model = coalesce(p ->> 'plan_model', plan_model),
    light_model = coalesce(p ->> 'light_model', light_model),
    fallback_model = CASE WHEN p ? 'fallback_model' THEN p ->> 'fallback_model' ELSE fallback_model END,
    updated_at = now()
  WHERE org_id = app.org_id();
  PERFORM app.audit('nutrition.settings', 'nutrition_settings', app.org_id()::text, NULL,
    jsonb_build_object('fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END $$;

-- ── Link every member: an empty profile now, and one for each member created later ─────────────────────────────
-- The migration role is the table owner but not a superuser: FORCE RLS would hide every member, so it is lifted
-- for these two reads and restored right after.
ALTER TABLE app.member NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.organization NO FORCE ROW LEVEL SECURITY;
INSERT INTO app.nutrition_profile (org_id, member_id) SELECT m.org_id, m.id FROM app.member m ON CONFLICT DO NOTHING;
INSERT INTO app.nutrition_settings (org_id) SELECT o.id FROM app.organization o ON CONFLICT DO NOTHING;
ALTER TABLE app.member FORCE ROW LEVEL SECURITY;
ALTER TABLE app.organization FORCE ROW LEVEL SECURITY;
CREATE FUNCTION app.nutrition_profile_for_new_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.nutrition_profile (org_id, member_id) VALUES (NEW.org_id, NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER member_nutrition_profile AFTER INSERT ON app.member
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_profile_for_new_member();
CREATE FUNCTION app.nutrition_settings_for_new_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.nutrition_settings (org_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_nutrition_settings AFTER INSERT ON app.organization
  FOR EACH ROW EXECUTE FUNCTION app.nutrition_settings_for_new_org();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.food ENABLE ROW LEVEL SECURITY; ALTER TABLE app.food FORCE ROW LEVEL SECURITY;
ALTER TABLE app.food_portion ENABLE ROW LEVEL SECURITY; ALTER TABLE app.food_portion FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nutrition_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nutrition_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nutrition_profile ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nutrition_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nutrition_measurement ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nutrition_measurement FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nutrition_plan ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nutrition_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nutrition_plan_item ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nutrition_plan_item FORCE ROW LEVEL SECURITY;

-- Reference catalog: readable by every signed-in user (no tenant data).
CREATE POLICY food_select ON app.food FOR SELECT TO app_authenticated USING (true);
CREATE POLICY food_portion_select ON app.food_portion FOR SELECT TO app_authenticated USING (true);
-- Settings: staff of the org read them (the API needs the limits); only the owner writes (definer).
CREATE POLICY nutrition_settings_select ON app.nutrition_settings FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.is_staff()));
-- Profile and measurements: the member (and guardian), and health staff of the member's location (owner org-wide).
CREATE POLICY nutrition_profile_select ON app.nutrition_profile FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (app.health_self_or_guardian(member_id) OR app.health_staff_can_see(member_id)));
CREATE POLICY nutrition_measurement_select ON app.nutrition_measurement FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (app.health_self_or_guardian(member_id) OR app.health_staff_can_see(member_id)));
-- Plans: health staff see every version; the member and guardian see only what was sent to them.
CREATE POLICY nutrition_plan_select ON app.nutrition_plan FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (app.health_staff_can_see(member_id)
    OR (sent_at IS NOT NULL AND app.health_self_or_guardian(member_id)
        AND ((status = 'archivado' AND outdated_reason IS DISTINCT FROM 'requiere_profesional'
              AND outdated_reason IS DISTINCT FROM 'limites_cambio')
             OR (status = 'enviado' AND outdated_reason IS NULL)))));
CREATE POLICY nutrition_plan_item_select ON app.nutrition_plan_item FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND EXISTS (SELECT 1 FROM app.nutrition_plan p WHERE p.id = nutrition_plan_item.plan_id));

CREATE POLICY definer_all ON app.food TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.food_portion TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.nutrition_settings TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.nutrition_profile TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.nutrition_measurement TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.nutrition_plan TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.nutrition_plan_item TO app_definer USING (true) WITH CHECK (true);

REVOKE ALL ON app.food, app.food_portion, app.nutrition_settings, app.nutrition_profile, app.nutrition_measurement,
  app.nutrition_plan, app.nutrition_plan_item FROM PUBLIC;
GRANT SELECT ON app.food, app.food_portion, app.nutrition_settings, app.nutrition_profile, app.nutrition_measurement,
  app.nutrition_plan, app.nutrition_plan_item TO app_authenticated;
GRANT SELECT ON app.food, app.food_portion TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.nutrition_settings, app.nutrition_profile, app.nutrition_plan TO app_definer;
GRANT SELECT, INSERT ON app.nutrition_measurement, app.nutrition_plan_item TO app_definer;
GRANT SELECT ON app.assessment, app.triage_result, app.guardian_link, app.staff_member TO app_definer;

DO $own$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.nutrition_item_compute()', 'app.nutrition_can_write(uuid)', 'app.nutrition_assert_reader(uuid)',
    'app.nutrition_latest_body(uuid)', 'app.nutrition_blocks(uuid)', 'app.nutrition_refresh_status(uuid)',
    'app.nutrition_blocks_internal(uuid)', 'app.nutrition_ratchet(uuid, text[], boolean)',
    'app.nutrition_blocks_raw(uuid)', 'app.nutrition_is_professional(uuid)', 'app.nutrition_sync(uuid, text)',
    'app.nutrition_release_blocks(uuid, text)', 'app.nutrition_plan_issues(uuid)',
    'app.nutrition_on_guardian()', 'app.nutrition_on_settings()',
    'app.nutrition_profile_save(uuid, jsonb)', 'app.nutrition_measure(uuid, numeric, numeric, numeric, text)',
    'app.nutrition_plan_check(uuid)',
    'app.nutrition_plan_create(uuid, date, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, uuid)',
    'app.nutrition_plan_verify(uuid, jsonb)', 'app.nutrition_plan_transition(uuid, text, text)',
    'app.nutrition_settings_save(jsonb)', 'app.nutrition_profile_for_new_member()', 'app.nutrition_on_triage()',
    'app.nutrition_settings_for_new_org()'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO app_definer', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $own$;
-- Request traffic: the reads check the caller themselves (nutrition_assert_reader); the writes re-check claims.
GRANT EXECUTE ON FUNCTION app.nutrition_latest_body(uuid), app.nutrition_blocks(uuid), app.nutrition_plan_check(uuid),
  app.nutrition_profile_save(uuid, jsonb), app.nutrition_measure(uuid, numeric, numeric, numeric, text),
  app.nutrition_plan_create(uuid, date, text, jsonb, jsonb, jsonb, jsonb, text, text, jsonb, uuid),
  app.nutrition_plan_verify(uuid, jsonb), app.nutrition_plan_transition(uuid, text, text),
  app.nutrition_settings_save(jsonb), app.nutrition_release_blocks(uuid, text),
  app.nutrition_answers_valid(jsonb) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.nutrition_answers_valid(jsonb) TO app_definer;

-- Hold the safety blocks the existing data already raises (an assessment signed before this migration), so a later
-- input cannot clear one that was never recorded. Read with row security lifted for the migration role (owner, not
-- superuser); the sync itself runs as app_definer.
ALTER TABLE app.nutrition_profile NO FORCE ROW LEVEL SECURITY;
DO $hold$
DECLARE m uuid;
BEGIN
  FOR m IN SELECT member_id FROM app.nutrition_profile LOOP
    PERFORM app.nutrition_sync(m, 'none');
  END LOOP;
END $hold$;
ALTER TABLE app.nutrition_profile FORCE ROW LEVEL SECURITY;
