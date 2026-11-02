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
  CHECK (window_start < window_end)
);

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

-- Grant or revoke ONE consent. Staff of the member's location, the member, or their guardian.
CREATE FUNCTION app.set_consent(p_member uuid, p_brand uuid, p_channel app.channel, p_purpose app.msg_purpose,
                                p_granted boolean, p_source app.consent_source, p_evidence text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_id uuid;
  v_loc uuid;
BEGIN
  IF v_org IS NULL OR NOT app.can_act_for_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.brand b WHERE b.id = p_brand AND b.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_brand' USING ERRCODE = '42501';
  END IF;
  -- A grant must carry evidence (who/how/when); a revocation never needs it.
  IF p_granted AND coalesce(btrim(p_evidence), '') = '' THEN
    RAISE EXCEPTION 'evidence_required' USING ERRCODE = '22023';
  END IF;
  -- 'keyword' revocations only come from the inbound pipeline; never accept a keyword-sourced GRANT.
  IF p_granted AND p_source = 'keyword' THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
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

  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit(CASE WHEN p_granted THEN 'consent.grant' ELSE 'consent.revoke' END, 'consent', v_id::text, v_loc,
                    jsonb_build_object('channel', p_channel, 'purpose', p_purpose, 'source', p_source));
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
  UPDATE app.consent SET status = 'revoked', source = p_source, revoked_at = now(), updated_at = now(),
                         recorded_by = app.person_id()
   WHERE member_id = p_member AND brand_id = p_brand AND org_id = app.org_id() AND status = 'granted';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Anything already queued for that brand and member is blocked too.
  UPDATE app.outbound_message SET status = 'blocked', block_reason = 'opted_out'
   WHERE member_id = p_member AND brand_id = p_brand AND org_id = app.org_id() AND status = 'queued';
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  PERFORM app.audit('consent.opt_out', 'member', p_member::text, v_loc,
                    jsonb_build_object('brand_id', p_brand, 'revoked', v_n, 'source', p_source));
  RETURN v_n;
END $$;

-- Queue one message. Front-of-house roles only (agents act as their invoking user, spec §7.2).
-- Returns the outbound row id; status is 'queued' or 'blocked' (with reason). Never raises for missing consent.
CREATE FUNCTION app.enqueue_message(p_member uuid, p_brand uuid, p_channel app.channel, p_purpose app.msg_purpose,
                                    p_template_key text, p_locale text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_loc uuid;
  v_tz text;
  v_start time;
  v_end time;
  v_ok boolean;
  v_status app.msg_status;
  v_reason text;
  v_when timestamptz := now();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk')
     OR NOT app.staff_can_see_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.brand b WHERE b.id = p_brand AND b.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_brand' USING ERRCODE = '42501';
  END IF;

  SELECT m.home_location_id, l.timezone INTO v_loc, v_tz
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id WHERE m.id = p_member;
  SELECT coalesce(mp.window_start, '08:00'), coalesce(mp.window_end, '21:00') INTO v_start, v_end
    FROM (SELECT 1) one LEFT JOIN app.message_policy mp ON mp.org_id = v_org;

  SELECT EXISTS (SELECT 1 FROM app.consent c
                  WHERE c.member_id = p_member AND c.brand_id = p_brand AND c.channel = p_channel
                    AND c.purpose = p_purpose AND c.status = 'granted') INTO v_ok;
  IF v_ok THEN
    v_status := 'queued';
    IF p_purpose <> 'transactional' THEN v_when := app.next_allowed_send(now(), v_tz, v_start, v_end); END IF;
  ELSE
    v_status := 'blocked';
    v_reason := 'no_consent';
  END IF;

  INSERT INTO app.outbound_message (org_id, brand_id, location_id, member_id, channel, purpose, template_key, locale,
                                    body, status, block_reason, scheduled_for, created_by)
  VALUES (v_org, p_brand, v_loc, p_member, p_channel, p_purpose, p_template_key, p_locale, p_body, v_status, v_reason,
          v_when, app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('message.enqueue', 'outbound_message', v_id::text, v_loc,
                    jsonb_build_object('status', v_status, 'reason', v_reason, 'channel', p_channel, 'purpose', p_purpose));
  RETURN v_id;
END $$;

-- ── RLS
ALTER TABLE app.consent          ENABLE ROW LEVEL SECURITY; ALTER TABLE app.consent          FORCE ROW LEVEL SECURITY;
ALTER TABLE app.message_policy   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.message_policy   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.outbound_message ENABLE ROW LEVEL SECURITY; ALTER TABLE app.outbound_message FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inbound_message  ENABLE ROW LEVEL SECURITY; ALTER TABLE app.inbound_message  FORCE ROW LEVEL SECURITY;

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
REVOKE ALL ON app.consent, app.message_policy, app.outbound_message, app.inbound_message FROM PUBLIC;
GRANT SELECT ON app.consent, app.message_policy, app.outbound_message, app.inbound_message TO app_authenticated;
GRANT INSERT (window_start, window_end), UPDATE (window_start, window_end) ON app.message_policy TO app_authenticated;
GRANT UPDATE (handled) ON app.inbound_message TO app_authenticated;

GRANT SELECT ON app.guardian_link, app.brand TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.consent, app.outbound_message TO app_definer;
GRANT SELECT ON app.message_policy TO app_definer;
ALTER FUNCTION app.can_act_for_member(uuid) OWNER TO app_definer;
ALTER FUNCTION app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text) OWNER TO app_definer;
ALTER FUNCTION app.opt_out(uuid, uuid, app.consent_source) OWNER TO app_definer;
ALTER FUNCTION app.enqueue_message(uuid, uuid, app.channel, app.msg_purpose, text, text, text) OWNER TO app_definer;
REVOKE ALL ON FUNCTION app.can_act_for_member(uuid), app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text),
  app.opt_out(uuid, uuid, app.consent_source), app.enqueue_message(uuid, uuid, app.channel, app.msg_purpose, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_act_for_member(uuid), app.next_allowed_send(timestamptz, text, time, time),
  app.is_opt_out_keyword(text),
  app.set_consent(uuid, uuid, app.channel, app.msg_purpose, boolean, app.consent_source, text),
  app.opt_out(uuid, uuid, app.consent_source), app.enqueue_message(uuid, uuid, app.channel, app.msg_purpose, text, text, text)
  TO app_authenticated;
