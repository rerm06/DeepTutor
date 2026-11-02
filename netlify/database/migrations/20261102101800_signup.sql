-- Module signup ("Únete") · spec E7 (member portal: registration and sign-in), §11 (consent, minors).
-- Public self-service registration for a gym, without an identity provider (DEMO deployment).
-- Rules that matter:
--   * Unauthenticated traffic reaches exactly two SECURITY DEFINER functions in their own schema `app_public`.
--     Only the API login role may use that schema (app_api locally; on Netlify the owner connection IS the API
--     login). Never PUBLIC, never app_authenticated. With no claims, the functions validate everything themselves.
--   * PII guard for the public demo [VERIFICAR · lift only with a real identity provider, email verification and a
--     privacy notice]: e-mails must end in @demo.invalid and phones must be in the fictional 555-01xx range.
--   * Puerto Rico age of majority is 21 [VERIFICAR · legal]: under 21 is refused online (come to the location with a
--     parent/guardian). Nothing about a refused visitor is stored; the birth date is never stored at all.
--   * Identity: a Person is created only for a brand-new e-mail. An e-mail that already exists ANYWHERE gets the same
--     generic answer, creates nothing and attaches nothing (no cross-org oracle beyond what docs/modules/signup.md
--     lists as demo-only).
--   * Abuse: at most 30 online sign-up attempts per organisation per hour, serialised by an advisory lock.
--   * New members start as `lead` (billing semantics: billing_refresh promotes lead → active on the first paid
--     session or pack; a pay-per-session client has nothing to pay yet, and `trial` would imply a free trial).
--   * Locations accept online sign-ups only when their owner (or manager) switched them on (`join_location`).

CREATE SCHEMA app_public;
REVOKE ALL ON SCHEMA app_public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA app_public TO app_definer;  -- CREATE: required to own functions in the schema

CREATE TYPE app.agreement_kind AS ENUM ('terms', 'waiver');
CREATE TYPE app.join_outcome AS ENUM ('created', 'existing');

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────────────────

-- Platform catalogue of versioned texts shown on the sign-up form (global, read-only for request traffic).
-- Draft wording pending legal review [VERIFICAR · legal: terms, liability release, TCPA consent language].
CREATE TABLE app.agreement_text (
  kind text NOT NULL CHECK (kind IN ('terms', 'waiver', 'sms_reminder', 'sms_marketing')),
  version text NOT NULL CHECK (version ~ '^v[0-9]{4}-[0-9]{2}(\.[0-9]{1,2})?$'),
  locale text NOT NULL CHECK (locale IN ('es', 'en')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  is_current boolean NOT NULL DEFAULT false,
  PRIMARY KEY (kind, version, locale)
);
CREATE UNIQUE INDEX agreement_text_current_uq ON app.agreement_text (kind, locale) WHERE is_current;

-- Per-location switch for online sign-up (core `location` has no active flag; this is the module's own switch).
CREATE TABLE app.join_location (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, location_id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

-- Accepted terms and liability release, one row per (member, kind, version). Append-only.
CREATE TABLE app.member_agreement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  kind app.agreement_kind NOT NULL,
  version text NOT NULL CHECK (version ~ '^v[0-9]{4}-[0-9]{2}(\.[0-9]{1,2})?$'),
  locale text NOT NULL CHECK (locale IN ('es', 'en')),
  source app.consent_source NOT NULL,
  accepted_by uuid NOT NULL,              -- person who accepted (the member themself online)
  evidence text CHECK (length(evidence) <= 500),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, kind, version),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);
CREATE INDEX member_agreement_member_idx ON app.member_agreement (member_id, accepted_at DESC);

-- Every online sign-up attempt that reached the identity step (created or generic "existing" answer). Feeds the
-- per-organisation rate cap and the owner's abuse view. No e-mail, phone, name or birth date is stored here.
CREATE TABLE app.join_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  outcome app.join_outcome NOT NULL,
  member_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK ((outcome = 'created') = (member_id IS NOT NULL))
);
CREATE INDEX join_attempt_org_at_idx ON app.join_attempt (org_id, at DESC);

-- ── Seed of the platform texts (draft; [VERIFICAR · legal]) ─────────────────────────────────────────────────
INSERT INTO app.agreement_text (kind, version, locale, title, body, is_current) VALUES
  ('terms', 'v2026-11', 'es', 'Términos de uso',
   'Borrador de demostración pendiente de revisión legal. Al crear tu cuenta aceptas usar las instalaciones según '
   'las normas de la sede, reservar y pagar cada sesión antes de usarla y mantener tus datos al día. No hay cuota '
   'mensual, contrato, cargo de inscripción ni cargo de mantenimiento: solo pagas la sesión que compras. Puedes '
   'cerrar tu cuenta cuando quieras en recepción.', true),
  ('terms', 'v2026-11', 'en', 'Terms of use',
   'Demo draft pending legal review. By creating your account you agree to use the facilities under the location '
   'rules, to book and pay for each session before using it and to keep your details up to date. There is no '
   'monthly fee, contract, enrolment fee or maintenance fee: you only pay for the session you buy. You can close '
   'your account at the front desk at any time.', true),
  ('waiver', 'v2026-11', 'es', 'Relevo de responsabilidad',
   'Borrador de demostración pendiente de revisión legal. Entiendo que el ejercicio físico conlleva riesgos. '
   'Declaro que puedo realizar actividad física, que seguiré las instrucciones del personal y que avisaré si tengo '
   'una condición de salud. Esto no limita derechos que la ley no permite renunciar.', true),
  ('waiver', 'v2026-11', 'en', 'Liability release',
   'Demo draft pending legal review. I understand that physical exercise carries risks. I state that I am able to '
   'take part in physical activity, that I will follow the staff''s instructions and that I will tell them about '
   'any health condition. This does not limit rights that the law does not allow me to waive.', true),
  ('sms_reminder', 'v2026-11', 'es', 'Recordatorios por SMS',
   'Acepto recibir por SMS recordatorios automáticos de mis reservas y sesiones de {brand} al número indicado. '
   'Hasta 4 mensajes al mes. Pueden aplicar tarifas de mensajes y datos. Responde BAJA o STOP para cancelar. '
   'Dar este consentimiento no es condición para comprar.', true),
  ('sms_reminder', 'v2026-11', 'en', 'SMS reminders',
   'I agree to receive automated SMS reminders about my bookings and sessions from {brand} at the number given. '
   'Up to 4 messages a month. Message and data rates may apply. Reply STOP or BAJA to cancel. Consent is not a '
   'condition of purchase.', true),
  ('sms_marketing', 'v2026-11', 'es', 'Promociones por SMS',
   'Acepto recibir por SMS mensajes de mercadeo automáticos (ofertas y promociones) de {brand} al número indicado. '
   'Hasta 4 mensajes al mes. Pueden aplicar tarifas de mensajes y datos. Responde BAJA o STOP para cancelar. '
   'Dar este consentimiento no es condición para comprar.', true),
  ('sms_marketing', 'v2026-11', 'en', 'SMS promotions',
   'I agree to receive automated marketing text messages (offers and promotions) from {brand} at the number given. '
   'Up to 4 messages a month. Message and data rates may apply. Reply STOP or BAJA to cancel. Consent is not a '
   'condition of purchase.', true);

-- ── Validation helpers (immutable, no table access) ──────────────────────────────────────────────────────

-- [VERIFICAR · lift only with a real identity provider and privacy notice] Demo-only identity data.
CREATE FUNCTION app.join_email_ok(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_email IS NOT NULL AND length(p_email) <= 254
     AND p_email ~ '^[a-z0-9][a-z0-9._+-]{0,63}@demo\.invalid$'
$$;
CREATE FUNCTION app.join_phone_ok(p_phone text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_phone IS NULL OR p_phone ~ '^\+1-(787|939)-555-01[0-9]{2}$'
$$;
-- Letters (Latin + Spanish), spaces, apostrophe, dot and hyphen; must start with a letter. Names reach messages
-- (render_message), so braces, links, digits, newlines and other scripts are refused here. A dot must end a word
-- ("J. Pérez", "Jr.") so bare domains such as "www.evil.com" cannot pass.
CREATE FUNCTION app.join_name_ok(p_name text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NOT NULL AND length(p_name) BETWEEN 2 AND 120
     AND p_name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü ''.-]*[A-Za-zÁÉÍÓÚÑÜáéíóúñü.]$'
     AND p_name !~ '  ' AND p_name !~ '\.[^ ]'
$$;
-- Whole years between the birth date and today in Puerto Rico.
CREATE FUNCTION app.join_age_years(p_birth date, p_today date) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT extract(year FROM age(p_today::timestamp, p_birth::timestamp))::integer
$$;

-- ── Staff entry point: switch online sign-up for a location (owner; manager of that location). Audited. ──────
CREATE FUNCTION app.set_join_location(p_location uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
BEGIN
  IF v_org IS NULL OR app.person_id() IS NULL OR v_role IS NULL
     OR NOT (v_role = 'owner' OR (v_role = 'location_manager' AND p_location = ANY (app.location_ids()))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.join_location AS j (org_id, location_id, enabled, updated_by, updated_at)
  VALUES (v_org, p_location, p_enabled, app.person_id(), now())
  ON CONFLICT (location_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by,
                                          updated_at = now()
  WHERE j.org_id = v_org;
  PERFORM app.audit('join_location.set', 'location', p_location::text, p_location,
                    jsonb_build_object('enabled', p_enabled));
END $$;

-- ── Public entry points (no claims). Owned by app_definer; validate every input themselves. ───────────────

-- What the public "Únete" page needs: brand name, sanitised theme, open locations, current texts, business model.
-- NULL when the organisation does not exist or has no location open for online sign-up (→ 404, same answer).
CREATE FUNCTION app_public.join_info(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_brand app.brand;
  v_theme jsonb;
  v_colors jsonb;
  v_locs jsonb;
  v_texts jsonb;
  v_recurring boolean;
  v_session_cents integer;
BEGIN
  IF p_org IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'municipality', l.municipality,
                                               'brand_id', l.brand_id) ORDER BY l.name, l.id), '[]'::jsonb)
    INTO v_locs
    FROM app.location l JOIN app.join_location j ON j.location_id = l.id AND j.org_id = l.org_id
   WHERE l.org_id = p_org AND j.enabled;
  IF jsonb_array_length(v_locs) = 0 THEN RETURN NULL; END IF;

  -- Display brand: the oldest brand that owns an open location.
  SELECT b.* INTO v_brand FROM app.brand b
   WHERE b.org_id = p_org AND EXISTS (
     SELECT 1 FROM app.location l JOIN app.join_location j ON j.location_id = l.id AND j.enabled
      WHERE l.brand_id = b.id AND l.org_id = p_org)
   ORDER BY b.created_at, b.id LIMIT 1;

  -- Theme: only the keys the UI understands, re-validated here (defence in depth over brand_theme_safe).
  SELECT coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb) INTO v_colors
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_brand.theme -> 'colors') = 'object'
                         THEN v_brand.theme -> 'colors' ELSE '{}'::jsonb END) c
   WHERE c.key IN ('accent', 'accent_hover', 'accent_text', 'header_bg', 'header_text', 'highlight')
     AND jsonb_typeof(c.value) = 'string' AND c.value #>> '{}' ~ '^#[0-9A-Fa-f]{6}$';
  v_theme := jsonb_strip_nulls(jsonb_build_object(
    'logo_url', CASE WHEN v_brand.theme ->> 'logo_url' ~ '^/brand/[a-z0-9@._-]{1,80}$' THEN v_brand.theme ->> 'logo_url' END,
    'logo_alt', CASE WHEN v_brand.theme ->> 'logo_alt' ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.-]{1,80}$' THEN v_brand.theme ->> 'logo_alt' END,
    'tagline_es', left(regexp_replace(v_brand.theme ->> 'tagline_es', '[[:cntrl:]<>{}]', '', 'g'), 120),
    'tagline_en', left(regexp_replace(v_brand.theme ->> 'tagline_en', '[[:cntrl:]<>{}]', '', 'g'), 120),
    'colors', CASE WHEN v_colors = '{}'::jsonb THEN NULL ELSE v_colors END));

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'version', a.version, 'locale', a.locale,
                                               'title', a.title, 'body', replace(a.body, '{brand}', v_brand.name))
                            ORDER BY a.kind, a.locale), '[]'::jsonb)
    INTO v_texts FROM app.agreement_text a WHERE a.is_current;

  -- Business model, read from the billing catalogue (never typed by a caller): pay-per-session when no recurring
  -- membership and no enrolment fee is on sale, and a single session is.
  SELECT EXISTS (SELECT 1 FROM app.price pr JOIN app.plan_product p ON p.id = pr.product_id AND p.org_id = pr.org_id
                  WHERE pr.org_id = p_org AND pr.active AND p.active
                    AND (pr.billing_interval <> 'none' OR p.kind = 'enrollment_fee'))
    INTO v_recurring;
  SELECT min(pr.amount_cents) INTO v_session_cents
    FROM app.price pr JOIN app.plan_product p ON p.id = pr.product_id AND p.org_id = pr.org_id
   WHERE pr.org_id = p_org AND pr.active AND p.active AND p.kind IN ('drop_in', 'day_pass');

  RETURN jsonb_build_object(
    'org_id', p_org,
    'org_name', (SELECT o.name FROM app.organization o WHERE o.id = p_org),
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'theme', v_theme),
    'locations', v_locs,
    'agreements', v_texts,
    'model', jsonb_build_object('pay_per_session', NOT v_recurring AND v_session_cents IS NOT NULL,
                                'session_from_cents', v_session_cents));
END $$;

-- Create a member online. Returns {outcome:'created', ...ids} or {outcome:'existing'} (generic: nothing created).
-- Errors (SQLSTATE 22023 unless noted): org_not_found (P0002), invalid_location, invalid_name, invalid_email,
-- invalid_phone, invalid_birth_date, age_requires_guardian, agreements_required, agreement_outdated,
-- phone_required_for_sms, invalid_locale, rate_limited (54000).
CREATE FUNCTION app_public.join_submit(
  p_org uuid, p_location uuid, p_full_name text, p_email text, p_phone text, p_birth_date date,
  p_terms_version text, p_waiver_version text, p_accept_terms boolean, p_accept_waiver boolean,
  p_sms_reminders boolean, p_sms_marketing boolean, p_locale text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  c_cap constant integer := 30;               -- online sign-up attempts per organisation per hour
  c_majority constant integer := 21;          -- Puerto Rico age of majority [VERIFICAR · legal]
  v_today date := (now() AT TIME ZONE 'America/Puerto_Rico')::date;
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '[ ]+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_loc app.location;
  v_brand_name text;
  v_terms text;
  v_waiver text;
  v_person uuid;
  v_member uuid;
  v_existing boolean := false;
  v_consent uuid;
  v_evidence text;
  r record;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM app.organization o WHERE o.id = p_org) THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.* INTO v_loc FROM app.location l
    JOIN app.join_location j ON j.location_id = l.id AND j.org_id = l.org_id AND j.enabled
   WHERE l.id = p_location AND l.org_id = p_org;
  IF v_loc.id IS NULL THEN RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023'; END IF;
  IF p_locale IS NULL OR p_locale NOT IN ('es', 'en') THEN
    RAISE EXCEPTION 'invalid_locale' USING ERRCODE = '22023';
  END IF;
  IF NOT app.join_name_ok(v_name) THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023'; END IF;
  IF NOT app.join_email_ok(v_email) THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023'; END IF;
  IF NOT app.join_phone_ok(v_phone) THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023'; END IF;
  IF p_birth_date IS NULL OR p_birth_date < DATE '1900-01-01' OR p_birth_date > v_today THEN
    RAISE EXCEPTION 'invalid_birth_date' USING ERRCODE = '22023';
  END IF;
  -- Under 21: refused, and nothing is stored (the transaction ends here). Under 13 falls in the same branch.
  IF app.join_age_years(p_birth_date, v_today) < c_majority THEN
    RAISE EXCEPTION 'age_requires_guardian' USING ERRCODE = '22023';
  END IF;
  IF p_accept_terms IS NOT TRUE OR p_accept_waiver IS NOT TRUE THEN
    RAISE EXCEPTION 'agreements_required' USING ERRCODE = '22023';
  END IF;
  SELECT a.version INTO v_terms FROM app.agreement_text a WHERE a.kind = 'terms' AND a.locale = p_locale AND a.is_current;
  SELECT a.version INTO v_waiver FROM app.agreement_text a WHERE a.kind = 'waiver' AND a.locale = p_locale AND a.is_current;
  IF v_terms IS NULL OR v_waiver IS NULL OR p_terms_version IS DISTINCT FROM v_terms
     OR p_waiver_version IS DISTINCT FROM v_waiver THEN
    RAISE EXCEPTION 'agreement_outdated' USING ERRCODE = '22023';
  END IF;
  IF (p_sms_reminders IS TRUE OR p_sms_marketing IS TRUE) AND v_phone IS NULL THEN
    RAISE EXCEPTION 'phone_required_for_sms' USING ERRCODE = '22023';
  END IF;

  -- Rate cap per organisation: count + insert are serialised so concurrent attempts cannot both slip under it.
  PERFORM pg_advisory_xact_lock(hashtextextended('app.join_submit:' || p_org::text, 0));
  IF (SELECT count(*) FROM app.join_attempt a WHERE a.org_id = p_org AND a.at > now() - interval '1 hour') >= c_cap THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- Identity: only a brand-new e-mail creates a Person. Existing anywhere → generic answer, nothing attached.
  IF EXISTS (SELECT 1 FROM app.person p WHERE lower(p.email) = v_email) THEN
    v_existing := true;
  ELSE
    BEGIN
      INSERT INTO app.person (email) VALUES (v_email) RETURNING id INTO v_person;
    EXCEPTION WHEN unique_violation THEN
      v_existing := true;  -- the same e-mail was registered concurrently (another org's sign-up or staff)
    END;
  END IF;
  IF v_existing THEN
    INSERT INTO app.join_attempt (org_id, location_id, outcome) VALUES (p_org, v_loc.id, 'existing');
    RETURN jsonb_build_object('outcome', 'existing');
  END IF;

  INSERT INTO app.member (org_id, person_id, home_location_id, full_name, phone, status)
  VALUES (p_org, v_person, v_loc.id, v_name, v_phone, 'lead')
  RETURNING id INTO v_member;

  INSERT INTO app.member_agreement (org_id, member_id, kind, version, locale, source, accepted_by, evidence)
  VALUES (p_org, v_member, 'terms', v_terms, p_locale, 'member_portal', v_person, 'Únete en línea: casilla marcada por el titular'),
         (p_org, v_member, 'waiver', v_waiver, p_locale, 'member_portal', v_person, 'Únete en línea: casilla marcada por el titular');

  -- Consents through the existing model (granted rows + append-only history). Unchecked boxes record nothing.
  FOR r IN SELECT * FROM (VALUES ('reminder'::app.msg_purpose, 'sms_reminder', p_sms_reminders IS TRUE),
                                 ('marketing'::app.msg_purpose, 'sms_marketing', p_sms_marketing IS TRUE)) x(purpose, kind, wanted)
            WHERE x.wanted LOOP
    v_evidence := format('Únete en línea: casilla %s %s (%s) marcada por el titular', r.kind,
                         (SELECT a.version FROM app.agreement_text a WHERE a.kind = r.kind AND a.locale = p_locale AND a.is_current),
                         p_locale);
    INSERT INTO app.consent (org_id, member_id, brand_id, channel, purpose, status, source, evidence, recorded_by,
                             granted_at, updated_at)
    VALUES (p_org, v_member, v_loc.brand_id, 'sms', r.purpose, 'granted', 'member_portal', v_evidence, v_person, now(), now())
    RETURNING id INTO v_consent;
    INSERT INTO app.consent_event (org_id, consent_id, member_id, brand_id, channel, purpose, status, source, evidence, recorded_by)
    VALUES (p_org, v_consent, v_member, v_loc.brand_id, 'sms', r.purpose, 'granted', 'member_portal', v_evidence, v_person);
  END LOOP;

  INSERT INTO app.join_attempt (org_id, location_id, outcome, member_id) VALUES (p_org, v_loc.id, 'created', v_member);
  -- Audit: the actor is the new member (no claims exist yet); actor and time are set here, never by the caller.
  INSERT INTO app.audit_log (org_id, actor_person_id, actor_role, action, entity, entity_id, location_id, meta, at)
  VALUES (p_org, v_person, 'member', 'member.join_online', 'member', v_member::text, v_loc.id,
          jsonb_build_object('status', 'lead', 'terms_version', v_terms, 'waiver_version', v_waiver,
                             'sms_reminder', p_sms_reminders IS TRUE, 'sms_marketing', p_sms_marketing IS TRUE),
          now());

  SELECT b.name INTO v_brand_name FROM app.brand b WHERE b.id = v_loc.brand_id;
  RETURN jsonb_build_object('outcome', 'created', 'person_id', v_person, 'member_id', v_member, 'org_id', p_org,
                            'location_id', v_loc.id, 'location_name', v_loc.name, 'brand_name', v_brand_name,
                            'full_name', v_name);
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.agreement_text   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.agreement_text   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.join_location    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.join_location    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.member_agreement ENABLE ROW LEVEL SECURITY; ALTER TABLE app.member_agreement FORCE ROW LEVEL SECURITY;
ALTER TABLE app.join_attempt     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.join_attempt     FORCE ROW LEVEL SECURITY;

-- 0005 created definer_all before these tables existed.
CREATE POLICY definer_all ON app.agreement_text   TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.join_location    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.member_agreement TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.join_attempt     TO app_definer USING (true) WITH CHECK (true);

-- agreement_text: platform catalogue, readable by any signed-in caller (like message_template).
CREATE POLICY agreement_text_select ON app.agreement_text FOR SELECT USING ((SELECT app.org_id()) IS NOT NULL);
-- join_location: staff who can see the location. Writes only through app.set_join_location().
CREATE POLICY join_location_select ON app.join_location FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.is_staff())
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
-- member_agreement: the member, their guardian, and staff of the member's home location (owner/accountant: org).
-- Terms and the liability release are not health data, so front desk reads them. No write path for request traffic.
CREATE POLICY member_agreement_select ON app.member_agreement FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND app.can_act_for_member(member_id));
-- join_attempt: owner (org) and the location manager of that location (abuse monitoring).
CREATE POLICY join_attempt_select ON app.join_attempt FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.agreement_text, app.join_location, app.member_agreement, app.join_attempt FROM PUBLIC;
GRANT SELECT ON app.agreement_text, app.join_location, app.member_agreement, app.join_attempt TO app_authenticated;
-- No INSERT/UPDATE/DELETE grants: every write goes through the definer functions above.

GRANT SELECT ON app.agreement_text TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.join_location TO app_definer;
GRANT SELECT, INSERT ON app.member_agreement, app.join_attempt TO app_definer;
GRANT SELECT ON app.organization, app.brand, app.location, app.plan_product, app.price TO app_definer;
GRANT SELECT, INSERT ON app.person, app.member, app.consent_event, app.audit_log TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.consent TO app_definer;

ALTER FUNCTION app.set_join_location(uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app_public.join_info(uuid) OWNER TO app_definer;
ALTER FUNCTION app_public.join_submit(uuid, uuid, text, text, text, date, text, text, boolean, boolean, boolean, boolean, text)
  OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.set_join_location(uuid, boolean), app.join_email_ok(text), app.join_phone_ok(text),
  app.join_name_ok(text), app.join_age_years(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_public.join_info(uuid),
  app_public.join_submit(uuid, uuid, text, text, text, date, text, text, boolean, boolean, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_join_location(uuid, boolean) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.join_email_ok(text), app.join_phone_ok(text), app.join_name_ok(text),
  app.join_age_years(date, date) TO app_definer;

-- The public entry points belong to the API login role only, used BEFORE any claims exist. Locally that is app_api
-- (NOINHERIT: it holds nothing else and still cannot read a single table). On Netlify there is no separate login
-- role: the owner connection is the API login, so the grant goes to the migrating role itself.
DO $grant$
DECLARE v_login text := CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN 'app_api' ELSE current_user END;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA app_public TO %I', v_login);
  EXECUTE format('GRANT EXECUTE ON FUNCTION app_public.join_info(uuid) TO %I', v_login);
  EXECUTE format('GRANT EXECUTE ON FUNCTION app_public.join_submit(uuid, uuid, text, text, text, date, text, text, '
                 'boolean, boolean, boolean, boolean, text) TO %I', v_login);
END $grant$;
