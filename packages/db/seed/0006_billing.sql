-- Demo seed for module billing. Synthetic data only ("Demo", @demo.invalid people come from seed/demo.sql).
-- Runs as the schema owner after demo.sql. Idempotent: does nothing if already applied or if the core demo is absent.
-- FORCE RLS is lifted only on billing tables for the duration of the seed and restored at the end.
-- Org A (Demo Gym Norte) follows a pay-per-session model: no monthly fee, no contract, no enrollment fee — members
-- pay each training session, or buy an optional session pack with credits and an expiry. Commitment 0.
-- Org B (Demo Club Sur) keeps a classic monthly membership.
DO $seed$
DECLARE
  oa constant uuid := 'a0000000-0000-4000-8000-000000000001';
  ob constant uuid := 'b0000000-0000-4000-8000-000000000001';
  la1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  la2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  lb1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  lea constant uuid := 'a0000000-0000-4000-8000-000000000002';
  leb constant uuid := 'b0000000-0000-4000-8000-000000000002';
  fd_a constant uuid := 'a0000000-0000-4000-8000-000000000103';
  fd_a2 constant uuid := 'a0000000-0000-4000-8000-000000000104';
  fd_b constant uuid := 'b0000000-0000-4000-8000-000000000103';
  -- products / prices
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
  sb_isabel constant uuid := 'b0000000-0000-4000-8000-000000006021';
  sb_tomas constant uuid := 'b0000000-0000-4000-8000-000000006022';
  t text;
  billing_tables constant text[] := ARRAY['billing_policy', 'plan_product', 'price', 'subscription',
    'subscription_freeze', 'invoice_counter', 'invoice', 'invoice_line', 'payment', 'credit_balance', 'access_pass'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = oa) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.plan_product WHERE id = pa_session) THEN RETURN; END IF;
  FOREACH t IN ARRAY billing_tables LOOP
    EXECUTE format('ALTER TABLE app.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  INSERT INTO app.billing_policy (org_id, max_commitment_months, invoice_due_days, max_freeze_days) VALUES
    (oa, 0, 3, 90), (ob, 0, 5, 60);

  -- ── Org A: pay per session
  INSERT INTO app.plan_product (id, org_id, kind, name, description, tax_category) VALUES
    (pa_session, oa, 'drop_in', 'Sesión de entrenamiento', 'Solo pagas tu sesión. Sin mensualidad ni contrato.', 'taxable'),
    (pa_pack5, oa, 'class_pack', 'Paquete 5 sesiones', 'Cinco sesiones para usar en 60 días.', 'taxable'),
    (pa_pack10, oa, 'class_pack', 'Paquete 10 sesiones', 'Diez sesiones para usar en 120 días.', 'taxable'),
    (pa_pt, oa, 'pt_package', 'Entrenamiento personal 4 sesiones', 'Cuatro sesiones uno a uno en 45 días.', 'taxable');
  INSERT INTO app.price (id, org_id, product_id, location_id, amount_cents, billing_interval, credits, validity_days) VALUES
    (xa_session, oa, pa_session, NULL, 1500, 'none', NULL, 1),
    (xa_session_bay, oa, pa_session, la2, 1200, 'none', NULL, 1),
    (xa_pack5, oa, pa_pack5, NULL, 7000, 'none', 5, 60),
    (xa_pack10, oa, pa_pack10, NULL, 13000, 'none', 10, 120),
    (xa_pt, oa, pa_pt, NULL, 16000, 'none', 4, 45);

  -- ── Org B: monthly membership
  INSERT INTO app.plan_product (id, org_id, kind, name, description, tax_category) VALUES
    (pb_month, ob, 'membership', 'Membresía mensual', 'Acceso libre a la sede. Cancela en línea cuando quieras.', 'taxable'),
    (pb_day, ob, 'day_pass', 'Pase diario', 'Acceso por un día.', 'taxable');
  INSERT INTO app.price (id, org_id, product_id, location_id, amount_cents, billing_interval, credits, validity_days) VALUES
    (xb_month, ob, pb_month, NULL, 3995, 'month', NULL, NULL),
    (xb_day, ob, pb_day, NULL, 1200, 'none', NULL, 1);
  INSERT INTO app.subscription (id, org_id, member_id, product_id, price_id, location_id, billing_interval, start_date,
                                current_period_start, current_period_end, created_by) VALUES
    (sb_isabel, ob, 'b0000000-0000-4000-8000-000000000210', pb_month, xb_month, lb1, 'month',
     current_date - 40, current_date - 10, (current_date - 10 + interval '1 month')::date, fd_b),
    (sb_tomas, ob, 'b0000000-0000-4000-8000-000000000211', pb_month, xb_month, lb1, 'month',
     current_date - 5, current_date - 5, (current_date - 5 + interval '1 month')::date, fd_b);

  -- ── Invoices: inserted with zero totals, lines added, totals and fees computed from the lines below.
  INSERT INTO app.invoice (id, org_id, legal_entity_id, number, member_id, location_id, municipality, subscription_id,
                           period_start, period_end, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents,
                           application_fee_bps, application_fee_cents, status, issued_at, due_date, paid_at, created_by)
  VALUES
    -- Ana: pack of 10 (card, paid), Pedro: session today (cash), Miguel: session 10 days ago still open (overdue),
    -- José and Andrés at Bayamón: session and pack of 5, Ana: personal training pack.
    ('a0000000-0000-4000-8000-000000006101', oa, lea, 1, 'a0000000-0000-4000-8000-000000000210', la1, 'San Juan', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'paid', now() - interval '20 days', current_date - 17, now() - interval '20 days', fd_a),
    ('a0000000-0000-4000-8000-000000006102', oa, lea, 2, 'a0000000-0000-4000-8000-000000000211', la1, 'San Juan', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'paid', now() - interval '2 hours', current_date + 3, now() - interval '2 hours', fd_a),
    ('a0000000-0000-4000-8000-000000006103', oa, lea, 3, 'a0000000-0000-4000-8000-000000000213', la1, 'San Juan', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'open', now() - interval '10 days', current_date - 7, NULL, fd_a),
    ('a0000000-0000-4000-8000-000000006104', oa, lea, 4, 'a0000000-0000-4000-8000-000000000215', la2, 'Bayamón', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'paid', now() - interval '1 day', current_date + 2, now() - interval '1 day', fd_a2),
    ('a0000000-0000-4000-8000-000000006105', oa, lea, 5, 'a0000000-0000-4000-8000-000000000217', la2, 'Bayamón', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'paid', now() - interval '6 days', current_date - 3, now() - interval '6 days', fd_a2),
    ('a0000000-0000-4000-8000-000000006106', oa, lea, 6, 'a0000000-0000-4000-8000-000000000210', la1, 'San Juan', NULL, NULL, NULL, 0, 0, 0, 0, 75, 0, 'paid', now() - interval '3 days', current_date, now() - interval '3 days', fd_a),
    -- Org B: Isabel's current period paid, Tomás's first period open.
    ('b0000000-0000-4000-8000-000000006101', ob, leb, 1, 'b0000000-0000-4000-8000-000000000210', lb1, 'Ponce', sb_isabel, current_date - 40, current_date - 10, 0, 0, 0, 0, 100, 0, 'paid', now() - interval '40 days', current_date - 35, now() - interval '40 days', fd_b),
    ('b0000000-0000-4000-8000-000000006102', ob, leb, 2, 'b0000000-0000-4000-8000-000000000210', lb1, 'Ponce', sb_isabel, current_date - 10, (current_date - 10 + interval '1 month')::date, 0, 0, 0, 0, 100, 0, 'paid', now() - interval '10 days', current_date - 5, now() - interval '9 days', fd_b),
    ('b0000000-0000-4000-8000-000000006103', ob, leb, 3, 'b0000000-0000-4000-8000-000000000211', lb1, 'Ponce', sb_tomas, current_date - 5, (current_date - 5 + interval '1 month')::date, 0, 0, 0, 0, 100, 0, 'open', now() - interval '5 days', current_date, NULL, fd_b);
  INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents, tax_category) VALUES
    (oa, 'a0000000-0000-4000-8000-000000006101', pa_pack10, xa_pack10, 'Paquete 10 sesiones', 1, 13000, 'taxable'),
    (oa, 'a0000000-0000-4000-8000-000000006102', pa_session, xa_session, 'Sesión de entrenamiento', 1, 1500, 'taxable'),
    (oa, 'a0000000-0000-4000-8000-000000006103', pa_session, xa_session, 'Sesión de entrenamiento', 1, 1500, 'taxable'),
    (oa, 'a0000000-0000-4000-8000-000000006104', pa_session, xa_session_bay, 'Sesión de entrenamiento', 1, 1200, 'taxable'),
    (oa, 'a0000000-0000-4000-8000-000000006105', pa_pack5, xa_pack5, 'Paquete 5 sesiones', 1, 7000, 'taxable'),
    (oa, 'a0000000-0000-4000-8000-000000006106', pa_pt, xa_pt, 'Entrenamiento personal 4 sesiones', 1, 16000, 'taxable'),
    (ob, 'b0000000-0000-4000-8000-000000006101', pb_month, xb_month, 'Membresía mensual', 1, 3995, 'taxable'),
    (ob, 'b0000000-0000-4000-8000-000000006102', pb_month, xb_month, 'Membresía mensual', 1, 3995, 'taxable'),
    (ob, 'b0000000-0000-4000-8000-000000006103', pb_month, xb_month, 'Membresía mensual', 1, 3995, 'taxable');
  UPDATE app.invoice i
     SET subtotal_cents = s.sub, ivu_state_cents = s.st, ivu_municipal_cents = s.mu, total_cents = s.sub + s.st + s.mu,
         application_fee_cents = (((s.sub + s.st + s.mu)::bigint * i.application_fee_bps + 5000) / 10000)::integer
    FROM (SELECT invoice_id, sum(amount_cents)::integer AS sub, sum(ivu_state_cents)::integer AS st,
                 sum(ivu_municipal_cents)::integer AS mu
            FROM app.invoice_line WHERE org_id IN (oa, ob) GROUP BY invoice_id) s
   WHERE i.id = s.invoice_id AND i.org_id IN (oa, ob);
  INSERT INTO app.invoice_counter (org_id, legal_entity_id, next_no) VALUES (oa, lea, 7), (ob, leb, 4);

  INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key,
                           reference, provider_ref, recorded_by, received_at)
  SELECT i.org_id, i.id, i.member_id, i.location_id,
         CASE WHEN i.number IN (1, 6) OR i.org_id = ob THEN 'card_simulated' ELSE 'cash' END::app.payment_method,
         i.total_cents, 'demo-seed-' || replace(i.id::text, '-', ''),
         CASE WHEN i.number IN (1, 6) OR i.org_id = ob THEN NULL ELSE 'Recibo ' || i.number END,
         CASE WHEN i.number IN (1, 6) OR i.org_id = ob THEN 'sim_demo' || i.number || substr(i.org_id::text, 1, 1) || 'seed' END,
         i.created_by, i.paid_at
    FROM app.invoice i WHERE i.org_id IN (oa, ob) AND i.status = 'paid';

  -- Entitlements: session credits and same-day passes (never revoked by billing status).
  INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total, credits_remaining,
                                  expires_at, created_at) VALUES
    (oa, 'a0000000-0000-4000-8000-000000000210', pa_pack10, la1, 'a0000000-0000-4000-8000-000000006101', 10, 6, now() + interval '100 days', now() - interval '20 days'),
    (oa, 'a0000000-0000-4000-8000-000000000217', pa_pack5, la2, 'a0000000-0000-4000-8000-000000006105', 5, 4, now() + interval '54 days', now() - interval '6 days'),
    (oa, 'a0000000-0000-4000-8000-000000000210', pa_pt, la1, 'a0000000-0000-4000-8000-000000006106', 4, 3, now() + interval '42 days', now() - interval '3 days');
  INSERT INTO app.access_pass (org_id, member_id, location_id, product_id, invoice_id, valid_from, valid_to) VALUES
    (oa, 'a0000000-0000-4000-8000-000000000211', la1, pa_session, 'a0000000-0000-4000-8000-000000006102', now() - interval '2 hours', now() + interval '22 hours'),
    (oa, 'a0000000-0000-4000-8000-000000000213', la1, pa_session, 'a0000000-0000-4000-8000-000000006103', now() - interval '10 days', now() - interval '9 days'),
    (oa, 'a0000000-0000-4000-8000-000000000215', la2, pa_session, 'a0000000-0000-4000-8000-000000006104', now() - interval '1 day', now());

  FOREACH t IN ARRAY billing_tables LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $seed$;
