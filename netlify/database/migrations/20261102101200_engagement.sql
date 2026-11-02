-- Module engagement (spec §9 · Comunidad, retos y fidelización). Evidence-based defaults:
--   * points are an append-only ledger; the balance is the sum and is a liability for finance;
--   * streaks are WEEKLY (ISO weeks with ≥ 1 visit), never daily;
--   * leaderboards are opt-in (default off), split by challenge kind, and beginners default to self-comparison;
--   * the community wall is moderated before anything is visible to other members;
--   * members with a guardian link (minors) cannot post, cannot refer, never appear on a leaderboard and cannot
--     redeem rewards marked restricted_for_minors.
-- Cash prizes, sweepstakes and raffles are NOT implemented [VERIFICAR · legal PR].
-- Wave A: references only core objects (0001–0005). Visits are recorded through app.award_points('visit') until the
-- schedule module's check-in is wired in wave B [S].

CREATE TYPE app.eng_event AS ENUM ('visit', 'class', 'purchase', 'challenge_goal', 'referral', 'comeback_bonus');
CREATE TYPE app.eng_challenge_kind AS ENUM ('individual', 'team', 'location');
CREATE TYPE app.eng_challenge_metric AS ENUM ('visits', 'classes', 'points');
CREATE TYPE app.eng_redemption_status AS ENUM ('requested', 'fulfilled', 'cancelled');
CREATE TYPE app.eng_referral_status AS ENUM ('pending', 'joined', 'credited');
CREATE TYPE app.eng_post_status AS ENUM ('pending', 'approved', 'rejected');

-- ── Tables
CREATE TABLE app.points_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  event app.eng_event NOT NULL,
  points integer NOT NULL CHECK (points BETWEEN 1 AND 10000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event),
  UNIQUE (org_id, id)
);

-- Append-only. Positive rows come from rules (or a manual award), negative rows from redemptions or a manual
-- correction. Written only by the definer functions below; UPDATE/DELETE are refused by trigger for every role.
CREATE TABLE app.points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0 AND delta BETWEEN -1000000 AND 1000000),
  reason text NOT NULL CHECK (reason IN ('visit', 'class', 'purchase', 'challenge_goal', 'referral', 'comeback_bonus',
                                         'manual', 'redemption', 'redemption_refund')),
  ref text CHECK (ref ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  note text CHECK (note ~ '^[^{}<>\r\n]{3,200}$'),
  location_id uuid,
  created_by uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK ((reason = 'manual') = (note IS NOT NULL)),
  CHECK (reason = 'manual' OR (reason = 'redemption') = (delta < 0))
);
CREATE INDEX points_ledger_member_idx ON app.points_ledger (org_id, member_id, at DESC);
-- Idempotency: the same booking/sale/challenge/referral is credited once per member.
CREATE UNIQUE INDEX points_ledger_ref_uq ON app.points_ledger (org_id, member_id, reason, ref) WHERE ref IS NOT NULL;

CREATE TABLE app.reward (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.,()%+-]{2,80}$'),
  description text CHECK (length(description) BETWEEN 1 AND 300 AND description ~ '^[^{}<>]+$'),
  points_cost integer NOT NULL CHECK (points_cost BETWEEN 1 AND 1000000),
  restricted_for_minors boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  -- No cash prizes, raffles or sweepstakes (games of chance need a permit in PR) [VERIFICAR · legal PR].
  CHECK (name !~* '(efectivo|cash|dinero|money|sorteo|rifa|raffle|sweepstake|loter[ií]a|lottery)'
         AND coalesce(description, '') !~* '(efectivo|cash|dinero|money|sorteo|rifa|raffle|sweepstake|loter[ií]a|lottery)')
);

CREATE TABLE app.redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  reward_id uuid NOT NULL,
  points integer NOT NULL CHECK (points > 0),
  status app.eng_redemption_status NOT NULL DEFAULT 'requested',
  requested_by uuid NOT NULL,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, reward_id) REFERENCES app.reward (org_id, id),
  CHECK ((status = 'requested') = (handled_at IS NULL))
);
CREATE INDEX redemption_member_idx ON app.redemption (org_id, member_id, created_at DESC);

CREATE TABLE app.challenge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.,()%+-]{2,80}$'),
  kind app.eng_challenge_kind NOT NULL,
  metric app.eng_challenge_metric NOT NULL,
  -- NULL = every location of the org. A 'location' challenge pits locations against each other, so it is org-wide.
  location_id uuid,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  goal integer NOT NULL CHECK (goal BETWEEN 1 AND 100000),
  leaderboard_opt_in_default boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT app.person_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 366),
  CHECK (kind <> 'location' OR location_id IS NULL)
);

CREATE TABLE app.challenge_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  challenge_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.-]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, challenge_id, id),
  FOREIGN KEY (org_id, challenge_id) REFERENCES app.challenge (org_id, id)
);
CREATE UNIQUE INDEX challenge_team_name_uq ON app.challenge_team (challenge_id, lower(name));

CREATE TABLE app.challenge_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  challenge_id uuid NOT NULL,
  member_id uuid NOT NULL,
  team_id uuid,
  show_on_leaderboard boolean NOT NULL DEFAULT false,
  -- 'self': the member compares against their own goal only (default for beginners); 'ranked': sees the board.
  compare_mode text NOT NULL DEFAULT 'self' CHECK (compare_mode IN ('self', 'ranked')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  goal_reached_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, member_id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, challenge_id) REFERENCES app.challenge (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  -- The team must belong to the same challenge (MATCH SIMPLE: skipped when team_id is NULL).
  FOREIGN KEY (org_id, challenge_id, team_id) REFERENCES app.challenge_team (org_id, challenge_id, id)
);

-- A member invites someone by email. Nothing is sent [S]: the invitee joins through the normal registration and
-- front desk credits the referral. referred_email is third-party data: visible only to the referrer and staff.
CREATE TABLE app.referral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  referrer_member_id uuid NOT NULL,
  referred_email text NOT NULL CHECK (length(referred_email) <= 254
                                      AND referred_email ~ '^[^@[:space:]<>{}]+@[^@[:space:]<>{}]+\.[^@[:space:]<>{}]+$'),
  status app.eng_referral_status NOT NULL DEFAULT 'pending',
  credit_points integer NOT NULL DEFAULT 0 CHECK (credit_points >= 0),
  joined_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, referrer_member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, joined_member_id) REFERENCES app.member (org_id, id),
  CHECK ((status = 'pending') = (joined_member_id IS NULL)),
  CHECK ((status = 'credited') = (credit_points > 0)),
  CHECK (joined_member_id IS DISTINCT FROM referrer_member_id)
);
CREATE UNIQUE INDEX referral_referrer_email_uq ON app.referral (org_id, referrer_member_id, lower(referred_email));
-- One credited (or joined) referral per new member, whoever referred them first.
CREATE UNIQUE INDEX referral_joined_uq ON app.referral (org_id, joined_member_id) WHERE joined_member_id IS NOT NULL;

CREATE TABLE app.achievement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN ('first_visit', 'streak_4', 'streak_12', 'comeback', 'challenge_goal', 'first_referral')),
  ref text CHECK (ref ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE NULLS NOT DISTINCT (org_id, member_id, code, ref),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);

CREATE TABLE app.community_post (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  author_member_id uuid NOT NULL,
  -- Author's home location at posting time: decides which front desk moderates it.
  location_id uuid NOT NULL,
  -- "Ana R.": first name + initial, computed by the server so other members never read member rows.
  author_label text NOT NULL CHECK (length(author_label) BETWEEN 1 AND 60),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status app.eng_post_status NOT NULL DEFAULT 'pending',
  moderated_by uuid,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, author_member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK ((status = 'pending') = (moderated_at IS NULL) AND (moderated_at IS NULL) = (moderated_by IS NULL))
);
CREATE INDEX community_post_status_idx ON app.community_post (org_id, status, created_at DESC);

-- ── Append-only ledger (also for app_definer and the owner: corrections are new rows).
CREATE FUNCTION app.points_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER points_ledger_no_update BEFORE UPDATE OR DELETE ON app.points_ledger
  FOR EACH ROW EXECUTE FUNCTION app.points_ledger_immutable();
CREATE TRIGGER points_ledger_no_truncate BEFORE TRUNCATE ON app.points_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.points_ledger_immutable();

-- ── Helpers (owned by app_definer; they read rows across RLS but apply the rules explicitly).
-- Front-of-house staff who can see the member (location scope via app.staff_can_see_member).
CREATE FUNCTION app.eng_front_staff_for(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'front_desk'), false) AND app.staff_can_see_member(p_member)
$$;
-- The caller IS this member (member role, same person, same org).
CREATE FUNCTION app.eng_is_self(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.role() = 'member' AND EXISTS (
    SELECT 1 FROM app.member m WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id())
$$;
-- Read access to a member's engagement data: front-of-house staff of the location, the member, their guardian.
CREATE FUNCTION app.eng_can_view(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.eng_front_staff_for(p_member)
      OR coalesce(app.eng_is_self(p_member), false)
      OR (app.role() = 'guardian' AND EXISTS (
            SELECT 1 FROM app.guardian_link g
             WHERE g.member_id = p_member AND g.org_id = app.org_id() AND g.guardian_person_id = app.person_id()))
$$;
-- A member with a guardian link is treated as a minor (spec §9, conservative).
CREATE FUNCTION app.eng_is_minor(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.guardian_link g WHERE g.member_id = p_member)
$$;
-- Serialise every balance-changing operation of one member (two redemptions cannot both read the old balance).
CREATE FUNCTION app.eng_lock_member(p_member uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('app.points_ledger:' || p_member::text, 0))
$$;
CREATE FUNCTION app.eng_balance(p_member uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(sum(delta), 0) FROM app.points_ledger WHERE member_id = p_member AND org_id = app.org_id()
$$;
-- "Ana R." from "Ana Rivera Demo": first name + initial of the second word; letters only.
CREATE FUNCTION app.eng_label(p_full_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(coalesce(nullif(regexp_replace(split_part(btrim(p_full_name), ' ', 1), '[^A-Za-zÁÉÍÓÚÑÜáéíóúñü''-]', '', 'g'), ''), '?'), 30)
         || coalesce(' ' || nullif(left(regexp_replace(split_part(btrim(p_full_name), ' ', 2), '[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]', '', 'g'), 1), '') || '.', '')
$$;
CREATE FUNCTION app.eng_member_tz(p_member uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT l.timezone FROM app.member m JOIN app.location l ON l.id = m.home_location_id
                    WHERE m.id = p_member AND m.org_id = app.org_id()), 'America/Puerto_Rico')
$$;

-- Insert one rule-based credit. Returns the points credited: 0 when the rule is inactive/missing or when the same
-- (member, reason, ref) was already credited (idempotent).
CREATE FUNCTION app.eng_credit(p_member uuid, p_reason app.eng_event, p_ref text, p_loc uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_points integer;
  v_id uuid;
BEGIN
  SELECT r.points INTO v_points FROM app.points_rule r
   WHERE r.org_id = app.org_id() AND r.event = p_reason AND r.active;
  IF v_points IS NULL THEN RETURN 0; END IF;
  INSERT INTO app.points_ledger (org_id, member_id, delta, reason, ref, location_id, created_by)
  VALUES (app.org_id(), p_member, v_points, p_reason::text, p_ref, p_loc, app.person_id())
  ON CONFLICT (org_id, member_id, reason, ref) WHERE ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE v_points END;
END $$;

-- Consecutive ISO weeks (Monday start, member's location time zone) with at least one visit, ending this week —
-- or last week, so a streak is not "broken" on Monday morning. Weekly by design: daily streaks reward compulsion.
CREATE FUNCTION app.eng_streak(p_member uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_tz text := app.eng_member_tz(p_member);
  v_weeks date[];
  v_wk date := date_trunc('week', now() AT TIME ZONE v_tz)::date;
  v_n integer := 0;
BEGIN
  SELECT array_agg(DISTINCT date_trunc('week', l.at AT TIME ZONE v_tz)::date) INTO v_weeks
    FROM app.points_ledger l
   WHERE l.member_id = p_member AND l.org_id = app.org_id() AND l.reason = 'visit';
  IF v_weeks IS NULL THEN RETURN 0; END IF;
  IF NOT v_wk = ANY (v_weeks) THEN v_wk := v_wk - 7; END IF;
  WHILE v_wk = ANY (v_weeks) LOOP
    v_n := v_n + 1;
    v_wk := v_wk - 7;
  END LOOP;
  RETURN v_n;
END $$;

-- Challenge progress for one member over the challenge window (local dates, inclusive).
CREATE FUNCTION app.eng_metric(p_member uuid, p_metric app.eng_challenge_metric, p_from date, p_to date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(CASE p_metric
      WHEN 'visits'  THEN count(*) FILTER (WHERE l.reason = 'visit')
      WHEN 'classes' THEN count(*) FILTER (WHERE l.reason = 'class')
      -- Points earned by activity only: no manual gifts, no challenge bonuses (no feedback loop).
      ELSE sum(l.delta) FILTER (WHERE l.reason IN ('visit', 'class', 'purchase', 'referral', 'comeback_bonus'))
    END, 0)::integer
    FROM app.points_ledger l
   WHERE l.member_id = p_member AND l.org_id = app.org_id()
     AND (l.at AT TIME ZONE app.eng_member_tz(p_member))::date BETWEEN p_from AND p_to
$$;

-- Recompute progress of every challenge the member is in (open today or not yet ended); credit the goal once.
-- Returns challenge_goal points credited. Caller holds the member lock.
CREATE FUNCTION app.eng_refresh_progress(p_member uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  r record;
  v_progress integer;
  v_awarded integer := 0;
  v_today date := (now() AT TIME ZONE app.eng_member_tz(p_member))::date;
BEGIN
  FOR r IN SELECT cp.id, c.id AS challenge_id, c.metric, c.goal, c.starts_on, c.ends_on, cp.goal_reached_at
             FROM app.challenge_participant cp JOIN app.challenge c ON c.id = cp.challenge_id
            WHERE cp.member_id = p_member AND cp.org_id = app.org_id() AND c.ends_on >= v_today
            ORDER BY c.starts_on, c.id
  LOOP
    v_progress := app.eng_metric(p_member, r.metric, r.starts_on, r.ends_on);
    UPDATE app.challenge_participant SET progress = v_progress WHERE id = r.id;
    IF v_progress >= r.goal AND r.goal_reached_at IS NULL THEN
      UPDATE app.challenge_participant SET goal_reached_at = now() WHERE id = r.id;
      v_awarded := v_awarded + app.eng_credit(p_member, 'challenge_goal', r.challenge_id::text, NULL);
      INSERT INTO app.achievement (org_id, member_id, code, ref)
      VALUES (app.org_id(), p_member, 'challenge_goal', r.challenge_id::text) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_awarded;
END $$;

-- ── Request entry points
-- Award rule-based points for an activity (front-of-house staff of the member's location). 'visit' is limited to
-- one per local day; a visit after ≥ 14 days without visits also earns the comeback bonus [P]. challenge_goal,
-- referral and comeback_bonus are credited only by the system paths. Returns the total points credited.
CREATE FUNCTION app.award_points(p_member uuid, p_event app.eng_event, p_ref text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_loc uuid;
  v_tz text;
  v_last timestamptz;
  v_points integer;
  v_total integer := 0;
  v_streak integer;
BEGIN
  IF v_org IS NULL OR NOT app.eng_front_staff_for(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_event IS NULL OR p_event NOT IN ('visit', 'class', 'purchase') THEN
    RAISE EXCEPTION 'event_not_awardable' USING ERRCODE = '22023';
  END IF;
  IF p_ref IS NOT NULL AND p_ref !~ '^[A-Za-z0-9_.:-]{1,80}$' THEN
    RAISE EXCEPTION 'invalid_ref' USING ERRCODE = '22023';
  END IF;
  PERFORM app.eng_lock_member(p_member);
  SELECT m.home_location_id, l.timezone INTO v_loc, v_tz
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id
   WHERE m.id = p_member AND m.org_id = v_org;

  IF p_event = 'visit' THEN
    SELECT max(at) INTO v_last FROM app.points_ledger
     WHERE member_id = p_member AND org_id = v_org AND reason = 'visit';
    IF v_last IS NOT NULL AND (v_last AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date THEN
      RAISE EXCEPTION 'already_awarded' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF p_ref IS NOT NULL AND EXISTS (SELECT 1 FROM app.points_ledger
      WHERE member_id = p_member AND org_id = v_org AND reason = p_event::text AND ref = p_ref) THEN
    RAISE EXCEPTION 'already_awarded' USING ERRCODE = '23505';
  END IF;

  v_points := app.eng_credit(p_member, p_event, p_ref, v_loc);
  IF v_points = 0 THEN RAISE EXCEPTION 'no_active_rule' USING ERRCODE = '22023'; END IF;
  v_total := v_points;

  IF p_event = 'visit' THEN
    IF v_last IS NULL THEN
      INSERT INTO app.achievement (org_id, member_id, code) VALUES (v_org, p_member, 'first_visit') ON CONFLICT DO NOTHING;
    ELSIF v_last <= now() - interval '14 days' THEN
      v_total := v_total + app.eng_credit(p_member, 'comeback_bonus',
                                          'comeback:' || to_char(now() AT TIME ZONE v_tz, 'YYYY-MM-DD'), v_loc);
      INSERT INTO app.achievement (org_id, member_id, code, ref)
      VALUES (v_org, p_member, 'comeback', to_char(now() AT TIME ZONE v_tz, 'YYYY-MM-DD')) ON CONFLICT DO NOTHING;
    END IF;
    v_streak := app.eng_streak(p_member);
    IF v_streak >= 4 THEN
      INSERT INTO app.achievement (org_id, member_id, code) VALUES (v_org, p_member, 'streak_4') ON CONFLICT DO NOTHING;
    END IF;
    IF v_streak >= 12 THEN
      INSERT INTO app.achievement (org_id, member_id, code) VALUES (v_org, p_member, 'streak_12') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  v_total := v_total + app.eng_refresh_progress(p_member);

  PERFORM app.audit('points.award', 'member', p_member::text, v_loc,
                    jsonb_build_object('event', p_event, 'ref', p_ref, 'points', v_total));
  RETURN v_total;
END $$;

-- Manual award or correction with a mandatory reason (front-of-house staff). A negative delta cannot overdraw.
CREATE FUNCTION app.award_manual_points(p_member uuid, p_delta integer, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_note text := btrim(p_note);
  v_loc uuid;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.eng_front_staff_for(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 OR p_delta NOT BETWEEN -10000 AND 10000 THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL OR v_note !~ '^[^{}<>\r\n]{3,200}$' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  PERFORM app.eng_lock_member(p_member);
  IF p_delta < 0 AND app.eng_balance(p_member) + p_delta < 0 THEN
    RAISE EXCEPTION 'insufficient_points' USING ERRCODE = '22023';
  END IF;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  INSERT INTO app.points_ledger (org_id, member_id, delta, reason, note, location_id, created_by)
  VALUES (app.org_id(), p_member, p_delta, 'manual', v_note, v_loc, app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('points.manual', 'points_ledger', v_id::text, v_loc,
                    jsonb_build_object('member_id', p_member, 'delta', p_delta, 'note', v_note));
  RETURN v_id;
END $$;

-- Redeem a reward: the member for themself, or front-of-house staff at the counter. The balance is computed under
-- the member lock, so two concurrent redemptions cannot both spend the same points.
CREATE FUNCTION app.redeem_reward(p_member uuid, p_reward uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_reward app.reward;
  v_loc uuid;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT (app.eng_is_self(p_member) OR app.eng_front_staff_for(p_member)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reward FROM app.reward WHERE id = p_reward AND org_id = app.org_id();
  IF v_reward.id IS NULL OR NOT v_reward.active THEN
    RAISE EXCEPTION 'reward_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_reward.restricted_for_minors AND app.eng_is_minor(p_member) THEN
    RAISE EXCEPTION 'restricted_for_minors' USING ERRCODE = '42501';
  END IF;
  PERFORM app.eng_lock_member(p_member);
  IF app.eng_balance(p_member) < v_reward.points_cost THEN
    RAISE EXCEPTION 'insufficient_points' USING ERRCODE = '22023';
  END IF;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = p_member;
  INSERT INTO app.redemption (org_id, member_id, reward_id, points, requested_by)
  VALUES (app.org_id(), p_member, p_reward, v_reward.points_cost, app.person_id())
  RETURNING id INTO v_id;
  INSERT INTO app.points_ledger (org_id, member_id, delta, reason, ref, location_id, created_by)
  VALUES (app.org_id(), p_member, -v_reward.points_cost, 'redemption', v_id::text, v_loc, app.person_id());
  PERFORM app.audit('reward.redeem', 'redemption', v_id::text, v_loc,
                    jsonb_build_object('member_id', p_member, 'reward_id', p_reward, 'points', v_reward.points_cost));
  RETURN v_id;
END $$;

-- requested → fulfilled (staff hands over the reward) | cancelled (staff, or the member for their own; refunded).
CREATE FUNCTION app.set_redemption_status(p_redemption uuid, p_status app.eng_redemption_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_r app.redemption;
  v_loc uuid;
BEGIN
  SELECT * INTO v_r FROM app.redemption WHERE id = p_redemption AND org_id = app.org_id();
  IF v_r.id IS NULL OR app.org_id() IS NULL
     OR NOT (app.eng_front_staff_for(v_r.member_id) OR (p_status = 'cancelled' AND app.eng_is_self(v_r.member_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('fulfilled', 'cancelled') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  PERFORM app.eng_lock_member(v_r.member_id);
  SELECT * INTO v_r FROM app.redemption WHERE id = p_redemption FOR UPDATE;
  IF v_r.status <> 'requested' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023'; END IF;
  SELECT home_location_id INTO v_loc FROM app.member WHERE id = v_r.member_id;
  UPDATE app.redemption SET status = p_status, handled_by = app.person_id(), handled_at = now() WHERE id = p_redemption;
  IF p_status = 'cancelled' THEN
    INSERT INTO app.points_ledger (org_id, member_id, delta, reason, ref, location_id, created_by)
    VALUES (app.org_id(), v_r.member_id, v_r.points, 'redemption_refund', p_redemption::text, v_loc, app.person_id());
  END IF;
  PERFORM app.audit('redemption.' || p_status::text, 'redemption', p_redemption::text, v_loc,
                    jsonb_build_object('member_id', v_r.member_id, 'points', v_r.points));
END $$;

-- Join a challenge: the member for themself, or front-of-house staff for a member they can see. Leaderboard
-- visibility defaults to the challenge default (false unless configured) and is always false for minors.
CREATE FUNCTION app.join_challenge(p_challenge uuid, p_member uuid, p_team uuid, p_show boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_c app.challenge;
  v_home uuid;
  v_visits integer;
  v_show boolean;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT (app.eng_is_self(p_member) OR app.eng_front_staff_for(p_member)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_c FROM app.challenge WHERE id = p_challenge AND org_id = app.org_id();
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT home_location_id INTO v_home FROM app.member WHERE id = p_member;
  IF v_c.location_id IS NOT NULL AND v_c.location_id <> v_home THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  IF v_c.ends_on < (now() AT TIME ZONE app.eng_member_tz(p_member))::date THEN
    RAISE EXCEPTION 'challenge_closed' USING ERRCODE = '22023';
  END IF;
  IF (v_c.kind = 'team') <> (p_team IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_team' USING ERRCODE = '22023';
  END IF;
  IF p_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.challenge_team t WHERE t.id = p_team AND t.challenge_id = p_challenge) THEN
    RAISE EXCEPTION 'invalid_team' USING ERRCODE = '22023';
  END IF;
  v_show := coalesce(p_show, v_c.leaderboard_opt_in_default);
  IF app.eng_is_minor(p_member) THEN
    IF p_show THEN RAISE EXCEPTION 'minor_not_listed' USING ERRCODE = '42501'; END IF;
    v_show := false;
  END IF;
  PERFORM app.eng_lock_member(p_member);
  -- Beginners (fewer than 4 recorded visits) compare against themselves by default [P].
  SELECT count(*) INTO v_visits FROM app.points_ledger WHERE member_id = p_member AND org_id = app.org_id() AND reason = 'visit';
  INSERT INTO app.challenge_participant (org_id, challenge_id, member_id, team_id, show_on_leaderboard, compare_mode)
  VALUES (app.org_id(), p_challenge, p_member, p_team, v_show, CASE WHEN v_visits < 4 THEN 'self' ELSE 'ranked' END)
  RETURNING id INTO v_id;
  PERFORM app.eng_refresh_progress(p_member);
  PERFORM app.audit('challenge.join', 'challenge_participant', v_id::text, v_home,
                    jsonb_build_object('challenge_id', p_challenge, 'member_id', p_member, 'show_on_leaderboard', v_show));
  RETURN v_id;
END $$;

-- The member (or front desk on their behalf) changes leaderboard visibility and comparison mode.
CREATE FUNCTION app.set_challenge_preferences(p_challenge uuid, p_member uuid, p_show boolean, p_compare text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_id uuid;
  v_home uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT (app.eng_is_self(p_member) OR app.eng_front_staff_for(p_member)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_show IS NULL OR p_compare IS NULL OR p_compare NOT IN ('self', 'ranked') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_show AND app.eng_is_minor(p_member) THEN
    RAISE EXCEPTION 'minor_not_listed' USING ERRCODE = '42501';
  END IF;
  UPDATE app.challenge_participant SET show_on_leaderboard = p_show, compare_mode = p_compare
   WHERE challenge_id = p_challenge AND member_id = p_member AND org_id = app.org_id()
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'not_participant' USING ERRCODE = '22023'; END IF;
  SELECT home_location_id INTO v_home FROM app.member WHERE id = p_member;
  PERFORM app.audit('challenge.preferences', 'challenge_participant', v_id::text, v_home,
                    jsonb_build_object('show_on_leaderboard', p_show, 'compare_mode', p_compare));
END $$;

-- Leaderboard. Only participants who opted in are ranked; divisions follow the challenge kind (individual,
-- team, location). Members in 'self' mode get only their own row; guardians get only their wards' rows; every
-- member also gets their own row (rank NULL when not listed). Staff: owner, location manager, front desk, trainer.
CREATE FUNCTION app.leaderboard(p_challenge uuid)
RETURNS TABLE (division text, rank integer, label text, progress integer, goal integer, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_role app.role_name := app.role();
  v_c app.challenge;
  v_mine uuid[] := '{}';
  v_mode text;
BEGIN
  IF app.org_id() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('owner', 'location_manager', 'front_desk', 'trainer', 'member', 'guardian') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_c FROM app.challenge WHERE id = p_challenge AND org_id = app.org_id();
  IF v_c.id IS NULL OR (app.is_staff() AND NOT app.org_wide() AND v_c.location_id IS NOT NULL
                        AND NOT v_c.location_id = ANY (app.location_ids())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'member' THEN
    SELECT array_agg(m.id) INTO v_mine FROM app.member m WHERE m.org_id = app.org_id() AND m.person_id = app.person_id();
  ELSIF v_role = 'guardian' THEN
    SELECT array_agg(g.member_id) INTO v_mine FROM app.guardian_link g
     WHERE g.org_id = app.org_id() AND g.guardian_person_id = app.person_id();
  END IF;
  v_mine := coalesce(v_mine, '{}');

  SELECT cp.compare_mode INTO v_mode FROM app.challenge_participant cp
   WHERE cp.challenge_id = p_challenge AND cp.member_id = ANY (v_mine) LIMIT 1;

  -- Own rows (members, guardians): always available, outside the ranking.
  IF v_role IN ('member', 'guardian') THEN
    RETURN QUERY
      SELECT 'self'::text, NULL::integer, app.eng_label(m.full_name), cp.progress, v_c.goal, true
        FROM app.challenge_participant cp JOIN app.member m ON m.id = cp.member_id
       WHERE cp.challenge_id = p_challenge AND cp.member_id = ANY (v_mine);
    IF v_role = 'guardian' OR v_mode = 'self' THEN RETURN; END IF;
  END IF;

  IF v_c.kind = 'individual' THEN
    RETURN QUERY
      SELECT 'individual'::text, (dense_rank() OVER (ORDER BY cp.progress DESC))::integer,
             app.eng_label(m.full_name), cp.progress, v_c.goal, cp.member_id = ANY (v_mine)
        FROM app.challenge_participant cp JOIN app.member m ON m.id = cp.member_id
       WHERE cp.challenge_id = p_challenge AND cp.show_on_leaderboard
       ORDER BY cp.progress DESC, m.full_name;
  ELSIF v_c.kind = 'team' THEN
    RETURN QUERY
      SELECT 'team'::text, (dense_rank() OVER (ORDER BY sum(cp.progress) DESC))::integer,
             t.name, sum(cp.progress)::integer, v_c.goal, bool_or(cp.member_id = ANY (v_mine))
        FROM app.challenge_participant cp JOIN app.challenge_team t ON t.id = cp.team_id
       WHERE cp.challenge_id = p_challenge AND cp.show_on_leaderboard
       GROUP BY t.id, t.name
       ORDER BY sum(cp.progress) DESC, t.name;
  ELSE
    RETURN QUERY
      SELECT 'location'::text, (dense_rank() OVER (ORDER BY sum(cp.progress) DESC))::integer,
             l.name, sum(cp.progress)::integer, v_c.goal, bool_or(cp.member_id = ANY (v_mine))
        FROM app.challenge_participant cp JOIN app.member m ON m.id = cp.member_id
        JOIN app.location l ON l.id = m.home_location_id
       WHERE cp.challenge_id = p_challenge AND cp.show_on_leaderboard
       GROUP BY l.id, l.name
       ORDER BY sum(cp.progress) DESC, l.name;
  END IF;
END $$;

-- A member invites someone by email. No message is sent. Minors cannot refer (third-party data) [P].
-- At most 10 referrals per member per 30 days [P].
CREATE FUNCTION app.create_referral(p_member uuid, p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_home uuid;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.eng_is_self(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF app.eng_is_minor(p_member) THEN RAISE EXCEPTION 'minor_not_allowed' USING ERRCODE = '42501'; END IF;
  IF v_email IS NULL OR length(v_email) > 254 OR v_email !~ '^[^@[:space:]<>{}]+@[^@[:space:]<>{}]+\.[^@[:space:]<>{}]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM app.person p WHERE p.id = app.person_id() AND lower(p.email) = v_email) THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  PERFORM app.eng_lock_member(p_member);
  IF (SELECT count(*) FROM app.referral r WHERE r.referrer_member_id = p_member
        AND r.created_at > now() - interval '30 days') >= 10 THEN
    RAISE EXCEPTION 'referral_limit' USING ERRCODE = '22023';
  END IF;
  SELECT home_location_id INTO v_home FROM app.member WHERE id = p_member;
  INSERT INTO app.referral (org_id, referrer_member_id, referred_email)
  VALUES (app.org_id(), p_member, v_email) RETURNING id INTO v_id;
  -- The invitee's email is third-party data: kept out of the audit trail.
  PERFORM app.audit('referral.create', 'referral', v_id::text, v_home, '{}'::jsonb);
  RETURN v_id;
END $$;

-- Front desk confirms the invitee became an ACTIVE member of this org. With an active referral rule the referrer is
-- credited (status credited); without one the referral is only marked joined.
CREATE FUNCTION app.credit_referral(p_referral uuid)
RETURNS app.eng_referral_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_r app.referral;
  v_joined uuid;
  v_points integer;
  v_status app.eng_referral_status;
  v_home uuid;
BEGIN
  SELECT * INTO v_r FROM app.referral WHERE id = p_referral AND org_id = app.org_id();
  IF app.org_id() IS NULL OR v_r.id IS NULL OR NOT app.eng_front_staff_for(v_r.referrer_member_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM app.eng_lock_member(v_r.referrer_member_id);
  SELECT * INTO v_r FROM app.referral WHERE id = p_referral FOR UPDATE;
  IF v_r.status = 'credited' THEN RAISE EXCEPTION 'already_credited' USING ERRCODE = '23505'; END IF;
  SELECT m.id INTO v_joined FROM app.member m JOIN app.person p ON p.id = m.person_id
   WHERE m.org_id = app.org_id() AND lower(p.email) = lower(v_r.referred_email) AND m.status = 'active'
     AND m.id <> v_r.referrer_member_id;
  IF v_joined IS NULL THEN RAISE EXCEPTION 'referral_not_joined' USING ERRCODE = '22023'; END IF;

  v_points := app.eng_credit(v_r.referrer_member_id, 'referral', p_referral::text, NULL);
  v_status := CASE WHEN v_points > 0 THEN 'credited' ELSE 'joined' END;
  UPDATE app.referral SET status = v_status, joined_member_id = v_joined, credit_points = v_points, updated_at = now()
   WHERE id = p_referral;
  IF v_points > 0 THEN
    INSERT INTO app.achievement (org_id, member_id, code) VALUES (app.org_id(), v_r.referrer_member_id, 'first_referral')
      ON CONFLICT DO NOTHING;
    PERFORM app.eng_refresh_progress(v_r.referrer_member_id);
  END IF;
  SELECT home_location_id INTO v_home FROM app.member WHERE id = v_r.referrer_member_id;
  PERFORM app.audit('referral.' || v_status::text, 'referral', p_referral::text, v_home,
                    jsonb_build_object('referrer_member_id', v_r.referrer_member_id, 'points', v_points));
  RETURN v_status;
END $$;

-- Post to the community wall (members only, never minors). The post stays pending until moderated. Bodies with
-- links, phone numbers, health promises or characters outside the Latin/Spanish set are refused
-- (app.has_forbidden_terms, migration 0004). At most 3 pending posts per member [P].
CREATE FUNCTION app.create_post(p_member uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[[:space:]]+', ' ', 'g'));
  v_m app.member;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR NOT app.eng_is_self(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF app.eng_is_minor(p_member) THEN RAISE EXCEPTION 'minor_cannot_post' USING ERRCODE = '42501'; END IF;
  IF length(v_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023'; END IF;
  IF app.has_forbidden_terms(v_body) THEN RAISE EXCEPTION 'forbidden_content' USING ERRCODE = '22023'; END IF;
  PERFORM app.eng_lock_member(p_member);
  IF (SELECT count(*) FROM app.community_post WHERE author_member_id = p_member AND status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'post_limit' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_m FROM app.member WHERE id = p_member;
  INSERT INTO app.community_post (org_id, author_member_id, location_id, author_label, body)
  VALUES (app.org_id(), p_member, v_m.home_location_id, app.eng_label(v_m.full_name), v_body)
  RETURNING id INTO v_id;
  PERFORM app.audit('post.create', 'community_post', v_id::text, v_m.home_location_id, '{}'::jsonb);
  RETURN v_id;
END $$;

-- pending → approved | rejected; approved → rejected (take-down). Owner, location manager, front desk of the
-- post's location.
CREATE FUNCTION app.moderate_post(p_post uuid, p_decision text)
RETURNS app.eng_post_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_p app.community_post;
  v_new app.eng_post_status;
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM app.community_post WHERE id = p_post AND org_id = app.org_id();
  IF v_p.id IS NULL OR NOT app.can_see_location(v_p.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM app.community_post WHERE id = p_post FOR UPDATE;
  v_new := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' END;
  IF v_new IS NULL THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023'; END IF;
  IF NOT (v_p.status = 'pending' OR (v_p.status = 'approved' AND v_new = 'rejected')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;
  UPDATE app.community_post SET status = v_new, moderated_by = app.person_id(), moderated_at = now() WHERE id = p_post;
  PERFORM app.audit('post.' || v_new::text, 'community_post', p_post::text, v_p.location_id,
                    jsonb_build_object('from', v_p.status));
  RETURN v_new;
END $$;

-- Read helpers for the member's own view (or guardian, or front-of-house staff).
CREATE FUNCTION app.points_balance(p_member uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR NOT app.eng_can_view(p_member) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN app.eng_balance(p_member);
END $$;
CREATE FUNCTION app.weekly_streak(p_member uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR NOT app.eng_can_view(p_member) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN app.eng_streak(p_member);
END $$;

-- Outstanding points of the whole organisation: a liability for finance (owner, accountant). Valuation per point
-- is a finance decision [VERIFICAR · CPA]; this returns points only.
CREATE FUNCTION app.points_liability(OUT outstanding_points bigint, OUT members_with_balance integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'accountant'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(b), 0), count(*) FILTER (WHERE b > 0) INTO outstanding_points, members_with_balance
    FROM (SELECT greatest(sum(delta), 0) AS b FROM app.points_ledger WHERE org_id = app.org_id() GROUP BY member_id) s;
END $$;

-- Configuration changes are audited by trigger so no request path can skip it (rules and rewards change what
-- the points liability is worth).
CREATE FUNCTION app.eng_config_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;  -- seeds and fixtures (no request claims)
  IF TG_TABLE_NAME = 'challenge' THEN v_loc := NEW.location_id; END IF;
  PERFORM app.audit(TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, NEW.id::text, v_loc,
                    to_jsonb(NEW) - 'org_id' - 'id' - 'created_at' - 'created_by');
  RETURN NEW;
END $$;
CREATE TRIGGER points_rule_audit AFTER INSERT OR UPDATE ON app.points_rule FOR EACH ROW EXECUTE FUNCTION app.eng_config_audit();
CREATE TRIGGER reward_audit AFTER INSERT OR UPDATE ON app.reward FOR EACH ROW EXECUTE FUNCTION app.eng_config_audit();
CREATE TRIGGER challenge_audit AFTER INSERT OR UPDATE ON app.challenge FOR EACH ROW EXECUTE FUNCTION app.eng_config_audit();
CREATE TRIGGER challenge_team_audit AFTER INSERT ON app.challenge_team FOR EACH ROW EXECUTE FUNCTION app.eng_config_audit();

-- ── RLS
ALTER TABLE app.points_rule           ENABLE ROW LEVEL SECURITY; ALTER TABLE app.points_rule           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.points_ledger         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.points_ledger         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.reward                ENABLE ROW LEVEL SECURITY; ALTER TABLE app.reward                FORCE ROW LEVEL SECURITY;
ALTER TABLE app.redemption            ENABLE ROW LEVEL SECURITY; ALTER TABLE app.redemption            FORCE ROW LEVEL SECURITY;
ALTER TABLE app.challenge             ENABLE ROW LEVEL SECURITY; ALTER TABLE app.challenge             FORCE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_team        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.challenge_team        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_participant ENABLE ROW LEVEL SECURITY; ALTER TABLE app.challenge_participant FORCE ROW LEVEL SECURITY;
ALTER TABLE app.referral              ENABLE ROW LEVEL SECURITY; ALTER TABLE app.referral              FORCE ROW LEVEL SECURITY;
ALTER TABLE app.achievement           ENABLE ROW LEVEL SECURITY; ALTER TABLE app.achievement           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.community_post        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.community_post        FORCE ROW LEVEL SECURITY;

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.points_rule           TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.points_ledger         TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.reward                TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.redemption            TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.challenge             TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.challenge_team        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.challenge_participant TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.referral              TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.achievement           TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.community_post        TO app_definer USING (true) WITH CHECK (true);

-- Rules and rewards: front-of-house staff read all; members and guardians read the active ones (how to earn, what
-- to redeem); owner and location managers configure.
CREATE POLICY points_rule_select ON app.points_rule FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
    OR ((SELECT app.role()) IN ('member', 'guardian') AND active)));
CREATE POLICY points_rule_insert ON app.points_rule FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'));
CREATE POLICY points_rule_update ON app.points_rule FOR UPDATE TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'))
  WITH CHECK (org_id = (SELECT app.org_id()));

CREATE POLICY reward_select ON app.reward FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
    OR ((SELECT app.role()) IN ('member', 'guardian') AND active)));
CREATE POLICY reward_insert ON app.reward FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'));
CREATE POLICY reward_update ON app.reward FOR UPDATE TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- Member-owned rows: front-of-house staff of the member's location, the member, the guardian.
CREATE POLICY points_ledger_select ON app.points_ledger FOR SELECT TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND app.eng_can_view(member_id));
CREATE POLICY redemption_select ON app.redemption FOR SELECT TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND app.eng_can_view(member_id));
CREATE POLICY participant_select ON app.challenge_participant FOR SELECT TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND app.eng_can_view(member_id));
CREATE POLICY referral_select ON app.referral FOR SELECT TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND app.eng_can_view(referrer_member_id));
CREATE POLICY achievement_select ON app.achievement FOR SELECT TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND app.eng_can_view(member_id));

-- Challenges: members and guardians see every challenge of the org; owner/location manager/front desk/trainer see
-- org-wide challenges and those of their locations. Owner creates any; a location manager only for own locations.
CREATE POLICY challenge_select ON app.challenge FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) IN ('member', 'guardian')
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk', 'trainer')
        AND ((SELECT app.org_wide()) OR location_id IS NULL OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));
CREATE POLICY challenge_insert ON app.challenge FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))));
CREATE POLICY challenge_update ON app.challenge FOR UPDATE TO app_authenticated
  USING (org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))))
  WITH CHECK (org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))));

-- Teams follow the visibility of their challenge (challenge RLS applies inside the EXISTS).
CREATE POLICY challenge_team_select ON app.challenge_team FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND EXISTS (SELECT 1 FROM app.challenge c WHERE c.id = challenge_id));
CREATE POLICY challenge_team_insert ON app.challenge_team FOR INSERT TO app_authenticated WITH CHECK (
  org_id = (SELECT app.org_id()) AND EXISTS (
    SELECT 1 FROM app.challenge c WHERE c.id = challenge_id AND c.kind = 'team' AND (
      (SELECT app.role()) = 'owner'
      OR ((SELECT app.role()) = 'location_manager' AND c.location_id = ANY ((SELECT app.location_ids())::uuid[])))));

-- Wall: members see approved posts of the org and their own (any status); guardians see their ward's posts;
-- moderators see everything of their locations. Pending posts are never visible to other members.
CREATE POLICY community_post_select ON app.community_post FOR SELECT TO app_authenticated USING (
  org_id = (SELECT app.org_id()) AND (
    ((SELECT app.role()) = 'member' AND status = 'approved')
    OR ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
        AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR ((SELECT app.role()) IN ('member', 'guardian') AND app.eng_can_view(author_member_id))));

-- ── Grants: reads, a few configuration columns; every other write goes through the definer functions.
REVOKE ALL ON app.points_rule, app.points_ledger, app.reward, app.redemption, app.challenge, app.challenge_team,
  app.challenge_participant, app.referral, app.achievement, app.community_post FROM PUBLIC;
GRANT SELECT ON app.points_rule, app.points_ledger, app.reward, app.redemption, app.challenge, app.challenge_team,
  app.challenge_participant, app.referral, app.achievement TO app_authenticated;
-- moderated_by (a staff person id) is not exposed to request traffic.
GRANT SELECT (id, org_id, author_member_id, location_id, author_label, body, status, moderated_at, created_at)
  ON app.community_post TO app_authenticated;
GRANT INSERT (event, points, active), UPDATE (points, active) ON app.points_rule TO app_authenticated;
GRANT INSERT (name, description, points_cost, restricted_for_minors, active),
      UPDATE (name, description, points_cost, restricted_for_minors, active) ON app.reward TO app_authenticated;
GRANT INSERT (name, kind, metric, location_id, starts_on, ends_on, goal, leaderboard_opt_in_default),
      UPDATE (name, ends_on, goal, leaderboard_opt_in_default) ON app.challenge TO app_authenticated;
GRANT INSERT (challenge_id, name) ON app.challenge_team TO app_authenticated;

GRANT SELECT ON app.points_rule, app.reward, app.challenge, app.challenge_team TO app_definer;
GRANT SELECT, INSERT ON app.points_ledger, app.achievement TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.redemption, app.challenge_participant, app.referral, app.community_post TO app_definer;
GRANT SELECT ON app.member, app.location, app.guardian_link, app.person TO app_definer;

-- ── Function ownership and EXECUTE: internal helpers are callable only by other app_definer functions.
ALTER FUNCTION app.eng_front_staff_for(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_is_self(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_can_view(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_is_minor(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_lock_member(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_balance(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_member_tz(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_credit(uuid, app.eng_event, text, uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_streak(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_metric(uuid, app.eng_challenge_metric, date, date) OWNER TO app_definer;
ALTER FUNCTION app.eng_refresh_progress(uuid) OWNER TO app_definer;
ALTER FUNCTION app.eng_config_audit() OWNER TO app_definer;
ALTER FUNCTION app.award_points(uuid, app.eng_event, text) OWNER TO app_definer;
ALTER FUNCTION app.award_manual_points(uuid, integer, text) OWNER TO app_definer;
ALTER FUNCTION app.redeem_reward(uuid, uuid) OWNER TO app_definer;
ALTER FUNCTION app.set_redemption_status(uuid, app.eng_redemption_status) OWNER TO app_definer;
ALTER FUNCTION app.join_challenge(uuid, uuid, uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app.set_challenge_preferences(uuid, uuid, boolean, text) OWNER TO app_definer;
ALTER FUNCTION app.leaderboard(uuid) OWNER TO app_definer;
ALTER FUNCTION app.create_referral(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.credit_referral(uuid) OWNER TO app_definer;
ALTER FUNCTION app.create_post(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.moderate_post(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.points_balance(uuid) OWNER TO app_definer;
ALTER FUNCTION app.weekly_streak(uuid) OWNER TO app_definer;
ALTER FUNCTION app.points_liability() OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.points_ledger_immutable(), app.eng_label(text),
  app.eng_front_staff_for(uuid), app.eng_is_self(uuid), app.eng_is_minor(uuid), app.eng_lock_member(uuid),
  app.eng_balance(uuid), app.eng_member_tz(uuid), app.eng_credit(uuid, app.eng_event, text, uuid), app.eng_streak(uuid),
  app.eng_metric(uuid, app.eng_challenge_metric, date, date), app.eng_refresh_progress(uuid), app.eng_config_audit(),
  app.eng_can_view(uuid), app.award_points(uuid, app.eng_event, text), app.award_manual_points(uuid, integer, text),
  app.redeem_reward(uuid, uuid), app.set_redemption_status(uuid, app.eng_redemption_status),
  app.join_challenge(uuid, uuid, uuid, boolean), app.set_challenge_preferences(uuid, uuid, boolean, text),
  app.leaderboard(uuid), app.create_referral(uuid, text), app.credit_referral(uuid), app.create_post(uuid, text),
  app.moderate_post(uuid, text), app.points_balance(uuid), app.weekly_streak(uuid), app.points_liability()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.eng_label(text) TO app_definer;
-- eng_can_view is used inside RLS policies, which run as the caller.
GRANT EXECUTE ON FUNCTION app.eng_can_view(uuid) TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.award_points(uuid, app.eng_event, text), app.award_manual_points(uuid, integer, text),
  app.redeem_reward(uuid, uuid), app.set_redemption_status(uuid, app.eng_redemption_status),
  app.join_challenge(uuid, uuid, uuid, boolean), app.set_challenge_preferences(uuid, uuid, boolean, text),
  app.leaderboard(uuid), app.create_referral(uuid, text), app.credit_referral(uuid), app.create_post(uuid, text),
  app.moderate_post(uuid, text), app.points_balance(uuid), app.weekly_streak(uuid), app.points_liability()
  TO app_authenticated;
