-- Module finance (Finanzas, gastos y cuentas por pagar) · spec §8. Owned by the finance module agent.
-- Accrual basis [P] with a cash view for reconciliation. Nothing here moves money: bills are paid OUTSIDE the
-- platform (we only record the payment), payroll is only an export (never processed), and receipts carry a note
-- (no file upload, no AI extraction yet).
-- Rules that matter:
--   * Money in integer cents.
--   * Bill approval by amount and role: a location manager decides bills of their locations up to the org threshold
--     (default $500.00, configurable per org in finance_policy [P]); above it only the owner. The approver is never the
--     person who entered the bill (segregation of duties; also a CHECK on the table).
--   * A paid or void bill is immutable for EVERY role (trigger), and an approved bill only moves to paid or void.
--   * The accountant reads everything in finance and generates exports; never writes anything else.
--   * Read models are functions (not views) so the isolation matrix keeps covering every relation with org_id.
--   * Account names, revenue recognition of packs and the QuickBooks layout are defaults [VERIFICAR · CPA].

CREATE TYPE app.bill_status AS ENUM ('pending_approval', 'approved', 'paid', 'void');
CREATE TYPE app.bill_decision AS ENUM ('approve', 'reject');
CREATE TYPE app.expense_category AS ENUM
  ('rent', 'utilities', 'payroll_export', 'supplies', 'maintenance', 'marketing', 'other');
CREATE TYPE app.commission_source AS ENUM ('sale', 'membership', 'session');
CREATE TYPE app.commission_status AS ENUM ('pending', 'approved', 'paid', 'void');

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────────────────

-- One row per org (optional): the approval threshold of location managers. Missing row = built-in default.
CREATE TABLE app.finance_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  manager_approval_max_cents integer NOT NULL DEFAULT 50000 CHECK (manager_approval_max_cents BETWEEN 0 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id),
  UNIQUE (org_id, id)
);

CREATE TABLE app.vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]' AND name = btrim(name)),
  contact_email text CHECK (length(contact_email) <= 254 AND contact_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX vendor_name_uq ON app.vendor (org_id, lower(name));

-- Vendor bill (accounts payable). Entered by owner / location manager, decided by someone else, paid outside.
CREATE TABLE app.bill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  vendor_id uuid NOT NULL,
  location_id uuid NOT NULL,
  number text NOT NULL CHECK (number ~ '^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$'),
  category app.expense_category NOT NULL DEFAULT 'other',
  memo text CHECK (length(memo) BETWEEN 1 AND 300 AND memo !~ '[[:cntrl:]]'),
  issued_on date NOT NULL CHECK (issued_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  due_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  status app.bill_status NOT NULL DEFAULT 'pending_approval',
  created_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES app.person (id),
  approved_at timestamptz,
  paid_on date,
  payment_ref text CHECK (payment_ref ~ '^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$'),
  paid_recorded_by uuid REFERENCES app.person (id),
  voided_at timestamptz,
  void_reason text CHECK (length(void_reason) BETWEEN 3 AND 200 AND void_reason !~ '[[:cntrl:]]'),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, vendor_id) REFERENCES app.vendor (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK (due_on >= issued_on AND due_on <= issued_on + 366),
  CHECK (status NOT IN ('approved', 'paid') OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK (approved_by IS NULL OR approved_by <> created_by),  -- segregation of duties, even for app_definer
  CHECK ((status = 'paid') = (paid_on IS NOT NULL AND payment_ref IS NOT NULL AND paid_recorded_by IS NOT NULL)),
  CHECK (paid_on IS NULL OR paid_on >= issued_on),
  CHECK ((status = 'void') = (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
-- The same vendor invoice cannot be entered twice (a voided one can be re-entered).
CREATE UNIQUE INDEX bill_vendor_number_uq ON app.bill (org_id, vendor_id, lower(number)) WHERE status <> 'void';
CREATE INDEX bill_org_status_idx ON app.bill (org_id, status, due_on);

-- Append-only decision record: one decision per bill (a second concurrent decision is a conflict).
CREATE TABLE app.bill_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  bill_id uuid NOT NULL,
  location_id uuid NOT NULL,
  approver_person_id uuid NOT NULL REFERENCES app.person (id),
  approver_role app.role_name NOT NULL CHECK (approver_role IN ('owner', 'location_manager')),
  decision app.bill_decision NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 1),
  threshold_cents integer NOT NULL CHECK (threshold_cents >= 0),
  note text CHECK (length(note) BETWEEN 1 AND 300 AND note !~ '[[:cntrl:]]'),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (bill_id),
  FOREIGN KEY (org_id, bill_id) REFERENCES app.bill (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

-- Template of a recurring expense (rent, utilities). run_recurring_expenses() materialises due occurrences.
CREATE TABLE app.recurring_expense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  vendor_id uuid,
  category app.expense_category NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 120 AND description !~ '[[:cntrl:]]'),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  interval_months integer NOT NULL DEFAULT 1 CHECK (interval_months BETWEEN 1 AND 12),
  next_on date NOT NULL CHECK (next_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, vendor_id) REFERENCES app.vendor (org_id, id)
);

-- A one-off expense already paid (cash out). Receipt is a note for now (no file, no AI extraction).
CREATE TABLE app.expense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  vendor_id uuid,
  recurring_id uuid,
  category app.expense_category NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  spent_on date NOT NULL CHECK (spent_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  receipt_note text CHECK (length(receipt_note) BETWEEN 1 AND 300 AND receipt_note !~ '[[:cntrl:]]'),
  recorded_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES app.person (id),
  void_reason text CHECK (length(void_reason) BETWEEN 3 AND 200 AND void_reason !~ '[[:cntrl:]]'),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, vendor_id) REFERENCES app.vendor (org_id, id),
  FOREIGN KEY (org_id, recurring_id) REFERENCES app.recurring_expense (org_id, id),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (voided_at IS NULL) = (voided_by IS NULL))
);
-- One occurrence per template and date: a re-run (or a concurrent run) never duplicates an expense.
CREATE UNIQUE INDEX expense_recurring_uq ON app.expense (recurring_id, spent_on) WHERE recurring_id IS NOT NULL;
CREATE INDEX expense_org_spent_idx ON app.expense (org_id, spent_on);

-- Commission owed to a staff member (sale, membership sold, session delivered). Paid through the payroll export.
CREATE TABLE app.commission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  staff_member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  source app.commission_source NOT NULL,
  source_ref text NOT NULL CHECK (source_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$'),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  earned_on date NOT NULL CHECK (earned_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  status app.commission_status NOT NULL DEFAULT 'pending',
  note text CHECK (length(note) BETWEEN 1 AND 300 AND note !~ '[[:cntrl:]]'),
  created_by uuid NOT NULL DEFAULT app.person_id() REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app.person (id),
  decided_at timestamptz,
  paid_on date,
  UNIQUE (org_id, id),
  UNIQUE (org_id, staff_member_id, source, source_ref),
  FOREIGN KEY (org_id, staff_member_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK ((status = 'pending') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CHECK ((status = 'paid') = (paid_on IS NOT NULL))
);

-- Generated journal exports (history). Append-only; the CSV is produced server-side from aggregates only.
CREATE TABLE app.journal_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  format text NOT NULL DEFAULT 'qbo_journal' CHECK (format = 'qbo_journal'),
  line_count integer NOT NULL CHECK (line_count >= 0),
  debit_total_cents bigint NOT NULL CHECK (debit_total_cents >= 0),
  credit_total_cents bigint NOT NULL,
  csv text NOT NULL CHECK (length(csv) <= 2000000),
  generated_by uuid NOT NULL REFERENCES app.person (id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CHECK (debit_total_cents = credit_total_cents)
);
CREATE INDEX journal_export_org_idx ON app.journal_export (org_id, generated_at DESC);

-- ── Policy helpers (claims only; used by RLS and by the definer functions) ────────────────────────────────

-- Reads finance at a location: owner and accountant everywhere, a location manager at assigned locations.
CREATE FUNCTION app.fin_reader_at(p_loc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'accountant'), false)
      OR (coalesce(app.role() = 'location_manager', false) AND p_loc = ANY (app.location_ids()))
$$;
-- Writes finance at a location: owner everywhere, a location manager at assigned locations. Never the accountant.
CREATE FUNCTION app.fin_writer_at(p_loc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() = 'owner', false)
      OR (coalesce(app.role() = 'location_manager', false) AND p_loc = ANY (app.location_ids()))
$$;

-- ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────

-- One CSV cell: always quoted, quotes doubled, and a leading = + - @ tab or CR neutralised with an apostrophe so a
-- spreadsheet never evaluates it as a formula (CSV injection).
CREATE FUNCTION app.fin_csv(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT '"' || replace(CASE WHEN coalesce(p, '') ~ '^[=+@\t\r-]' THEN '''' || p ELSE coalesce(p, '') END, '"', '""') || '"'
$$;
-- Non-negative cents → "1234.50"; zero → '' (empty debit/credit cell).
CREATE FUNCTION app.fin_amount(p bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR p = 0 THEN '' ELSE (p / 100)::text || '.' || lpad((p % 100)::text, 2, '0') END
$$;
-- Default chart of accounts for expense categories [VERIFICAR · CPA chart of accounts].
CREATE FUNCTION app.fin_expense_account(p app.expense_category) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'rent' THEN 'Rent Expense' WHEN 'utilities' THEN 'Utilities Expense'
                WHEN 'payroll_export' THEN 'Payroll Expense' WHEN 'supplies' THEN 'Supplies Expense'
                WHEN 'maintenance' THEN 'Repairs and Maintenance' WHEN 'marketing' THEN 'Advertising and Marketing'
                ELSE 'Other Expenses' END
$$;

-- ── Internal helpers (app_definer only) ──────────────────────────────────────────────────────────────────

-- Effective manager threshold of the caller's org.
CREATE FUNCTION app.fin_manager_max() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce((SELECT p.manager_approval_max_cents FROM app.finance_policy p WHERE p.org_id = app.org_id()), 50000)
$$;

-- The caller may act on a bill of this amount at this location (owner: any; manager: assigned location and within
-- the threshold).
CREATE FUNCTION app.fin_can_decide(p_loc uuid, p_amount integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() = 'owner', false)
      OR (coalesce(app.role() = 'location_manager', false) AND p_loc = ANY (app.location_ids())
          AND p_amount <= app.fin_manager_max())
$$;

CREATE FUNCTION app.fin_today() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Puerto_Rico')::date
$$;

-- Accrual and cash amounts of one month per location visible to the caller. Local dates use each location's time
-- zone. Recognition:
--   memberships: linear by day over [period_start, period_end), cumulative rounding so the months sum exactly;
--   other invoices (packs, passes, drop-ins, fees): at issue [VERIFICAR · CPA: packs on use/expiry];
--   store: net of refunds (a refund reverses in the month it happens); IVU is never revenue (liability);
--   bills: approved or paid, by issue date; expenses: not voided, by spend date; commissions: approved or paid,
--   by earned date; platform fee: invoices issued in the month.
CREATE FUNCTION app.fin_month_amounts(p_month date)
RETURNS TABLE (location_id uuid, location_name text, membership_billed_cents bigint, membership_revenue_cents bigint,
               other_billing_revenue_cents bigint, invoice_ivu_cents bigint, invoice_total_cents bigint,
               platform_fees_cents bigint, payments_cents bigint, store_gross_subtotal_cents bigint,
               store_gross_ivu_cents bigint, store_refund_subtotal_cents bigint, store_refund_ivu_cents bigint,
               expenses_cents bigint, bills_cents bigint, bill_payments_cents bigint, commissions_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  WITH m AS (SELECT date_trunc('month', p_month)::date AS ms, (date_trunc('month', p_month) + interval '1 month')::date AS me),
  loc AS (SELECT l.id, l.name, l.timezone FROM app.location l
           WHERE l.org_id = app.org_id() AND app.fin_reader_at(l.id)),
  inv AS (
    SELECT i.location_id,
      sum(i.subtotal_cents) FILTER (WHERE i.subscription_id IS NOT NULL AND (i.issued_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (i.issued_at AT TIME ZONE loc.timezone)::date < m.me) AS mem_billed,
      sum(i.subtotal_cents) FILTER (WHERE i.subscription_id IS NULL AND (i.issued_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (i.issued_at AT TIME ZONE loc.timezone)::date < m.me) AS other_rev,
      sum(i.ivu_state_cents + i.ivu_municipal_cents) FILTER (WHERE (i.issued_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (i.issued_at AT TIME ZONE loc.timezone)::date < m.me) AS ivu,
      sum(i.total_cents) FILTER (WHERE (i.issued_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (i.issued_at AT TIME ZONE loc.timezone)::date < m.me) AS total,
      sum(i.application_fee_cents) FILTER (WHERE (i.issued_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (i.issued_at AT TIME ZONE loc.timezone)::date < m.me) AS fees,
      sum(CASE WHEN i.subscription_id IS NULL THEN 0 ELSE
            (i.subtotal_cents::bigint * least(greatest(m.me - i.period_start, 0), greatest(i.period_end - i.period_start, 1)))
              / greatest(i.period_end - i.period_start, 1)
          - (i.subtotal_cents::bigint * least(greatest(m.ms - i.period_start, 0), greatest(i.period_end - i.period_start, 1)))
              / greatest(i.period_end - i.period_start, 1) END) AS mem_rev
    FROM app.invoice i JOIN loc ON loc.id = i.location_id CROSS JOIN m
    WHERE i.org_id = app.org_id() AND i.status <> 'void'
    GROUP BY i.location_id),
  pay AS (
    SELECT p.location_id, sum(p.amount_cents) AS amt
    FROM app.payment p JOIN loc ON loc.id = p.location_id CROSS JOIN m
    WHERE p.org_id = app.org_id() AND p.status = 'succeeded'
      AND (p.received_at AT TIME ZONE loc.timezone)::date >= m.ms AND (p.received_at AT TIME ZONE loc.timezone)::date < m.me
    GROUP BY p.location_id),
  st AS (
    SELECT s.location_id,
      sum(s.subtotal_cents) FILTER (WHERE (s.completed_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (s.completed_at AT TIME ZONE loc.timezone)::date < m.me) AS gross_sub,
      sum(s.ivu_state_cents + s.ivu_municipal_cents) FILTER (WHERE (s.completed_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (s.completed_at AT TIME ZONE loc.timezone)::date < m.me) AS gross_ivu,
      sum(s.subtotal_cents) FILTER (WHERE s.status = 'refunded' AND (s.refunded_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (s.refunded_at AT TIME ZONE loc.timezone)::date < m.me) AS ref_sub,
      sum(s.ivu_state_cents + s.ivu_municipal_cents) FILTER (WHERE s.status = 'refunded'
                                     AND (s.refunded_at AT TIME ZONE loc.timezone)::date >= m.ms
                                     AND (s.refunded_at AT TIME ZONE loc.timezone)::date < m.me) AS ref_ivu
    FROM app.sale s JOIN loc ON loc.id = s.location_id CROSS JOIN m
    WHERE s.org_id = app.org_id() AND s.status IN ('completed', 'refunded')
    GROUP BY s.location_id),
  ex AS (
    SELECT e.location_id, sum(e.amount_cents) AS amt
    FROM app.expense e JOIN loc ON loc.id = e.location_id CROSS JOIN m
    WHERE e.org_id = app.org_id() AND e.voided_at IS NULL AND e.spent_on >= m.ms AND e.spent_on < m.me
    GROUP BY e.location_id),
  bl AS (
    SELECT b.location_id,
      sum(b.amount_cents) FILTER (WHERE b.status IN ('approved', 'paid') AND b.issued_on >= m.ms AND b.issued_on < m.me) AS accrued,
      sum(b.amount_cents) FILTER (WHERE b.status = 'paid' AND b.paid_on >= m.ms AND b.paid_on < m.me) AS paid
    FROM app.bill b JOIN loc ON loc.id = b.location_id CROSS JOIN m
    WHERE b.org_id = app.org_id()
    GROUP BY b.location_id),
  cm AS (
    SELECT c.location_id, sum(c.amount_cents) AS amt
    FROM app.commission c JOIN loc ON loc.id = c.location_id CROSS JOIN m
    WHERE c.org_id = app.org_id() AND c.status IN ('approved', 'paid') AND c.earned_on >= m.ms AND c.earned_on < m.me
    GROUP BY c.location_id)
  SELECT loc.id, loc.name,
    coalesce(inv.mem_billed, 0)::bigint, coalesce(inv.mem_rev, 0)::bigint, coalesce(inv.other_rev, 0)::bigint,
    coalesce(inv.ivu, 0)::bigint, coalesce(inv.total, 0)::bigint, coalesce(inv.fees, 0)::bigint,
    coalesce(pay.amt, 0)::bigint, coalesce(st.gross_sub, 0)::bigint, coalesce(st.gross_ivu, 0)::bigint,
    coalesce(st.ref_sub, 0)::bigint, coalesce(st.ref_ivu, 0)::bigint, coalesce(ex.amt, 0)::bigint,
    coalesce(bl.accrued, 0)::bigint, coalesce(bl.paid, 0)::bigint, coalesce(cm.amt, 0)::bigint
  FROM loc
  LEFT JOIN inv ON inv.location_id = loc.id
  LEFT JOIN pay ON pay.location_id = loc.id
  LEFT JOIN st ON st.location_id = loc.id
  LEFT JOIN ex ON ex.location_id = loc.id
  LEFT JOIN bl ON bl.location_id = loc.id
  LEFT JOIN cm ON cm.location_id = loc.id
  ORDER BY loc.name, loc.id
$$;

-- ── Request entry points (SECURITY DEFINER, claims re-checked, audited) ──────────────────────────────────

-- Approve or reject a pending bill. Locks the bill so two concurrent deciders cannot both win.
CREATE FUNCTION app.decide_bill(p_bill uuid, p_decision app.bill_decision, p_note text) RETURNS app.bill_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.bill;
  v_role app.role_name := app.role();
  v_new app.bill_status;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('owner', 'location_manager') OR p_decision IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM app.bill WHERE id = p_bill AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.fin_writer_at(v.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';  -- other org / other location look the same
  END IF;
  IF v.status <> 'pending_approval' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF v.created_by = app.person_id() THEN RAISE EXCEPTION 'approver_is_creator' USING ERRCODE = '42501'; END IF;
  -- Security review (finance) M1: the manager threshold applies to the total of non-void bills from the same vendor
  -- at the same location over the last 30 days, so a large bill cannot be split into approvable pieces.
  IF NOT app.fin_can_decide(v.location_id, (
       SELECT coalesce(sum(b.amount_cents), 0)::integer FROM app.bill b
        WHERE b.org_id = v.org_id AND b.vendor_id = v.vendor_id AND b.location_id = v.location_id
          AND b.status <> 'void' AND b.created_at > v.created_at - interval '30 days'
          AND b.created_at <= v.created_at)) THEN
    RAISE EXCEPTION 'above_threshold' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NOT NULL AND (length(v_note) > 300 OR v_note ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.bill_approval (org_id, bill_id, location_id, approver_person_id, approver_role, decision,
                                 amount_cents, threshold_cents, note)
  VALUES (v.org_id, v.id, v.location_id, app.person_id(), v_role, p_decision, v.amount_cents, app.fin_manager_max(), v_note);
  IF p_decision = 'approve' THEN
    v_new := 'approved';
    UPDATE app.bill SET status = v_new, approved_by = app.person_id(), approved_at = now() WHERE id = v.id;
  ELSE
    v_new := 'void';
    UPDATE app.bill SET status = v_new, voided_at = now(),
                        void_reason = left('rejected' || coalesce(': ' || v_note, ''), 200) WHERE id = v.id;
  END IF;
  RETURN v_new;
END $$;

-- Record that an approved bill was paid outside the platform (check, transfer). Same authority as deciding it.
CREATE FUNCTION app.pay_bill(p_bill uuid, p_paid_on date, p_payment_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.bill;
  v_ref text := btrim(p_payment_ref);
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM app.bill WHERE id = p_bill AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.fin_writer_at(v.location_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v.status IN ('paid', 'void') THEN RAISE EXCEPTION 'bill_immutable' USING ERRCODE = '22023'; END IF;
  IF v.status <> 'approved' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF NOT app.fin_can_decide(v.location_id, v.amount_cents) THEN
    RAISE EXCEPTION 'above_threshold' USING ERRCODE = '42501';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on < v.issued_on OR p_paid_on > app.fin_today() THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$' THEN
    RAISE EXCEPTION 'invalid_reference' USING ERRCODE = '22023';
  END IF;
  UPDATE app.bill SET status = 'paid', paid_on = p_paid_on, payment_ref = v_ref, paid_recorded_by = app.person_id()
   WHERE id = v.id;
END $$;

-- Void a pending or approved bill (entered by mistake, duplicate). A paid bill can never be voided.
CREATE FUNCTION app.void_bill(p_bill uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.bill;
  v_reason text := btrim(p_reason);
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM app.bill WHERE id = p_bill AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.fin_writer_at(v.location_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v.status IN ('paid', 'void') THEN RAISE EXCEPTION 'bill_immutable' USING ERRCODE = '22023'; END IF;
  IF NOT app.fin_can_decide(v.location_id, v.amount_cents) THEN
    RAISE EXCEPTION 'above_threshold' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  UPDATE app.bill SET status = 'void', voided_at = now(), void_reason = v_reason WHERE id = v.id;
END $$;

-- Void a recorded expense (kept for the audit trail; excluded from P&L and exports).
CREATE FUNCTION app.void_expense(p_expense uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.expense;
  v_reason text := btrim(p_reason);
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM app.expense WHERE id = p_expense AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND OR NOT app.fin_writer_at(v.location_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v.voided_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  UPDATE app.expense SET voided_at = now(), voided_by = app.person_id(), void_reason = v_reason WHERE id = v.id;
END $$;

-- Materialise every due occurrence (next_on ≤ as_of) of the active templates the caller may write. Idempotent:
-- templates are locked and each (template, date) is unique, so a re-run or a concurrent run adds nothing.
CREATE FUNCTION app.run_recurring_expenses(p_as_of date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_as_of date := coalesce(p_as_of, app.fin_today());
  r app.recurring_expense;
  v_n integer := 0;
  v_step integer;
  v_on date;
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_as_of > app.fin_today() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023'; END IF;
  FOR r IN SELECT * FROM app.recurring_expense t
            WHERE t.org_id = app.org_id() AND t.active AND t.next_on <= v_as_of AND app.fin_writer_at(t.location_id)
            ORDER BY t.id FOR UPDATE LOOP
    -- Re-read after the lock: a concurrent run may already have advanced it.
    SELECT next_on INTO v_on FROM app.recurring_expense WHERE id = r.id;
    v_step := 0;
    WHILE v_on <= v_as_of AND v_step < 36 LOOP
      INSERT INTO app.expense (org_id, location_id, vendor_id, recurring_id, category, amount_cents, spent_on,
                               receipt_note, recorded_by)
      VALUES (r.org_id, r.location_id, r.vendor_id, r.id, r.category, r.amount_cents, v_on, r.description, app.person_id())
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
      v_on := (v_on + make_interval(months => r.interval_months))::date;
      v_step := v_step + 1;
    END LOOP;
    UPDATE app.recurring_expense SET next_on = v_on, updated_at = now() WHERE id = r.id;
  END LOOP;
  PERFORM app.audit('expense.recurring_run', 'organization', app.org_id()::text, NULL,
                    jsonb_build_object('as_of', v_as_of, 'created', v_n));
  RETURN v_n;
END $$;

-- Commission workflow: owner only (pending → approved → paid; any unpaid → void). Location managers propose.
CREATE FUNCTION app.set_commission_status(p_id uuid, p_status app.commission_status, p_paid_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.commission;
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR app.role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM app.commission WHERE id = p_id AND org_id = app.org_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v.status IN ('paid', 'void') THEN RAISE EXCEPTION 'commission_immutable' USING ERRCODE = '22023'; END IF;
  IF NOT ((v.status = 'pending' AND p_status IN ('approved', 'void'))
          OR (v.status = 'approved' AND p_status IN ('paid', 'void'))) THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'paid' AND (p_paid_on IS NULL OR p_paid_on < v.earned_on OR p_paid_on > app.fin_today()) THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  UPDATE app.commission
     SET status = p_status,
         decided_by = coalesce(decided_by, app.person_id()),
         decided_at = coalesce(decided_at, now()),
         paid_on = CASE WHEN p_status = 'paid' THEN p_paid_on END
   WHERE id = v.id;
END $$;

-- P&L for a month, one row per location the caller may read (consolidated = sum of rows; done by the caller).
CREATE FUNCTION app.finance_pnl(p_month date)
RETURNS TABLE (location_id uuid, location_name text, membership_revenue_cents bigint, other_billing_revenue_cents bigint,
               store_revenue_cents bigint, revenue_cents bigint, expenses_cents bigint, bills_cents bigint,
               commissions_cents bigint, platform_fees_cents bigint, costs_cents bigint, net_cents bigint,
               cash_in_cents bigint, cash_out_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'accountant', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month < DATE '2000-01-01' OR p_month > DATE '2100-12-01' THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.location_id, a.location_name, a.membership_revenue_cents, a.other_billing_revenue_cents,
           a.store_gross_subtotal_cents - a.store_refund_subtotal_cents,
           a.membership_revenue_cents + a.other_billing_revenue_cents + a.store_gross_subtotal_cents - a.store_refund_subtotal_cents,
           a.expenses_cents, a.bills_cents, a.commissions_cents, a.platform_fees_cents,
           a.expenses_cents + a.bills_cents + a.commissions_cents + a.platform_fees_cents,
           a.membership_revenue_cents + a.other_billing_revenue_cents + a.store_gross_subtotal_cents - a.store_refund_subtotal_cents
             - (a.expenses_cents + a.bills_cents + a.commissions_cents + a.platform_fees_cents),
           a.payments_cents + a.store_gross_subtotal_cents + a.store_gross_ivu_cents
             - a.store_refund_subtotal_cents - a.store_refund_ivu_cents,
           a.expenses_cents + a.bill_payments_cents
      FROM app.fin_month_amounts(p_month) a;
END $$;

-- Deferred revenue today, per location the caller may read [VERIFICAR · CPA]:
--   prepaid periods = unearned part of membership invoices (billed, period not yet elapsed);
--   unused credits  = remaining fraction of the pack's invoiced amount for live credit balances (informational: the
--                     P&L still recognises packs at sale until session usage carries dates).
CREATE FUNCTION app.finance_deferred()
RETURNS TABLE (location_id uuid, location_name text, prepaid_periods_cents bigint, unused_credits_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'accountant', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH loc AS (SELECT l.id, l.name, l.timezone FROM app.location l
                  WHERE l.org_id = app.org_id() AND app.fin_reader_at(l.id)),
    pre AS (
      SELECT i.location_id,
             sum(i.subtotal_cents - (i.subtotal_cents::bigint
                 * least(greatest(((now() AT TIME ZONE loc.timezone)::date + 1) - i.period_start, 0),
                         greatest(i.period_end - i.period_start, 1)))
                 / greatest(i.period_end - i.period_start, 1)) AS amt
        FROM app.invoice i JOIN loc ON loc.id = i.location_id
       WHERE i.org_id = app.org_id() AND i.status <> 'void' AND i.subscription_id IS NOT NULL
         AND i.period_end > (now() AT TIME ZONE loc.timezone)::date
       GROUP BY i.location_id),
    cr AS (
      SELECT cb.location_id,
             sum((coalesce((SELECT sum(il.amount_cents) FROM app.invoice_line il JOIN app.invoice i ON i.id = il.invoice_id
                             WHERE il.invoice_id = cb.invoice_id AND il.product_id = cb.product_id AND i.status <> 'void'), 0)
                  * cb.credits_remaining) / cb.credits_total) AS amt
        FROM app.credit_balance cb JOIN loc ON loc.id = cb.location_id
       WHERE cb.org_id = app.org_id() AND cb.credits_remaining > 0 AND (cb.expires_at IS NULL OR cb.expires_at > now())
       GROUP BY cb.location_id)
    SELECT loc.id, loc.name, coalesce(pre.amt, 0)::bigint, coalesce(cr.amt, 0)::bigint
      FROM loc LEFT JOIN pre ON pre.location_id = loc.id LEFT JOIN cr ON cr.location_id = loc.id
     ORDER BY loc.name, loc.id;
END $$;

-- Summarised monthly journal in a QuickBooks Online journal-import layout, one balanced entry per location
-- (JournalNo, JournalDate, Account, Debits, Credits, Description, Location). Only server aggregates and location
-- names reach the CSV; every cell is quoted and formula-neutralised. Owner and accountant only.
-- Xero allows at most 2 tracking categories; this export uses one (location) [VERIFICAR · CPA chart of accounts].
CREATE FUNCTION app.generate_journal_export(p_period date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_period date := date_trunc('month', p_period)::date;
  v_last date;
  v_csv text;
  v_lines integer;
  v_dr bigint;
  v_cr bigint;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR app.person_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'accountant'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_period IS NULL OR v_period < DATE '2000-01-01' OR v_period > date_trunc('month', app.fin_today())::date THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  v_last := (v_period + interval '1 month' - interval '1 day')::date;

  WITH a AS (SELECT * FROM app.fin_month_amounts(v_period)),
  cat AS (
    SELECT e.location_id, e.category, sum(e.amount_cents)::bigint AS exp_amt, 0::bigint AS bill_amt
      FROM app.expense e
     WHERE e.org_id = app.org_id() AND e.voided_at IS NULL AND e.spent_on >= v_period AND e.spent_on <= v_last
     GROUP BY e.location_id, e.category
    UNION ALL
    SELECT b.location_id, b.category, 0, sum(b.amount_cents)::bigint
      FROM app.bill b
     WHERE b.org_id = app.org_id() AND b.status IN ('approved', 'paid') AND b.issued_on >= v_period AND b.issued_on <= v_last
     GROUP BY b.location_id, b.category),
  raw (location_id, account, amount) AS (
    SELECT a.location_id, 'Accounts Receivable', a.invoice_total_cents - a.payments_cents FROM a
    UNION ALL SELECT a.location_id, 'Membership Revenue', -a.membership_revenue_cents FROM a
    UNION ALL SELECT a.location_id, 'Deferred Revenue', -(a.membership_billed_cents - a.membership_revenue_cents) FROM a
    UNION ALL SELECT a.location_id, 'Packs and Passes Revenue', -a.other_billing_revenue_cents FROM a
    UNION ALL SELECT a.location_id, 'IVU Payable',
                     -(a.invoice_ivu_cents + a.store_gross_ivu_cents - a.store_refund_ivu_cents) FROM a
    UNION ALL SELECT a.location_id, 'Undeposited Funds',
                     a.payments_cents + a.store_gross_subtotal_cents + a.store_gross_ivu_cents
                     - a.store_refund_subtotal_cents - a.store_refund_ivu_cents - a.platform_fees_cents FROM a
    UNION ALL SELECT a.location_id, 'Store Sales', -(a.store_gross_subtotal_cents - a.store_refund_subtotal_cents) FROM a
    UNION ALL SELECT a.location_id, 'Platform Fees', a.platform_fees_cents FROM a
    UNION ALL SELECT a.location_id, 'Commissions Expense', a.commissions_cents FROM a
    UNION ALL SELECT a.location_id, 'Commissions Payable', -a.commissions_cents FROM a
    UNION ALL SELECT a.location_id, 'Accounts Payable', a.bill_payments_cents FROM a
    UNION ALL SELECT a.location_id, 'Bank', -(a.expenses_cents + a.bill_payments_cents) FROM a
    UNION ALL SELECT cat.location_id, app.fin_expense_account(cat.category), cat.exp_amt + cat.bill_amt
                FROM cat JOIN a ON a.location_id = cat.location_id
    UNION ALL SELECT cat.location_id, 'Accounts Payable', -cat.bill_amt
                FROM cat JOIN a ON a.location_id = cat.location_id),
  net AS (
    SELECT r.location_id, r.account, sum(r.amount)::bigint AS amount FROM raw r
     GROUP BY r.location_id, r.account HAVING sum(r.amount) <> 0),
  numbered AS (
    SELECT n.*, a.location_name, dense_rank() OVER (ORDER BY a.location_name, a.location_id) AS entry_no
      FROM net n JOIN a ON a.location_id = n.location_id)
  SELECT
    'JournalNo,JournalDate,Account,Debits,Credits,Description,Location' || E'\r\n' ||
    coalesce(string_agg(
      concat_ws(',',
        app.fin_csv('GYM-' || to_char(v_period, 'YYYYMM') || '-' || lpad(entry_no::text, 2, '0')),
        app.fin_csv(to_char(v_last, 'MM/DD/YYYY')),
        app.fin_csv(account),
        app.fin_csv(app.fin_amount(greatest(amount, 0))),
        app.fin_csv(app.fin_amount(greatest(-amount, 0))),
        app.fin_csv('Resumen mensual ' || to_char(v_period, 'YYYY-MM')),
        app.fin_csv(location_name)) || E'\r\n',
      '' ORDER BY location_name, location_id, account), ''),
    count(*)::integer,
    coalesce(sum(greatest(amount, 0)), 0)::bigint,
    coalesce(sum(greatest(-amount, 0)), 0)::bigint
  INTO v_csv, v_lines, v_dr, v_cr
  FROM numbered;

  IF v_dr <> v_cr THEN RAISE EXCEPTION 'unbalanced_journal' USING ERRCODE = '22023'; END IF;
  INSERT INTO app.journal_export (org_id, period, line_count, debit_total_cents, credit_total_cents, csv, generated_by)
  VALUES (app.org_id(), v_period, v_lines, v_dr, v_cr, v_csv, app.person_id())
  RETURNING id INTO v_id;
  PERFORM app.audit('journal.export', 'journal_export', v_id::text, NULL,
                    jsonb_build_object('period', v_period, 'lines', v_lines, 'debit_total_cents', v_dr));
  RETURN v_id;
END $$;

-- ── Triggers: immutability and audit ─────────────────────────────────────────────────────────────────────

-- Bills: paid/void are final; approved only moves to paid or void; the commercial fields never change after entry.
-- Applies to every role, app_definer included.
CREATE FUNCTION app.bill_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bill_immutable' USING ERRCODE = '22023'; END IF;
  IF OLD.status IN ('paid', 'void') THEN RAISE EXCEPTION 'bill_immutable' USING ERRCODE = '22023'; END IF;
  IF (NEW.org_id, NEW.vendor_id, NEW.location_id, NEW.number, NEW.category, NEW.memo, NEW.issued_on, NEW.due_on,
      NEW.amount_cents, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.org_id, OLD.vendor_id, OLD.location_id, OLD.number, OLD.category, OLD.memo, OLD.issued_on, OLD.due_on,
      OLD.amount_cents, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'bill_immutable' USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'void'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'void'))) THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bill_guard BEFORE UPDATE OR DELETE ON app.bill FOR EACH ROW EXECUTE FUNCTION app.bill_guard();

-- Expenses: only the void columns may be set, once.
CREATE FUNCTION app.expense_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.voided_at IS NOT NULL
     OR (NEW.org_id, NEW.location_id, NEW.vendor_id, NEW.recurring_id, NEW.category, NEW.amount_cents, NEW.spent_on,
         NEW.receipt_note, NEW.recorded_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.org_id, OLD.location_id, OLD.vendor_id, OLD.recurring_id, OLD.category, OLD.amount_cents, OLD.spent_on,
         OLD.receipt_note, OLD.recorded_by, OLD.created_at) THEN
    RAISE EXCEPTION 'expense_immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_guard BEFORE UPDATE OR DELETE ON app.expense FOR EACH ROW EXECUTE FUNCTION app.expense_guard();

-- Commissions: amount and attribution fixed; paid/void final.
CREATE FUNCTION app.commission_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('paid', 'void')
     OR (NEW.org_id, NEW.staff_member_id, NEW.location_id, NEW.source, NEW.source_ref, NEW.amount_cents, NEW.earned_on,
         NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.org_id, OLD.staff_member_id, OLD.location_id, OLD.source, OLD.source_ref, OLD.amount_cents, OLD.earned_on,
         OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'commission_immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_guard BEFORE UPDATE OR DELETE ON app.commission
  FOR EACH ROW EXECUTE FUNCTION app.commission_guard();

-- Decisions and generated exports are append-only.
CREATE FUNCTION app.fin_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'append_only' USING ERRCODE = '22023';
END $$;
CREATE TRIGGER bill_approval_append_only BEFORE UPDATE OR DELETE ON app.bill_approval
  FOR EACH ROW EXECUTE FUNCTION app.fin_append_only();
CREATE TRIGGER journal_export_append_only BEFORE UPDATE OR DELETE ON app.journal_export
  FOR EACH ROW EXECUTE FUNCTION app.fin_append_only();

-- Every money or status change is audited by trigger, so no request path can skip it.
CREATE FUNCTION app.fin_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_meta jsonb;
  v_loc uuid;
  v_action text;
  v_entity text := TG_TABLE_NAME;
  v_entity_id text := NEW.id::text;
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;  -- migrations, fixtures and seeds have no actor
  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  IF TG_TABLE_NAME = 'bill' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
      v_action := 'bill.' || NEW.status;
    END IF;
    v_loc := NEW.location_id;
    v_meta := jsonb_strip_nulls(jsonb_build_object('amount_cents', NEW.amount_cents, 'status', NEW.status,
      'vendor_id', NEW.vendor_id, 'number', NEW.number, 'paid_on', NEW.paid_on, 'void_reason', NEW.void_reason));
  ELSIF TG_TABLE_NAME = 'expense' THEN
    IF TG_OP = 'UPDATE' THEN v_action := 'expense.void'; END IF;
    v_loc := NEW.location_id;
    v_meta := jsonb_strip_nulls(jsonb_build_object('amount_cents', NEW.amount_cents, 'category', NEW.category,
      'spent_on', NEW.spent_on, 'recurring_id', NEW.recurring_id, 'void_reason', NEW.void_reason));
  ELSIF TG_TABLE_NAME = 'recurring_expense' THEN
    v_loc := NEW.location_id;
    v_meta := jsonb_build_object('amount_cents', NEW.amount_cents, 'category', NEW.category,
      'interval_months', NEW.interval_months, 'next_on', NEW.next_on, 'active', NEW.active);
  ELSIF TG_TABLE_NAME = 'commission' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
      v_action := 'commission.' || NEW.status;
    END IF;
    v_loc := NEW.location_id;
    v_meta := jsonb_strip_nulls(jsonb_build_object('amount_cents', NEW.amount_cents, 'status', NEW.status,
      'staff_member_id', NEW.staff_member_id, 'source', NEW.source, 'paid_on', NEW.paid_on));
  ELSIF TG_TABLE_NAME = 'vendor' THEN
    v_meta := jsonb_build_object('name', NEW.name, 'active', NEW.active);
  ELSIF TG_TABLE_NAME = 'finance_policy' THEN
    v_meta := jsonb_build_object('manager_approval_max_cents', NEW.manager_approval_max_cents);
  ELSIF TG_TABLE_NAME = 'bill_approval' THEN
    v_action := 'bill.decision';
    v_entity := 'bill';
    v_entity_id := NEW.bill_id::text;  -- the decision is part of the bill's history
    v_loc := NEW.location_id;
    v_meta := jsonb_build_object('approval_id', NEW.id, 'decision', NEW.decision, 'amount_cents', NEW.amount_cents,
      'threshold_cents', NEW.threshold_cents);
  END IF;
  PERFORM app.audit(v_action, v_entity, v_entity_id, v_loc, coalesce(v_meta, '{}'::jsonb));
  RETURN NEW;
END $$;
CREATE TRIGGER bill_audit AFTER INSERT OR UPDATE ON app.bill FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER bill_approval_audit AFTER INSERT ON app.bill_approval FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER expense_audit AFTER INSERT OR UPDATE ON app.expense FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER recurring_expense_audit AFTER INSERT OR UPDATE ON app.recurring_expense
  FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER commission_audit AFTER INSERT OR UPDATE ON app.commission FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER vendor_audit AFTER INSERT OR UPDATE ON app.vendor FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();
CREATE TRIGGER finance_policy_audit AFTER INSERT OR UPDATE ON app.finance_policy
  FOR EACH ROW EXECUTE FUNCTION app.fin_audit_trigger();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.finance_policy    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.finance_policy    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.vendor            ENABLE ROW LEVEL SECURITY; ALTER TABLE app.vendor            FORCE ROW LEVEL SECURITY;
ALTER TABLE app.bill              ENABLE ROW LEVEL SECURITY; ALTER TABLE app.bill              FORCE ROW LEVEL SECURITY;
ALTER TABLE app.bill_approval     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.bill_approval     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.recurring_expense ENABLE ROW LEVEL SECURITY; ALTER TABLE app.recurring_expense FORCE ROW LEVEL SECURITY;
ALTER TABLE app.expense           ENABLE ROW LEVEL SECURITY; ALTER TABLE app.expense           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.commission        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.commission        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.journal_export    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.journal_export    FORCE ROW LEVEL SECURITY;

-- Org-wide finance objects: owner, accountant and location managers read; owner configures.
CREATE POLICY finance_policy_select ON app.finance_policy FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'accountant', 'location_manager'));
CREATE POLICY finance_policy_insert ON app.finance_policy FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY finance_policy_update ON app.finance_policy FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

CREATE POLICY vendor_select ON app.vendor FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'accountant', 'location_manager'));
CREATE POLICY vendor_insert ON app.vendor FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager')
  AND created_by = (SELECT app.person_id()));
CREATE POLICY vendor_update ON app.vendor FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

-- Location-scoped objects: read by fin_reader_at, written by fin_writer_at (never the accountant).
CREATE POLICY bill_select ON app.bill FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND app.fin_reader_at(location_id));
CREATE POLICY bill_insert ON app.bill FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id)
  AND status = 'pending_approval' AND created_by = (SELECT app.person_id()));

CREATE POLICY bill_approval_select ON app.bill_approval FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND app.fin_reader_at(location_id));

CREATE POLICY recurring_expense_select ON app.recurring_expense FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND app.fin_reader_at(location_id));
CREATE POLICY recurring_expense_insert ON app.recurring_expense FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id) AND created_by = (SELECT app.person_id())
  AND ((SELECT app.role()) = 'owner' OR amount_cents <= app.fin_manager_max()));
-- A manager can neither raise a template above the threshold nor edit an owner's template that already is.
CREATE POLICY recurring_expense_update ON app.recurring_expense FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id)
         AND ((SELECT app.role()) = 'owner' OR amount_cents <= app.fin_manager_max()))
  WITH CHECK (org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id)
              AND ((SELECT app.role()) = 'owner' OR amount_cents <= app.fin_manager_max()));

CREATE POLICY expense_select ON app.expense FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND app.fin_reader_at(location_id));
-- Security review (finance) M2: expenses above the manager threshold are recorded by the owner only.
CREATE POLICY expense_insert ON app.expense FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id)
  AND recurring_id IS NULL AND voided_at IS NULL AND recorded_by = (SELECT app.person_id())
  AND ((SELECT app.role()) = 'owner' OR amount_cents <= app.fin_manager_max()));

-- A commission is for a staff member assigned to that location (staff_location RLS applies to the caller).
CREATE POLICY commission_select ON app.commission FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND app.fin_reader_at(location_id));
CREATE POLICY commission_insert ON app.commission FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND app.fin_writer_at(location_id)
  AND status = 'pending' AND created_by = (SELECT app.person_id())
  AND EXISTS (SELECT 1 FROM app.staff_location sl
               WHERE sl.staff_member_id = commission.staff_member_id AND sl.location_id = commission.location_id));

CREATE POLICY journal_export_select ON app.journal_export FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'accountant'));

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.finance_policy    TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.vendor            TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.bill              TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.bill_approval     TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.recurring_expense TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.expense           TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.commission        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.journal_export    TO app_definer USING (true) WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.finance_policy, app.vendor, app.bill, app.bill_approval, app.recurring_expense, app.expense,
  app.commission, app.journal_export FROM PUBLIC;
GRANT SELECT ON app.finance_policy, app.vendor, app.bill, app.bill_approval, app.recurring_expense, app.expense,
  app.commission, app.journal_export TO app_authenticated;
-- Writable columns only. Never org_id, status, created_by/recorded_by, approval, payment or void columns (those
-- change only through the definer functions above).
GRANT INSERT (manager_approval_max_cents), UPDATE (manager_approval_max_cents, updated_at)
  ON app.finance_policy TO app_authenticated;
GRANT INSERT (name, contact_email, active), UPDATE (name, contact_email, active) ON app.vendor TO app_authenticated;
GRANT INSERT (vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents)
  ON app.bill TO app_authenticated;
GRANT INSERT (location_id, vendor_id, category, description, amount_cents, interval_months, next_on, active),
  UPDATE (vendor_id, category, description, amount_cents, interval_months, next_on, active, updated_at)
  ON app.recurring_expense TO app_authenticated;
GRANT INSERT (location_id, vendor_id, category, amount_cents, spent_on, receipt_note) ON app.expense TO app_authenticated;
GRANT INSERT (staff_member_id, location_id, source, source_ref, amount_cents, earned_on, note)
  ON app.commission TO app_authenticated;

GRANT SELECT, INSERT, UPDATE ON app.finance_policy, app.vendor, app.bill, app.bill_approval, app.recurring_expense,
  app.expense, app.commission, app.journal_export TO app_definer;
GRANT SELECT ON app.invoice, app.invoice_line, app.payment, app.credit_balance, app.sale TO app_definer;

ALTER FUNCTION app.fin_manager_max() OWNER TO app_definer;
ALTER FUNCTION app.fin_can_decide(uuid, integer) OWNER TO app_definer;
ALTER FUNCTION app.fin_month_amounts(date) OWNER TO app_definer;
ALTER FUNCTION app.decide_bill(uuid, app.bill_decision, text) OWNER TO app_definer;
ALTER FUNCTION app.pay_bill(uuid, date, text) OWNER TO app_definer;
ALTER FUNCTION app.void_bill(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.void_expense(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.run_recurring_expenses(date) OWNER TO app_definer;
ALTER FUNCTION app.set_commission_status(uuid, app.commission_status, date) OWNER TO app_definer;
ALTER FUNCTION app.finance_pnl(date) OWNER TO app_definer;
ALTER FUNCTION app.finance_deferred() OWNER TO app_definer;
ALTER FUNCTION app.generate_journal_export(date) OWNER TO app_definer;
ALTER FUNCTION app.fin_audit_trigger() OWNER TO app_definer;

-- New functions are executable by PUBLIC by default: revoke everything, then grant the request entry points.
REVOKE ALL ON FUNCTION app.fin_reader_at(uuid), app.fin_writer_at(uuid), app.fin_csv(text), app.fin_amount(bigint),
  app.fin_expense_account(app.expense_category), app.fin_manager_max(), app.fin_can_decide(uuid, integer),
  app.fin_today(), app.fin_month_amounts(date), app.decide_bill(uuid, app.bill_decision, text),
  app.pay_bill(uuid, date, text), app.void_bill(uuid, text), app.void_expense(uuid, text),
  app.run_recurring_expenses(date), app.set_commission_status(uuid, app.commission_status, date),
  app.finance_pnl(date), app.finance_deferred(), app.generate_journal_export(date), app.bill_guard(),
  app.expense_guard(), app.commission_guard(), app.fin_append_only(), app.fin_audit_trigger()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fin_reader_at(uuid), app.fin_writer_at(uuid) TO app_authenticated, app_definer;
GRANT EXECUTE ON FUNCTION app.fin_csv(text), app.fin_amount(bigint), app.fin_expense_account(app.expense_category),
  app.fin_today() TO app_definer;
GRANT EXECUTE ON FUNCTION app.decide_bill(uuid, app.bill_decision, text), app.pay_bill(uuid, date, text),
  app.void_bill(uuid, text), app.void_expense(uuid, text), app.run_recurring_expenses(date),
  app.set_commission_status(uuid, app.commission_status, date), app.finance_pnl(date), app.finance_deferred(),
  app.generate_journal_export(date) TO app_authenticated;

-- Policies on expense/recurring_expense compare amounts with the manager threshold (security review M2).
GRANT EXECUTE ON FUNCTION app.fin_manager_max() TO app_authenticated;
