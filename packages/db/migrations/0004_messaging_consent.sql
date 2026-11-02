-- E8 · Messaging and consent (spec §3.3 Consent, §11 TCPA/A2P/WABA, §15 E8).
-- Rule: no outbound message is ever queued for delivery without a GRANTED consent row for exactly
-- (member, brand, channel, purpose). Messages without consent are stored as 'blocked' so the refusal is auditable.
-- [P] Every purpose, transactional included, requires explicit consent; legal review may relax transactional.

CREATE TYPE app.channel AS ENUM ('whatsapp', 'sms', 'email');
CREATE TYPE app.msg_purpose AS ENUM ('transactional', 'reminder', 'marketing');
CREATE TYPE app.consent_status AS ENUM ('granted', 'revoked');
CREATE TYPE app.consent_source AS ENUM ('front_desk', 'member_portal', 'web_form', 'import', 'keyword');
CREATE TYPE app.msg_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'blocked');

CREATE TABLE app.consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  channel app.channel NOT NULL,
  purpose app.msg_purpose NOT NULL,
  status app.consent_status NOT NULL,
  source app.consent_source NOT NULL,
  evidence text CHECK (length(evidence) <= 2000),  -- e.g. form version + IP, or staff note
  recorded_by uuid NOT NULL,                        -- person who recorded the change
  granted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, brand_id, channel, purpose),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, brand_id) REFERENCES app.brand (org_id, id),
  CHECK ((status = 'granted' AND granted_at IS NOT NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

-- Allowed sending window in the member's home-location time zone, for reminder and marketing traffic.
-- Default 08:00–21:00 mirrors the TCPA telephone-solicitation window [VERIFICAR · legal review for PR and per state].
CREATE TABLE app.message_policy (
  org_id uuid PRIMARY KEY DEFAULT app.org_id() REFERENCES app.organization (id),
  window_start time NOT NULL DEFAULT '08:00',
  window_end time NOT NULL DEFAULT '21:00',
  CHECK (window_start < window_end),
  -- Owners may narrow the window, never widen it beyond 08:00–21:00 (E8 review LOW).
  CHECK (window_start >= '08:00' AND window_end <= '21:00')
);

-- Append-only consent history: every grant/revoke with its evidence (E8 review MEDIUM: upserts lost proof).
CREATE TABLE app.consent_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL,
  consent_id uuid NOT NULL REFERENCES app.consent (id),
  member_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  channel app.channel NOT NULL,
  purpose app.msg_purpose NOT NULL,
  status app.consent_status NOT NULL,
  source app.consent_source NOT NULL,
  evidence text,
  recorded_by uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);
CREATE INDEX consent_event_member_idx ON app.consent_event (member_id, at DESC);

-- Platform template catalogue (global, read-only for request traffic). The DATABASE renders every message:
-- purpose comes from here, brand/name/location/link are looked up server-side, and every other variable must
-- match a strict pattern (E8 review CRITICAL: free-text variables let a sender inject marketing, health claims,
-- forbidden terms and phishing links into a reminder).
CREATE TABLE app.message_template (
  key text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('es', 'en')),
  purpose app.msg_purpose NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (key, locale),
  -- Marketing always carries the opt-out line.
  CHECK (purpose <> 'marketing' OR body LIKE '%BAJA%' OR body LIKE '%STOP%')
);
CREATE TABLE app.template_variable (
  name text PRIMARY KEY,
  pattern text NOT NULL  -- anchored POSIX regex; no braces, newlines or URLs can pass any of them
);
INSERT INTO app.template_variable (name, pattern) VALUES
  ('class_name', '^[[:alpha:][:digit:] .''-]{1,40}$'),
  ('plan',       '^[[:alpha:][:digit:] .''-]{1,40}$'),
  ('date',       '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  ('time',       '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ('amount',     '^\$[0-9]{1,6}\.[0-9]{2}$'),
  ('last4',      '^[0-9]{4}$'),
  ('discount',   '^[1-9][0-9]?%$');
INSERT INTO app.message_template (key, locale, purpose, body) VALUES
  ('class.reminder', 'es', 'reminder', '{{brand}}: Hola {{name}}, te recordamos tu clase de {{class_name}} en {{location}} el {{date}} a las {{time}}.'),
  ('class.reminder', 'en', 'reminder', '{{brand}}: Hi {{name}}, a reminder of your {{class_name}} class at {{location}} on {{date}} at {{time}}.'),
  ('membership.renewal_notice', 'es', 'transactional', '{{brand}}: Hola {{name}}, tu membresía {{plan}} se renueva el {{date}} por {{amount}}.'),
  ('membership.renewal_notice', 'en', 'transactional', '{{brand}}: Hi {{name}}, your {{plan}} membership renews on {{date}} for {{amount}}.'),
  ('payment.failed', 'es', 'transactional', '{{brand}}: Hola {{name}}, no pudimos procesar tu pago de {{amount}}. Actualiza tu método de pago en {{link}}'),
  ('payment.failed', 'en', 'transactional', '{{brand}}: Hi {{name}}, we could not process your payment of {{amount}}. Update your payment method at {{link}}'),
  ('card.expiring', 'es', 'transactional', '{{brand}}: Hola {{name}}, tu tarjeta terminada en {{last4}} vence el {{date}}. Actualízala en {{link}}'),
  ('card.expiring', 'en', 'transactional', '{{brand}}: Hi {{name}}, your card ending in {{last4}} expires on {{date}}. Update it at {{link}}'),
  ('promo.generic', 'es', 'marketing', '{{brand}}: Hola {{name}}, este mes tienes {{discount}} de descuento en {{location}} hasta el {{date}}. Pregunta en recepción. Responde BAJA para no recibir más mensajes.'),
  ('promo.generic', 'en', 'marketing', '{{brand}}: Hi {{name}}, this month you get {{discount}} off at {{location}} until {{date}}. Ask at the front desk. Reply STOP to unsubscribe.');

CREATE TABLE app.outbound_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  brand_id uuid NOT NULL,
  location_id uuid NOT NULL,
  member_id uuid NOT NULL,
  channel app.channel NOT NULL,
  purpose app.msg_purpose NOT NULL,
  template_key text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('es', 'en')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4096),
  status app.msg_status NOT NULL,
  block_reason text,
  scheduled_for timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, brand_id) REFERENCES app.brand (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK ((status = 'blocked') = (block_reason IS NOT NULL))
);
CREATE INDEX outbound_due_idx ON app.outbound_message (status, scheduled_for) WHERE status = 'queued';

-- Unified inbox (front desk). Rows arrive from provider webhooks (next slice) through a system path.
CREATE TABLE app.inbound_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  brand_id uuid NOT NULL,
  location_id uuid,
  member_id uuid,
  channel app.channel NOT NULL,
  from_address text NOT NULL,
  body text NOT NULL CHECK (length(body) <= 4096),
  received_at timestamptz NOT NULL DEFAULT now(),
  handled boolean NOT NULL DEFAULT false,
  FOREIGN KEY (org_id, brand_id) REFERENCES app.brand (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);

-- ── Helpers (owned by app_definer: they read member rows without RLS but apply the rules explicitly).
-- Who may see or act for a member: scoped staff, the member themself, or their guardian.
CREATE FUNCTION app.can_act_for_member(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.staff_can_see_member(p_member)
      OR EXISTS (SELECT 1 FROM app.member m
                 WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id())
      OR EXISTS (SELECT 1 FROM app.guardian_link g
                 WHERE g.member_id = p_member AND g.org_id = app.org_id() AND g.guardian_person_id = app.person_id())
$$;

-- Next instant at or after p_ts that falls inside [window_start, window_end) local time in p_tz.
CREATE FUNCTION app.next_allowed_send(p_ts timestamptz, p_tz text, p_start time, p_end time)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_local timestamp := p_ts AT TIME ZONE p_tz;
BEGIN
  IF v_local::time >= p_start AND v_local::time < p_end THEN RETURN p_ts; END IF;
  IF v_local::time < p_start THEN RETURN (v_local::date + p_start) AT TIME ZONE p_tz; END IF;
  RETURN (v_local::date + 1 + p_start) AT TIME ZONE p_tz;
END $$;

-- Opt-out keywords (STOP/BAJA family). Normalised: trimmed, case-insensitive, accents ignored for "cancelación".
CREATE FUNCTION app.is_opt_out_keyword(p_body text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(btrim(translate(coalesce(p_body, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'), E' \t\r\n.!¡'))
         IN ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'BAJA', 'CANCELAR', 'ALTO', 'PARAR')
$$;

-- Health-claim and title guard on every rendered body (spec §6.7 Ley 82, §11 FDA/FTC). [P] list to be extended
-- by legal review; matching is on whole words, case-insensitive.
CREATE FUNCTION app.has_forbidden_terms(p_body text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_body ~* '\m(nutricionista|dietista|nutritionist|dietitian|garantiza|garantizado|guarantee|guaranteed|cura|cure|curar|adelgaza|bajar[[:space:]]+[0-9]+|lose[[:space:]]+[0-9]+)\M'
      -- At most one link, and only the server-built payment link at the very end of the message.
      OR regexp_count(p_body, '(https?://|www\.)', 1, 'i') > 1
      OR (p_body ~* '(https?://|www\.)' AND p_body !~ ' https://[a-z0-9.-]+/pagos$')
$$;

-- Render a catalogue template for a member. Server variables: brand, name (first name), location, link.
-- Client variables must be declared in app.template_variable and match its pattern; unknown or missing → error.
CREATE FUNCTION app.render_message(p_key text, p_locale text, p_member uuid, p_brand uuid, p_vars jsonb,
                                   OUT purpose app.msg_purpose, OUT body text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_name text;
  v_brand text;
  v_location text;
  v_domain text;
  v_var text;
  v_val text;
  v_pattern text;
  v_used text[] := '{}';
BEGIN
  SELECT t.purpose, t.body INTO purpose, body FROM app.message_template t WHERE t.key = p_key AND t.locale = p_locale;
  IF body IS NULL THEN RAISE EXCEPTION 'unknown_template' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(coalesce(p_vars, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'invalid_vars' USING ERRCODE = '22023'; END IF;

  SELECT regexp_replace(split_part(btrim(m.full_name), ' ', 1), '[^[:alpha:]''-]', '', 'g'), b.name, l.name, b.custom_domain
    INTO v_name, v_brand, v_location, v_domain
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id JOIN app.brand b ON b.id = p_brand
   WHERE m.id = p_member AND m.org_id = app.org_id() AND b.org_id = app.org_id();
  IF v_brand IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  FOR v_var IN SELECT DISTINCT (regexp_matches(body, '\{\{([a-z_0-9]+)\}\}', 'g'))[1] LOOP
    v_val := CASE v_var
      WHEN 'brand' THEN v_brand
      WHEN 'name' THEN coalesce(nullif(v_name, ''), CASE p_locale WHEN 'es' THEN 'socio' ELSE 'member' END)
      WHEN 'location' THEN v_location
      -- [S] platform default portal domain until brands configure custom domains.
      WHEN 'link' THEN 'https://' || coalesce(v_domain, 'portal.gym-saas.invalid') || '/pagos'
    END;
    IF v_val IS NULL THEN
      SELECT tv.pattern INTO v_pattern FROM app.template_variable tv WHERE tv.name = v_var;
      v_val := p_vars ->> v_var;
      IF v_pattern IS NULL OR v_val IS NULL OR v_val !~ v_pattern THEN
        RAISE EXCEPTION 'invalid_variable:%', v_var USING ERRCODE = '22023';
      END IF;
      v_used := v_used || v_var;
    END IF;
    body := replace(body, '{{' || v_var || '}}', v_val);
  END LOOP;
  -- Extra client variables are refused, not ignored, so callers notice mistakes.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) k WHERE NOT k = ANY (v_used)) THEN
    RAISE EXCEPTION 'unexpected_variable' USING ERRCODE = '22023';
  END IF;
  IF app.has_forbidden_terms(body) THEN RAISE EXCEPTION 'forbidden_content' USING ERRCODE = '22023'; END IF;
END $$;

-- Which consent sources a caller may record (builder review): members/guardians only through the portal;
-- staff through the front desk or a paper/web form they transcribe; imports by the owner. 'keyword' comes only
-- from the inbound pipeline (a system path), never from request traffic.
CREATE FUNCTION app.check_consent_source(p_source app.consent_source) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_source = 'keyword'
     OR (app.role() IN ('member', 'guardian') AND p_source <> 'member_portal')
     OR (app.is_staff() AND p_source NOT IN ('front_desk', 'web_form', 'import'))
     OR (p_source = 'import' AND app.role() IS DISTINCT FROM 'owner') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
END $$;

-- The brand must be the brand of the member's home location (builder review). [P] multi-brand memberships
-- would relax this to "a brand of a location the membership covers".
CREATE FUNCTION app.check_member_brand(p_member uuid, p_brand uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.member m JOIN app.location l ON l.id = m.home_location_id
                  WHERE m.id = p_member AND l.brand_id = p_brand AND m.org_id = app.org_id()) THEN
    RAISE EXCEPTION 'forbidden_brand' USING ERRCODE = '42501';
  END IF;
END $$;

-- Grant or revoke ONE consent. Staff of the member's location, the member, or their guardian.
CREATE FUNCTION app.set_consent(p_member uuid, p_brand uuid, p_channel app.channel, p_purpose app.msg_purpose,
                                p_granted boolean, p_source app.consent_source, p_evidence text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_id uuid;
  v_loc uuid;
  v_prev app.consent;
BEGIN
  IF v_org IS NULL OR NOT app.can_act_for_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Any staff who can see the member may RECORD a revocation; only front-of-house staff may record a grant
  -- (E8 review HIGH: chef/trainer/accountant could grant marketing consent).
  IF p_granted AND app.is_staff() AND app.role() NOT IN ('owner', 'location_manager', 'front_desk') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_member_brand(p_member, p_brand);
  PERFORM app.check_consent_source(p_source);
  IF p_granted AND coalesce(btrim(p_evidence), '') = '' THEN
    RAISE EXCEPTION 'evidence_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM app.consent
   WHERE member_id = p_member AND brand_id = p_brand AND channel = p_channel AND purpose = p_purpose
   FOR UPDATE;
  -- A revocation made by the member (portal) or by keyword can only be undone by the member or guardian
  -- (E8 review HIGH: staff could re-grant over a member's opt-out).
  IF p_granted AND app.is_staff() AND v_prev.status = 'revoked' AND v_prev.source IN ('member_portal', 'keyword') THEN
    RAISE EXCEPTION 'member_revoked' USING ERRCODE = '42501';
  END IF;

  INSERT INTO app.consent AS c (org_id, member_id, brand_id, channel, purpose, status, source, evidence, recorded_by,
                                granted_at, revoked_at, updated_at)
  VALUES (v_org, p_member, p_brand, p_channel, p_purpose,
          CASE WHEN p_granted THEN 'granted' ELSE 'revoked' END::app.consent_status, p_source, p_evidence,
          app.person_id(), CASE WHEN p_granted THEN now() END, CASE WHEN p_granted THEN NULL ELSE now() END, now())
  ON CONFLICT (member_id, brand_id, channel, purpose) DO UPDATE
    SET status = EXCLUDED.status, source = EXCLUDED.source, evidence = EXCLUDED.evidence,
        recorded_by = EXCLUDED.recorded_by,
        granted_at = CASE WHEN p_granted THEN now() ELSE c.granted_at END,
        revoked_at = CASE WHEN p_granted THEN NULL ELSE now() END,
        updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO app.consent_event (org_id, consent_id, member_id, brand_id, channel, purpose, status, source, evidence, recorded_by)
  VALUES (v_org, v_id, p_member, p_brand, p_channel, p_purpose,
          CASE WHEN p_granted THEN 'granted' ELSE 'revoked' END::app.consent_status, p_source, p_evidence, app.person_id());

  -- A single revocation also blocks what is already queued for that channel and purpose (E8 review HIGH).
  IF NOT p_granted THEN
    UPDATE app.outbound_message SET status = 'blocked', block_reason = 'consent_revoked'
     WHERE member_id = p_member AND brand_id = p_brand AND channel = p_channel AND purpose = p_purpose
       AND org_id = v_org AND status = 'queued';
  END IF;

  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit(CASE WHEN p_granted THEN 'consent.grant' ELSE 'consent.revoke' END, 'consent', v_id::text, v_loc,
                    jsonb_build_object('channel', p_channel, 'purpose', p_purpose, 'source', p_source,
                                       'evidence', p_evidence));
  RETURN v_id;
END $$;

-- Full opt-out: revoke every consent of the member for the brand, all channels and purposes, in one statement
-- (spec E8: an opt-out applies across every channel of that brand in under one minute). Returns rows revoked.
CREATE FUNCTION app.opt_out(p_member uuid, p_brand uuid, p_source app.consent_source)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_n integer;
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.can_act_for_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_member_brand(p_member, p_brand);
  PERFORM app.check_consent_source(p_source);
  WITH revoked AS (
    UPDATE app.consent SET status = 'revoked', source = p_source, evidence = NULL, revoked_at = now(),
                           updated_at = now(), recorded_by = app.person_id()
     WHERE member_id = p_member AND brand_id = p_brand AND org_id = app.org_id() AND status = 'granted'
    RETURNING id, org_id, member_id, brand_id, channel, purpose
  ), hist AS (
    INSERT INTO app.consent_event (org_id, consent_id, member_id, brand_id, channel, purpose, status, source, recorded_by)
    SELECT org_id, id, member_id, brand_id, channel, purpose, 'revoked', p_source, app.person_id() FROM revoked
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM hist;
  -- Anything already queued for that brand and member is blocked too.
  UPDATE app.outbound_message SET status = 'blocked', block_reason = 'opted_out'
   WHERE member_id = p_member AND brand_id = p_brand AND org_id = app.org_id() AND status = 'queued';
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit('consent.opt_out', 'member', p_member::text, v_loc,
                    jsonb_build_object('brand_id', p_brand, 'revoked', v_n, 'source', p_source));
  RETURN v_n;
END $$;

-- Queue one message rendered from the catalogue. Front-of-house roles only (agents act as their invoking user,
-- spec §7.2). Returns the outbound row id; status is 'queued' or 'blocked' (with reason). Never raises for
-- missing consent. The consent row is read FOR SHARE so a concurrent opt-out either waits for this transaction
-- (and then blocks the queued row) or wins first (and this read sees it revoked) — E8 review HIGH race.
CREATE FUNCTION app.enqueue_message(p_member uuid, p_brand uuid, p_channel app.channel, p_template_key text,
                                    p_locale text, p_vars jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_loc uuid;
  v_tz text;
  v_start time;
  v_end time;
  v_consent uuid;
  v_status app.msg_status;
  v_reason text;
  v_when timestamptz := now();
  v_id uuid;
  v_msg record;
BEGIN
  IF v_org IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.staff_can_see_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.check_member_brand(p_member, p_brand);
  SELECT * INTO v_msg FROM app.render_message(p_template_key, p_locale, p_member, p_brand, p_vars);

  SELECT m.home_location_id, l.timezone INTO v_loc, v_tz
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id WHERE m.id = p_member;
  SELECT coalesce(mp.window_start, '08:00'), coalesce(mp.window_end, '21:00') INTO v_start, v_end
    FROM (SELECT 1) one LEFT JOIN app.message_policy mp ON mp.org_id = v_org;

  SELECT c.id INTO v_consent FROM app.consent c
   WHERE c.member_id = p_member AND c.brand_id = p_brand AND c.channel = p_channel
     AND c.purpose = v_msg.purpose AND c.status = 'granted'
   FOR SHARE;
  IF v_consent IS NOT NULL THEN
    v_status := 'queued';
    IF v_msg.purpose <> 'transactional' THEN v_when := app.next_allowed_send(now(), v_tz, v_start, v_end); END IF;
  ELSE
    v_status := 'blocked';
    v_reason := 'no_consent';
  END IF;

  INSERT INTO app.outbound_message (org_id, brand_id, location_id, member_id, channel, purpose, template_key, locale,
                                    body, status, block_reason, scheduled_for, created_by)
  VALUES (v_org, p_brand, v_loc, p_member, p_channel, v_msg.purpose, p_template_key, p_locale, v_msg.body, v_status,
          v_reason, v_when, app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('message.enqueue', 'outbound_message', v_id::text, v_loc,
                    jsonb_build_object('status', v_status, 'reason', v_reason, 'channel', p_channel,
                                       'purpose', v_msg.purpose, 'template', p_template_key));
  RETURN v_id;
END $$;

-- ── RLS
ALTER TABLE app.consent          ENABLE ROW LEVEL SECURITY; ALTER TABLE app.consent          FORCE ROW LEVEL SECURITY;
ALTER TABLE app.message_policy   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.message_policy   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.outbound_message ENABLE ROW LEVEL SECURITY; ALTER TABLE app.outbound_message FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbound_message  ENABLE ROW LEVEL SECURITY; ALTER TABLE app.inbound_message  FORCE ROW LEVEL SECURITY;
ALTER TABLE app.consent_event    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.consent_event    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.message_template ENABLE ROW LEVEL SECURITY; ALTER TABLE app.message_template FORCE ROW LEVEL SECURITY;
ALTER TABLE app.template_variable ENABLE ROW LEVEL SECURITY; ALTER TABLE app.template_variable FORCE ROW LEVEL SECURITY;

CREATE POLICY consent_event_select ON app.consent_event FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND app.can_act_for_member(member_id));
-- The catalogue is global and read-only (platform content, not tenant data).
CREATE POLICY template_select ON app.message_template FOR SELECT USING ((SELECT app.org_id()) IS NOT NULL);
CREATE POLICY template_var_select ON app.template_variable FOR SELECT USING ((SELECT app.org_id()) IS NOT NULL);

CREATE POLICY consent_select ON app.consent FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND app.can_act_for_member(member_id));
CREATE POLICY policy_select ON app.message_policy FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.is_staff()));
CREATE POLICY policy_insert ON app.message_policy FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY policy_update ON app.message_policy FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));
-- Members see messages addressed to them; staff see those of members they can see.
CREATE POLICY outbound_select ON app.outbound_message FOR SELECT
  USING (org_id = (SELECT app.org_id()) AND app.can_act_for_member(member_id));
CREATE POLICY inbound_select ON app.inbound_message FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.is_staff()) AND (
    (SELECT app.org_wide())
    OR location_id = ANY ((SELECT app.location_ids())::uuid[])
    OR (member_id IS NOT NULL AND app.staff_can_see_member(member_id))));
CREATE POLICY inbound_update ON app.inbound_message FOR UPDATE USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND (
    (SELECT app.org_wide())
    OR location_id = ANY ((SELECT app.location_ids())::uuid[])
    OR (member_id IS NOT NULL AND app.staff_can_see_member(member_id))))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- ── Grants: reads plus the few writable columns; every other write goes through the definer functions.
REVOKE ALL ON app.consent, app.message_policy, app.outbound_message, app.inbound_message, app.consent_event,
  app.message_template, app.template_variable FROM PUBLIC;
GRANT SELECT ON app.consent, app.message_policy, app.outbound_message, app.inbound_message, app.consent_event,
  app.message_template, app.template_variable TO app_authenticated;
GRANT INSERT (window_start, window_end), UPDATE (window_start, window_end) ON app.message_policy TO app_authenticated;
GRANT UPDATE (handled) ON app.inbound_message TO app_authenticated;

GRANT SELECT ON app.guardian_link, app.brand TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.consent, app.outbound_message TO app_definer;
GRANT SELECT, INSERT ON app.consent_event TO app_definer;
GRANT SELECT ON app.message_template, app.template_variable TO app_definer;
ALTER FUNCTION app.render_message(text, text, uuid, uuid, jsonb) OWNER TO app_definer;
GRANT SELECT ON app.message_policy TO app_definer;
ALTER FUNCTION app.check_member_brand(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.can_act_for_member(uuid) OWNER TO app_definer;
ALTER FUNCTION app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text) OWNER TO app_definer;
ALTER FUNCTION app.opt_out(uuid, uuid, app.consent_source) OWNER TO app_definer;
ALTER FUNCTION app.enqueue_message(uuid, uuid, app.channel, text, text, jsonb) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.check_member_brand(uuid, uuid), app.check_consent_source(app.consent_source),
  app.render_message(text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.check_consent_source(app.consent_source) TO app_definer;
REVOKE ALL ON FUNCTION app.can_act_for_member(uuid), app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text),
  app.opt_out(uuid, uuid, app.consent_source), app.enqueue_message(uuid, uuid, app.channel, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_act_for_member(uuid), app.next_allowed_send(timestamptz, text, time, time),
  app.is_opt_out_keyword(text),
  app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text),
  app.opt_out(uuid, uuid, app.consent_source), app.enqueue_message(uuid, uuid, app.channel, text, text, jsonb)
  TO app_authenticated;
