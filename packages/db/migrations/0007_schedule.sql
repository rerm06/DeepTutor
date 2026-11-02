-- Module schedule · E6 Agenda, reservas y acceso (spec §3.2). Owned by the schedule module agent; see docs/modules.md.
-- Classes (class_type → class_session), bookings with waitlist, per-location access/cancellation policy,
-- staff appointments, and check-in with a rotating QR credential.
-- Every cross-row rule (capacity, waitlist promotion, late cancellation, staff overlap, access decision, QR
-- verification) lives in SECURITY DEFINER functions owned by app_definer that re-check the caller's claims and
-- location scope, take row/advisory locks where two operations compete, and write audit rows.

CREATE TYPE app.booking_status AS ENUM ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show');
CREATE TYPE app.appointment_kind AS ENUM ('personal_training', 'assessment', 'nutrition', 'clinical');
CREATE TYPE app.appointment_status AS ENUM ('scheduled', 'cancelled');
-- 'app' and 'door' are reserved for a member self-check-in flow and door hardware [VERIFICAR · not in F1].
CREATE TYPE app.checkin_source AS ENUM ('qr', 'front_desk', 'app', 'door');
CREATE TYPE app.checkin_result AS ENUM ('allowed', 'denied');

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────
-- Class catalogue (org-wide). Names may end up in reminders later (E8), so they are validated like location names.
CREATE TABLE app.class_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  -- Letters, digits and light punctuation only; nothing that reads as a domain (E8: names reach messages).
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.-]{1,60}$' AND name !~ '[[:alnum:]-]\.[[:alpha:]]{2,}'),
  description text CHECK (length(description) <= 500 AND description !~ '[\r\n{}<>]'),
  duration_min integer NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 480),
  default_capacity integer NOT NULL DEFAULT 20 CHECK (default_capacity BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);

CREATE TABLE app.class_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  class_type_id uuid NOT NULL,
  instructor_id uuid,  -- staff_member; NULL = "por asignar"
  room text CHECK (room ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.#-]{1,60}$' AND room !~ '[[:alnum:]-]\.[[:alpha:]]{2,}'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 500),
  cancelled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, class_type_id) REFERENCES app.class_type (org_id, id),
  FOREIGN KEY (org_id, instructor_id) REFERENCES app.staff_member (org_id, id),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '8 hours')
);
CREATE INDEX class_session_loc_start_idx ON app.class_session (org_id, location_id, starts_at);
CREATE INDEX class_session_instructor_idx ON app.class_session (instructor_id, starts_at);

CREATE TABLE app.booking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  session_id uuid NOT NULL,
  member_id uuid NOT NULL,
  status app.booking_status NOT NULL,
  waitlist_position integer CHECK (waitlist_position >= 1),
  late_cancel boolean NOT NULL DEFAULT false,
  booked_by uuid NOT NULL,     -- person who made the booking (member, guardian or staff)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, session_id) REFERENCES app.class_session (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (NOT late_cancel OR status = 'cancelled')
);
-- No double booking: one live booking per member and session (cancelled rows are history).
CREATE UNIQUE INDEX booking_one_live_per_member ON app.booking (session_id, member_id) WHERE status <> 'cancelled';
CREATE INDEX booking_member_idx ON app.booking (member_id, created_at DESC);

-- Per-location rules. deny_past_due defaults to false: refusing entry to an unpaid member is a HUMAN decision
-- taken by the owner (spec §3.2), never automatic.
CREATE TABLE app.location_policy (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid PRIMARY KEY,
  cancel_window_hours integer NOT NULL DEFAULT 12 CHECK (cancel_window_hours BETWEEN 0 AND 72),
  no_show_penalty boolean NOT NULL DEFAULT false,
  deny_past_due boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, location_id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

-- Staff appointments. No free-text notes: the kind alone can be health-related, so visibility is restricted
-- (see policies) and clinical content belongs to the health module.
CREATE TABLE app.appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  kind app.appointment_kind NOT NULL,
  staff_member_id uuid NOT NULL,
  member_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status app.appointment_status NOT NULL DEFAULT 'scheduled',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, staff_member_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '8 hours'),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX appointment_staff_idx ON app.appointment (staff_member_id, starts_at) WHERE status = 'scheduled';

-- Every access attempt, allowed or denied. member_id is NULL when the presented token could not be attributed.
CREATE TABLE app.check_in (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  member_id uuid,
  source app.checkin_source NOT NULL,
  result app.checkin_result NOT NULL,
  reason text NOT NULL CHECK (reason IN ('active', 'trial', 'past_due', 'past_due_denied', 'frozen', 'cancelled',
                                         'lead', 'invalid_token', 'expired_token', 'token_used')),
  recorded_by uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  CHECK (member_id IS NOT NULL OR reason = 'invalid_token'),
  CHECK ((result = 'allowed') = (reason IN ('active', 'trial', 'past_due')))
);
CREATE INDEX check_in_loc_at_idx ON app.check_in (org_id, location_id, at DESC);
CREATE INDEX check_in_member_idx ON app.check_in (member_id, at DESC);

-- Rotating QR credential key: generated inside the database, readable only by app_definer (never by request traffic).
CREATE TABLE app_private.qr_key (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  key bytea NOT NULL CHECK (length(key) >= 32)
);
INSERT INTO app_private.qr_key (key) SELECT app_private.gen_random_bytes(32);
REVOKE ALL ON app_private.qr_key FROM PUBLIC;
GRANT SELECT ON app_private.qr_key TO app_definer;

-- ── Helpers (definer: read across RLS but apply the rule explicitly) ─────────────────────────────────────
-- The caller is the member themself or their guardian (NOT staff: staff access is decided per table).
CREATE FUNCTION app.sched_self_or_ward(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p_member IS NOT NULL AND (
       EXISTS (SELECT 1 FROM app.member m
                WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id()
                  AND app.role() = 'member')
    OR EXISTS (SELECT 1 FROM app.guardian_link g
                WHERE g.member_id = p_member AND g.org_id = app.org_id()
                  AND g.guardian_person_id = app.person_id() AND app.role() = 'guardian'))
$$;

-- staff_member ids of the caller in the current org (one person may hold several staff roles).
CREATE FUNCTION app.sched_my_staff_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(array_agg(s.id), '{}'::uuid[]) FROM app.staff_member s
   WHERE s.org_id = app.org_id() AND s.person_id = app.person_id() AND app.is_staff()
$$;

-- Staff who may see a session's roster: front of house at the session's location, or its own instructor.
CREATE FUNCTION app.sched_staff_session(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.class_session s
     WHERE s.id = p_session AND s.org_id = app.org_id() AND app.is_staff()
       AND app.can_see_location(s.location_id)
       AND (app.role() IN ('owner', 'location_manager', 'front_desk')
            OR (app.role() = 'trainer' AND s.instructor_id = ANY (app.sched_my_staff_ids()))))
$$;

-- Access rule (spec §3.2). Pure, so it is tested directly: active|trial → allowed; past_due → allowed unless the
-- location policy denies it; frozen|cancelled|lead → denied with the status as reason.
CREATE FUNCTION app.access_decision(p_status app.member_status, p_deny_past_due boolean,
                                    OUT result app.checkin_result, OUT reason text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_status IN ('active', 'trial') OR (p_status = 'past_due' AND NOT coalesce(p_deny_past_due, false))
              THEN 'allowed' ELSE 'denied' END::app.checkin_result,
         CASE WHEN p_status = 'past_due' AND coalesce(p_deny_past_due, false) THEN 'past_due_denied'
              ELSE p_status::text END
$$;

-- QR token: v1.<member uuid>.<30-second window>.<first 32 hex of HMAC-SHA256(org|member|window, qr_key)>.
-- Internal (not granted to request traffic): tests call it as the superuser to forge old windows.
CREATE FUNCTION app.qr_token_for(p_org uuid, p_member uuid, p_window bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT 'v1.' || p_member::text || '.' || p_window::text || '.'
         || left(encode(app_private.hmac(convert_to(p_org::text || '|' || p_member::text || '|' || p_window::text, 'UTF8'),
                                         k.key, 'sha256'), 'hex'), 32)
    FROM app_private.qr_key k
$$;

CREATE FUNCTION app.qr_window(p_at timestamptz) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT floor(extract(epoch FROM p_at) / 30)::bigint
$$;

-- Current token for the caller (member) or their ward (guardian). Staff cannot mint credentials.
CREATE FUNCTION app.my_qr_token(p_member uuid, OUT token text, OUT expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_window bigint := app.qr_window(clock_timestamp());
BEGIN
  IF app.org_id() IS NULL OR NOT app.sched_self_or_ward(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  token := app.qr_token_for(app.org_id(), p_member, v_window);
  -- Valid for the rest of this window plus the next one (verify accepts current and previous windows).
  expires_at := to_timestamp((v_window + 2) * 30);
END $$;

-- Verify a token for the caller's org. Returns the member id (NULL if the token is malformed, forged or from
-- another org) and whether its window is still accepted (current or previous only: an old screenshot fails).
CREATE FUNCTION app.qr_verify(p_token text, OUT member_id uuid, OUT fresh boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_parts text[];
  v_member uuid;
  v_window bigint;
  v_now bigint := app.qr_window(clock_timestamp());
BEGIN
  fresh := false;
  IF p_token IS NULL OR length(p_token) > 120
     OR p_token !~ '^v1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]{1,12}\.[0-9a-f]{32}$' THEN
    RETURN;
  END IF;
  v_parts := string_to_array(p_token, '.');
  v_member := v_parts[2]::uuid;
  v_window := v_parts[3]::bigint;
  IF app.qr_token_for(app.org_id(), v_member, v_window) <> p_token THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.member m WHERE m.id = v_member AND m.org_id = app.org_id()) THEN RETURN; END IF;
  member_id := v_member;
  fresh := v_window IN (v_now, v_now - 1);
END $$;

-- ── Check-in ─────────────────────────────────────────────────────────────────────────────────────────────
-- Front of house at the location checks a member in by scanned token (source qr) or by member id (front_desk).
-- Every attempt by an authorised caller is recorded, allowed or denied. Unauthorised callers are refused outright.
CREATE FUNCTION app.check_in(p_location uuid, p_member uuid, p_token text)
RETURNS TABLE (id uuid, result app.checkin_result, reason text, member_id uuid, full_name text,
               member_no text, member_status app.member_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid;
  v_fresh boolean := true;
  v_source app.checkin_source;
  v_status app.member_status;
  v_deny boolean;
  v_result app.checkin_result;
  v_reason text;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager', 'front_desk') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  IF (p_member IS NULL) = (p_token IS NULL) THEN
    RAISE EXCEPTION 'member_or_token_required' USING ERRCODE = '22023';
  END IF;

  IF p_token IS NOT NULL THEN
    v_source := 'qr';
    SELECT q.member_id, q.fresh INTO v_member, v_fresh FROM app.qr_verify(p_token) q;
  ELSE
    v_source := 'front_desk';
    -- Same error for a member of another org and a non-existent id (no existence oracle).
    IF NOT EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = v_org) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    v_member := p_member;
  END IF;

  IF v_member IS NULL THEN
    v_result := 'denied'; v_reason := 'invalid_token';
  ELSIF NOT v_fresh THEN
    v_result := 'denied'; v_reason := 'expired_token';
  ELSIF v_source = 'qr' AND (
      -- Security review (schedule) L1: a token admits ONE allowed check-in. Its window is at most 60 s, so an allowed
      -- QR check-in for this member in the last 90 s means the token (or a copy of it) was already used anywhere.
      SELECT pg_advisory_xact_lock(hashtext('qr_use:' || v_member::text)) IS NOT NULL
         AND EXISTS (SELECT 1 FROM app.check_in c
                      WHERE c.member_id = v_member AND c.org_id = v_org AND c.source = 'qr' AND c.result = 'allowed'
                        AND c.at > now() - interval '90 seconds')) THEN
    v_result := 'denied'; v_reason := 'token_used';
  ELSE
    SELECT m.status INTO v_status FROM app.member m WHERE m.id = v_member;
    SELECT coalesce(lp.deny_past_due, false) INTO v_deny
      FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = p_location AND lp.org_id = v_org;
    SELECT d.result, d.reason INTO v_result, v_reason FROM app.access_decision(v_status, v_deny) d;
  END IF;

  INSERT INTO app.check_in AS ci (org_id, location_id, member_id, source, result, reason, recorded_by)
  VALUES (v_org, p_location, v_member, v_source, v_result, v_reason, app.person_id())
  RETURNING ci.id INTO v_id;

  RETURN QUERY
    SELECT v_id, v_result, v_reason, v_member, m.full_name, m.member_no, m.status
      FROM (SELECT 1) one LEFT JOIN app.member m ON m.id = v_member;
END $$;

-- ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────
-- Serialise everything that books a staff member's time (classes they teach and appointments).
CREATE FUNCTION app.sched_lock_staff(p_staff uuid) RETURNS void
LANGUAGE sql VOLATILE AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('schedule.staff:' || p_staff::text, 0))
$$;

-- True when the staff member already teaches or has an appointment overlapping [p_start, p_end).
CREATE FUNCTION app.sched_staff_busy(p_staff uuid, p_start timestamptz, p_end timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.appointment a
                  WHERE a.staff_member_id = p_staff AND a.status = 'scheduled'
                    AND tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, p_end))
      OR EXISTS (SELECT 1 FROM app.class_session s
                  WHERE s.instructor_id = p_staff AND NOT s.cancelled
                    AND tstzrange(s.starts_at, s.ends_at) && tstzrange(p_start, p_end))
$$;

CREATE FUNCTION app.create_class_session(p_location uuid, p_class_type uuid, p_instructor uuid, p_room text,
                                         p_starts timestamptz, p_ends timestamptz, p_capacity integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.class_type c WHERE c.id = p_class_type AND c.org_id = v_org AND c.active) THEN
    RAISE EXCEPTION 'invalid_class_type' USING ERRCODE = '22023';
  END IF;
  IF p_starts IS NULL OR p_starts <= now() THEN
    RAISE EXCEPTION 'session_in_past' USING ERRCODE = '22023';
  END IF;
  IF p_instructor IS NOT NULL THEN
    -- The instructor must be an active trainer of this org assigned to this location.
    IF NOT EXISTS (SELECT 1 FROM app.staff_member s JOIN app.staff_location sl ON sl.staff_member_id = s.id
                    WHERE s.id = p_instructor AND s.org_id = v_org AND s.active AND s.role = 'trainer'
                      AND sl.location_id = p_location) THEN
      RAISE EXCEPTION 'invalid_instructor' USING ERRCODE = '22023';
    END IF;
    PERFORM app.sched_lock_staff(p_instructor);
    IF app.sched_staff_busy(p_instructor, p_starts, p_ends) THEN
      RAISE EXCEPTION 'staff_busy' USING ERRCODE = '23505';
    END IF;
  END IF;
  INSERT INTO app.class_session (org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at,
                                 capacity, created_by)
  VALUES (v_org, p_location, p_class_type, p_instructor, nullif(btrim(p_room), ''), p_starts, p_ends, p_capacity,
          app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('class_session.create', 'class_session', v_id::text, p_location,
                    jsonb_build_object('capacity', p_capacity, 'starts_at', p_starts));
  RETURN v_id;
END $$;

-- Cancel a session: every live booking is cancelled with it (not flagged late: the gym cancelled).
CREATE FUNCTION app.cancel_class_session(p_session uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_s app.class_session;
  v_n integer;
BEGIN
  SELECT * INTO v_s FROM app.class_session s WHERE s.id = p_session AND s.org_id = app.org_id() FOR UPDATE;
  IF v_s.id IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager')
     OR NOT app.can_see_location(v_s.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_s.cancelled THEN RAISE EXCEPTION 'already_cancelled' USING ERRCODE = '22023'; END IF;
  UPDATE app.class_session SET cancelled = true WHERE id = p_session;
  UPDATE app.booking SET status = 'cancelled', waitlist_position = NULL, cancelled_at = now(), updated_at = now()
   WHERE session_id = p_session AND status IN ('booked', 'waitlisted');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM app.audit('class_session.cancel', 'class_session', p_session::text, v_s.location_id,
                    jsonb_build_object('bookings_cancelled', v_n));
  RETURN v_n;
END $$;

-- Seats taken / waitlisted per session, for sessions the caller can see (same rule as class_session_select).
-- Counts only: no member identity leaves this function.
CREATE FUNCTION app.session_occupancy(p_sessions uuid[])
RETURNS TABLE (session_id uuid, booked integer, waitlisted integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.id,
         (count(*) FILTER (WHERE b.status IN ('booked', 'attended', 'no_show')))::integer,
         (count(*) FILTER (WHERE b.status = 'waitlisted'))::integer
    FROM app.class_session s LEFT JOIN app.booking b ON b.session_id = s.id
   WHERE s.id = ANY (p_sessions) AND s.org_id = app.org_id()
     AND (NOT app.is_staff() OR app.can_see_location(s.location_id))
     AND app.role() IS NOT NULL
   GROUP BY s.id
$$;

-- Roster with member names for staff allowed on the session (front of house at its location, or its instructor).
-- Members of another home location are shown too: they booked this class.
CREATE FUNCTION app.session_roster(p_session uuid)
RETURNS TABLE (booking_id uuid, member_id uuid, full_name text, member_no text, status app.booking_status,
               waitlist_position integer, late_cancel boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.sched_staff_session(p_session) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT b.id, b.member_id, m.full_name, m.member_no, b.status, b.waitlist_position, b.late_cancel, b.created_at
      FROM app.booking b JOIN app.member m ON m.id = b.member_id
     WHERE b.session_id = p_session
     ORDER BY CASE b.status WHEN 'waitlisted' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,
              b.waitlist_position NULLS FIRST, b.created_at;
END $$;

-- ── Bookings ─────────────────────────────────────────────────────────────────────────────────────────────
-- Renumber the waitlist 1..n in its current order (call with the session row locked).
CREATE FUNCTION app.sched_renumber_waitlist(p_session uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  UPDATE app.booking b SET waitlist_position = r.pos, updated_at = now()
    FROM (SELECT id, row_number() OVER (ORDER BY waitlist_position, created_at, id)::integer AS pos
            FROM app.booking WHERE session_id = p_session AND status = 'waitlisted') r
   WHERE b.id = r.id AND b.waitlist_position IS DISTINCT FROM r.pos
$$;

-- Book a member into a session: the member themself, their guardian, or front of house at the session's location.
-- The session row is locked FOR UPDATE, so two bookings for the last seat serialise and exactly one gets it;
-- the other is waitlisted. Returns the booking id.
CREATE FUNCTION app.book_class(p_session uuid, p_member uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_s app.class_session;
  v_status app.member_status;
  v_deny boolean;
  v_taken integer;
  v_pos integer;
  v_id uuid;
  v_new app.booking_status;
BEGIN
  IF v_org IS NULL OR app.role() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_s FROM app.class_session s WHERE s.id = p_session AND s.org_id = v_org FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT (app.sched_self_or_ward(p_member)
          OR (app.role() IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(v_s.location_id)
              AND EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = v_org))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_s.cancelled THEN RAISE EXCEPTION 'session_cancelled' USING ERRCODE = '22023'; END IF;
  IF v_s.starts_at <= now() THEN RAISE EXCEPTION 'session_started' USING ERRCODE = '22023'; END IF;

  -- Same eligibility as the door: frozen, cancelled and lead members cannot book.
  SELECT m.status INTO v_status FROM app.member m WHERE m.id = p_member;
  SELECT coalesce(lp.deny_past_due, false) INTO v_deny
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_s.location_id AND lp.org_id = v_org;
  IF (app.access_decision(v_status, v_deny)).result = 'denied' THEN
    RAISE EXCEPTION 'member_not_eligible' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM app.booking b WHERE b.session_id = p_session AND b.member_id = p_member
               AND b.status <> 'cancelled') THEN
    RAISE EXCEPTION 'already_booked' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) FILTER (WHERE b.status IN ('booked', 'attended', 'no_show')),
         coalesce(max(b.waitlist_position) FILTER (WHERE b.status = 'waitlisted'), 0)
    INTO v_taken, v_pos
    FROM app.booking b WHERE b.session_id = p_session;
  IF v_taken < v_s.capacity THEN
    v_new := 'booked'; v_pos := NULL;
  ELSE
    v_new := 'waitlisted'; v_pos := v_pos + 1;
  END IF;
  INSERT INTO app.booking (org_id, session_id, member_id, status, waitlist_position, booked_by)
  VALUES (v_org, p_session, p_member, v_new, v_pos, app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('booking.create', 'booking', v_id::text, v_s.location_id,
                    jsonb_build_object('status', v_new, 'waitlist_position', v_pos, 'session_id', p_session));
  RETURN v_id;
END $$;

-- Cancel a booking (member, guardian, or front of house at the location). A booked seat cancelled inside the
-- location's cancellation window is flagged late_cancel. Freeing a seat promotes the first waitlisted booking.
CREATE FUNCTION app.cancel_booking(p_booking uuid,
                                   OUT status app.booking_status, OUT late_cancel boolean, OUT promoted_booking_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_session uuid;
  v_s app.class_session;
  v_b app.booking;
  v_window integer;
BEGIN
  SELECT b.session_id INTO v_session FROM app.booking b WHERE b.id = p_booking AND b.org_id = v_org;
  IF v_org IS NULL OR v_session IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  -- Lock order: session, then booking (same as book_class), so promotion cannot race a new booking.
  SELECT * INTO v_s FROM app.class_session s WHERE s.id = v_session FOR UPDATE;
  SELECT * INTO v_b FROM app.booking b WHERE b.id = p_booking FOR UPDATE;
  IF NOT (app.sched_self_or_ward(v_b.member_id)
          OR (app.role() IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(v_s.location_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_b.status NOT IN ('booked', 'waitlisted') THEN RAISE EXCEPTION 'not_cancellable' USING ERRCODE = '22023'; END IF;
  IF v_s.starts_at <= now() THEN RAISE EXCEPTION 'session_started' USING ERRCODE = '22023'; END IF;

  SELECT coalesce(lp.cancel_window_hours, 12) INTO v_window
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_s.location_id AND lp.org_id = v_org;
  late_cancel := v_b.status = 'booked' AND now() > v_s.starts_at - make_interval(hours => v_window);

  UPDATE app.booking b SET status = 'cancelled', waitlist_position = NULL, late_cancel = cancel_booking.late_cancel,
                           cancelled_at = now(), updated_at = now()
   WHERE b.id = p_booking;
  status := 'cancelled';

  IF v_b.status = 'booked' THEN
    SELECT b.id INTO promoted_booking_id FROM app.booking b
     WHERE b.session_id = v_session AND b.status = 'waitlisted'
     ORDER BY b.waitlist_position, b.created_at, b.id LIMIT 1 FOR UPDATE;
    IF promoted_booking_id IS NOT NULL THEN
      UPDATE app.booking b SET status = 'booked', waitlist_position = NULL, updated_at = now()
       WHERE b.id = promoted_booking_id;
      PERFORM app.audit('booking.promote', 'booking', promoted_booking_id::text, v_s.location_id,
                        jsonb_build_object('status', 'booked', 'freed_by', p_booking));
    END IF;
  END IF;
  PERFORM app.sched_renumber_waitlist(v_session);
  PERFORM app.audit('booking.cancel', 'booking', p_booking::text, v_s.location_id,
                    jsonb_build_object('status', 'cancelled', 'from', v_b.status, 'late_cancel', late_cancel));
END $$;

-- Mark attendance: front of house at the location, or the session's own trainer. From 30 minutes before start.
CREATE FUNCTION app.mark_attendance(p_booking uuid, p_status app.booking_status) RETURNS app.booking_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_b app.booking;
  v_s app.class_session;
  v_penalty boolean;
BEGIN
  SELECT * INTO v_b FROM app.booking b WHERE b.id = p_booking AND b.org_id = app.org_id() FOR UPDATE;
  IF v_b.id IS NULL OR NOT app.sched_staff_session(v_b.session_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('attended', 'no_show') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF v_b.status NOT IN ('booked', 'attended', 'no_show') THEN
    RAISE EXCEPTION 'not_markable' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM app.class_session s WHERE s.id = v_b.session_id;
  IF now() < v_s.starts_at - interval '30 minutes' THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '22023';
  END IF;
  UPDATE app.booking b SET status = p_status, updated_at = now() WHERE b.id = p_booking;
  SELECT coalesce(lp.no_show_penalty, false) INTO v_penalty
    FROM (SELECT 1) one LEFT JOIN app.location_policy lp ON lp.location_id = v_s.location_id;
  -- The penalty itself (fee or credit) is billing's job [VERIFICAR]; here it is only flagged in the audit trail.
  PERFORM app.audit('booking.attendance', 'booking', p_booking::text, v_s.location_id,
                    jsonb_build_object('status', p_status, 'from', v_b.status,
                                       'no_show_penalty', p_status = 'no_show' AND v_penalty));
  RETURN p_status;
END $$;

-- ── Location policy ──────────────────────────────────────────────────────────────────────────────────────
-- Owner (any location) or location manager (own locations). Only the OWNER may change deny_past_due: refusing
-- entry to unpaid members is a human, owner-level decision (spec §3.2).
CREATE FUNCTION app.set_location_policy(p_location uuid, p_cancel_window_hours integer, p_no_show_penalty boolean,
                                        p_deny_past_due boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_prev app.location_policy;
BEGIN
  IF v_org IS NULL OR app.role() IS NULL OR app.role() NOT IN ('owner', 'location_manager')
     OR NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_prev FROM app.location_policy lp WHERE lp.location_id = p_location FOR UPDATE;
  IF coalesce(p_deny_past_due, false) IS DISTINCT FROM coalesce(v_prev.deny_past_due, false)
     AND app.role() <> 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app.location_policy AS lp (org_id, location_id, cancel_window_hours, no_show_penalty, deny_past_due,
                                         updated_by, updated_at)
  VALUES (v_org, p_location, p_cancel_window_hours, coalesce(p_no_show_penalty, false),
          coalesce(p_deny_past_due, false), app.person_id(), now())
  ON CONFLICT (location_id) DO UPDATE
    SET cancel_window_hours = EXCLUDED.cancel_window_hours, no_show_penalty = EXCLUDED.no_show_penalty,
        deny_past_due = EXCLUDED.deny_past_due, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM app.audit('location_policy.update', 'location_policy', p_location::text, p_location,
                    jsonb_build_object('cancel_window_hours', p_cancel_window_hours,
                                       'no_show_penalty', p_no_show_penalty, 'deny_past_due', p_deny_past_due,
                                       'previous_deny_past_due', v_prev.deny_past_due));
END $$;

-- ── Appointments ─────────────────────────────────────────────────────────────────────────────────────────
-- Which staff role delivers each kind, and who may schedule it:
--   personal_training: trainer; front of house may schedule for any trainer of the location, a trainer for self.
--   assessment: trainer or clinician, for self.   nutrition: nutritionist, for self.   clinical: clinician, for self.
-- [VERIFICAR] whether front desk may schedule health-related kinds without seeing them.
CREATE FUNCTION app.create_appointment(p_kind app.appointment_kind, p_staff uuid, p_member uuid, p_location uuid,
                                       p_starts timestamptz, p_ends timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_role app.role_name := app.role();
  v_staff_role app.role_name;
  v_self boolean;
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_role IS NULL OR NOT app.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  SELECT s.role INTO v_staff_role FROM app.staff_member s JOIN app.staff_location sl ON sl.staff_member_id = s.id
   WHERE s.id = p_staff AND s.org_id = v_org AND s.active AND sl.location_id = p_location;
  IF v_staff_role IS NULL THEN RAISE EXCEPTION 'invalid_staff' USING ERRCODE = '22023'; END IF;
  IF NOT ((p_kind = 'personal_training' AND v_staff_role = 'trainer')
       OR (p_kind = 'assessment' AND v_staff_role IN ('trainer', 'clinician'))
       OR (p_kind = 'nutrition' AND v_staff_role = 'nutritionist')
       OR (p_kind = 'clinical' AND v_staff_role = 'clinician')) THEN
    RAISE EXCEPTION 'invalid_staff' USING ERRCODE = '22023';
  END IF;
  v_self := p_staff = ANY (app.sched_my_staff_ids());
  IF NOT ((p_kind = 'personal_training' AND v_role IN ('owner', 'location_manager', 'front_desk')) OR v_self) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = v_org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_starts IS NULL OR p_starts <= now() THEN RAISE EXCEPTION 'appointment_in_past' USING ERRCODE = '22023'; END IF;

  PERFORM app.sched_lock_staff(p_staff);
  IF app.sched_staff_busy(p_staff, p_starts, p_ends) THEN
    RAISE EXCEPTION 'staff_busy' USING ERRCODE = '23505';
  END IF;
  INSERT INTO app.appointment (org_id, location_id, kind, staff_member_id, member_id, starts_at, ends_at, created_by)
  VALUES (v_org, p_location, p_kind, p_staff, p_member, p_starts, p_ends, app.person_id())
  RETURNING id INTO v_id;
  -- The audit row names the kind only for personal training; health-related kinds stay out of the audit meta.
  PERFORM app.audit('appointment.create', 'appointment', v_id::text, p_location,
                    jsonb_build_object('status', 'scheduled',
                                       'kind', CASE WHEN p_kind = 'personal_training' THEN p_kind::text ELSE 'restricted' END));
  RETURN v_id;
END $$;

-- Cancel: the member/guardian, the assigned staff member, or front of house for personal training.
CREATE FUNCTION app.cancel_appointment(p_appointment uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_a app.appointment;
BEGIN
  SELECT * INTO v_a FROM app.appointment a WHERE a.id = p_appointment AND a.org_id = app.org_id() FOR UPDATE;
  IF v_a.id IS NULL OR NOT (
       app.sched_self_or_ward(v_a.member_id)
    OR v_a.staff_member_id = ANY (app.sched_my_staff_ids())
    OR (v_a.kind = 'personal_training' AND app.role() IN ('owner', 'location_manager', 'front_desk')
        AND app.can_see_location(v_a.location_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_a.status <> 'scheduled' THEN RAISE EXCEPTION 'not_cancellable' USING ERRCODE = '22023'; END IF;
  UPDATE app.appointment SET status = 'cancelled', cancelled_at = now() WHERE id = p_appointment;
  PERFORM app.audit('appointment.cancel', 'appointment', p_appointment::text, v_a.location_id,
                    jsonb_build_object('status', 'cancelled'));
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.class_type      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.class_type      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.class_session   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.class_session   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.booking         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.booking         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.location_policy ENABLE ROW LEVEL SECURITY; ALTER TABLE app.location_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE app.appointment     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.appointment     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.check_in        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.check_in        FORCE ROW LEVEL SECURITY;

-- 0005 created definer_all before these tables existed.
CREATE POLICY definer_all ON app.class_type      TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.class_session   TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.booking         TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.location_policy TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.appointment     TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.check_in        TO app_definer USING (true) WITH CHECK (true);

-- class_type: the whole org reads the catalogue (members book from it); owner and managers maintain it.
CREATE POLICY class_type_select ON app.class_type FOR SELECT USING (org_id = (SELECT app.org_id()));
CREATE POLICY class_type_insert ON app.class_type FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'));
CREATE POLICY class_type_update ON app.class_type FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- class_session: members and guardians see every session of their org (to book anywhere); staff only their
-- locations. Writes only through create_class_session / cancel_class_session.
CREATE POLICY class_session_select ON app.class_session FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (NOT (SELECT app.is_staff()) OR (SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- booking: the member or guardian; front of house at the session's location; the session's own trainer.
CREATE POLICY booking_select ON app.booking FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (app.sched_self_or_ward(member_id) OR app.sched_staff_session(session_id)));

-- location_policy: staff of the location (and org-wide roles); members read it (cancellation window).
CREATE POLICY location_policy_select ON app.location_policy FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (NOT (SELECT app.is_staff()) OR (SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- appointment: the member or guardian; the assigned staff member; front of house at the location for personal
-- training only; licensed/clinical roles at the location for health-related kinds. Never chef or accountant, and
-- never front desk for health-related kinds (spec §6: health data).
CREATE POLICY appointment_select ON app.appointment FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    app.sched_self_or_ward(member_id)
    OR staff_member_id = ANY ((SELECT app.sched_my_staff_ids())::uuid[])
    OR ((SELECT app.is_staff()) AND app.can_see_location(location_id) AND (
          (kind = 'personal_training' AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk'))
       OR (kind IN ('assessment', 'nutrition', 'clinical') AND (SELECT app.role()) IN ('nutritionist', 'clinician'))))));

-- check_in: front of house at the location; the member or guardian.
CREATE POLICY check_in_select ON app.check_in FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk') AND app.can_see_location(location_id))
    OR app.sched_self_or_ward(member_id)));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.class_type, app.class_session, app.booking, app.location_policy, app.appointment, app.check_in
  FROM PUBLIC;
GRANT SELECT ON app.class_type, app.class_session, app.booking, app.location_policy, app.appointment, app.check_in
  TO app_authenticated;
-- The only direct writes: the class catalogue, column by column (never org_id / id / created_at).
GRANT INSERT (name, description, duration_min, default_capacity, active),
      UPDATE (name, description, duration_min, default_capacity, active) ON app.class_type TO app_authenticated;

GRANT SELECT ON app.class_type, app.location_policy TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.class_session, app.booking, app.appointment, app.check_in, app.location_policy
  TO app_definer;
GRANT SELECT ON app.staff_location, app.member, app.staff_member, app.guardian_link, app.location TO app_definer;

-- Function ownership and EXECUTE: definers belong to app_definer; nothing is executable by PUBLIC.
ALTER FUNCTION app.sched_self_or_ward(uuid) OWNER TO app_definer;
ALTER FUNCTION app.sched_my_staff_ids() OWNER TO app_definer;
ALTER FUNCTION app.sched_staff_session(uuid) OWNER TO app_definer;
ALTER FUNCTION app.qr_token_for(uuid, uuid, bigint) OWNER TO app_definer;
ALTER FUNCTION app.my_qr_token(uuid) OWNER TO app_definer;
ALTER FUNCTION app.qr_verify(text) OWNER TO app_definer;
ALTER FUNCTION app.check_in(uuid, uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.sched_staff_busy(uuid, timestamptz, timestamptz) OWNER TO app_definer;
ALTER FUNCTION app.create_class_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer) OWNER TO app_definer;
ALTER FUNCTION app.cancel_class_session(uuid) OWNER TO app_definer;
ALTER FUNCTION app.session_occupancy(uuid[]) OWNER TO app_definer;
ALTER FUNCTION app.session_roster(uuid) OWNER TO app_definer;
ALTER FUNCTION app.sched_renumber_waitlist(uuid) OWNER TO app_definer;
ALTER FUNCTION app.book_class(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.cancel_booking(uuid) OWNER TO app_definer;
ALTER FUNCTION app.mark_attendance(uuid, app.booking_status) OWNER TO app_definer;
ALTER FUNCTION app.set_location_policy(uuid, integer, boolean, boolean) OWNER TO app_definer;
ALTER FUNCTION app.create_appointment(app.appointment_kind, uuid, uuid, uuid, timestamptz, timestamptz) OWNER TO app_definer;
ALTER FUNCTION app.cancel_appointment(uuid) OWNER TO app_definer;

REVOKE ALL ON FUNCTION
  app.sched_self_or_ward(uuid), app.sched_my_staff_ids(), app.sched_staff_session(uuid),
  app.access_decision(app.member_status, boolean), app.qr_token_for(uuid, uuid, bigint), app.qr_window(timestamptz),
  app.my_qr_token(uuid), app.qr_verify(text), app.check_in(uuid, uuid, text), app.sched_lock_staff(uuid),
  app.sched_staff_busy(uuid, timestamptz, timestamptz),
  app.create_class_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer),
  app.cancel_class_session(uuid), app.session_occupancy(uuid[]), app.session_roster(uuid),
  app.sched_renumber_waitlist(uuid), app.book_class(uuid, uuid), app.cancel_booking(uuid),
  app.mark_attendance(uuid, app.booking_status), app.set_location_policy(uuid, integer, boolean, boolean),
  app.create_appointment(app.appointment_kind, uuid, uuid, uuid, timestamptz, timestamptz),
  app.cancel_appointment(uuid)
  FROM PUBLIC, app_authenticated;

-- Internal helpers stay with app_definer (the owner of every caller). Policies need the visibility helpers.
GRANT EXECUTE ON FUNCTION app.access_decision(app.member_status, boolean), app.qr_window(timestamptz),
  app.sched_lock_staff(uuid) TO app_definer;
GRANT EXECUTE ON FUNCTION
  app.sched_self_or_ward(uuid), app.sched_my_staff_ids(), app.sched_staff_session(uuid),
  app.access_decision(app.member_status, boolean),
  app.my_qr_token(uuid), app.check_in(uuid, uuid, text),
  app.create_class_session(uuid, uuid, uuid, text, timestamptz, timestamptz, integer),
  app.cancel_class_session(uuid), app.session_occupancy(uuid[]), app.session_roster(uuid),
  app.book_class(uuid, uuid), app.cancel_booking(uuid), app.mark_attendance(uuid, app.booking_status),
  app.set_location_policy(uuid, integer, boolean, boolean),
  app.create_appointment(app.appointment_kind, uuid, uuid, uuid, timestamptz, timestamptz),
  app.cancel_appointment(uuid)
  TO app_authenticated;
