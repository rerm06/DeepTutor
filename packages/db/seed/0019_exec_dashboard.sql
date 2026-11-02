-- DEMO seed for module exec (Panel ejecutivo): 12 months of SYNTHETIC history so the executive dashboard, the
-- panel heatmap, the members report and the finance P&L have something real to show. Synthetic data only: every
-- person is "… Demo" with an @demo.invalid email. Runs as the schema owner after the core demo seed and the module
-- seeds it builds on (billing 0006 catalogue, store 0009 catalogue and stock, finance 0013 vendors and templates).
-- Idempotent: does nothing if the core demo, those seeds are missing, or this seed already ran.
--
-- Everything goes through the real module tables with the same rules the definer functions apply:
--   * invoices: zero totals first, lines second (IVU 10.5 % + 1 % comes from the GENERATED per-line columns, the
--     same expression billing uses), then totals and the platform fee from the lines (CHECKs re-verify both);
--     numbers stay gapless per legal entity and chronological (every demo invoice is renumbered by issue time);
--   * one-off sales grant their pass or credits; org B's subscriptions roll monthly periods, freezes extend the
--     period they fall in (≤ 90 days a year), cancellations happen at period end;
--   * store lines use app.store_line_amounts(); the stock ledger stays balanced (Σ movements = on_hand: every
--     historical sale is matched by that month's delivery, so current stock is unchanged);
--   * bills are entered by the San Juan manager and approved by the owner (never the same person).
-- Deterministic: pseudo-random choices come from md5 of stable keys (no random()). Dates are relative to the day
-- the seed runs (Puerto Rico time), like the other module seeds.
--
-- Shape [S]: Org A (Demo Gym Norte, pay per session) ≈ 300 members over two locations, ≈ 250 active today, monthly
-- cash revenue ≈ USD 18–26k with growth and seasonality (January peak, December dip), expenses ≈ 60–80 % of
-- revenue. Brand promise: no monthly fee, no contract, no enrollment, no maintenance fee — members pay single
-- sessions or buy session / personal-training packs, nothing recurring. So org A has no subscriptions: its
-- cancellations and freezes are honestly zero, and retention shows in the renewal (repurchase) rate instead.
-- Org B (Demo Club Sur, classic monthly membership) gets a lighter history and carries the cancellation and
-- freeze paths. FORCE RLS is lifted only on the tables written here, and restored.
DO $seed$
DECLARE
  tz constant text := 'America/Puerto_Rico';
  oa constant uuid := 'a0000000-0000-4000-8000-000000000001';
  ob constant uuid := 'b0000000-0000-4000-8000-000000000001';
  la1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  la2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  lb1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  lea constant uuid := 'a0000000-0000-4000-8000-000000000002';
  leb constant uuid := 'b0000000-0000-4000-8000-000000000002';
  owner_a constant uuid := 'a0000000-0000-4000-8000-000000000101';
  mgr_a constant uuid := 'a0000000-0000-4000-8000-000000000102';
  fd_a1 constant uuid := 'a0000000-0000-4000-8000-000000000103';
  fd_a2 constant uuid := 'a0000000-0000-4000-8000-000000000104';
  owner_b constant uuid := 'b0000000-0000-4000-8000-000000000101';
  fd_b constant uuid := 'b0000000-0000-4000-8000-000000000103';
  sm_a1 constant uuid := 'a0000000-0000-4000-8000-000000000503';  -- front-desk staff_member (age checks)
  sm_a2 constant uuid := 'a0000000-0000-4000-8000-000000000504';
  -- Billing seed (0006) catalogue.
  pa_session constant uuid := 'a0000000-0000-4000-8000-000000006001';
  pa_pack5 constant uuid := 'a0000000-0000-4000-8000-000000006002';
  pa_pack10 constant uuid := 'a0000000-0000-4000-8000-000000006003';
  pa_pt constant uuid := 'a0000000-0000-4000-8000-000000006004';
  xa_session constant uuid := 'a0000000-0000-4000-8000-000000006011';
  xa_session_bay constant uuid := 'a0000000-0000-4000-8000-000000006012';
  xa_pack5 constant uuid := 'a0000000-0000-4000-8000-000000006013';
  xa_pack10 constant uuid := 'a0000000-0000-4000-8000-000000006014';
  xa_pt constant uuid := 'a0000000-0000-4000-8000-000000006015';
  pb_month constant uuid := 'b0000000-0000-4000-8000-000000006001';
  pb_day constant uuid := 'b0000000-0000-4000-8000-000000006002';
  xb_month constant uuid := 'b0000000-0000-4000-8000-000000006011';
  xb_day constant uuid := 'b0000000-0000-4000-8000-000000006012';
  -- Finance seed (0013) vendors and recurring templates.
  v_clean constant uuid := 'a0000000-0013-4000-8000-000000000001';
  v_power constant uuid := 'a0000000-0013-4000-8000-000000000002';
  v_equip constant uuid := 'a0000000-0013-4000-8000-000000000003';
  v_mkt constant uuid := 'a0000000-0013-4000-8000-000000000004';
  v_rent constant uuid := 'a0000000-0013-4000-8000-000000000005';
  v_b constant uuid := 'b0000000-0013-4000-8000-000000000001';
  r_rent1 constant uuid := 'a0000000-0013-4000-8000-000000000101';
  r_rent2 constant uuid := 'a0000000-0013-4000-8000-000000000102';
  r_power1 constant uuid := 'a0000000-0013-4000-8000-000000000103';
  r_rent_b constant uuid := 'b0000000-0013-4000-8000-000000000101';
  -- Idempotency marker: the first synthetic member of org A.
  marker constant uuid := md5('exec:a:m:1')::uuid;
  first_names constant text[] := ARRAY['Adriana', 'Alejandro', 'Alicia', 'Ángel', 'Beatriz', 'Carlos', 'Carolina',
    'Daniel', 'Daniela', 'Eduardo', 'Elena', 'Emilio', 'Fernanda', 'Francisco', 'Gloria', 'Gustavo', 'Héctor', 'Irene',
    'Iván', 'Jazmín', 'Jorge', 'Julia', 'Karla', 'Kevin', 'Laura', 'Leonardo', 'Marta', 'Mateo', 'Natalia', 'Nicolás',
    'Olga', 'Óscar', 'Patricia', 'Pablo', 'Raquel', 'Raúl', 'Samuel', 'Sara', 'Teresa', 'Víctor', 'Wanda', 'Yamil'];
  last_names constant text[] := ARRAY['Acevedo', 'Alicea', 'Báez', 'Burgos', 'Cabrera', 'Calderón', 'Cintrón',
    'Colón', 'Cordero', 'Cruz', 'Díaz', 'Feliciano', 'Figueroa', 'García', 'González', 'Hernández', 'Irizarry',
    'Lebrón', 'López', 'Maldonado', 'Martínez', 'Medina', 'Meléndez', 'Montañez', 'Negrón', 'Nieves', 'Ortiz',
    'Pagán', 'Pérez', 'Quiles', 'Ramírez', 'Reyes', 'Rivera', 'Rodríguez', 'Rosado', 'Santiago', 'Serrano', 'Soto',
    'Torres', 'Vázquez'];
  seeded_tables constant text[] := ARRAY['person', 'member', 'subscription',
    'subscription_freeze', 'invoice', 'invoice_line', 'invoice_counter', 'payment', 'credit_balance', 'access_pass',
    'check_in', 'class_session', 'booking', 'sale', 'sale_line', 'stock_movement', 'expense', 'bill',
    'bill_approval'];
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE tz)::date;
  v_first date := (date_trunc('month', now() AT TIME ZONE tz) - interval '11 months')::date;
  v_roster jsonb;
  v_tmpno bigint := 1000000;
  t text;
  r record;
  -- Subscription walk.
  v_sub uuid;
  v_price uuid;
  v_prod uuid;
  v_unit integer;
  v_bps integer;
  v_le uuid;
  v_fd uuid;
  v_due integer;
  v_tenure integer;
  v_pf integer;
  v_i integer;
  v_ps date;
  v_pe date;
  v_starts date[];
  v_ends date[];
  v_cancel boolean;
  v_fs date;
  v_fe date;
  v_pfs date;
  v_frozen boolean;
  v_inv uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = oa)
     OR NOT EXISTS (SELECT 1 FROM app.organization WHERE id = ob)
     OR NOT EXISTS (SELECT 1 FROM app.plan_product WHERE id = pa_session)
     OR NOT EXISTS (SELECT 1 FROM app.product WHERE id = 'a0000000-0009-4000-8000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM app.vendor WHERE id = v_clean) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM app.member WHERE id = marker) THEN RETURN; END IF;

  FOREACH t IN ARRAY seeded_tables LOOP
    EXECUTE format('ALTER TABLE app.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Seed-only helper: a stable pseudo-random number in [0, 1) from a text key. Dropped at the end of this block.
  CREATE FUNCTION app.exec_seed_u(p text) RETURNS double precision
  LANGUAGE sql IMMUTABLE AS 'SELECT (''x'' || substr(md5(p), 1, 8))::bit(32)::bigint / 4294967296.0';

  -- ── Roster: baseline members (joined before the window) plus monthly joins with seasonality and growth.
  WITH cfg(org, tag, base_n, scale) AS (VALUES (oa, 'a', 155, 0.45), (ob, 'b', 62, 0.30)),
  season(cm, w) AS (VALUES (1, 30), (2, 24), (3, 22), (4, 19), (5, 18), (6, 15), (7, 14), (8, 18), (9, 23), (10, 21),
                           (11, 17), (12, 12)),
  sched AS (
    SELECT c.org, c.tag, k, (v_first + make_interval(months => k))::date AS ms,
           CASE WHEN k = 11
                THEN greatest(1, round(s.w * (0.88 + 0.022 * k) * c.scale * extract(day FROM v_today)
                                       / extract(day FROM (date_trunc('month', v_today) + interval '1 month - 1 day'))))
                ELSE round(s.w * (0.88 + 0.022 * k) * c.scale) END::integer AS n
      FROM cfg c CROSS JOIN generate_series(0, 11) AS k
      JOIN season s ON s.cm = extract(month FROM v_first + make_interval(months => k))),
  roster AS (
    SELECT c.org, c.tag, g.n::integer AS n, NULL::integer AS k, NULL::date AS ms
      FROM cfg c, generate_series(1, c.base_n) AS g(n)
    UNION ALL
    SELECT s.org, s.tag, (c.base_n + row_number() OVER (PARTITION BY s.org ORDER BY s.k, j))::integer, s.k, s.ms
      FROM sched s JOIN cfg c ON c.org = s.org, generate_series(1, s.n) AS j),
  dated AS (
    SELECT ro.*, md5('exec:' || ro.tag || ':m:' || ro.n)::uuid AS mid, md5('exec:' || ro.tag || ':p:' || ro.n)::uuid AS pid,
           CASE WHEN ro.k IS NULL THEN v_first - 20 - floor(app.exec_seed_u(ro.tag || ro.n || 'base') * 420)::integer
                WHEN ro.k = 11 THEN ro.ms + floor(app.exec_seed_u(ro.tag || ro.n || 'day') * extract(day FROM v_today))::integer
                ELSE ro.ms + floor(app.exec_seed_u(ro.tag || ro.n || 'day')
                                  * ((ro.ms + interval '1 month')::date - ro.ms))::integer END AS jd
      FROM roster ro)
  SELECT jsonb_agg(jsonb_build_object(
           'org', d.org, 'tag', d.tag, 'n', d.n, 'mid', d.mid, 'pid', d.pid,
           'loc', CASE WHEN d.org = ob THEN lb1 WHEN app.exec_seed_u(d.mid || 'loc') < 0.62 THEN la1 ELSE la2 END,
           'created', least(((d.jd + time '08:00' + make_interval(mins => floor(app.exec_seed_u(d.mid || 'min') * 720)::integer))
                              AT TIME ZONE tz), v_now - interval '45 minutes'),
           -- type: plan (monthly membership, org B only), pack (session packs), dropin (pays each visit or day);
           -- recent sign-ups may still be leads or on trial.
           'type', CASE
             WHEN d.jd > v_today - 21 AND app.exec_seed_u(d.mid || 'new') < 0.15 THEN 'lead'
             WHEN d.jd > v_today - 21 AND app.exec_seed_u(d.mid || 'new') < 0.45 THEN 'trial'
             WHEN d.org = ob THEN CASE WHEN app.exec_seed_u(d.mid || 'type') < 0.86 THEN 'plan' ELSE 'dropin' END
             WHEN app.exec_seed_u(d.mid || 'type') < 0.48 THEN 'pack'
             ELSE 'dropin' END,
           'name', first_names[1 + floor(app.exec_seed_u(d.mid || 'fn') * array_length(first_names, 1))::integer] || ' '
                   || last_names[1 + floor(app.exec_seed_u(d.mid || 'ln') * array_length(last_names, 1))::integer] || ' '
                   || last_names[1 + floor(app.exec_seed_u(d.mid || 'ln2') * array_length(last_names, 1))::integer]
                   || ' Demo'))
    INTO v_roster
    FROM dated d;

  INSERT INTO app.person (id, email, created_at)
  SELECT x.pid, 'socio' || x.n || '.exec.' || x.tag || '@demo.invalid', x.created
    FROM jsonb_to_recordset(v_roster) AS x(pid uuid, n integer, tag text, created timestamptz);
  INSERT INTO app.member (id, org_id, person_id, home_location_id, full_name, member_no, status, created_at)
  SELECT x.mid, x.org, x.pid, x.loc, x.name, upper(x.tag) || '-' || (2000 + x.n),
         CASE x.type WHEN 'lead' THEN 'lead' WHEN 'trial' THEN 'trial' ELSE 'active' END::app.member_status, x.created
    FROM jsonb_to_recordset(v_roster) AS x(mid uuid, org uuid, pid uuid, loc uuid, name text, tag text, n integer,
                                           type text, created timestamptz);

  -- ── Org B monthly memberships: periods, renewal invoices, freezes and cancellations (walked per member).
  FOR r IN SELECT x.mid, x.org, x.loc, (x.created AT TIME ZONE tz)::date AS jd
             FROM jsonb_to_recordset(v_roster) AS x(mid uuid, org uuid, loc uuid, created timestamptz, type text)
            WHERE x.type = 'plan' AND x.org = ob
            ORDER BY x.created, x.mid LOOP
    v_prod := pb_month; v_price := xb_month; v_unit := 3995; v_bps := 100; v_le := leb; v_due := 5; v_fd := fd_b;
    v_tenure := 4 + floor(app.exec_seed_u(r.mid || 'tenure') * 30)::integer;
    v_sub := md5('exec:sub:' || r.mid)::uuid;
    -- One past 30-day freeze in some member's history (mid-period, extending that period).
    v_pf := CASE WHEN app.exec_seed_u(r.mid || 'pastfreeze') < 0.22
                 THEN 1 + floor(app.exec_seed_u(r.mid || 'pfidx') * 12)::integer END;
    v_starts := '{}'; v_ends := '{}'; v_cancel := false; v_frozen := false; v_pfs := NULL;
    v_ps := r.jd; v_i := 0;
    LOOP
      v_pe := (v_ps + interval '1 month')::date;
      IF v_pf IS NOT NULL AND v_i = v_pf AND v_ps + 42 <= v_today THEN
        v_pfs := v_ps + 12; v_pe := v_pe + 30;
      END IF;
      v_starts := v_starts || v_ps; v_ends := v_ends || v_pe;
      v_i := v_i + 1;
      IF v_i >= v_tenure AND v_pe <= v_today THEN v_cancel := true; EXIT; END IF;
      IF v_pe > v_today THEN EXIT; END IF;
      v_ps := v_pe;
    END LOOP;

    -- Some live plans are frozen right now (21–45 days, starting inside the current period).
    IF NOT v_cancel AND app.exec_seed_u(r.mid || 'frozen') < 0.12 AND v_pf IS DISTINCT FROM v_i - 1 THEN
      v_fs := greatest(v_starts[v_i], v_today - floor(app.exec_seed_u(r.mid || 'fs') * 18)::integer);
      v_fe := greatest(v_fs + 21 + floor(app.exec_seed_u(r.mid || 'fl') * 25)::integer, v_today + 1);
      v_frozen := true;
    END IF;

    INSERT INTO app.subscription (id, org_id, member_id, product_id, price_id, location_id, status, billing_interval,
                                  start_date, current_period_start, current_period_end, cancel_at_period_end,
                                  cancel_requested_at, cancelled_at, created_by, created_at)
    VALUES (v_sub, r.org, r.mid, v_prod, v_price, r.loc,
            CASE WHEN v_cancel THEN 'cancelled' WHEN v_frozen THEN 'frozen' ELSE 'active' END::app.subscription_status,
            'month', r.jd, v_starts[v_i], v_ends[v_i] + CASE WHEN v_frozen THEN v_fe - v_fs ELSE 0 END, v_cancel,
            CASE WHEN v_cancel THEN (v_ends[v_i] - 3 - floor(app.exec_seed_u(r.mid || 'req') * 12)::integer
                                     + time '12:00') AT TIME ZONE tz END,
            CASE WHEN v_cancel THEN (v_ends[v_i] + time '05:00') AT TIME ZONE tz END,
            v_fd, (r.jd + time '08:00') AT TIME ZONE tz);
    IF v_pfs IS NOT NULL THEN
      INSERT INTO app.subscription_freeze (id, org_id, subscription_id, member_id, location_id, start_date, end_date,
                                           reason, created_by, created_at)
      VALUES (md5('exec:frz:' || r.mid || ':past')::uuid, r.org, v_sub, r.mid, r.loc, v_pfs, v_pfs + 30,
              'Demo: viaje', v_fd, (v_pfs - 2 + time '10:00') AT TIME ZONE tz);
    END IF;
    IF v_frozen THEN
      INSERT INTO app.subscription_freeze (id, org_id, subscription_id, member_id, location_id, start_date, end_date,
                                           reason, created_by, created_at)
      VALUES (md5('exec:frz:' || r.mid || ':now')::uuid, r.org, v_sub, r.mid, r.loc, v_fs, v_fe,
              'Demo: lesión, pausa temporal', v_fd, least((v_fs - 1 + time '10:00') AT TIME ZONE tz, v_now));
    END IF;

    -- One renewal invoice per period, issued at the period start (paid by card the same morning).
    FOR v_i IN 1 .. array_length(v_starts, 1) LOOP
      v_tmpno := v_tmpno + 1;
      v_inv := md5('exec:inv:sub:' || r.mid || ':' || v_i)::uuid;
      INSERT INTO app.invoice (id, org_id, legal_entity_id, number, member_id, location_id, municipality,
                               subscription_id, period_start, period_end, subtotal_cents, ivu_state_cents,
                               ivu_municipal_cents, total_cents, application_fee_bps, application_fee_cents, status,
                               issued_at, due_date, paid_at, created_by)
      SELECT v_inv, r.org, v_le, v_tmpno, r.mid, r.loc, l.municipality, v_sub, v_starts[v_i], v_ends[v_i],
             0, 0, 0, 0, v_bps, 0, 'paid', (v_starts[v_i] + time '07:00') AT TIME ZONE tz, v_starts[v_i] + v_due,
             (v_starts[v_i] + time '07:00') AT TIME ZONE tz, v_fd
        FROM app.location l WHERE l.id = r.loc;
      INSERT INTO app.invoice_line (id, org_id, invoice_id, product_id, price_id, description, quantity,
                                    unit_amount_cents, tax_category)
      VALUES (md5('exec:il:' || v_inv)::uuid, r.org, v_inv, v_prod, v_price,
              'Membresía mensual', 1, v_unit, 'taxable');
    END LOOP;

    UPDATE app.member SET status = CASE WHEN v_cancel THEN 'cancelled' WHEN v_frozen THEN 'frozen' ELSE 'active' END::app.member_status
     WHERE id = r.mid;
  END LOOP;

  -- ── Visits: allowed check-ins with weekday / hour patterns, from the window start (or the join day) until
  -- today, never after a cancellation nor inside a freeze. Leads do not come in. Pay-per-visit and pack members
  -- sometimes take a break of 6–13 weeks, and about one in four stops coming altogether (their status stays as
  -- the desk left it: nobody cancels a pay-per-session member); that is what the renewal rate measures.
  INSERT INTO app.check_in (id, org_id, location_id, member_id, source, result, reason, recorded_by, at)
  WITH mem AS (
    SELECT x.mid, x.org, x.loc, x.type, (x.created AT TIME ZONE tz)::date AS jd,
           (SELECT (s.cancelled_at AT TIME ZONE tz)::date - 1 FROM app.subscription s
             WHERE s.member_id = x.mid AND s.status = 'cancelled') AS last_day,
           -- visits per week by type
           CASE x.type WHEN 'plan' THEN 2.4 + 2.0 * app.exec_seed_u(x.mid || 'freq')
                       WHEN 'pack' THEN 1.5 + 1.6 * app.exec_seed_u(x.mid || 'freq')
                       WHEN 'trial' THEN 2.0
                       ELSE 0.9 + 1.4 * app.exec_seed_u(x.mid || 'freq') END AS per_week,
           app.exec_seed_u(x.mid || 'slot') AS slot,
           CASE WHEN x.type IN ('pack', 'dropin') AND app.exec_seed_u(x.mid || 'lapse') < 0.25
                THEN (x.created AT TIME ZONE tz)::date + 60 + floor(app.exec_seed_u(x.mid || 'lapsed') * 330)::integer
           END AS lapse_day
      FROM jsonb_to_recordset(v_roster) AS x(mid uuid, org uuid, loc uuid, type text, created timestamptz)
     WHERE x.type <> 'lead'),
  brk AS (
    SELECT m.mid, b.bs, b.bs + 45 + floor(app.exec_seed_u(m.mid::text || 'brklen' || k) * 50)::integer AS be
      FROM mem m CROSS JOIN generate_series(-2, 11) AS k,
           LATERAL (SELECT (v_first + make_interval(months => k))::date
                           + floor(app.exec_seed_u(m.mid::text || 'brkday' || k) * 28)::integer AS bs) b
     WHERE m.type IN ('pack', 'dropin') AND app.exec_seed_u(m.mid::text || 'brk' || k) < 0.10),
  days AS (
    SELECT m.*, d::date AS d, extract(isodow FROM d)::integer AS dow
      FROM mem m,
           LATERAL generate_series(greatest(m.jd, v_first), least(m.last_day, m.lapse_day, v_today),
                                   interval '1 day') AS d),
  hits AS (
    SELECT days.*,
           ((days.d + CASE WHEN days.dow >= 6 THEN time '08:00' + make_interval(mins => floor(app.exec_seed_u(days.mid::text || days.d || 't') * 240)::integer)
                           WHEN days.slot < 0.22 THEN time '05:30' + make_interval(mins => floor(app.exec_seed_u(days.mid::text || days.d || 't') * 120)::integer)
                           WHEN days.slot < 0.37 THEN time '11:30' + make_interval(mins => floor(app.exec_seed_u(days.mid::text || days.d || 't') * 120)::integer)
                           WHEN days.slot < 0.88 THEN time '16:30' + make_interval(mins => floor(app.exec_seed_u(days.mid::text || days.d || 't') * 210)::integer)
                           ELSE time '08:30' + make_interval(mins => floor(app.exec_seed_u(days.mid::text || days.d || 't') * 120)::integer) END)
             AT TIME ZONE tz) AS at
      FROM days
     WHERE app.exec_seed_u(days.mid::text || days.d || 'visit')
           < days.per_week / 7.0
             * (ARRAY[1.3, 1.2, 1.2, 1.1, 0.9, 0.8, 0.5])[days.dow]
             * (ARRAY[1.15, 1.10, 1.05, 1.0, 1.0, 0.93, 0.86, 0.92, 1.02, 1.0, 0.98, 0.88])[extract(month FROM days.d)::integer]
       AND NOT EXISTS (SELECT 1 FROM app.subscription_freeze f
                        WHERE f.member_id = days.mid AND days.d >= f.start_date AND days.d < f.end_date)
       AND NOT EXISTS (SELECT 1 FROM brk WHERE brk.mid = days.mid AND days.d >= brk.bs AND days.d < brk.be))
  SELECT md5('exec:ci:' || h.mid || ':' || h.d)::uuid, h.org, h.loc, h.mid,
         CASE WHEN app.exec_seed_u(h.mid::text || h.d || 'src') < 0.72 THEN 'qr' ELSE 'front_desk' END::app.checkin_source,
         'allowed', CASE WHEN h.type = 'trial' THEN 'trial' ELSE 'active' END,
         CASE h.loc WHEN la1 THEN fd_a1 WHEN la2 THEN fd_a2 ELSE fd_b END, h.at
    FROM hits h
   WHERE h.at < v_now - interval '10 minutes';

  -- ── One-off sales from the visits: pay-per-visit members buy the session (org A) or a day pass (org B) at the
  -- desk; pack members buy a 5- or 10-session pack on the visit that starts it; some pack members add personal
  -- training every other month.
  WITH mem AS (
    SELECT x.mid, x.org, x.type, app.exec_seed_u(x.mid || 'pack') < 0.4 AS small_pack,
           app.exec_seed_u(x.mid || 'pt') < 0.22 AS pt
      FROM jsonb_to_recordset(v_roster) AS x(mid uuid, org uuid, type text)
     WHERE x.type IN ('pack', 'dropin')),
  v AS (
    SELECT c.id AS ci, c.member_id AS mid, c.location_id AS loc, c.at, m.org, m.type, m.small_pack, m.pt,
           row_number() OVER (PARTITION BY c.member_id ORDER BY c.at) AS rn,
           row_number() OVER (PARTITION BY c.member_id, date_trunc('month', c.at AT TIME ZONE tz) ORDER BY c.at) AS rn_month
      FROM app.check_in c JOIN mem m ON m.mid = c.member_id),
  sold AS (
    SELECT v.ci, v.mid, v.loc, v.org, v.at - interval '4 minutes' AS issued, 'once' AS what,
           CASE WHEN v.org = ob THEN pb_day ELSE pa_session END AS prod,
           CASE WHEN v.org = ob THEN xb_day WHEN v.loc = la2 THEN xa_session_bay ELSE xa_session END AS price
      FROM v WHERE v.type = 'dropin'
    UNION ALL
    SELECT v.ci, v.mid, v.loc, v.org, v.at - interval '5 minutes', 'pack',
           CASE WHEN v.small_pack THEN pa_pack5 ELSE pa_pack10 END, CASE WHEN v.small_pack THEN xa_pack5 ELSE xa_pack10 END
      FROM v WHERE v.type = 'pack' AND (v.rn - 1) % CASE WHEN v.small_pack THEN 5 ELSE 10 END = 0
    UNION ALL
    SELECT v.ci, v.mid, v.loc, v.org, v.at - interval '6 minutes', 'pt', pa_pt, xa_pt
      FROM v WHERE v.type = 'pack' AND v.pt AND v.rn_month = 1
                   AND (extract(month FROM v.at AT TIME ZONE tz)::integer
                        + floor(app.exec_seed_u(v.mid || 'ptphase') * 2)::integer) % 2 = 0),
  numbered AS (
    SELECT s.*, md5('exec:inv:' || s.ci || ':' || s.what)::uuid AS inv,
           2000000 + row_number() OVER (ORDER BY s.issued, s.ci, s.what) AS tmpno
      FROM sold s),
  ins AS (
    INSERT INTO app.invoice (id, org_id, legal_entity_id, number, member_id, location_id, municipality,
                             subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents, application_fee_bps,
                             application_fee_cents, status, issued_at, due_date, paid_at, created_by)
    SELECT n.inv, n.org, l.legal_entity_id, n.tmpno, n.mid, n.loc, l.municipality, 0, 0, 0, 0,
           CASE WHEN n.org = ob THEN 100 ELSE 75 END, 0, 'paid', n.issued,
           (n.issued AT TIME ZONE tz)::date + CASE WHEN n.org = ob THEN 5 ELSE 3 END, n.issued,
           CASE n.loc WHEN la1 THEN fd_a1 WHEN la2 THEN fd_a2 ELSE fd_b END
      FROM numbered n JOIN app.location l ON l.id = n.loc
    RETURNING id)
  INSERT INTO app.invoice_line (id, org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents,
                                tax_category)
  SELECT md5('exec:il:' || n.inv)::uuid, n.org, n.inv, n.prod, n.price, left(pp.name, 120), 1, pr.amount_cents,
         pp.tax_category
    FROM numbered n JOIN app.price pr ON pr.id = n.price JOIN app.plan_product pp ON pp.id = n.prod;

  -- Totals and platform fee from the lines (same arithmetic as billing_issue_invoice; the CHECKs re-verify it).
  UPDATE app.invoice i
     SET subtotal_cents = s.sub, ivu_state_cents = s.st, ivu_municipal_cents = s.mu, total_cents = s.sub + s.st + s.mu,
         application_fee_cents = (((s.sub + s.st + s.mu)::bigint * i.application_fee_bps + 5000) / 10000)::integer
    FROM (SELECT il.invoice_id, sum(il.amount_cents)::integer AS sub, sum(il.ivu_state_cents)::integer AS st,
                 sum(il.ivu_municipal_cents)::integer AS mu
            FROM app.invoice_line il JOIN app.invoice i2 ON i2.id = il.invoice_id
           WHERE i2.org_id IN (oa, ob) AND i2.number > 1000000
           GROUP BY il.invoice_id) s
   WHERE i.id = s.invoice_id;

  -- A few pay-per-visit members still owe their last session (open past its due date → past_due).
  UPDATE app.invoice i SET status = 'open', paid_at = NULL
    FROM (SELECT DISTINCT ON (i2.member_id) i2.id
            FROM app.invoice i2
            JOIN jsonb_to_recordset(v_roster) AS x(mid uuid, type text) ON x.mid = i2.member_id
           WHERE x.type = 'dropin' AND i2.number > 2000000 AND app.exec_seed_u(x.mid || 'owes') < 0.05
           ORDER BY i2.member_id, i2.issued_at DESC) o
   WHERE i.id = o.id AND i.due_date < v_today;
  UPDATE app.member m SET status = 'past_due'
   WHERE m.id IN (SELECT i.member_id FROM app.invoice i WHERE i.number > 1000000 AND i.status = 'open'
                     AND i.org_id IN (oa, ob));

  -- Payments: every paid demo invoice, in full, when it was issued (renewals by card, the desk card or cash).
  INSERT INTO app.payment (id, org_id, invoice_id, member_id, location_id, method, amount_cents, status, idempotency_key,
                           reference, provider_ref, recorded_by, received_at)
  SELECT md5('exec:pay:' || i.id)::uuid, i.org_id, i.id, i.member_id, i.location_id, x.method, i.total_cents,
         'succeeded', 'exec-' || left(md5('exec:pay:' || i.id), 24),
         CASE WHEN x.method = 'cash' THEN 'Efectivo en recepcion' END,
         CASE WHEN x.method = 'card_simulated' THEN 'sim_' || left(md5('exec:ref:' || i.id), 20) END,
         i.created_by, i.paid_at
    FROM app.invoice i,
         LATERAL (SELECT CASE WHEN i.subscription_id IS NOT NULL OR app.exec_seed_u(i.id || 'method') < 0.62
                              THEN 'card_simulated' ELSE 'cash' END::app.payment_method AS method) x
   WHERE i.number > 1000000 AND i.status = 'paid' AND i.total_cents > 0 AND i.org_id IN (oa, ob);

  -- Entitlements the one-off sales granted: the pass for single sessions / day passes, credits for packs.
  INSERT INTO app.access_pass (id, org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to,
                               created_at)
  SELECT md5('exec:pass:' || i.id)::uuid, i.org_id, i.member_id, i.location_id, il.product_id, i.id, i.issued_at,
         i.issued_at + interval '1 day', i.issued_at
    FROM app.invoice i JOIN app.invoice_line il ON il.invoice_id = i.id
   WHERE i.number > 2000000 AND i.org_id IN (oa, ob) AND il.product_id IN (pa_session, pb_day);
  INSERT INTO app.credit_balance (id, org_id, member_id, product_id, location_id, invoice_id, credits_total,
                                  credits_remaining, expires_at, created_at)
  SELECT md5('exec:cred:' || i.id)::uuid, i.org_id, i.member_id, il.product_id, i.location_id, i.id, pr.credits,
         CASE WHEN i.issued_at + make_interval(days => pr.validity_days) <= v_now THEN 0
              WHEN il.product_id = pa_pt THEN 1 + floor(app.exec_seed_u(i.id || 'left') * 3)::integer
              ELSE greatest(pr.credits - (SELECT count(*) FROM app.check_in c
                                           WHERE c.member_id = i.member_id AND c.at >= i.issued_at)::integer, 0) END,
         i.issued_at + make_interval(days => pr.validity_days), i.issued_at
    FROM app.invoice i JOIN app.invoice_line il ON il.invoice_id = i.id JOIN app.price pr ON pr.id = il.price_id
   WHERE i.number > 2000000 AND i.org_id = oa AND il.product_id IN (pa_pack5, pa_pack10, pa_pt);

  -- ── Classes for the two weeks before the schedule seed's window (same timetable; one cancelled class), with
  -- the members who came in that day and took the class marked as attended.
  INSERT INTO app.class_session (id, org_id, location_id, class_type_id, instructor_id, room, starts_at, ends_at,
                                 capacity, cancelled, created_by, created_at)
  SELECT md5('exec:cls:' || x.loc || ':' || x.ct || ':' || g.d)::uuid, x.org, x.loc, x.ct, x.instructor, x.room,
         (g.d + x.at) AT TIME ZONE tz, (g.d + x.at + make_interval(mins => x.mins)) AT TIME ZONE tz, x.cap,
         x.loc = la2 AND x.ct = 'a0000000-0000-4000-8000-000000007005'::uuid AND g.d = v_today - 11,
         x.creator, (g.d - 14 + time '09:00') AT TIME ZONE tz
    FROM generate_series(v_today - 20, v_today - 8, interval '1 day') AS gs(ts),
         LATERAL (SELECT gs.ts::date AS d, extract(isodow FROM gs.ts)::integer AS dow) g,
         (VALUES
           (oa, la1, 'a0000000-0000-4000-8000-000000007001'::uuid, 'a0000000-0000-4000-8000-000000000505'::uuid,
            'Salon Ciclismo', time '06:00', 45, 20, owner_a, 0),
           (oa, la1, 'a0000000-0000-4000-8000-000000007003', 'a0000000-0000-4000-8000-000000000505',
            'Area Funcional', time '12:00', 50, 12, owner_a, 0),
           (oa, la1, 'a0000000-0000-4000-8000-000000007002', 'a0000000-0000-4000-8000-000000000505',
            'Salon 2', time '18:00', 60, 15, owner_a, 1),
           (oa, la1, 'a0000000-0000-4000-8000-000000007004', NULL, 'Salon 1', time '19:00', 55, 25, owner_a, 2),
           (oa, la2, 'a0000000-0000-4000-8000-000000007005', NULL, 'Salon A', time '07:00', 30, 10, owner_a, 0),
           (oa, la2, 'a0000000-0000-4000-8000-000000007001', NULL, 'Salon B', time '18:30', 45, 16, owner_a, 0),
           (ob, lb1, 'b0000000-0000-4000-8000-000000007001', NULL, 'Salon Principal', time '18:00', 45, 16, owner_b, 0)
         ) AS x(org, loc, ct, instructor, room, at, mins, cap, creator, days)  -- days: 0 Mon–Sat, 1 M/W/F, 2 T/Th/Sa
   WHERE g.dow <> 7 AND (x.days = 0 OR (x.days = 1 AND g.dow IN (1, 3, 5)) OR (x.days = 2 AND g.dow IN (2, 4, 6)));
  INSERT INTO app.booking (id, org_id, session_id, member_id, status, booked_by, created_at, updated_at)
  SELECT md5('exec:bk:' || b.sid || ':' || b.mid)::uuid, b.org, b.sid, b.mid, 'attended', b.fd, b.starts - interval '1 day',
         b.starts + interval '1 hour'
    FROM (SELECT cs.id AS sid, cs.org_id AS org, cs.starts_at AS starts, cs.capacity, c.member_id AS mid,
                 c.recorded_by AS fd,
                 row_number() OVER (PARTITION BY cs.id ORDER BY app.exec_seed_u(cs.id::text || c.member_id)) AS rn
            FROM app.class_session cs
            JOIN app.check_in c ON c.location_id = cs.location_id
                               AND (c.at AT TIME ZONE tz)::date = (cs.starts_at AT TIME ZONE tz)::date
            JOIN jsonb_to_recordset(v_roster) AS x(mid uuid) ON x.mid = c.member_id
           WHERE cs.id = md5('exec:cls:' || cs.location_id || ':' || cs.class_type_id || ':'
                             || (cs.starts_at AT TIME ZONE tz)::date)::uuid
             AND NOT cs.cancelled AND app.exec_seed_u(cs.id::text || c.member_id || 'bk') < 0.3) b
   WHERE b.rn <= b.capacity;

  -- ── Store (org A): about one visit in nine ends at the counter. Stocked products per location only.
  WITH v AS (
    SELECT c.id AS ci, c.member_id, c.location_id AS loc, c.at + interval '40 minutes' AS done,
           app.exec_seed_u(c.id || 'pick') AS pick, app.exec_seed_u(c.id || 'qty') AS q,
           app.exec_seed_u(c.id || 'refund') < 0.015 AS refunded
      FROM app.check_in c
      JOIN jsonb_to_recordset(v_roster) AS x(mid uuid) ON x.mid = c.member_id
     WHERE c.org_id = oa AND app.exec_seed_u(c.id || 'store') < 0.115 AND c.at < v_now - interval '2 days'),
  pick AS (
    SELECT v.*, p.id AS product_id, p.price_cents, p.taxable, p.age_restricted,
           CASE WHEN p.category = 'drink' THEN 1 + floor(v.q * 3)::integer ELSE 1 END AS qty
      FROM v JOIN app.product p ON p.org_id = oa AND p.sku = CASE
        WHEN v.loc = la1 THEN CASE WHEN v.pick < 0.30 THEN 'DRK-AGUA-500' WHEN v.pick < 0.48 THEN 'DRK-ELEC-600'
                                   WHEN v.pick < 0.60 THEN 'SUP-WHEY-2LB' WHEN v.pick < 0.68 THEN 'SUP-CREA-300'
                                   WHEN v.pick < 0.74 THEN 'SUP-PRE-30' WHEN v.pick < 0.79 THEN 'APP-TEE-M'
                                   WHEN v.pick < 0.82 THEN 'APP-TEE-L' WHEN v.pick < 0.92 THEN 'ACC-SHAKER'
                                   ELSE 'ACC-TOALLA' END
        ELSE CASE WHEN v.pick < 0.50 THEN 'DRK-AGUA-500' WHEN v.pick < 0.72 THEN 'SUP-WHEY-2LB'
                  WHEN v.pick < 0.86 THEN 'SUP-CREA-300' ELSE 'APP-TEE-M' END END),
  amt AS (
    SELECT pick.*, a.subtotal_cents, a.ivu_state_cents, a.ivu_municipal_cents, a.total_cents,
           md5('exec:sale:' || pick.ci)::uuid AS sale_id,
           CASE pick.loc WHEN la1 THEN fd_a1 ELSE fd_a2 END AS seller
      FROM pick, LATERAL app.store_line_amounts(pick.qty, pick.price_cents, pick.taxable) a),
  ins AS (
    INSERT INTO app.sale (id, org_id, location_id, channel, member_id, status, subtotal_cents, ivu_state_cents,
                          ivu_municipal_cents, total_cents, payment_method, age_verified_by, created_by, created_at,
                          completed_by, completed_at, refunded_by, refunded_at, refund_reason)
    SELECT a.sale_id, oa, a.loc, 'pos', a.member_id,
           CASE WHEN a.refunded THEN 'refunded' ELSE 'completed' END::app.store_sale_status,
           a.subtotal_cents, a.ivu_state_cents, a.ivu_municipal_cents, a.total_cents,
           CASE WHEN app.exec_seed_u(a.ci || 'pm') < 0.55 THEN 'card_simulated' ELSE 'cash' END::app.store_payment_method,
           CASE WHEN a.age_restricted THEN CASE a.loc WHEN la1 THEN sm_a1 ELSE sm_a2 END END,
           a.seller, a.done, a.seller, a.done,
           CASE WHEN a.refunded THEN CASE a.loc WHEN la1 THEN mgr_a ELSE owner_a END END,
           CASE WHEN a.refunded THEN a.done + interval '1 day' END,
           CASE WHEN a.refunded THEN 'Demo: producto devuelto sin abrir' END
      FROM amt a
    RETURNING id)
  INSERT INTO app.sale_line (id, org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
                             subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
  SELECT md5('exec:sl:' || a.sale_id)::uuid, oa, a.sale_id, a.product_id, a.qty, a.price_cents, a.taxable,
         a.age_restricted, a.subtotal_cents, a.ivu_state_cents, a.ivu_municipal_cents, a.total_cents
    FROM amt a;

  -- Stock ledger: each sale out, each refund back in, and that month's delivery for exactly the net units sold,
  -- so on_hand (= Σ movements) is unchanged.
  INSERT INTO app.stock_movement (id, org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id, at)
  SELECT md5('exec:mv:sale:' || s.id)::uuid, oa, sl.product_id, s.location_id, 'sale', -sl.qty, 'POS', s.id,
         s.completed_by, s.completed_at
    FROM app.check_in c
    JOIN app.sale s ON s.id = md5('exec:sale:' || c.id)::uuid
    JOIN app.sale_line sl ON sl.sale_id = s.id
   WHERE c.org_id = oa;
  INSERT INTO app.stock_movement (id, org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id, at)
  SELECT md5('exec:mv:ret:' || s.id)::uuid, oa, sl.product_id, s.location_id, 'return', sl.qty, 'REFUND', s.id,
         s.refunded_by, s.refunded_at
    FROM app.stock_movement mv JOIN app.sale s ON s.id = mv.sale_id JOIN app.sale_line sl ON sl.sale_id = s.id
   WHERE mv.id = md5('exec:mv:sale:' || s.id)::uuid AND s.status = 'refunded';
  INSERT INTO app.stock_movement (id, org_id, product_id, location_id, kind, qty, ref, by_person_id, at)
  SELECT md5('exec:mv:rcv:' || x.product_id || x.location_id || x.m)::uuid, oa, x.product_id, x.location_id,
         'receive', x.net, 'Demo pedido mensual', CASE x.location_id WHEN la1 THEN mgr_a ELSE owner_a END,
         (x.m + time '05:00') AT TIME ZONE tz
    FROM (SELECT mv.product_id, mv.location_id,
                 date_trunc('month', min(mv.at) AT TIME ZONE tz)::date AS m, -sum(mv.qty)::integer AS net
            FROM app.stock_movement mv
           WHERE mv.org_id = oa AND mv.id IN (md5('exec:mv:sale:' || mv.sale_id)::uuid, md5('exec:mv:ret:' || mv.sale_id)::uuid)
           GROUP BY mv.product_id, mv.location_id, date_trunc('month', mv.at AT TIME ZONE tz)) x
   WHERE x.net > 0;

  -- ── Gapless, chronological invoice numbers per legal entity (the billing demo invoices included), and the
  -- counter that the next real invoice will take.
  UPDATE app.invoice SET number = number + 10000000 WHERE legal_entity_id IN (lea, leb);
  UPDATE app.invoice i SET number = x.rn
    FROM (SELECT id, row_number() OVER (PARTITION BY legal_entity_id ORDER BY issued_at, id) AS rn
            FROM app.invoice WHERE legal_entity_id IN (lea, leb)) x
   WHERE i.id = x.id;
  UPDATE app.invoice_counter c SET next_no = (SELECT max(i.number) + 1 FROM app.invoice i
                                               WHERE i.legal_entity_id = c.legal_entity_id)
   WHERE c.legal_entity_id IN (lea, leb);
  UPDATE app.payment p SET reference = 'Recibo ' || i.number
    FROM app.invoice i WHERE i.id = p.invoice_id AND p.org_id = oa AND p.reference ~ '^Recibo [0-9]+$';

  -- ── Finance: monthly costs before the two months the finance seed already recorded (rent, power, payroll,
  -- supplies, maintenance, marketing; cleaning as an approved and paid bill), plus the items that seed leaves
  -- out of last month. Nothing is dated after today.
  WITH mon AS (SELECT k, (v_first + make_interval(months => k))::date AS m FROM generate_series(0, 10) AS k),
  rows_a AS (
    SELECT la1 AS loc, v_rent AS vendor, r_rent1 AS rec, 'rent'::app.expense_category AS cat, 380000 AS amt,
           m.m AS d, 'Renta local Demo San Juan' AS note, owner_a AS who FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la2, v_rent, r_rent2, 'rent', 290000, m.m, 'Renta local Demo Bayamón', owner_a FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la1, v_power, r_power1, 'utilities', 65000, m.m, 'Luz Demo San Juan (estimado)', owner_a
      FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la2, v_power, NULL, 'utilities',
           42000 + floor(app.exec_seed_u('bypower' || m.m) * 14000)::integer, m.m + 9, 'Demo: luz Bayamón', owner_a FROM mon m
    UNION ALL SELECT la1, NULL, NULL, 'utilities', 9500 + floor(app.exec_seed_u('water1' || m.m) * 4000)::integer, m.m + 11,
           'Demo: agua San Juan', mgr_a FROM mon m
    UNION ALL SELECT la2, NULL, NULL, 'utilities', 7000 + floor(app.exec_seed_u('water2' || m.m) * 3000)::integer, m.m + 11,
           'Demo: agua Bayamón', owner_a FROM mon m
    UNION ALL SELECT la1, NULL, NULL, 'utilities', 14999, m.m + 4, 'Demo: internet y teléfono', owner_a FROM mon m
    UNION ALL SELECT la1, NULL, NULL, 'payroll_export',
           280000 + 12000 * m.k + floor(app.exec_seed_u('pay' || m.m) * 30000)::integer, m.m + 27,
           'Demo: total nómina exportada (no procesada aquí)', owner_a FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la2, NULL, NULL, 'payroll_export',
           100000 + 5000 * m.k + floor(app.exec_seed_u('pay2' || m.m) * 20000)::integer, m.m + 27,
           'Demo: nómina Bayamón exportada (no procesada aquí)', owner_a FROM mon m
    UNION ALL SELECT CASE WHEN m.k % 2 = 0 THEN la1 ELSE la2 END, NULL, NULL, 'supplies',
           12000 + floor(app.exec_seed_u('sup' || m.m) * 18000)::integer, m.m + 6, 'Demo: limpieza y papel', mgr_a
      FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la2, NULL, NULL, 'maintenance', 8000 + floor(app.exec_seed_u('mnt' || m.m) * 30000)::integer, m.m + 17,
           'Demo: mantenimiento de equipos', owner_a FROM mon m WHERE m.k <= 9
    UNION ALL SELECT la1, v_mkt, NULL, 'marketing',
           CASE WHEN extract(month FROM m.m) IN (1, 9) THEN 110000 WHEN extract(month FROM m.m) IN (12, 8) THEN 60000
                ELSE 25000 + floor(app.exec_seed_u('mkt' || m.m) * 20000)::integer END,
           m.m + 3, 'Demo: anuncios en redes', owner_a FROM mon m WHERE m.k <= 9),
  rows_b AS (
    SELECT lb1 AS loc, NULL::uuid AS vendor, r_rent_b AS rec, 'rent'::app.expense_category AS cat, 210000 AS amt,
           m.m AS d, 'Renta local Demo Ponce' AS note, owner_b AS who FROM mon m WHERE m.k <= 9
    UNION ALL SELECT lb1, NULL, NULL, 'utilities', 26000 + floor(app.exec_seed_u('bpow' || m.m) * 10000)::integer, m.m + 9,
           'Demo: luz Ponce', owner_b FROM mon m
    UNION ALL SELECT lb1, NULL, NULL, 'supplies', 4000 + floor(app.exec_seed_u('bsup' || m.m) * 6000)::integer, m.m + 14,
           'Demo: toallas y limpieza', owner_b FROM mon m WHERE m.k <= 9
    UNION ALL SELECT lb1, v_b, NULL, 'maintenance', 6000 + floor(app.exec_seed_u('bmnt' || m.m) * 16000)::integer, m.m + 20,
           'Demo: mantenimiento aire acondicionado', owner_b FROM mon m WHERE m.k % 3 = 0)
  INSERT INTO app.expense (id, org_id, location_id, vendor_id, recurring_id, category, amount_cents, spent_on,
                           receipt_note, recorded_by, created_at)
  SELECT md5('exec:exp:' || x.org || x.loc || x.cat || x.d || x.note)::uuid, x.org, x.loc, x.vendor, x.rec, x.cat, x.amt,
         x.d, x.note, x.who, (x.d + time '18:00') AT TIME ZONE tz
    FROM (SELECT oa AS org, * FROM rows_a UNION ALL SELECT ob, * FROM rows_b) x
   WHERE x.d <= v_today;

  -- Cleaning (San Juan): entered by the manager, approved by the owner, paid 20 days later.
  INSERT INTO app.bill (id, org_id, vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents,
                        status, created_by, created_at, approved_by, approved_at, paid_on, payment_ref,
                        paid_recorded_by)
  SELECT md5('exec:bill:' || m.m)::uuid, oa, v_clean, la1, 'LDB-H' || to_char(m.m, 'YYMM'), 'maintenance',
         'Limpieza profunda mensual', m.m + 1, m.m + 31, 27500 + 500 * (m.k / 4), 'paid', mgr_a,
         (m.m + 1 + time '15:00') AT TIME ZONE tz, owner_a, (m.m + 3 + time '09:00') AT TIME ZONE tz, m.m + 21,
         'CHK ' || (2900 + m.k), owner_a
    FROM (SELECT k, (v_first + make_interval(months => k))::date AS m FROM generate_series(0, 9) AS k) m;
  -- Equipment repairs now and then (approved by the owner, one still awaiting payment).
  INSERT INTO app.bill (id, org_id, vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents,
                        status, created_by, created_at, approved_by, approved_at, paid_on, payment_ref,
                        paid_recorded_by)
  SELECT md5('exec:bill:equip:' || m.m)::uuid, oa, v_equip, la1, 'EDF-H' || to_char(m.m, 'YYMM'), 'maintenance',
         'Demo: reparación de equipo cardiovascular', m.m + 13, m.m + 43,
         40000 + floor(app.exec_seed_u('equip' || m.m) * 60000)::integer,
         CASE WHEN m.k = 9 THEN 'approved' ELSE 'paid' END::app.bill_status, mgr_a,
         (m.m + 13 + time '15:00') AT TIME ZONE tz, owner_a, (m.m + 14 + time '09:00') AT TIME ZONE tz,
         CASE WHEN m.k = 9 THEN NULL ELSE m.m + 40 END, CASE WHEN m.k = 9 THEN NULL ELSE 'CHK ' || (3100 + m.k) END,
         CASE WHEN m.k = 9 THEN NULL ELSE owner_a END
    FROM (SELECT k, (v_first + make_interval(months => k))::date AS m FROM generate_series(0, 9) AS k) m
   WHERE m.k % 3 = 0 AND m.m + 40 <= v_today;
  INSERT INTO app.bill_approval (id, org_id, bill_id, location_id, approver_person_id, approver_role, decision,
                                 amount_cents, threshold_cents, note, at)
  SELECT md5('exec:appr:' || b.id)::uuid, oa, b.id, b.location_id, owner_a, 'owner', 'approve', b.amount_cents, 50000,
         NULL, b.approved_at
    FROM app.bill b
   WHERE b.org_id = oa AND b.number ~ '^(LDB|EDF)-H[0-9]{4}$';

  DROP FUNCTION app.exec_seed_u(text);
  FOREACH t IN ARRAY seeded_tables LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $seed$;
