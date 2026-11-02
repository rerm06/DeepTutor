-- Module exec (Panel ejecutivo) · migration 0019. Owner and location-manager "executive dashboard": KPI cards with
-- 12-point sparklines, monthly revenue vs expenses, joins vs cancellations, member status donut and sales mix.
-- Owned by the exec module agent; see docs/modules/exec.md.
--
-- Design: one SECURITY INVOKER read model, like every report in 0014. It runs under the caller's RLS on the
-- billing (0006), schedule (0007), store (0009) and finance (0013) tables and reuses the 0014 guard
-- (app.rpt_guard: owner / location_manager, location probed under RLS → 42501) plus 0014's own member-status and
-- member-flow read models, so the same figure is the same number on every screen. No table, no definer function:
-- nothing here widens visibility or writes anything.
--
-- Definitions (each row bucketed in its own location's local time; the 12-month grid is in Puerto Rico time):
--   revenue   = cash collected net of refunds = succeeded billing payments by received_at
--               + store sales (completed or later refunded) by completed_at − refunded sales by refunded_at.
--               Equals finance_pnl().cash_in_cents for the same month and scope. IVU collected is included
--               (it is cash received) [VERIFICAR · CPA: show IVU separately or net it out of "profit"].
--   expenses  = non-void finance expenses by spent_on + approved or paid bills by issued_on
--               (= finance_pnl().expenses_cents + bills_cents; commissions and platform fees are NOT included).
--   net profit = revenue − expenses (cash view, not the accrual P&L).
--   revenue / net profit KPI "prev": last month over the same days as this month-to-date (1st .. same
--               day-of-month, clamped), so a partial month is never compared with a full one. Series = full months.
--   active members: value = member.status 'active' now (= report_dashboard.members_active); earlier points are
--               reconstructed at each month end from member, subscription and freeze history [S]: joined by then,
--               not a lead/trial today, not cancelled by then (members cancelled today with no cancelled
--               subscription never count), not inside a freeze on the month's last day.
--   check-ins: allowed check-ins per local day (= report_dashboard.check_ins_today); prev = same weekday last week.
--   joins / cancellations: app.report_member_flow; member status: app.report_member_status
--               (expired = cancelled; other = lead + trial + past_due).
--   classes:  non-cancelled class sessions starting on each local day (14 days); prev = same weekday last week.
--   renewal rate (pay per session: renewal = repurchase), see app.exec_renewal_outcomes below.
--   sales mix: last 30 local days, lines of non-void invoices (by plan_product.kind) and completed store sales
--               (store_<category>), units and line totals with IVU (= report_sales().total_cents); top 6 + other.

-- Bilingual label of a sales-mix kind (billing product kinds, store_<category>, other).
CREATE FUNCTION app.exec_kind_label(p_kind text, p_lang text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN p_lang = 'en' THEN
    CASE p_kind
      WHEN 'membership' THEN 'Memberships' WHEN 'class_pack' THEN 'Session packs'
      WHEN 'day_pass' THEN 'Day passes' WHEN 'drop_in' THEN 'Single sessions'
      WHEN 'pt_package' THEN 'Personal training' WHEN 'addon' THEN 'Add-ons'
      WHEN 'enrollment_fee' THEN 'Enrollment fees' WHEN 'store_supplement' THEN 'Store: supplements'
      WHEN 'store_apparel' THEN 'Store: apparel' WHEN 'store_drink' THEN 'Store: drinks'
      WHEN 'store_accessory' THEN 'Store: accessories' WHEN 'store_other' THEN 'Store: other'
      ELSE 'Other' END
  ELSE
    CASE p_kind
      WHEN 'membership' THEN 'Membresías' WHEN 'class_pack' THEN 'Paquetes de sesiones'
      WHEN 'day_pass' THEN 'Pases diarios' WHEN 'drop_in' THEN 'Sesiones sueltas'
      WHEN 'pt_package' THEN 'Entrenamiento personal' WHEN 'addon' THEN 'Complementos'
      WHEN 'enrollment_fee' THEN 'Cuotas de inscripción' WHEN 'store_supplement' THEN 'Tienda: suplementos'
      WHEN 'store_apparel' THEN 'Tienda: ropa' WHEN 'store_drink' THEN 'Tienda: bebidas'
      WHEN 'store_accessory' THEN 'Tienda: accesorios' WHEN 'store_other' THEN 'Tienda: otros'
      ELSE 'Otros' END
  END
$$;

-- Renewal outcomes (pay per session: a renewal is a repurchase). Entitlements are session passes
-- (access_pass: [valid_from, valid_to)) and session credits (credit_balance: from created_at until it runs out —
-- at expires_at when credits were left, or when exhausted at the earlier of expires_at and the member's
-- credits_total-th allowed check-in since purchase [S]: credit consumption carries no date yet).
-- Overlapping entitlements of a member merge into one coverage island; the island's end is the moment the
-- member's LAST entitlement ran out. Outcome: renewed when the member's next entitlement was bought within 30 days
-- of that moment (decided at that purchase); not renewed when 30 days passed without one (decided at run-out +
-- 30 days). Run-outs whose 30-day window is still open and without a repurchase are pending and not returned.
-- Only entitlements at locations in scope count (RLS applies on top).
CREATE FUNCTION app.exec_renewal_outcomes(p_location uuid DEFAULT NULL)
RETURNS TABLE (member_id uuid, location_id uuid, timezone text, ran_out_at timestamptz, decided_at timestamptz,
               renewed boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);
  RETURN QUERY
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  cred AS (
    SELECT cb.id, cb.member_id, cb.location_id, l.timezone, cb.created_at, cb.expires_at, cb.credits_total,
           cb.credits_remaining
      FROM app.credit_balance cb JOIN loc l ON l.id = cb.location_id),
  -- The credits_total-th allowed check-in of the member since each exhausted balance was bought.
  used_up AS (
    SELECT u.id, u.at
      FROM (SELECT cr.id, cr.credits_total, c.at,
                   row_number() OVER (PARTITION BY cr.id ORDER BY c.at) AS rn
              FROM cred cr
              JOIN app.check_in c ON c.member_id = cr.member_id AND c.result = 'allowed' AND c.at >= cr.created_at
             WHERE cr.credits_remaining = 0) u
     WHERE u.rn = u.credits_total),
  ent AS (
    SELECT ap.member_id AS mid, ap.location_id AS lid, l.timezone AS tz, ap.valid_from AS bought, ap.valid_to AS ended
      FROM app.access_pass ap JOIN loc l ON l.id = ap.location_id
    UNION ALL
    SELECT cr.member_id, cr.location_id, cr.timezone, cr.created_at,
           coalesce(CASE WHEN cr.credits_remaining > 0 THEN cr.expires_at ELSE least(cr.expires_at, uu.at) END,
                    'infinity'::timestamptz)
      FROM cred cr LEFT JOIN used_up uu ON uu.id = cr.id),
  ord AS (
    SELECT e.*, max(e.ended) OVER (PARTITION BY e.mid ORDER BY e.bought, e.ended
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_end
      FROM ent e),
  isl AS (
    SELECT o.*, sum(CASE WHEN o.prev_end IS NULL OR o.bought > o.prev_end THEN 1 ELSE 0 END)
                  OVER (PARTITION BY o.mid ORDER BY o.bought, o.ended ROWS UNBOUNDED PRECEDING) AS island
      FROM ord o),
  islands AS (
    SELECT i.mid, i.island, min(i.bought) AS started, max(i.ended) AS ended,
           (array_agg(i.lid ORDER BY i.ended DESC, i.lid))[1] AS lid,
           (array_agg(i.tz ORDER BY i.ended DESC, i.lid))[1] AS tz
      FROM isl i GROUP BY i.mid, i.island),
  seq AS (
    SELECT s.*, lead(s.started) OVER (PARTITION BY s.mid ORDER BY s.island) AS next_start FROM islands s)
  SELECT q.mid, q.lid, q.tz, q.ended,
         CASE WHEN q.next_start <= q.ended + interval '30 days' THEN q.next_start ELSE q.ended + interval '30 days' END,
         coalesce(q.next_start <= q.ended + interval '30 days', false)
    FROM seq q
   WHERE q.ended <= now()
     AND (q.next_start <= q.ended + interval '30 days' OR q.ended + interval '30 days' <= now());
END $$;

CREATE FUNCTION app.report_executive(p_location uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
DECLARE
  c_tz constant text := 'America/Puerto_Rico';
  v_today date;
  v_first date;     -- first day of the oldest month on the 12-month grid
  v_since timestamptz;  -- loose lower bound for timestamp scans (exact bucketing is done in local time)
  v_months text[];
  v_rev bigint[];
  v_exp bigint[];
  v_net bigint[] := '{}';
  v_pm_start date;      -- first day of last month (local)
  v_pm_end date;        -- same day-of-month last month (clamped to its last day): month-to-date comparison
  v_rev_pmtd bigint;
  v_exp_pmtd bigint;
  v_act bigint[];
  v_chk bigint[];
  v_cls bigint[];
  v_ren numeric[];
  v_ren_now numeric;
  v_ren_prev numeric;
  v_flow jsonb;
  v_status jsonb;
  v_mix jsonb;
  i integer;
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);

  v_today := app.rpt_local(now(), c_tz)::date;
  v_first := (date_trunc('month', v_today) - interval '11 months')::date;
  v_since := (v_first - 2)::timestamp AT TIME ZONE 'UTC';

  SELECT array_agg(to_char(v_first + make_interval(months => k), 'YYYY-MM') ORDER BY k) INTO v_months
    FROM generate_series(0, 11) AS k;

  -- Revenue and expenses per local month, restricted to the locations in scope (RLS applies on top).
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  mon AS (SELECT k, (v_first + make_interval(months => k))::date AS m FROM generate_series(0, 11) AS k),
  cash AS (
    SELECT date_trunc('month', app.rpt_local(p.received_at, l.timezone))::date AS m, p.amount_cents::bigint AS c
      FROM app.payment p JOIN loc l ON l.id = p.location_id
     WHERE p.status = 'succeeded' AND p.received_at >= v_since
    UNION ALL
    SELECT date_trunc('month', app.rpt_local(s.completed_at, l.timezone))::date, s.total_cents::bigint
      FROM app.sale s JOIN loc l ON l.id = s.location_id
     WHERE s.status IN ('completed', 'refunded') AND s.completed_at >= v_since
    UNION ALL
    SELECT date_trunc('month', app.rpt_local(s.refunded_at, l.timezone))::date, -s.total_cents::bigint
      FROM app.sale s JOIN loc l ON l.id = s.location_id
     WHERE s.status = 'refunded' AND s.refunded_at >= v_since),
  cost AS (
    SELECT date_trunc('month', e.spent_on)::date AS m, e.amount_cents::bigint AS c
      FROM app.expense e JOIN loc l ON l.id = e.location_id
     WHERE e.voided_at IS NULL AND e.spent_on >= v_first
    UNION ALL
    SELECT date_trunc('month', b.issued_on)::date, b.amount_cents::bigint
      FROM app.bill b JOIN loc l ON l.id = b.location_id
     WHERE b.status IN ('approved', 'paid') AND b.issued_on >= v_first),
  cash_m AS (SELECT m, sum(c) AS c FROM cash GROUP BY m),
  cost_m AS (SELECT m, sum(c) AS c FROM cost GROUP BY m)
  SELECT array_agg(coalesce(cash_m.c, 0)::bigint ORDER BY mon.k),
         array_agg(coalesce(cost_m.c, 0)::bigint ORDER BY mon.k)
    INTO v_rev, v_exp
    FROM mon LEFT JOIN cash_m ON cash_m.m = mon.m LEFT JOIN cost_m ON cost_m.m = mon.m;
  FOR i IN 1 .. 12 LOOP
    v_net := v_net || (v_rev[i] - v_exp[i]);
  END LOOP;

  -- The current month is month-to-date, so its "prev" is last month over the same days (1st .. same day-of-month,
  -- clamped to last month's length), never last month's full total: Nov 1–2 is compared with Oct 1–2.
  v_pm_start := (date_trunc('month', v_today) - interval '1 month')::date;
  v_pm_end := least(v_pm_start + (v_today - date_trunc('month', v_today)::date),
                    (date_trunc('month', v_today) - interval '1 day')::date);
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  cash AS (
    SELECT app.rpt_local(p.received_at, l.timezone)::date AS d, p.amount_cents::bigint AS c
      FROM app.payment p JOIN loc l ON l.id = p.location_id
     WHERE p.status = 'succeeded' AND p.received_at >= v_since
    UNION ALL
    SELECT app.rpt_local(s.completed_at, l.timezone)::date, s.total_cents::bigint
      FROM app.sale s JOIN loc l ON l.id = s.location_id
     WHERE s.status IN ('completed', 'refunded') AND s.completed_at >= v_since
    UNION ALL
    SELECT app.rpt_local(s.refunded_at, l.timezone)::date, -s.total_cents::bigint
      FROM app.sale s JOIN loc l ON l.id = s.location_id
     WHERE s.status = 'refunded' AND s.refunded_at >= v_since),
  cost AS (
    SELECT e.spent_on AS d, e.amount_cents::bigint AS c
      FROM app.expense e JOIN loc l ON l.id = e.location_id
     WHERE e.voided_at IS NULL AND e.spent_on >= v_pm_start
    UNION ALL
    SELECT b.issued_on, b.amount_cents::bigint
      FROM app.bill b JOIN loc l ON l.id = b.location_id
     WHERE b.status IN ('approved', 'paid') AND b.issued_on >= v_pm_start)
  SELECT (SELECT coalesce(sum(c), 0) FROM cash WHERE d BETWEEN v_pm_start AND v_pm_end),
         (SELECT coalesce(sum(c), 0) FROM cost WHERE d BETWEEN v_pm_start AND v_pm_end)
    INTO v_rev_pmtd, v_exp_pmtd;

  -- Active members at each month end (last point = now). Member RLS: home location in scope.
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  mem AS (
    SELECT m.id, m.status, app.rpt_local(m.created_at, l.timezone) AS joined,
           CASE WHEN m.status = 'cancelled' THEN coalesce(
             (SELECT max(app.rpt_local(s.cancelled_at, l.timezone)) FROM app.subscription s
               WHERE s.member_id = m.id AND s.status = 'cancelled'),
             app.rpt_local(m.created_at, l.timezone)) END AS ended
      FROM app.member m JOIN loc l ON l.id = m.home_location_id),
  ends AS (SELECT k, (v_first + make_interval(months => k + 1))::date AS e FROM generate_series(0, 11) AS k)
  SELECT array_agg(CASE WHEN ends.k = 11 THEN
             (SELECT count(*) FROM mem WHERE mem.status = 'active')
           ELSE
             (SELECT count(*) FROM mem
               WHERE mem.status NOT IN ('lead', 'trial')
                 AND mem.joined < ends.e
                 AND (mem.ended IS NULL OR mem.ended >= ends.e)
                 AND NOT EXISTS (SELECT 1 FROM app.subscription_freeze f
                                  WHERE f.member_id = mem.id AND f.start_date <= ends.e - 1 AND f.end_date > ends.e - 1))
           END::bigint ORDER BY ends.k)
    INTO v_act
    FROM ends;

  -- Allowed check-ins per local day, last 14 days ending today.
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  hits AS (
    SELECT app.rpt_local(c.at, l.timezone)::date AS d, count(*) AS n
      FROM app.check_in c JOIN loc l ON l.id = c.location_id
     WHERE c.result = 'allowed' AND c.at >= (v_today - 16)::timestamp AT TIME ZONE 'UTC'
     GROUP BY 1)
  SELECT array_agg(coalesce(hits.n, 0)::bigint ORDER BY g.k)
    INTO v_chk
    FROM generate_series(0, 13) AS g(k)
    LEFT JOIN hits ON hits.d = v_today - 13 + g.k;

  -- Class sessions (not cancelled) starting on each local day, last 14 days ending today.
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  cls AS (
    SELECT app.rpt_local(cs.starts_at, l.timezone)::date AS d, count(*) AS n
      FROM app.class_session cs JOIN loc l ON l.id = cs.location_id
     WHERE NOT cs.cancelled AND cs.starts_at >= (v_today - 15)::timestamp AT TIME ZONE 'UTC'
       AND cs.starts_at < (v_today + 2)::timestamp AT TIME ZONE 'UTC'
     GROUP BY 1)
  SELECT array_agg(coalesce(cls.n, 0)::bigint ORDER BY g.k)
    INTO v_cls
    FROM generate_series(0, 13) AS g(k)
    LEFT JOIN cls ON cls.d = v_today - 13 + g.k;

  -- Renewal rate: members whose renewal outcome was decided in the period (each member once, by their latest
  -- outcome in it); renewed ÷ decided × 100, one decimal, NULL when nobody's outcome was decided.
  WITH o AS (SELECT * FROM app.exec_renewal_outcomes(p_location)),
  per AS (
    SELECT 'now' AS p, o.* FROM o WHERE o.decided_at > now() - interval '30 days' AND o.decided_at <= now()
    UNION ALL
    SELECT 'prev', o.* FROM o
     WHERE o.decided_at > now() - interval '60 days' AND o.decided_at <= now() - interval '30 days'
    UNION ALL
    SELECT to_char(app.rpt_local(o.decided_at, o.timezone), 'YYYY-MM'), o.* FROM o
     WHERE o.decided_at >= v_since),
  latest AS (
    SELECT DISTINCT ON (per.p, per.member_id) per.p, per.renewed
      FROM per ORDER BY per.p, per.member_id, per.decided_at DESC),
  rate AS (
    SELECT latest.p, round(100.0 * count(*) FILTER (WHERE latest.renewed) / count(*), 1) AS pct
      FROM latest GROUP BY latest.p)
  SELECT (SELECT pct FROM rate WHERE p = 'now'), (SELECT pct FROM rate WHERE p = 'prev'),
         (SELECT array_agg(r.pct ORDER BY g.k) FROM generate_series(1, 12) AS g(k)
            LEFT JOIN rate r ON r.p = v_months[g.k])
    INTO v_ren_now, v_ren_prev, v_ren;

  -- Joins and cancellations: exactly the members report (0014).
  SELECT jsonb_agg(jsonb_build_object('month', to_char(f.month, 'YYYY-MM'), 'joins', f.joins,
                                      'cancellations', f.cancellations) ORDER BY f.month)
    INTO v_flow
    FROM app.report_member_flow(p_location, 12) f;

  -- Status donut: exactly the members-by-status report (0014).
  SELECT jsonb_build_object(
           'active', coalesce(sum(s.members) FILTER (WHERE s.status = 'active'), 0),
           'expired', coalesce(sum(s.members) FILTER (WHERE s.status = 'cancelled'), 0),
           'frozen', coalesce(sum(s.members) FILTER (WHERE s.status = 'frozen'), 0),
           'other', coalesce(sum(s.members) FILTER (WHERE s.status NOT IN ('active', 'cancelled', 'frozen')), 0))
    INTO v_status
    FROM app.report_member_status(p_location) s;

  -- Sales mix, last 30 local days (same lines as report_sales).
  WITH loc AS (
    SELECT l.id, l.timezone FROM app.location l
     WHERE l.org_id = app.org_id() AND app.can_see_location(l.id) AND (p_location IS NULL OR l.id = p_location)),
  lines AS (
    SELECT pp.kind::text AS kind, il.quantity::bigint AS units,
           (il.amount_cents + il.ivu_state_cents + il.ivu_municipal_cents)::bigint AS rev
      FROM app.invoice i
      JOIN loc l ON l.id = i.location_id
      JOIN app.invoice_line il ON il.invoice_id = i.id
      JOIN app.plan_product pp ON pp.id = il.product_id
     WHERE i.status <> 'void' AND i.issued_at >= (v_today - 31)::timestamp AT TIME ZONE 'UTC'
       AND app.rpt_local(i.issued_at, l.timezone)::date BETWEEN v_today - 29 AND v_today
    UNION ALL
    SELECT 'store_' || p.category::text, sl.qty::bigint, sl.total_cents::bigint
      FROM app.sale s
      JOIN loc l ON l.id = s.location_id
      JOIN app.sale_line sl ON sl.sale_id = s.id
      JOIN app.product p ON p.id = sl.product_id
     WHERE s.status = 'completed' AND s.completed_at >= (v_today - 31)::timestamp AT TIME ZONE 'UTC'
       AND app.rpt_local(s.completed_at, l.timezone)::date BETWEEN v_today - 29 AND v_today),
  agg AS (SELECT kind, sum(units) AS units, sum(rev) AS rev FROM lines GROUP BY kind),
  ranked AS (SELECT agg.*, row_number() OVER (ORDER BY rev DESC, kind) AS rn FROM agg),
  grouped AS (
    SELECT CASE WHEN rn <= 6 THEN kind ELSE 'other' END AS kind, min(rn) AS ord, sum(units) AS units,
           sum(rev) AS rev
      FROM ranked GROUP BY 1)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'label_es', app.exec_kind_label(kind, 'es'), 'label_en', app.exec_kind_label(kind, 'en'),
           'units', units::bigint, 'revenue_cents', rev::bigint) ORDER BY ord), '[]'::jsonb)
    INTO v_mix
    FROM grouped;

  RETURN jsonb_build_object(
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'currency', 'USD',
    'months', to_jsonb(v_months),
    'kpis', jsonb_build_object(
      'revenue_month_cents', jsonb_build_object('value', v_rev[12], 'prev', v_rev_pmtd, 'series', to_jsonb(v_rev)),
      'active_members', jsonb_build_object('value', v_act[12], 'prev', v_act[11], 'series', to_jsonb(v_act)),
      'net_profit_month_cents', jsonb_build_object('value', v_net[12], 'prev', v_rev_pmtd - v_exp_pmtd,
                                                   'series', to_jsonb(v_net)),
      'checkins_today', jsonb_build_object('value', v_chk[14], 'prev', v_chk[7], 'series', to_jsonb(v_chk)),
      'classes_today', jsonb_build_object('value', v_cls[14], 'prev', v_cls[7], 'series', to_jsonb(v_cls)),
      'renewal_rate_pct', jsonb_build_object('value', v_ren_now, 'prev', v_ren_prev, 'series', to_jsonb(v_ren))),
    'revenue_vs_expenses', (
      SELECT jsonb_agg(jsonb_build_object('month', v_months[k], 'revenue_cents', v_rev[k],
                                          'expenses_cents', v_exp[k]) ORDER BY k)
        FROM generate_series(1, 12) AS k),
    'new_members', coalesce(v_flow, '[]'::jsonb),
    'member_status', v_status,
    'sales_mix', v_mix);
END $$;

-- Invoker read model: callable by request traffic, where rpt_guard and RLS decide what it returns.
REVOKE ALL ON FUNCTION app.exec_kind_label(text, text), app.exec_renewal_outcomes(uuid), app.report_executive(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.exec_kind_label(text, text), app.exec_renewal_outcomes(uuid), app.report_executive(uuid)
  TO app_authenticated;
