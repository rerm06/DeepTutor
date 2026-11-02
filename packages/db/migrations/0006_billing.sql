-- Module billing (Membresías, catálogo y facturación) · spec §5, E3, E4. Owned by the billing module agent.
-- An internal billing engine: catalogue, prices, subscriptions with real freezes, invoices with IVU per line,
-- gapless numbering per legal entity, payments (simulated methods only), session credits and day passes.
-- Stripe is NOT called: the API exposes an adapter interface with a simulated implementation (no network).
-- Rules that matter:
--   * Money in integer cents. IVU 10.5 % state + 1 % municipal on taxable lines, rounded half-up PER LINE
--     [VERIFICAR · CPA]. Generated columns compute it, so no writer can forge a line's tax.
--   * Platform fee (application_fee) = round(total × bps / 10 000) with bps from the org's SaaS plan
--     (esencial 100, pro 75, elite 50; spec §5.1 [P]). The base includes IVU (spec §5.1 [I]). Computed in SQL,
--     pinned by a CHECK, and never readable by members (column grants).
--   * A freeze EXTENDS current_period_end and commitment_end by its length (never "pause collection").
--   * Cancellation is at period end (or at commitment end if later); members can do it online.
--   * Member status follows billing (active / frozen / past_due / cancelled) but nothing here ever denies
--     access automatically: passes and credits are never revoked by a status change (spec §5.2).
--   * Commitment ("permanencia") only up to the location/org policy maximum, default 0 months [VERIFICAR · DACO].

CREATE TYPE app.product_kind AS ENUM
  ('membership', 'class_pack', 'day_pass', 'drop_in', 'pt_package', 'addon', 'enrollment_fee');
CREATE TYPE app.tax_category AS ENUM ('taxable', 'exempt');
CREATE TYPE app.billing_interval AS ENUM ('month', 'year', 'none');
CREATE TYPE app.subscription_status AS ENUM ('active', 'frozen', 'past_due', 'cancelled');
CREATE TYPE app.invoice_status AS ENUM ('open', 'paid', 'void');
CREATE TYPE app.payment_method AS ENUM ('cash', 'card_simulated', 'ach_simulated');
CREATE TYPE app.payment_status AS ENUM ('succeeded', 'failed');

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────────────────

-- Billing policy: one org default row (location_id NULL) plus optional per-location overrides.
CREATE TABLE app.billing_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  location_id uuid,
  -- Maximum "permanencia" a price may carry here. Default 0 [VERIFICAR · DACO / state gym-contract laws].
  max_commitment_months integer NOT NULL DEFAULT 0 CHECK (max_commitment_months BETWEEN 0 AND 12),
  invoice_due_days integer NOT NULL DEFAULT 3 CHECK (invoice_due_days BETWEEN 0 AND 60),
  max_freeze_days integer NOT NULL DEFAULT 90 CHECK (max_freeze_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, location_id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

CREATE TABLE app.plan_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  kind app.product_kind NOT NULL,
  -- Names reach invoices and (later) messages: same screen as rendered messages (no links, phones, health claims,
  -- regulated titles or exotic characters).
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND NOT app.has_forbidden_terms(name)),
  description text CHECK (length(description) <= 500 AND NOT app.has_forbidden_terms(description)),
  tax_category app.tax_category NOT NULL DEFAULT 'taxable',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- Prices are immutable except `active`: a new amount is a new price row, so active subscriptions keep theirs (E3).
CREATE TABLE app.price (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  product_id uuid NOT NULL,
  location_id uuid,  -- NULL = every location of the org
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 0 AND 10000000),
  billing_interval app.billing_interval NOT NULL DEFAULT 'none',
  credits integer CHECK (credits BETWEEN 1 AND 500),
  validity_days integer CHECK (validity_days BETWEEN 1 AND 730),
  commitment_months integer NOT NULL DEFAULT 0 CHECK (commitment_months BETWEEN 0 AND 36),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, product_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.plan_product (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK (commitment_months = 0 OR billing_interval <> 'none')
);

CREATE TABLE app.subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price_id uuid NOT NULL,
  location_id uuid NOT NULL,
  status app.subscription_status NOT NULL DEFAULT 'active',
  billing_interval app.billing_interval NOT NULL CHECK (billing_interval <> 'none'),
  start_date date NOT NULL,
  current_period_start date NOT NULL,
  current_period_end date NOT NULL,  -- exclusive
  commitment_end date,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, product_id, price_id) REFERENCES app.price (org_id, product_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK (current_period_end > current_period_start),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (cancel_at_period_end = (cancel_requested_at IS NOT NULL))
);
-- One live subscription per member and product (also makes a double-click on "subscribe" a 409).
CREATE UNIQUE INDEX subscription_live_uq ON app.subscription (member_id, product_id) WHERE status <> 'cancelled';
CREATE INDEX subscription_due_idx ON app.subscription (org_id, current_period_end) WHERE status <> 'cancelled';

CREATE TABLE app.subscription_freeze (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  subscription_id uuid NOT NULL,
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,  -- exclusive
  days integer GENERATED ALWAYS AS (end_date - start_date) STORED,
  reason text CHECK (length(reason) <= 300),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, subscription_id) REFERENCES app.subscription (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  CHECK (end_date > start_date)
);

-- Gapless numbering: one counter row per legal entity, taken FOR UPDATE inside the invoicing transaction, so a
-- rolled-back invoice also rolls back its number and concurrent invoices queue on the row.
CREATE TABLE app.invoice_counter (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  legal_entity_id uuid PRIMARY KEY,
  next_no bigint NOT NULL DEFAULT 1 CHECK (next_no >= 1),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES app.legal_entity (org_id, id)
);

CREATE TABLE app.invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  legal_entity_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number >= 1),
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  municipality text,  -- copied at issue time for the IVU-by-municipality report (E13)
  subscription_id uuid,
  period_start date,
  period_end date,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  ivu_state_cents integer NOT NULL CHECK (ivu_state_cents >= 0),
  ivu_municipal_cents integer NOT NULL CHECK (ivu_municipal_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  application_fee_bps integer NOT NULL CHECK (application_fee_bps IN (50, 75, 100)),
  application_fee_cents integer NOT NULL,
  status app.invoice_status NOT NULL DEFAULT 'open',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_date date NOT NULL,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text CHECK (length(void_reason) <= 300),
  idempotency_key text CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_by uuid NOT NULL,
  UNIQUE (org_id, id),
  UNIQUE (legal_entity_id, number),
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES app.legal_entity (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, subscription_id) REFERENCES app.subscription (org_id, id),
  CHECK (total_cents = subtotal_cents + ivu_state_cents + ivu_municipal_cents),
  CHECK (application_fee_cents = ((total_cents::bigint * application_fee_bps + 5000) / 10000)),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK ((subscription_id IS NULL) = (period_start IS NULL) AND (period_start IS NULL) = (period_end IS NULL))
);
-- Renewal idempotency: at most one invoice per subscription period.
CREATE UNIQUE INDEX invoice_subscription_period_uq ON app.invoice (subscription_id, period_start)
  WHERE subscription_id IS NOT NULL;
CREATE INDEX invoice_open_due_idx ON app.invoice (org_id, due_date) WHERE status = 'open';
CREATE INDEX invoice_member_idx ON app.invoice (member_id, issued_at DESC);

CREATE TABLE app.invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  invoice_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price_id uuid NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_amount_cents integer NOT NULL CHECK (unit_amount_cents BETWEEN 0 AND 10000000),
  tax_category app.tax_category NOT NULL,
  amount_cents integer GENERATED ALWAYS AS (quantity * unit_amount_cents) STORED,
  -- IVU rounded half-up per line: 10.5 % state, 1 % municipal [VERIFICAR · CPA].
  ivu_state_cents integer GENERATED ALWAYS AS (CASE WHEN tax_category = 'taxable'
    THEN ((quantity::bigint * unit_amount_cents * 1050 + 5000) / 10000)::integer ELSE 0 END) STORED,
  ivu_municipal_cents integer GENERATED ALWAYS AS (CASE WHEN tax_category = 'taxable'
    THEN ((quantity::bigint * unit_amount_cents * 100 + 5000) / 10000)::integer ELSE 0 END) STORED,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES app.invoice (org_id, id),
  FOREIGN KEY (org_id, product_id, price_id) REFERENCES app.price (org_id, product_id, id)
);
CREATE INDEX invoice_line_invoice_idx ON app.invoice_line (invoice_id);

-- Payments: simulated methods only; never card numbers (no PAN column; references carry at most 6 digits).
CREATE TABLE app.payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  invoice_id uuid NOT NULL,
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  method app.payment_method NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  status app.payment_status NOT NULL DEFAULT 'succeeded',
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  reference text CHECK (reference ~ '^[A-Za-z0-9 #._-]{1,40}$' AND regexp_count(reference, '[0-9]') <= 6),
  provider_ref text CHECK (provider_ref ~ '^[a-z]{2,8}_[A-Za-z0-9]{6,64}$'),
  recorded_by uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, invoice_id) REFERENCES app.invoice (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);
CREATE INDEX payment_invoice_idx ON app.payment (invoice_id);

-- Session credits (class packs, PT packages). Consumption belongs to the schedule module (wave B wiring).
CREATE TABLE app.credit_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  credits_total integer NOT NULL CHECK (credits_total BETWEEN 1 AND 5000),
  credits_remaining integer NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.plan_product (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES app.invoice (org_id, id),
  CHECK (credits_remaining BETWEEN 0 AND credits_total)
);

-- Day pass / single session entitlement (spec §5.2 AccessCredential window).
CREATE TABLE app.access_pass (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  product_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.plan_product (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES app.invoice (org_id, id),
  CHECK (valid_to > valid_from)
);

-- ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────

-- Platform fee basis points by SaaS plan (spec §5.1 [P]); mirrors APPLICATION_FEE_BPS in @gym/shared.
CREATE FUNCTION app.application_fee_bps(p_plan app.saas_plan) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_plan WHEN 'esencial' THEN 100 WHEN 'pro' THEN 75 WHEN 'elite' THEN 50 END
$$;

CREATE FUNCTION app.billing_next_period_end(p_start date, p_interval app.billing_interval) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_interval WHEN 'month' THEN (p_start + interval '1 month')::date
                         WHEN 'year' THEN (p_start + interval '1 year')::date END
$$;

-- ── Policy helpers (used by RLS; they only read claims) ─────────────────────────────────────────────────
-- Front-of-house billing staff at a location: owner (org-wide), or location manager / front desk assigned there.
CREATE FUNCTION app.billing_staff_at(p_loc uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'front_desk'), false) AND app.can_see_location(p_loc)
$$;

-- The caller is the member themself or their guardian. Owned by app_definer (reads member / guardian_link
-- without RLS, applying the rule explicitly) to avoid policy recursion.
CREATE FUNCTION app.billing_is_self(p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('member', 'guardian'), false) AND (
    EXISTS (SELECT 1 FROM app.member m
             WHERE m.id = p_member AND m.org_id = app.org_id() AND m.person_id = app.person_id())
    OR EXISTS (SELECT 1 FROM app.guardian_link g
                WHERE g.member_id = p_member AND g.org_id = app.org_id() AND g.guardian_person_id = app.person_id()))
$$;

-- ── Internal helpers (app_definer only) ──────────────────────────────────────────────────────────────────

CREATE FUNCTION app.billing_today(p_loc uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT l.timezone FROM app.location l WHERE l.id = p_loc),
                                      'America/Puerto_Rico'))::date
$$;

-- Effective policy for a location: its override, else the org default, else built-in defaults.
CREATE FUNCTION app.billing_policy_for(p_loc uuid, OUT max_commitment_months integer, OUT invoice_due_days integer,
                                       OUT max_freeze_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  SELECT p.max_commitment_months, p.invoice_due_days, p.max_freeze_days
    INTO max_commitment_months, invoice_due_days, max_freeze_days
    FROM app.billing_policy p
   WHERE p.org_id = app.org_id() AND (p.location_id = p_loc OR p.location_id IS NULL)
   ORDER BY p.location_id NULLS LAST LIMIT 1;
  max_commitment_months := coalesce(max_commitment_months, 0);
  invoice_due_days := coalesce(invoice_due_days, 3);
  max_freeze_days := coalesce(max_freeze_days, 90);
END $$;

-- Issue one invoice with its lines. Callers have already checked role, location and member. Totals are the sums
-- of the generated per-line amounts; the fee comes from the org's plan; the number from the locked counter.
CREATE FUNCTION app.billing_issue_invoice(p_member uuid, p_location uuid, p_subscription uuid, p_period_start date,
                                          p_period_end date, p_price_ids uuid[], p_quantities integer[],
                                          p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_le uuid;
  v_muni text;
  v_bps integer;
  v_no bigint;
  v_id uuid;
  v_due date;
  v_sub integer;
  v_st integer;
  v_mu integer;
  i integer;
BEGIN
  IF v_org IS NULL OR coalesce(array_length(p_price_ids, 1), 0) = 0
     OR array_length(p_price_ids, 1) IS DISTINCT FROM array_length(p_quantities, 1) THEN
    RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
  END IF;
  SELECT l.legal_entity_id, l.municipality INTO v_le, v_muni
    FROM app.location l WHERE l.id = p_location AND l.org_id = v_org;
  IF v_le IS NULL THEN RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501'; END IF;
  SELECT app.application_fee_bps(o.saas_plan) INTO v_bps FROM app.organization o WHERE o.id = v_org;
  v_due := coalesce(p_period_start, app.billing_today(p_location))
           + (SELECT invoice_due_days FROM app.billing_policy_for(p_location));

  -- First invoice of a legal entity: create its counter row (a concurrent creator waits on the unique key).
  -- Every later invoice is serialised by the FOR UPDATE row lock below, held until commit.
  IF NOT EXISTS (SELECT 1 FROM app.invoice_counter c WHERE c.legal_entity_id = v_le) THEN
    INSERT INTO app.invoice_counter (org_id, legal_entity_id) VALUES (v_org, v_le) ON CONFLICT DO NOTHING;
  END IF;
  SELECT c.next_no INTO v_no FROM app.invoice_counter c WHERE c.legal_entity_id = v_le FOR UPDATE;
  UPDATE app.invoice_counter SET next_no = next_no + 1 WHERE legal_entity_id = v_le;

  INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, municipality, subscription_id,
                           period_start, period_end, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents,
                           application_fee_bps, application_fee_cents, due_date, idempotency_key, created_by)
  VALUES (v_org, v_le, v_no, p_member, p_location, v_muni, p_subscription, p_period_start, p_period_end, 0, 0, 0, 0,
          v_bps, 0, v_due, p_idempotency_key, app.person_id())
  RETURNING id INTO v_id;

  FOR i IN 1 .. array_length(p_price_ids, 1) LOOP
    INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents,
                                  tax_category)
    SELECT v_org, v_id, pr.product_id, pr.id, left(pp.name, 120), p_quantities[i], pr.amount_cents, pp.tax_category
      FROM app.price pr JOIN app.plan_product pp ON pp.id = pr.product_id
     WHERE pr.id = p_price_ids[i] AND pr.org_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'; END IF;
  END LOOP;

  SELECT sum(amount_cents), sum(ivu_state_cents), sum(ivu_municipal_cents) INTO v_sub, v_st, v_mu
    FROM app.invoice_line WHERE invoice_id = v_id;
  UPDATE app.invoice
     SET subtotal_cents = v_sub, ivu_state_cents = v_st, ivu_municipal_cents = v_mu,
         total_cents = v_sub + v_st + v_mu,
         application_fee_cents = (((v_sub + v_st + v_mu)::bigint * v_bps + 5000) / 10000)::integer,
         status = CASE WHEN v_sub + v_st + v_mu = 0 THEN 'paid' ELSE 'open' END::app.invoice_status,
         paid_at = CASE WHEN v_sub + v_st + v_mu = 0 THEN now() END
   WHERE id = v_id;
  PERFORM app.audit('invoice.issue', 'invoice', v_id::text, p_location,
                    jsonb_build_object('number', v_no, 'total_cents', v_sub + v_st + v_mu,
                                       'ivu_state_cents', v_st, 'ivu_municipal_cents', v_mu,
                                       'application_fee_bps', v_bps, 'subscription_id', p_subscription));
  RETURN v_id;
END $$;

-- Insert a succeeded payment and settle the invoice when fully paid. Caller holds the invoice lock.
CREATE FUNCTION app.billing_apply_payment(p_invoice uuid, p_method app.payment_method, p_amount integer,
                                          p_idempotency_key text, p_reference text, p_provider_ref text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_inv app.invoice;
  v_paid integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_inv FROM app.invoice WHERE id = p_invoice AND org_id = app.org_id();
  IF v_inv.status <> 'open' THEN RAISE EXCEPTION 'invoice_not_open' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO v_paid FROM app.payment
   WHERE invoice_id = p_invoice AND status = 'succeeded';
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > v_inv.total_cents - v_paid THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, status, idempotency_key,
                           reference, provider_ref, recorded_by)
  VALUES (v_inv.org_id, p_invoice, v_inv.member_id, v_inv.location_id, p_method, p_amount, 'succeeded',
          p_idempotency_key, nullif(btrim(p_reference), ''), p_provider_ref, app.person_id())
  RETURNING id INTO v_id;
  IF v_paid + p_amount = v_inv.total_cents THEN
    UPDATE app.invoice SET status = 'paid', paid_at = now() WHERE id = p_invoice;
  END IF;
  PERFORM app.audit('payment.record', 'payment', v_id::text, v_inv.location_id,
                    jsonb_build_object('invoice_id', p_invoice, 'amount_cents', p_amount, 'method', p_method,
                                       'settled', v_paid + p_amount = v_inv.total_cents));
  RETURN v_id;
END $$;

-- Recompute subscription and member status from billing facts as of a date. Never touches passes or credits:
-- an overdue invoice marks the member past_due for a human to act on; it does not deny access (spec §5.2).
CREATE FUNCTION app.billing_refresh(p_member uuid, p_as_of date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_cur app.member_status;
  v_new app.member_status;
BEGIN
  UPDATE app.subscription s SET status = x.new_status
    FROM (SELECT s2.id, CASE
            WHEN EXISTS (SELECT 1 FROM app.subscription_freeze f WHERE f.subscription_id = s2.id
                          AND p_as_of >= f.start_date AND p_as_of < f.end_date) THEN 'frozen'
            WHEN EXISTS (SELECT 1 FROM app.invoice i WHERE i.subscription_id = s2.id AND i.status = 'open'
                          AND i.due_date < p_as_of) THEN 'past_due'
            ELSE 'active' END::app.subscription_status AS new_status
            FROM app.subscription s2
           WHERE s2.member_id = p_member AND s2.org_id = v_org AND s2.status <> 'cancelled') x
   WHERE s.id = x.id AND s.status <> x.new_status;

  SELECT m.status INTO v_cur FROM app.member m WHERE m.id = p_member AND m.org_id = v_org;
  IF v_cur IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.invoice i WHERE i.member_id = p_member AND i.status = 'open' AND i.due_date < p_as_of) THEN
    v_new := 'past_due';
  ELSIF EXISTS (SELECT 1 FROM app.subscription s WHERE s.member_id = p_member AND s.status = 'active') THEN
    v_new := 'active';
  ELSIF EXISTS (SELECT 1 FROM app.subscription s WHERE s.member_id = p_member AND s.status = 'frozen') THEN
    v_new := 'frozen';
  ELSIF EXISTS (SELECT 1 FROM app.subscription s WHERE s.member_id = p_member) THEN
    v_new := 'cancelled';
  ELSIF v_cur = 'past_due' THEN
    v_new := 'active';  -- pay-per-session member whose overdue invoice is settled
  ELSIF v_cur IN ('lead', 'trial') AND (
          EXISTS (SELECT 1 FROM app.credit_balance c WHERE c.member_id = p_member AND c.credits_remaining > 0
                   AND (c.expires_at IS NULL OR c.expires_at > now()))
       OR EXISTS (SELECT 1 FROM app.access_pass a WHERE a.member_id = p_member AND a.valid_to > now())) THEN
    v_new := 'active';  -- first paid session or pack
  ELSE
    v_new := v_cur;
  END IF;
  IF v_new IS DISTINCT FROM v_cur THEN
    UPDATE app.member SET status = v_new WHERE id = p_member;  -- audited by member_audit
  END IF;
END $$;

-- ── Request entry points (SECURITY DEFINER, claims re-checked, audited) ───────────────────────────────────

-- Subscribe a member to a recurring price; issues the first period's invoice (plus an optional enrollment fee).
CREATE FUNCTION app.create_subscription(p_member uuid, p_price uuid, p_start date, p_enrollment_price uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_loc uuid;
  v_price app.price;
  v_kind app.product_kind;
  v_fee app.price;
  v_today date;
  v_start date;
  v_end date;
  v_sub uuid;
  v_inv uuid;
  v_ids uuid[];
  v_qty integer[];
BEGIN
  IF v_org IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.home_location_id INTO v_loc FROM app.member m WHERE m.id = p_member AND m.org_id = v_org FOR UPDATE;
  IF v_loc IS NULL OR NOT app.billing_staff_at(v_loc) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_price FROM app.price WHERE id = p_price AND org_id = v_org AND active;
  SELECT kind INTO v_kind FROM app.plan_product WHERE id = v_price.product_id AND active;
  IF v_price.id IS NULL OR v_kind IS NULL OR (v_price.location_id IS NOT NULL AND v_price.location_id <> v_loc) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('membership', 'addon') OR v_price.billing_interval = 'none' THEN
    RAISE EXCEPTION 'not_recurring' USING ERRCODE = '22023';
  END IF;
  IF v_price.commitment_months > (SELECT max_commitment_months FROM app.billing_policy_for(v_loc)) THEN
    RAISE EXCEPTION 'commitment_not_allowed' USING ERRCODE = '22023';
  END IF;
  v_today := app.billing_today(v_loc);
  v_start := coalesce(p_start, v_today);
  IF v_start < v_today - 31 OR v_start > v_today + 90 THEN RAISE EXCEPTION 'invalid_start' USING ERRCODE = '22023'; END IF;
  v_end := app.billing_next_period_end(v_start, v_price.billing_interval);

  INSERT INTO app.subscription (org_id, member_id, product_id, price_id, location_id, billing_interval, start_date,
                                current_period_start, current_period_end, commitment_end, created_by)
  VALUES (v_org, p_member, v_price.product_id, v_price.id, v_loc, v_price.billing_interval, v_start, v_start, v_end,
          CASE WHEN v_price.commitment_months > 0
               THEN (v_start + make_interval(months => v_price.commitment_months))::date END,
          app.person_id())
  RETURNING id INTO v_sub;

  v_ids := ARRAY[v_price.id];
  v_qty := ARRAY[1];
  IF p_enrollment_price IS NOT NULL THEN
    SELECT pr.* INTO v_fee FROM app.price pr JOIN app.plan_product pp ON pp.id = pr.product_id
     WHERE pr.id = p_enrollment_price AND pr.org_id = v_org AND pr.active AND pp.active AND pp.kind = 'enrollment_fee'
       AND (pr.location_id IS NULL OR pr.location_id = v_loc);
    IF v_fee.id IS NULL THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'; END IF;
    v_ids := v_ids || v_fee.id;
    v_qty := v_qty || 1;
  END IF;
  v_inv := app.billing_issue_invoice(p_member, v_loc, v_sub, v_start, v_end, v_ids, v_qty, NULL);
  PERFORM app.audit('subscription.create', 'subscription', v_sub::text, v_loc,
                    jsonb_build_object('price_id', v_price.id, 'invoice_id', v_inv, 'start', v_start,
                                       'commitment_months', v_price.commitment_months));
  PERFORM app.billing_refresh(p_member, v_today);
  RETURN v_sub;
END $$;

-- Freeze for [p_start, p_end). The period end and the commitment end move forward by the freeze length.
CREATE FUNCTION app.freeze_subscription(p_subscription uuid, p_start date, p_end date, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_sub app.subscription;
  v_today date;
  v_id uuid;
  v_days integer;
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM app.subscription WHERE id = p_subscription AND org_id = app.org_id() FOR UPDATE;
  IF v_sub.id IS NULL OR NOT app.billing_staff_at(v_sub.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_sub.status = 'cancelled' THEN RAISE EXCEPTION 'subscription_cancelled' USING ERRCODE = '22023'; END IF;
  v_today := app.billing_today(v_sub.location_id);
  v_days := p_end - p_start;
  IF p_start IS NULL OR p_end IS NULL OR p_start < v_today OR v_days < 1
     OR v_days > (SELECT max_freeze_days FROM app.billing_policy_for(v_sub.location_id)) THEN
    RAISE EXCEPTION 'invalid_freeze' USING ERRCODE = '22023';
  END IF;
  IF p_start < v_sub.current_period_start OR p_start >= v_sub.current_period_end THEN
    RAISE EXCEPTION 'freeze_outside_period' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM app.subscription_freeze f WHERE f.subscription_id = p_subscription
              AND daterange(f.start_date, f.end_date) && daterange(p_start, p_end)) THEN
    RAISE EXCEPTION 'freeze_overlap' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.subscription_freeze (org_id, subscription_id, member_id, location_id, start_date, end_date, reason,
                                       created_by)
  VALUES (v_sub.org_id, p_subscription, v_sub.member_id, v_sub.location_id, p_start, p_end,
          nullif(btrim(p_reason), ''), app.person_id())
  RETURNING id INTO v_id;
  UPDATE app.subscription
     SET current_period_end = current_period_end + v_days,
         commitment_end = commitment_end + v_days
   WHERE id = p_subscription;
  PERFORM app.audit('subscription.freeze', 'subscription', p_subscription::text, v_sub.location_id,
                    jsonb_build_object('freeze_id', v_id, 'start', p_start, 'end', p_end, 'days', v_days,
                                       'new_period_end', v_sub.current_period_end + v_days));
  PERFORM app.billing_refresh(v_sub.member_id, v_today);
  RETURN v_id;
END $$;

-- Cancel at period end (or at the commitment end if later). Staff at the location, the member, or their guardian.
-- Returns the date the subscription stops. Idempotent.
CREATE FUNCTION app.cancel_subscription(p_subscription uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_sub app.subscription;
  v_effective date;
BEGIN
  IF app.org_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sub FROM app.subscription WHERE id = p_subscription AND org_id = app.org_id() FOR UPDATE;
  IF v_sub.id IS NULL OR NOT (app.billing_staff_at(v_sub.location_id) OR app.billing_is_self(v_sub.member_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_sub.status = 'cancelled' THEN RAISE EXCEPTION 'subscription_cancelled' USING ERRCODE = '22023'; END IF;
  v_effective := greatest(v_sub.current_period_end, coalesce(v_sub.commitment_end, v_sub.current_period_end));
  IF NOT v_sub.cancel_at_period_end THEN
    UPDATE app.subscription SET cancel_at_period_end = true, cancel_requested_at = now() WHERE id = p_subscription;
    PERFORM app.audit('subscription.cancel_request', 'subscription', p_subscription::text, v_sub.location_id,
                      jsonb_build_object('effective_date', v_effective));
  END IF;
  RETURN v_effective;
END $$;

-- Record a payment against an open invoice (front of house at the invoice's location). Idempotent by key.
CREATE FUNCTION app.record_payment(p_invoice uuid, p_method app.payment_method, p_amount_cents integer,
                                   p_idempotency_key text, p_reference text, p_provider_ref text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_inv app.invoice;
  v_existing app.payment;
  v_id uuid;
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM app.invoice WHERE id = p_invoice AND org_id = app.org_id() FOR UPDATE;
  IF v_inv.id IS NULL OR NOT app.billing_staff_at(v_inv.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM app.payment WHERE org_id = app.org_id() AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.invoice_id = p_invoice AND v_existing.amount_cents = p_amount_cents THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  v_id := app.billing_apply_payment(p_invoice, p_method, p_amount_cents, p_idempotency_key, p_reference, p_provider_ref);
  PERFORM app.billing_refresh(v_inv.member_id, app.billing_today(v_inv.location_id));
  RETURN v_id;
END $$;

-- Sell a one-off at the desk: single session (drop_in), day pass, session pack or PT package. Issues the invoice
-- with IVU, records the payment in full, and grants the pass or the credits. Idempotent by key.
CREATE FUNCTION app.sell_one_off(p_member uuid, p_price uuid, p_location uuid, p_quantity integer,
                                 p_method app.payment_method, p_idempotency_key text, p_provider_ref text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_price app.price;
  v_kind app.product_kind;
  v_inv uuid;
  v_existing app.invoice;
  v_total integer;
  v_qty integer := coalesce(p_quantity, 1);
BEGIN
  IF v_org IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager', 'front_desk'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org)
     OR NOT app.billing_staff_at(p_location) OR NOT app.staff_can_see_member(p_member) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_method IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  -- Serialise retries of the same sale, then answer them with the first result.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text || ':sale:' || p_idempotency_key, 0));
  SELECT * INTO v_existing FROM app.invoice WHERE org_id = v_org AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.member_id = p_member THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_price FROM app.price WHERE id = p_price AND org_id = v_org AND active;
  SELECT kind INTO v_kind FROM app.plan_product WHERE id = v_price.product_id AND active;
  IF v_price.id IS NULL OR v_kind IS NULL OR (v_price.location_id IS NOT NULL AND v_price.location_id <> p_location) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('drop_in', 'day_pass', 'class_pack', 'pt_package') THEN
    RAISE EXCEPTION 'not_one_off' USING ERRCODE = '22023';
  END IF;
  IF v_qty < 1 OR v_qty > 20 OR (v_kind IN ('drop_in', 'day_pass') AND v_qty <> 1) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;

  v_inv := app.billing_issue_invoice(p_member, p_location, NULL, NULL, NULL, ARRAY[v_price.id], ARRAY[v_qty],
                                     p_idempotency_key);
  SELECT total_cents INTO v_total FROM app.invoice WHERE id = v_inv;
  IF v_total > 0 THEN
    PERFORM app.billing_apply_payment(v_inv, p_method, v_total, p_idempotency_key, NULL, p_provider_ref);
  END IF;
  IF v_kind IN ('drop_in', 'day_pass') THEN
    INSERT INTO app.access_pass (org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to)
    VALUES (v_org, p_member, p_location, v_price.product_id, v_inv, now(),
            now() + make_interval(days => coalesce(v_price.validity_days, 1)));
  ELSE
    INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total,
                                    credits_remaining, expires_at)
    VALUES (v_org, p_member, v_price.product_id, p_location, v_inv, v_price.credits * v_qty, v_price.credits * v_qty,
            CASE WHEN v_price.validity_days IS NOT NULL THEN now() + make_interval(days => v_price.validity_days) END);
  END IF;
  PERFORM app.audit('sale.one_off', 'invoice', v_inv::text, p_location,
                    jsonb_build_object('price_id', v_price.id, 'kind', v_kind, 'quantity', v_qty,
                                       'method', p_method, 'total_cents', v_total));
  PERFORM app.billing_refresh(p_member, app.billing_today(p_location));
  RETURN v_inv;
END $$;

-- Void an open invoice without payments (owner, or the location manager of its location). The number stays used.
CREATE FUNCTION app.void_invoice(p_invoice uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_inv app.invoice;
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM app.invoice WHERE id = p_invoice AND org_id = app.org_id() FOR UPDATE;
  IF v_inv.id IS NULL OR NOT app.billing_staff_at(v_inv.location_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'open' OR EXISTS (SELECT 1 FROM app.payment p WHERE p.invoice_id = p_invoice AND p.status = 'succeeded') THEN
    RAISE EXCEPTION 'invoice_not_voidable' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE app.invoice SET status = 'void', voided_at = now(), void_reason = btrim(p_reason) WHERE id = p_invoice;
  PERFORM app.billing_refresh(v_inv.member_id, app.billing_today(v_inv.location_id));
END $$;

-- Renewal cycle as of a date (owner: every location or one; location manager: assigned locations). For each live
-- subscription whose period has ended: cancel it if cancellation was requested and the commitment is met, else
-- roll the period and issue its invoice (one per period: idempotent). Then refresh member statuses.
CREATE FUNCTION app.run_billing_cycle(p_as_of date, p_location uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_as_of date := coalesce(p_as_of, (now() AT TIME ZONE 'America/Puerto_Rico')::date);
  v_sub app.subscription;
  v_start date;
  v_end date;
  v_n integer;
  v_members uuid[] := '{}';
  v_m uuid;
  v_renewed integer := 0;
  v_invoices integer := 0;
  v_cancelled integer := 0;
  v_past_due integer := 0;
BEGIN
  IF v_org IS NULL OR coalesce(app.role() NOT IN ('owner', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_location IS NOT NULL AND (NOT app.can_see_location(p_location)
     OR NOT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = v_org)) THEN
    RAISE EXCEPTION 'forbidden_location' USING ERRCODE = '42501';
  END IF;
  -- No billing ahead of time: as_of may not be later than "today" anywhere on Earth (UTC + 1 day).
  IF v_as_of > (now() AT TIME ZONE 'UTC')::date + 1 OR v_as_of < (now() AT TIME ZONE 'UTC')::date - 366 THEN
    RAISE EXCEPTION 'invalid_as_of' USING ERRCODE = '22023';
  END IF;

  FOR v_sub IN
    SELECT * FROM app.subscription s
     WHERE s.org_id = v_org AND s.status <> 'cancelled' AND app.can_see_location(s.location_id)
       AND (p_location IS NULL OR s.location_id = p_location)
     ORDER BY s.id FOR UPDATE
  LOOP
    v_n := 0;
    WHILE v_sub.current_period_end <= v_as_of AND v_n < 24 LOOP
      IF v_sub.cancel_at_period_end AND (v_sub.commitment_end IS NULL OR v_sub.commitment_end <= v_sub.current_period_end) THEN
        UPDATE app.subscription SET status = 'cancelled', cancelled_at = now() WHERE id = v_sub.id;
        v_cancelled := v_cancelled + 1;
        EXIT;
      END IF;
      v_start := v_sub.current_period_end;
      v_end := app.billing_next_period_end(v_start, v_sub.billing_interval);
      IF NOT EXISTS (SELECT 1 FROM app.invoice i WHERE i.subscription_id = v_sub.id AND i.period_start = v_start) THEN
        PERFORM app.billing_issue_invoice(v_sub.member_id, v_sub.location_id, v_sub.id, v_start, v_end,
                                          ARRAY[v_sub.price_id], ARRAY[1], NULL);
        v_invoices := v_invoices + 1;
      END IF;
      UPDATE app.subscription SET current_period_start = v_start, current_period_end = v_end
       WHERE id = v_sub.id RETURNING * INTO v_sub;
      v_renewed := v_renewed + 1;
      v_n := v_n + 1;
    END LOOP;
    v_members := v_members || v_sub.member_id;
  END LOOP;

  v_members := v_members || ARRAY(
    SELECT DISTINCT i.member_id FROM app.invoice i
     WHERE i.org_id = v_org AND i.status = 'open' AND i.due_date < v_as_of AND app.can_see_location(i.location_id)
       AND (p_location IS NULL OR i.location_id = p_location));
  FOR v_m IN SELECT DISTINCT unnest(v_members) LOOP
    PERFORM app.billing_refresh(v_m, v_as_of);
    IF (SELECT status FROM app.member WHERE id = v_m) = 'past_due' THEN v_past_due := v_past_due + 1; END IF;
  END LOOP;

  PERFORM app.audit('billing.cycle', 'organization', v_org::text, p_location,
                    jsonb_build_object('as_of', v_as_of, 'renewed', v_renewed, 'invoices', v_invoices,
                                       'cancelled', v_cancelled, 'past_due', v_past_due));
  RETURN jsonb_build_object('as_of', v_as_of, 'renewed', v_renewed, 'invoices', v_invoices,
                            'cancelled', v_cancelled, 'past_due_members', v_past_due);
END $$;

-- Platform fee per invoice: owner and accountant (org-wide) or a location manager (assigned locations). Members and
-- front desk never read fees (the columns are not granted to request traffic).
CREATE FUNCTION app.invoice_fees(p_location uuid)
RETURNS TABLE (invoice_id uuid, application_fee_bps integer, application_fee_cents integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL OR coalesce(app.role() NOT IN ('owner', 'accountant', 'location_manager'), true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.application_fee_bps, i.application_fee_cents FROM app.invoice i
     WHERE i.org_id = app.org_id() AND app.can_see_location(i.location_id)
       AND (p_location IS NULL OR i.location_id = p_location)
     ORDER BY i.issued_at DESC LIMIT 500;
END $$;

-- ── Triggers: price consistency and audit of catalogue / status changes ───────────────────────────────────

-- A price must fit its product kind: recurring kinds bill monthly/yearly; packs carry credits; the rest are one-off.
CREATE FUNCTION app.price_kind_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_kind app.product_kind;
BEGIN
  SELECT kind INTO v_kind FROM app.plan_product WHERE id = NEW.product_id AND org_id = NEW.org_id;
  IF v_kind IS NULL
     OR (v_kind IN ('membership', 'addon') AND (NEW.billing_interval = 'none' OR NEW.credits IS NOT NULL))
     OR (v_kind IN ('class_pack', 'pt_package') AND (NEW.billing_interval <> 'none' OR NEW.credits IS NULL))
     OR (v_kind IN ('day_pass', 'drop_in', 'enrollment_fee') AND (NEW.billing_interval <> 'none' OR NEW.credits IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid_price_for_kind' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER price_kind_check BEFORE INSERT OR UPDATE ON app.price
  FOR EACH ROW EXECUTE FUNCTION app.price_kind_check();

CREATE FUNCTION app.billing_audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_meta jsonb;
  v_loc uuid;
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;  -- migrations, fixtures and seeds have no actor
  IF TG_TABLE_NAME = 'plan_product' THEN
    v_meta := jsonb_build_object('kind', NEW.kind, 'name', NEW.name, 'tax_category', NEW.tax_category, 'active', NEW.active);
  ELSIF TG_TABLE_NAME = 'price' THEN
    v_loc := NEW.location_id;
    v_meta := jsonb_build_object('product_id', NEW.product_id, 'amount_cents', NEW.amount_cents,
                                 'billing_interval', NEW.billing_interval, 'active', NEW.active);
  ELSIF TG_TABLE_NAME = 'billing_policy' THEN
    v_loc := NEW.location_id;
    v_meta := jsonb_build_object('max_commitment_months', NEW.max_commitment_months,
                                 'invoice_due_days', NEW.invoice_due_days, 'max_freeze_days', NEW.max_freeze_days);
  ELSIF TG_TABLE_NAME = 'subscription' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.current_period_end IS NOT DISTINCT FROM OLD.current_period_end
       AND NEW.cancel_at_period_end IS NOT DISTINCT FROM OLD.cancel_at_period_end THEN RETURN NEW; END IF;
    v_loc := NEW.location_id;
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN NEW.status END,
      'from_status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN OLD.status END,
      'period_end', CASE WHEN NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN NEW.current_period_end END,
      'cancel_at_period_end', CASE WHEN NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end THEN NEW.cancel_at_period_end END));
  ELSIF TG_TABLE_NAME = 'invoice' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_loc := NEW.location_id;
    v_meta := jsonb_build_object('status', NEW.status, 'from_status', OLD.status, 'number', NEW.number,
                                 'void_reason', NEW.void_reason);
  END IF;
  PERFORM app.audit(TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, NEW.id::text, v_loc, v_meta);
  RETURN NEW;
END $$;
CREATE TRIGGER plan_product_audit AFTER INSERT OR UPDATE ON app.plan_product
  FOR EACH ROW EXECUTE FUNCTION app.billing_audit_trigger();
CREATE TRIGGER price_audit AFTER INSERT OR UPDATE ON app.price
  FOR EACH ROW EXECUTE FUNCTION app.billing_audit_trigger();
CREATE TRIGGER billing_policy_audit AFTER INSERT OR UPDATE ON app.billing_policy
  FOR EACH ROW EXECUTE FUNCTION app.billing_audit_trigger();
CREATE TRIGGER subscription_audit AFTER UPDATE ON app.subscription
  FOR EACH ROW EXECUTE FUNCTION app.billing_audit_trigger();
CREATE TRIGGER invoice_status_audit AFTER UPDATE ON app.invoice
  FOR EACH ROW EXECUTE FUNCTION app.billing_audit_trigger();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE app.billing_policy      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.billing_policy      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.plan_product        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.plan_product        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.price               ENABLE ROW LEVEL SECURITY; ALTER TABLE app.price               FORCE ROW LEVEL SECURITY;
ALTER TABLE app.subscription        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.subscription        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_freeze ENABLE ROW LEVEL SECURITY; ALTER TABLE app.subscription_freeze FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invoice_counter     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.invoice_counter     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invoice             ENABLE ROW LEVEL SECURITY; ALTER TABLE app.invoice             FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invoice_line        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.invoice_line        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.payment             ENABLE ROW LEVEL SECURITY; ALTER TABLE app.payment             FORCE ROW LEVEL SECURITY;
ALTER TABLE app.credit_balance      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.credit_balance      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.access_pass         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.access_pass         FORCE ROW LEVEL SECURITY;

-- Policy: owner writes; owner and location managers (their location or the org default) read; front desk reads.
CREATE POLICY billing_policy_select ON app.billing_policy FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
  AND (location_id IS NULL OR (SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY billing_policy_insert ON app.billing_policy FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner');
CREATE POLICY billing_policy_update ON app.billing_policy FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) = 'owner') WITH CHECK (org_id = (SELECT app.org_id()));

-- Catalogue: front of house, accountant, members and guardians read; owner and location managers write.
-- Trainers, chef and clinical roles have no billing access.
CREATE POLICY plan_product_select ON app.plan_product FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk', 'accountant', 'member', 'guardian'));
CREATE POLICY plan_product_insert ON app.plan_product FOR INSERT
  WITH CHECK (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'));
CREATE POLICY plan_product_update ON app.plan_product FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'))
  WITH CHECK (org_id = (SELECT app.org_id()));

CREATE POLICY price_select ON app.price FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) IN ('owner', 'accountant', 'member', 'guardian')
    OR ((SELECT app.role()) IN ('location_manager', 'front_desk')
        AND (location_id IS NULL OR location_id = ANY ((SELECT app.location_ids())::uuid[])))));
-- Owner: any location or org-wide. Location manager: only prices of an assigned location (never org-wide).
CREATE POLICY price_insert ON app.price FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))));
CREATE POLICY price_update ON app.price FOR UPDATE USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'owner'
    OR ((SELECT app.role()) = 'location_manager' AND location_id = ANY ((SELECT app.location_ids())::uuid[]))))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- Subscriptions, freezes, credits and passes: front of house at the location, the member, their guardian.
CREATE POLICY subscription_select ON app.subscription FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));
CREATE POLICY subscription_freeze_select ON app.subscription_freeze FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));
CREATE POLICY credit_balance_select ON app.credit_balance FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));
CREATE POLICY access_pass_select ON app.access_pass FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));

-- Invoices and payments: also the accountant (read-only, org-wide).
CREATE POLICY invoice_select ON app.invoice FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'accountant' OR app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));
CREATE POLICY invoice_line_select ON app.invoice_line FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND EXISTS (SELECT 1 FROM app.invoice i WHERE i.id = invoice_line.invoice_id));
CREATE POLICY payment_select ON app.payment FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) = 'accountant' OR app.billing_staff_at(location_id) OR app.billing_is_self(member_id)));
CREATE POLICY invoice_counter_select ON app.invoice_counter FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'accountant'));

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.billing_policy      TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.plan_product        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.price               TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.subscription        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.subscription_freeze TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.invoice_counter     TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.invoice             TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.invoice_line        TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.payment             TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.credit_balance      TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.access_pass         TO app_definer USING (true) WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON app.billing_policy, app.plan_product, app.price, app.subscription, app.subscription_freeze,
  app.invoice_counter, app.invoice, app.invoice_line, app.payment, app.credit_balance, app.access_pass FROM PUBLIC;
GRANT SELECT ON app.billing_policy, app.plan_product, app.price, app.subscription, app.subscription_freeze,
  app.invoice_counter, app.invoice_line, app.payment, app.credit_balance, app.access_pass TO app_authenticated;
-- Invoices: every column except the platform fee (read through app.invoice_fees for owner/accountant/manager).
GRANT SELECT (id, org_id, legal_entity_id, number, member_id, location_id, municipality, subscription_id, period_start,
  period_end, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents, status, issued_at, due_date, paid_at,
  voided_at, void_reason, idempotency_key, created_by) ON app.invoice TO app_authenticated;
-- Writable columns. Never org_id, kind (a product's kind is fixed), amounts of an existing price, or anything on
-- subscriptions, invoices, payments, credits or passes (those change only through the definer functions).
GRANT INSERT (kind, name, description, tax_category, active), UPDATE (name, description, tax_category, active)
  ON app.plan_product TO app_authenticated;
GRANT INSERT (product_id, location_id, amount_cents, billing_interval, credits, validity_days, commitment_months, active),
  UPDATE (active) ON app.price TO app_authenticated;
GRANT INSERT (location_id, max_commitment_months, invoice_due_days, max_freeze_days),
  UPDATE (max_commitment_months, invoice_due_days, max_freeze_days, updated_at) ON app.billing_policy TO app_authenticated;

GRANT SELECT, INSERT, UPDATE ON app.billing_policy, app.plan_product, app.price, app.subscription,
  app.subscription_freeze, app.invoice_counter, app.invoice, app.invoice_line, app.payment, app.credit_balance,
  app.access_pass TO app_definer;
GRANT SELECT ON app.organization, app.legal_entity TO app_definer;
GRANT UPDATE (status) ON app.member TO app_definer;

ALTER FUNCTION app.billing_is_self(uuid) OWNER TO app_definer;
ALTER FUNCTION app.billing_today(uuid) OWNER TO app_definer;
ALTER FUNCTION app.billing_policy_for(uuid) OWNER TO app_definer;
ALTER FUNCTION app.billing_issue_invoice(uuid, uuid, uuid, date, date, uuid[], integer[], text) OWNER TO app_definer;
ALTER FUNCTION app.billing_apply_payment(uuid, app.payment_method, integer, text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.billing_refresh(uuid, date) OWNER TO app_definer;
ALTER FUNCTION app.create_subscription(uuid, uuid, date, uuid) OWNER TO app_definer;
ALTER FUNCTION app.freeze_subscription(uuid, date, date, text) OWNER TO app_definer;
ALTER FUNCTION app.cancel_subscription(uuid) OWNER TO app_definer;
ALTER FUNCTION app.record_payment(uuid, app.payment_method, integer, text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.sell_one_off(uuid, uuid, uuid, integer, app.payment_method, text, text) OWNER TO app_definer;
ALTER FUNCTION app.void_invoice(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.run_billing_cycle(date, uuid) OWNER TO app_definer;
ALTER FUNCTION app.invoice_fees(uuid) OWNER TO app_definer;
ALTER FUNCTION app.price_kind_check() OWNER TO app_definer;
ALTER FUNCTION app.billing_audit_trigger() OWNER TO app_definer;

-- New functions are executable by PUBLIC by default: revoke everything, then grant the request entry points.
REVOKE ALL ON FUNCTION app.application_fee_bps(app.saas_plan), app.billing_next_period_end(date, app.billing_interval),
  app.billing_staff_at(uuid), app.billing_is_self(uuid), app.billing_today(uuid), app.billing_policy_for(uuid),
  app.billing_issue_invoice(uuid, uuid, uuid, date, date, uuid[], integer[], text),
  app.billing_apply_payment(uuid, app.payment_method, integer, text, text, text), app.billing_refresh(uuid, date),
  app.create_subscription(uuid, uuid, date, uuid), app.freeze_subscription(uuid, date, date, text),
  app.cancel_subscription(uuid), app.record_payment(uuid, app.payment_method, integer, text, text, text),
  app.sell_one_off(uuid, uuid, uuid, integer, app.payment_method, text, text), app.void_invoice(uuid, text),
  app.run_billing_cycle(date, uuid), app.invoice_fees(uuid), app.price_kind_check(), app.billing_audit_trigger()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.application_fee_bps(app.saas_plan), app.billing_next_period_end(date, app.billing_interval)
  TO app_authenticated, app_definer;
GRANT EXECUTE ON FUNCTION app.billing_staff_at(uuid), app.billing_is_self(uuid) TO app_authenticated, app_definer;
GRANT EXECUTE ON FUNCTION app.create_subscription(uuid, uuid, date, uuid), app.freeze_subscription(uuid, date, date, text),
  app.cancel_subscription(uuid), app.record_payment(uuid, app.payment_method, integer, text, text, text),
  app.sell_one_off(uuid, uuid, uuid, integer, app.payment_method, text, text), app.void_invoice(uuid, text),
  app.run_billing_cycle(date, uuid), app.invoice_fees(uuid) TO app_authenticated;
