-- Module reports (Panel y reportes) · spec E13 + v0.5 panel details (peak-hours heatmap, overdue balances,
-- expiring memberships/credits, quick check-in). Owned by the reports module agent; see docs/modules.md.
--
-- Design: every report is a read model computed by a SECURITY INVOKER function, so it runs under the caller's
-- RLS on the underlying module tables (billing 0006, schedule 0007, crm 0008, store 0009, engagement 0012). A
-- number on the panel is therefore exactly what the caller could count by hand in those tables; nothing here
-- widens visibility. On top of RLS each function re-checks the caller's role (who may see which report) and the
-- requested location (same 42501 whether the location is missing, in another org or outside the caller's scope).
-- Revenue figures are only in the owner / location-manager panel and the financial reports; the front-desk
-- "Hoy" read model carries no money except the balance a member owes at the desk.
--
-- Time: "today", "this week" (ISO, Monday start) and "this month" are evaluated in each row's location time zone.
-- IVU: totals come from the per-line amounts that billing and store already computed (10.5 % state + 1 %
-- municipal rounded per line [VERIFICAR · CPA]); this module never recomputes tax.
--
-- The only table is `ivu_municipality`: the owner's record of whether a municipality files its municipal IVU
-- through SURI with the state return (SC 2915) or follows its own process. Absent row = "unverified", which the
-- report flags exactly like a non-participant [VERIFICAR · SC 2915 format, CPA].

CREATE TYPE app.ivu_suri_status AS ENUM ('participant', 'non_participant');

CREATE TABLE app.ivu_municipality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  municipality text NOT NULL CHECK (municipality ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü .''-]{1,59}$'),
  suri_status app.ivu_suri_status NOT NULL,
  note text CHECK (length(note) BETWEEN 1 AND 300 AND note !~ '[[:cntrl:]]'),
  updated_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX ivu_municipality_org_name_uq ON app.ivu_municipality (org_id, lower(municipality));

-- ── Guards and helpers ───────────────────────────────────────────────────────────────────────────────────

-- Role and location gate shared by every report. Invoker rights: the location probe runs under location RLS,
-- so a location of another organisation, an unassigned one and a non-existent one are indistinguishable.
CREATE FUNCTION app.rpt_guard(p_roles app.role_name[], p_location uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR app.role() IS NULL OR NOT (app.role() = ANY (p_roles)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.location l
        WHERE l.id = p_location AND l.org_id = app.org_id() AND app.can_see_location(l.id)) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
END $$;

-- Local wall-clock time at a location's time zone.
CREATE FUNCTION app.rpt_local(p_at timestamptz, p_tz text) RETURNS timestamp
LANGUAGE sql STABLE AS $$ SELECT p_at AT TIME ZONE coalesce(p_tz, 'America/Puerto_Rico') $$;

-- Outstanding balance of an invoice as the caller sees it: total minus succeeded payments.
CREATE FUNCTION app.rpt_invoice_balance(p_invoice uuid, p_total integer) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT p_total - coalesce((SELECT sum(p.amount_cents) FROM app.payment p
                              WHERE p.invoice_id = p_invoice AND p.status = 'succeeded'), 0)
$$;

-- ── Panel (owner / location manager) ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION app.report_dashboard(p_location uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
DECLARE
  v jsonb := '{}'::jsonb;
  r record;
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);

  -- Members (member RLS: home location in scope).
  SELECT count(*) FILTER (WHERE m.status = 'active') AS active,
         count(*) FILTER (WHERE app.rpt_local(m.created_at, l.timezone)
                                >= date_trunc('month', app.rpt_local(now(), l.timezone))) AS new_month
    INTO r
    FROM app.member m JOIN app.location l ON l.id = m.home_location_id
   WHERE p_location IS NULL OR m.home_location_id = p_location;
  v := v || jsonb_build_object('members_active', r.active, 'members_new_month', r.new_month);

  -- Cancellations: members whose subscription was cancelled this month (subscription RLS).
  SELECT count(DISTINCT s.member_id) AS n INTO r
    FROM app.subscription s JOIN app.location l ON l.id = s.location_id
   WHERE s.status = 'cancelled'
     AND app.rpt_local(s.cancelled_at, l.timezone) >= date_trunc('month', app.rpt_local(now(), l.timezone))
     AND (p_location IS NULL OR s.location_id = p_location);
  v := v || jsonb_build_object('members_cancelled_month', r.n);

  -- Allowed check-ins today and this ISO week (check_in RLS: front of house at the location).
  SELECT count(*) FILTER (WHERE app.rpt_local(c.at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date) AS today,
         count(DISTINCT c.member_id) FILTER (
           WHERE app.rpt_local(c.at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date) AS members_today,
         count(*) FILTER (WHERE app.rpt_local(c.at, l.timezone)
                                >= date_trunc('week', app.rpt_local(now(), l.timezone))) AS week
    INTO r
    FROM app.check_in c JOIN app.location l ON l.id = c.location_id
   WHERE c.result = 'allowed' AND (p_location IS NULL OR c.location_id = p_location);
  v := v || jsonb_build_object('check_ins_today', r.today, 'check_ins_members_today', r.members_today,
                               'check_ins_week', r.week);

  -- Class occupancy this ISO week: occupied seats (booked, attended, no-show) over capacity of live sessions.
  SELECT coalesce(sum(s.capacity), 0) AS capacity,
         coalesce(sum((SELECT count(*) FROM app.booking b
                        WHERE b.session_id = s.id AND b.status IN ('booked', 'attended', 'no_show'))), 0) AS occupied,
         count(*) AS sessions
    INTO r
    FROM app.class_session s JOIN app.location l ON l.id = s.location_id
   WHERE NOT s.cancelled
     AND app.rpt_local(s.starts_at, l.timezone) >= date_trunc('week', app.rpt_local(now(), l.timezone))
     AND app.rpt_local(s.starts_at, l.timezone) < date_trunc('week', app.rpt_local(now(), l.timezone)) + interval '7 days'
     AND (p_location IS NULL OR s.location_id = p_location);
  v := v || jsonb_build_object('classes_week', r.sessions, 'class_seats_week', r.capacity,
                               'class_booked_week', r.occupied,
                               'class_occupancy_pct', CASE WHEN r.capacity > 0
                                 THEN round(100.0 * r.occupied / r.capacity, 1) END);

  -- Sales today (billing): non-void invoices issued today; session units = per-session products sold.
  SELECT count(*) AS invoices, coalesce(sum(i.total_cents), 0) AS total,
         coalesce(sum((SELECT sum(il.quantity) FROM app.invoice_line il JOIN app.plan_product pp ON pp.id = il.product_id
                        WHERE il.invoice_id = i.id
                          AND pp.kind IN ('drop_in', 'day_pass', 'class_pack', 'pt_package'))), 0) AS sessions
    INTO r
    FROM app.invoice i JOIN app.location l ON l.id = i.location_id
   WHERE i.status <> 'void'
     AND app.rpt_local(i.issued_at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR i.location_id = p_location);
  v := v || jsonb_build_object('invoices_today', r.invoices, 'invoiced_today_cents', r.total,
                               'sessions_sold_today', r.sessions);

  SELECT coalesce(sum(p.amount_cents), 0) AS collected INTO r
    FROM app.payment p JOIN app.location l ON l.id = p.location_id
   WHERE p.status = 'succeeded'
     AND app.rpt_local(p.received_at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR p.location_id = p_location);
  v := v || jsonb_build_object('collected_today_cents', r.collected);

  SELECT coalesce(sum(s.total_cents), 0) AS total, count(*) AS n INTO r
    FROM app.sale s JOIN app.location l ON l.id = s.location_id
   WHERE s.status = 'completed'
     AND app.rpt_local(s.completed_at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR s.location_id = p_location);
  v := v || jsonb_build_object('store_sales_today', r.n, 'store_sales_today_cents', r.total);

  -- Overdue balances: open invoices past their due date (location's local date).
  SELECT count(*) AS invoices, count(DISTINCT x.member_id) AS members, coalesce(sum(x.balance), 0) AS balance
    INTO r
    FROM (SELECT i.member_id, app.rpt_invoice_balance(i.id, i.total_cents) AS balance
            FROM app.invoice i JOIN app.location l ON l.id = i.location_id
           WHERE i.status = 'open' AND i.due_date < app.rpt_local(now(), l.timezone)::date
             AND (p_location IS NULL OR i.location_id = p_location)) x;
  v := v || jsonb_build_object('overdue_invoices', r.invoices, 'overdue_members', r.members,
                               'overdue_balance_cents', r.balance);

  -- Expiring in the next 7 days: credits with sessions left, passes, memberships ending at period end.
  SELECT
    (SELECT count(*) FROM app.credit_balance cb
      WHERE cb.credits_remaining > 0 AND cb.expires_at >= now() AND cb.expires_at < now() + interval '7 days'
        AND (p_location IS NULL OR cb.location_id = p_location)) AS credits,
    (SELECT count(*) FROM app.access_pass ap
      WHERE ap.valid_to >= now() AND ap.valid_to < now() + interval '7 days'
        AND (p_location IS NULL OR ap.location_id = p_location)) AS passes,
    (SELECT count(*) FROM app.subscription s JOIN app.location l ON l.id = s.location_id
      WHERE s.status <> 'cancelled' AND s.cancel_at_period_end
        AND greatest(s.current_period_end, coalesce(s.commitment_end, s.current_period_end))
            BETWEEN app.rpt_local(now(), l.timezone)::date AND app.rpt_local(now(), l.timezone)::date + 7
        AND (p_location IS NULL OR s.location_id = p_location)) AS memberships
    INTO r;
  v := v || jsonb_build_object('expiring_credits_7d', r.credits, 'expiring_passes_7d', r.passes,
                               'expiring_memberships_7d', r.memberships);

  -- CRM: open leads; this month's cohort and its conversion (same rule as app.crm_funnel).
  SELECT count(*) FILTER (WHERE ld.stage NOT IN ('won', 'lost')) AS open,
         count(*) FILTER (WHERE app.rpt_local(ld.created_at, l.timezone)
                                >= date_trunc('month', app.rpt_local(now(), l.timezone))) AS new_month,
         count(*) FILTER (WHERE ld.stage = 'won' AND app.rpt_local(ld.created_at, l.timezone)
                                >= date_trunc('month', app.rpt_local(now(), l.timezone))) AS won_cohort,
         count(*) FILTER (WHERE ld.stage = 'won' AND app.rpt_local(ld.stage_changed_at, l.timezone)
                                >= date_trunc('month', app.rpt_local(now(), l.timezone))) AS won_month
    INTO r
    FROM app.lead ld JOIN app.location l ON l.id = ld.location_id
   WHERE p_location IS NULL OR ld.location_id = p_location;
  v := v || jsonb_build_object('leads_open', r.open, 'leads_new_month', r.new_month, 'leads_won_month', r.won_month,
                               'lead_conversion_pct_month', CASE WHEN r.new_month > 0
                                 THEN round(100.0 * r.won_cohort / r.new_month, 1) END);

  -- Store: low stock exactly as the store module defines it (available ≤ reorder point).
  SELECT count(*) AS n INTO r FROM app.inventory_level i
   WHERE i.on_hand - i.reserved <= i.reorder_point AND (p_location IS NULL OR i.location_id = p_location);
  v := v || jsonb_build_object('low_stock_products', r.n);

  -- Points liability (engagement): organisation-wide, owner only (the accountant reads it in engagement).
  IF app.role() = 'owner' THEN
    SELECT outstanding_points, members_with_balance INTO r FROM app.points_liability();
    v := v || jsonb_build_object('points_liability', r.outstanding_points,
                                 'points_members_with_balance', r.members_with_balance);
  END IF;

  RETURN v || jsonb_build_object('location_id', p_location, 'generated_at', now());
END $$;

-- Open invoices past due, with the member and the outstanding balance. Front desk included: collecting at the
-- desk is their job (the balance owed is not a revenue figure).
CREATE FUNCTION app.report_overdue(p_location uuid DEFAULT NULL)
RETURNS TABLE (invoice_id uuid, number bigint, member_id uuid, full_name text, member_no text, location_id uuid,
               due_date date, days_overdue integer, balance_cents bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager', 'front_desk']::app.role_name[], p_location);
  RETURN QUERY
  SELECT i.id, i.number, i.member_id, m.full_name, m.member_no, i.location_id, i.due_date,
         (app.rpt_local(now(), l.timezone)::date - i.due_date)::integer,
         app.rpt_invoice_balance(i.id, i.total_cents)
    FROM app.invoice i
    JOIN app.location l ON l.id = i.location_id
    LEFT JOIN app.member m ON m.id = i.member_id  -- member RLS: a member homed elsewhere shows without a name
   WHERE i.status = 'open' AND i.due_date < app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR i.location_id = p_location)
   ORDER BY i.due_date, i.number;
END $$;

-- What expires in the next p_days (1–31): credits with sessions left, passes, memberships ending.
CREATE FUNCTION app.report_expiring(p_location uuid DEFAULT NULL, p_days integer DEFAULT 7)
RETURNS TABLE (kind text, ref_id uuid, member_id uuid, full_name text, location_id uuid, expires_at timestamptz,
               credits_remaining integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT x.kind, x.ref_id, x.member_id, m.full_name, x.location_id, x.expires_at, x.credits_remaining
    FROM (
      SELECT 'credits'::text AS kind, cb.id AS ref_id, cb.member_id, cb.location_id, cb.expires_at,
             cb.credits_remaining
        FROM app.credit_balance cb
       WHERE cb.credits_remaining > 0 AND cb.expires_at >= now() AND cb.expires_at < now() + make_interval(days => p_days)
      UNION ALL
      SELECT 'pass', ap.id, ap.member_id, ap.location_id, ap.valid_to, NULL::integer
        FROM app.access_pass ap
       WHERE ap.valid_to >= now() AND ap.valid_to < now() + make_interval(days => p_days)
      UNION ALL
      SELECT 'membership', s.id, s.member_id, s.location_id,
             (greatest(s.current_period_end, coalesce(s.commitment_end, s.current_period_end))::timestamp
               AT TIME ZONE l.timezone),
             NULL::integer
        FROM app.subscription s JOIN app.location l ON l.id = s.location_id
       WHERE s.status <> 'cancelled' AND s.cancel_at_period_end
         AND greatest(s.current_period_end, coalesce(s.commitment_end, s.current_period_end))
             BETWEEN app.rpt_local(now(), l.timezone)::date AND app.rpt_local(now(), l.timezone)::date + p_days
    ) x
    LEFT JOIN app.member m ON m.id = x.member_id
   WHERE p_location IS NULL OR x.location_id = p_location
   ORDER BY x.expires_at, x.kind;
END $$;

-- Peak hours: allowed check-ins of the last p_weeks (4 or 8) by ISO day of week (1 = Monday) × local hour.
-- Always the full 7 × 24 grid, zeros included.
CREATE FUNCTION app.report_heatmap(p_location uuid DEFAULT NULL, p_weeks integer DEFAULT 4)
RETURNS TABLE (dow integer, hour integer, check_ins bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);
  IF p_weeks IS NULL OR p_weeks NOT IN (4, 8) THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH hits AS (
    SELECT extract(isodow FROM app.rpt_local(c.at, l.timezone))::integer AS d,
           extract(hour FROM app.rpt_local(c.at, l.timezone))::integer AS h
      FROM app.check_in c JOIN app.location l ON l.id = c.location_id
     WHERE c.result = 'allowed' AND c.at >= now() - make_interval(weeks => p_weeks) AND c.at <= now()
       AND (p_location IS NULL OR c.location_id = p_location))
  SELECT g.d, gh.h, count(hits.d)
    FROM generate_series(1, 7) AS g(d)
    CROSS JOIN generate_series(0, 23) AS gh(h)
    LEFT JOIN hits ON hits.d = g.d AND hits.h = gh.h
   GROUP BY g.d, gh.h
   ORDER BY 1, 2;
END $$;

-- Front desk "Hoy": no revenue figures. Check-ins today, today's classes, overdue members at the desk.
CREATE FUNCTION app.report_today(p_location uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
DECLARE
  v jsonb;
  r record;
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager', 'front_desk']::app.role_name[], p_location);
  SELECT count(*) AS n, count(DISTINCT c.member_id) AS members,
         count(*) FILTER (WHERE c.result = 'denied') AS denied
    INTO r
    FROM app.check_in c JOIN app.location l ON l.id = c.location_id
   WHERE app.rpt_local(c.at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR c.location_id = p_location);
  v := jsonb_build_object('check_ins_today', r.n - r.denied, 'check_ins_members_today', r.members,
                          'check_ins_denied_today', r.denied);
  SELECT count(DISTINCT i.member_id) AS members, count(*) AS invoices INTO r
    FROM app.invoice i JOIN app.location l ON l.id = i.location_id
   WHERE i.status = 'open' AND i.due_date < app.rpt_local(now(), l.timezone)::date
     AND (p_location IS NULL OR i.location_id = p_location);
  v := v || jsonb_build_object('overdue_members', r.members, 'overdue_invoices', r.invoices);
  v := v || jsonb_build_object('classes_today', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'session_id', s.id, 'location_id', s.location_id, 'class_name', ct.name, 'room', s.room,
             'starts_at', s.starts_at, 'ends_at', s.ends_at, 'capacity', s.capacity,
             'booked', (SELECT count(*) FROM app.booking b WHERE b.session_id = s.id
                         AND b.status IN ('booked', 'attended', 'no_show')),
             'waitlisted', (SELECT count(*) FROM app.booking b WHERE b.session_id = s.id AND b.status = 'waitlisted'))
           ORDER BY s.starts_at)
      FROM app.class_session s
      JOIN app.location l ON l.id = s.location_id
      JOIN app.class_type ct ON ct.id = s.class_type_id
     WHERE NOT s.cancelled
       AND app.rpt_local(s.starts_at, l.timezone)::date = app.rpt_local(now(), l.timezone)::date
       AND (p_location IS NULL OR s.location_id = p_location)), '[]'::jsonb));
  RETURN v || jsonb_build_object('location_id', p_location, 'generated_at', now());
END $$;

-- ── Financial and operational reports ────────────────────────────────────────────────────────────────────

-- IVU for one calendar month (local date of each document's location), by municipality and source.
--   billing:      non-void invoices issued in the month (their municipality was copied at issue time).
--   store:        POS/online sales completed in the month (refunded later or not), municipality of the location.
--   store_refund: refunds made in the month, as negative amounts [VERIFICAR · CPA: credit-note treatment].
-- suri_status: participant / non_participant from ivu_municipality; 'unverified' when the owner has not recorded it.
CREATE FUNCTION app.report_ivu(p_month date, p_location uuid DEFAULT NULL)
RETURNS TABLE (municipality text, suri_status text, source text, documents bigint, taxable_base_cents bigint,
               exempt_base_cents bigint, ivu_state_cents bigint, ivu_municipal_cents bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
DECLARE
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager', 'accountant']::app.role_name[], p_location);
  IF p_month IS NULL OR p_month < DATE '2000-01-01' OR p_month > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH docs AS (
    SELECT coalesce(i.municipality, l.municipality, '') AS muni, 'billing'::text AS src, i.id AS doc,
           il.tax_category = 'taxable' AS taxable, il.amount_cents::bigint AS base,
           il.ivu_state_cents::bigint AS st, il.ivu_municipal_cents::bigint AS mu
      FROM app.invoice i
      JOIN app.location l ON l.id = i.location_id
      JOIN app.invoice_line il ON il.invoice_id = i.id
     WHERE i.status <> 'void'
       AND app.rpt_local(i.issued_at, l.timezone)::date >= v_from
       AND app.rpt_local(i.issued_at, l.timezone)::date < v_to
       AND (p_location IS NULL OR i.location_id = p_location)
    UNION ALL
    SELECT coalesce(l.municipality, ''), 'store', s.id, sl.taxable, sl.subtotal_cents::bigint,
           sl.ivu_state_cents::bigint, sl.ivu_municipal_cents::bigint
      FROM app.sale s
      JOIN app.location l ON l.id = s.location_id
      JOIN app.sale_line sl ON sl.sale_id = s.id
     WHERE s.status IN ('completed', 'refunded')
       AND app.rpt_local(s.completed_at, l.timezone)::date >= v_from
       AND app.rpt_local(s.completed_at, l.timezone)::date < v_to
       AND (p_location IS NULL OR s.location_id = p_location)
    UNION ALL
    SELECT coalesce(l.municipality, ''), 'store_refund', s.id, sl.taxable, -sl.subtotal_cents::bigint,
           -sl.ivu_state_cents::bigint, -sl.ivu_municipal_cents::bigint
      FROM app.sale s
      JOIN app.location l ON l.id = s.location_id
      JOIN app.sale_line sl ON sl.sale_id = s.id
     WHERE s.status = 'refunded'
       AND app.rpt_local(s.refunded_at, l.timezone)::date >= v_from
       AND app.rpt_local(s.refunded_at, l.timezone)::date < v_to
       AND (p_location IS NULL OR s.location_id = p_location))
  SELECT d.muni,
         coalesce((SELECT im.suri_status::text FROM app.ivu_municipality im
                    WHERE im.org_id = app.org_id() AND lower(im.municipality) = lower(d.muni)), 'unverified'),
         d.src, count(DISTINCT d.doc),
         coalesce(sum(d.base) FILTER (WHERE d.taxable), 0)::bigint,
         coalesce(sum(d.base) FILTER (WHERE NOT d.taxable), 0)::bigint,
         sum(d.st)::bigint, sum(d.mu)::bigint
    FROM docs d
   GROUP BY d.muni, d.src
   ORDER BY d.muni, d.src;
END $$;

-- Sales by product/plan × location × seller for a date range (≤ 366 days, local dates, inclusive).
--   billing: lines of non-void invoices issued in the range; seller = the person who issued the invoice.
--   store:   lines of completed (not refunded) sales completed in the range; seller = the person who completed it.
CREATE FUNCTION app.report_sales(p_from date, p_to date, p_location uuid DEFAULT NULL)
RETURNS TABLE (source text, location_id uuid, product_id uuid, product_name text, product_kind text,
               seller_person_id uuid, seller_name text, documents bigint, units bigint, subtotal_cents bigint,
               ivu_cents bigint, total_cents bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager', 'accountant']::app.role_name[], p_location);
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH lines AS (
    SELECT 'billing'::text AS src, i.location_id AS loc, il.product_id AS prod, pp.name AS pname,
           pp.kind::text AS pkind, i.created_by AS seller, i.id AS doc, il.quantity::bigint AS qty,
           il.amount_cents::bigint AS sub, (il.ivu_state_cents + il.ivu_municipal_cents)::bigint AS tax
      FROM app.invoice i
      JOIN app.location l ON l.id = i.location_id
      JOIN app.invoice_line il ON il.invoice_id = i.id
      JOIN app.plan_product pp ON pp.id = il.product_id
     WHERE i.status <> 'void'
       AND app.rpt_local(i.issued_at, l.timezone)::date BETWEEN p_from AND p_to
       AND (p_location IS NULL OR i.location_id = p_location)
    UNION ALL
    SELECT 'store', s.location_id, sl.product_id, p.name, p.category::text, coalesce(s.completed_by, s.created_by),
           s.id, sl.qty::bigint, sl.subtotal_cents::bigint, (sl.ivu_state_cents + sl.ivu_municipal_cents)::bigint
      FROM app.sale s
      JOIN app.location l ON l.id = s.location_id
      JOIN app.sale_line sl ON sl.sale_id = s.id
      JOIN app.product p ON p.id = sl.product_id
     WHERE s.status = 'completed'
       AND app.rpt_local(s.completed_at, l.timezone)::date BETWEEN p_from AND p_to
       AND (p_location IS NULL OR s.location_id = p_location))
  SELECT x.src, x.loc, x.prod, x.pname, x.pkind, x.seller,
         (SELECT min(sm.display_name) FROM app.staff_member sm WHERE sm.person_id = x.seller),
         count(DISTINCT x.doc), sum(x.qty)::bigint, sum(x.sub)::bigint, sum(x.tax)::bigint,
         (sum(x.sub) + sum(x.tax))::bigint
    FROM lines x
   GROUP BY x.src, x.loc, x.prod, x.pname, x.pkind, x.seller
   ORDER BY x.src, x.pname, x.loc, x.seller;
END $$;

-- Members by status (member RLS: home location in scope).
CREATE FUNCTION app.report_member_status(p_location uuid DEFAULT NULL)
RETURNS TABLE (status text, members bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);
  RETURN QUERY
  SELECT st::text, (SELECT count(*) FROM app.member m
                     WHERE m.status = st AND (p_location IS NULL OR m.home_location_id = p_location))
    FROM unnest(enum_range(NULL::app.member_status)) AS st
   ORDER BY 1;
END $$;

-- Joins (members created) and cancellations (members with a subscription cancelled) per local month,
-- for the last p_months months including the current one (1–24).
CREATE FUNCTION app.report_member_flow(p_location uuid DEFAULT NULL, p_months integer DEFAULT 12)
RETURNS TABLE (month date, joins bigint, cancellations bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.rpt_guard(ARRAY['owner', 'location_manager']::app.role_name[], p_location);
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH months AS (
    SELECT (date_trunc('month', app.rpt_local(now(), 'America/Puerto_Rico')) - make_interval(months => k))::date AS m
      FROM generate_series(0, p_months - 1) AS k),
  j AS (
    SELECT date_trunc('month', app.rpt_local(mb.created_at, l.timezone))::date AS m, count(*) AS n
      FROM app.member mb JOIN app.location l ON l.id = mb.home_location_id
     WHERE p_location IS NULL OR mb.home_location_id = p_location
     GROUP BY 1),
  c AS (
    SELECT date_trunc('month', app.rpt_local(s.cancelled_at, l.timezone))::date AS m,
           count(DISTINCT s.member_id) AS n
      FROM app.subscription s JOIN app.location l ON l.id = s.location_id
     WHERE s.status = 'cancelled' AND (p_location IS NULL OR s.location_id = p_location)
     GROUP BY 1)
  SELECT months.m, coalesce(j.n, 0)::bigint, coalesce(c.n, 0)::bigint
    FROM months LEFT JOIN j ON j.m = months.m LEFT JOIN c ON c.m = months.m
   ORDER BY months.m DESC;
END $$;

-- ── Export audit (definer) ───────────────────────────────────────────────────────────────────────────────
-- Every CSV export is audited: member lists leave the system through it. Same role gate as the report itself.
CREATE FUNCTION app.report_log_export(p_report text, p_location uuid, p_params jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_roles app.role_name[];
BEGIN
  v_roles := CASE p_report
    WHEN 'overdue' THEN ARRAY['owner', 'location_manager', 'front_desk']::app.role_name[]
    WHEN 'expiring' THEN ARRAY['owner', 'location_manager']::app.role_name[]
    WHEN 'heatmap' THEN ARRAY['owner', 'location_manager']::app.role_name[]
    WHEN 'members' THEN ARRAY['owner', 'location_manager']::app.role_name[]
    WHEN 'ivu' THEN ARRAY['owner', 'location_manager', 'accountant']::app.role_name[]
    WHEN 'sales' THEN ARRAY['owner', 'location_manager', 'accountant']::app.role_name[]
  END;
  IF v_roles IS NULL THEN RAISE EXCEPTION 'invalid_report' USING ERRCODE = '22023'; END IF;
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR app.role() IS NULL OR NOT (app.role() = ANY (v_roles)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()
          AND app.can_see_location(l.id)) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  PERFORM app.audit('report.export', 'report', p_report, p_location,
                    coalesce(p_params, '{}'::jsonb) - 'location_id');
END $$;

-- ── ivu_municipality: actor forced, every change audited ─────────────────────────────────────────────────
CREATE FUNCTION app.ivu_municipality_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  NEW.updated_by := coalesce(app.person_id(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER ivu_municipality_stamp BEFORE INSERT OR UPDATE ON app.ivu_municipality
  FOR EACH ROW EXECUTE FUNCTION app.ivu_municipality_stamp();

CREATE FUNCTION app.ivu_municipality_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NOT NULL THEN
    PERFORM app.audit(CASE TG_OP WHEN 'INSERT' THEN 'ivu_municipality.create' ELSE 'ivu_municipality.update' END,
      'ivu_municipality', NEW.id::text, NULL,
      jsonb_strip_nulls(jsonb_build_object('municipality', NEW.municipality, 'suri_status', NEW.suri_status,
        'previous', CASE WHEN TG_OP = 'UPDATE' THEN OLD.suri_status END)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ivu_municipality_audit AFTER INSERT OR UPDATE ON app.ivu_municipality
  FOR EACH ROW EXECUTE FUNCTION app.ivu_municipality_audit_trigger();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.ivu_municipality ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ivu_municipality FORCE ROW LEVEL SECURITY;

-- Read: the roles that read the IVU report. Write: the owner only (a tax-filing decision) [VERIFICAR · CPA].
CREATE POLICY ivu_municipality_select ON app.ivu_municipality FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager', 'accountant'));
CREATE POLICY ivu_municipality_insert ON app.ivu_municipality FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY ivu_municipality_update ON app.ivu_municipality FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner')
  WITH CHECK (org_id = (SELECT app.org_id()));
CREATE POLICY definer_all ON app.ivu_municipality TO app_definer USING (true) WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.ivu_municipality FROM PUBLIC;
GRANT SELECT ON app.ivu_municipality TO app_authenticated;
-- Never org_id, updated_by or updated_at (stamped by the trigger); the name is fixed once recorded.
GRANT INSERT (municipality, suri_status, note), UPDATE (suri_status, note) ON app.ivu_municipality
  TO app_authenticated;
GRANT SELECT, INSERT, UPDATE ON app.ivu_municipality TO app_definer;

ALTER FUNCTION app.report_log_export(text, uuid, jsonb) OWNER TO app_definer;
ALTER FUNCTION app.ivu_municipality_audit_trigger() OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.rpt_guard(app.role_name[], uuid), app.rpt_local(timestamptz, text),
  app.rpt_invoice_balance(uuid, integer), app.report_dashboard(uuid), app.report_overdue(uuid),
  app.report_expiring(uuid, integer), app.report_heatmap(uuid, integer), app.report_today(uuid),
  app.report_ivu(date, uuid), app.report_sales(date, date, uuid), app.report_member_status(uuid),
  app.report_member_flow(uuid, integer), app.report_log_export(text, uuid, jsonb), app.ivu_municipality_stamp(),
  app.ivu_municipality_audit_trigger()
  FROM PUBLIC;
-- Invoker read models (they run under the caller's RLS) and the audited export entry point.
GRANT EXECUTE ON FUNCTION app.rpt_guard(app.role_name[], uuid), app.rpt_local(timestamptz, text),
  app.rpt_invoice_balance(uuid, integer), app.report_dashboard(uuid), app.report_overdue(uuid),
  app.report_expiring(uuid, integer), app.report_heatmap(uuid, integer), app.report_today(uuid),
  app.report_ivu(date, uuid), app.report_sales(date, date, uuid), app.report_member_status(uuid),
  app.report_member_flow(uuid, integer), app.report_log_export(text, uuid, jsonb), app.ivu_municipality_stamp()
  TO app_authenticated;
GRANT EXECUTE ON FUNCTION app.rpt_local(timestamptz, text), app.ivu_municipality_stamp() TO app_definer;
