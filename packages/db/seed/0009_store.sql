-- DEMO seed for module store (Tienda, POS e inventario). Synthetic data only ("Demo" names, demo UUIDs).
-- Runs as the schema owner right after the core demo seed. FORCE RLS is lifted only on the store tables, only
-- for the duration of this block, and restored at the end. Idempotent: does nothing if already applied or if
-- the core demo organisation is missing. Ledger-consistent: on_hand = Σ movements, reserved = Σ pending lines.
DO $seed$
DECLARE
  c_org_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  c_org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  c_a1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  c_a2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  c_b1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  r record;
  l record;
  v_sale uuid;
  v_sub integer;
  v_st integer;
  v_mu integer;
  v_restricted boolean;
  v_transfer uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = c_org_a) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.product WHERE id = 'a0000000-0009-4000-8000-000000000001') THEN RETURN; END IF;

  ALTER TABLE app.product NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.inventory_level NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.sale NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.sale_line NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_movement NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_transfer NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_transfer_line NO FORCE ROW LEVEL SECURITY;

  -- Catalogue. Age-restricted: pre-workout and creatine [VERIFICAR · legal: which categories and minimum age].
  -- Taxability: everything taxable by default [VERIFICAR · CPA].
  INSERT INTO app.product (id, org_id, sku, name, category, age_restricted, taxable, price_cents, active) VALUES
    ('a0000000-0009-4000-8000-000000000001', c_org_a, 'SUP-WHEY-2LB', 'Proteína Whey Demo 2 lb', 'supplement', false, true, 4499, true),
    ('a0000000-0009-4000-8000-000000000002', c_org_a, 'SUP-CREA-300', 'Creatina Demo 300 g', 'supplement', true, true, 2999, true),
    ('a0000000-0009-4000-8000-000000000003', c_org_a, 'SUP-PRE-30', 'Pre-entreno Demo 30 porciones', 'supplement', true, true, 3499, true),
    ('a0000000-0009-4000-8000-000000000004', c_org_a, 'DRK-AGUA-500', 'Agua Demo 500 ml', 'drink', false, true, 150, true),
    ('a0000000-0009-4000-8000-000000000005', c_org_a, 'DRK-ELEC-600', 'Bebida electrolítica Demo 600 ml', 'drink', false, true, 275, true),
    ('a0000000-0009-4000-8000-000000000006', c_org_a, 'APP-TEE-M', 'Camiseta Demo Norte M', 'apparel', false, true, 2200, true),
    ('a0000000-0009-4000-8000-000000000007', c_org_a, 'APP-TEE-L', 'Camiseta Demo Norte L', 'apparel', false, true, 2200, true),
    ('a0000000-0009-4000-8000-000000000008', c_org_a, 'ACC-SHAKER', 'Shaker Demo 600 ml', 'accessory', false, true, 899, true),
    ('a0000000-0009-4000-8000-000000000009', c_org_a, 'ACC-TOALLA', 'Toalla Demo', 'accessory', false, true, 1200, true),
    ('a0000000-0009-4000-8000-000000000010', c_org_a, 'OTH-CANDADO', 'Candado Demo', 'other', false, true, 650, false),
    ('b0000000-0009-4000-8000-000000000001', c_org_b, 'SUP-WHEY-2LB', 'Proteína Demo Sur 2 lb', 'supplement', false, true, 4299, true),
    ('b0000000-0009-4000-8000-000000000002', c_org_b, 'SUP-PRE-30', 'Pre-entreno Demo Sur', 'supplement', true, true, 3299, true),
    ('b0000000-0009-4000-8000-000000000003', c_org_b, 'DRK-AGUA-500', 'Agua Demo Sur 500 ml', 'drink', false, true, 125, true),
    ('b0000000-0009-4000-8000-000000000004', c_org_b, 'APP-GORRA', 'Gorra Demo Club Sur', 'apparel', false, true, 1800, true);

  -- Stock received (sku, location, qty, reorder point, received by).
  FOR r IN SELECT * FROM (VALUES
      (c_org_a, 'SUP-WHEY-2LB', c_a1, 18, 5, 'a0000000-0000-4000-8000-000000000102'::uuid),
      (c_org_a, 'SUP-CREA-300', c_a1, 12, 4, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'SUP-PRE-30',   c_a1,  6, 4, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'DRK-AGUA-500', c_a1, 96, 24, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'DRK-ELEC-600', c_a1, 48, 12, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'APP-TEE-M',    c_a1, 10, 3, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'APP-TEE-L',    c_a1,  4, 3, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'ACC-SHAKER',   c_a1, 15, 5, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'ACC-TOALLA',   c_a1,  8, 2, 'a0000000-0000-4000-8000-000000000102'),
      (c_org_a, 'SUP-WHEY-2LB', c_a2,  8, 4, 'a0000000-0000-4000-8000-000000000101'),
      (c_org_a, 'SUP-CREA-300', c_a2,  3, 3, 'a0000000-0000-4000-8000-000000000101'),
      (c_org_a, 'DRK-AGUA-500', c_a2, 24, 24, 'a0000000-0000-4000-8000-000000000101'),
      (c_org_a, 'APP-TEE-M',    c_a2,  5, 2, 'a0000000-0000-4000-8000-000000000101'),
      (c_org_b, 'SUP-WHEY-2LB', c_b1, 10, 3, 'b0000000-0000-4000-8000-000000000101'),
      (c_org_b, 'SUP-PRE-30',   c_b1,  5, 2, 'b0000000-0000-4000-8000-000000000101'),
      (c_org_b, 'DRK-AGUA-500', c_b1, 48, 12, 'b0000000-0000-4000-8000-000000000101'),
      (c_org_b, 'APP-GORRA',    c_b1,  6, 2, 'b0000000-0000-4000-8000-000000000101')
    ) AS x(org, sku, loc, qty, reorder, by_person) LOOP
    INSERT INTO app.inventory_level (org_id, product_id, location_id, on_hand, reorder_point)
    SELECT r.org, p.id, r.loc, r.qty, r.reorder FROM app.product p WHERE p.org_id = r.org AND p.sku = r.sku;
    INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, by_person_id, at)
    SELECT r.org, p.id, r.loc, 'receive', r.qty, 'Demo factura 1001', r.by_person, now() - interval '20 days'
      FROM app.product p WHERE p.org_id = r.org AND p.sku = r.sku;
  END LOOP;

  -- Sales: (org, location, channel, status, member, seller person, seller staff, payment, days ago, lines, reason).
  FOR r IN SELECT * FROM (VALUES
      (c_org_a, c_a1, 'pos', 'completed', NULL::uuid, 'a0000000-0000-4000-8000-000000000103'::uuid, 'a0000000-0000-4000-8000-000000000503'::uuid, 'cash', 9, '[["DRK-AGUA-500",2],["SUP-WHEY-2LB",1]]'::jsonb, NULL::text),
      (c_org_a, c_a1, 'pos', 'completed', 'a0000000-0000-4000-8000-000000000210', 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000503', 'card_simulated', 8, '[["SUP-CREA-300",1],["ACC-SHAKER",1]]', NULL),
      (c_org_a, c_a1, 'pos', 'completed', NULL, 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000503', 'cash', 6, '[["DRK-ELEC-600",3]]', NULL),
      (c_org_a, c_a1, 'pos', 'completed', 'a0000000-0000-4000-8000-000000000211', 'a0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000502', 'card_simulated', 5, '[["APP-TEE-L",1],["SUP-PRE-30",1]]', NULL),
      (c_org_a, c_a1, 'pos', 'refunded', NULL, 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000503', 'cash', 4, '[["APP-TEE-M",1]]', 'Demo: talla incorrecta'),
      (c_org_a, c_a1, 'pos', 'completed', NULL, 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000503', 'cash', 1, '[["DRK-AGUA-500",6],["ACC-TOALLA",1]]', NULL),
      (c_org_a, c_a1, 'online', 'pending_pickup', 'a0000000-0000-4000-8000-000000000210', NULL, NULL, NULL, 0, '[["SUP-PRE-30",1],["DRK-AGUA-500",2]]', NULL),
      (c_org_a, c_a1, 'online', 'completed', 'a0000000-0000-4000-8000-000000000210', 'a0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000503', 'card_simulated', 3, '[["SUP-WHEY-2LB",1]]', NULL),
      (c_org_a, c_a1, 'online', 'cancelled', 'a0000000-0000-4000-8000-000000000211', NULL, NULL, NULL, 2, '[["APP-TEE-M",2]]', NULL),
      (c_org_a, c_a2, 'pos', 'completed', 'a0000000-0000-4000-8000-000000000215', 'a0000000-0000-4000-8000-000000000104', 'a0000000-0000-4000-8000-000000000504', 'cash', 7, '[["SUP-CREA-300",1],["DRK-AGUA-500",1]]', NULL),
      (c_org_a, c_a2, 'pos', 'completed', NULL, 'a0000000-0000-4000-8000-000000000104', 'a0000000-0000-4000-8000-000000000504', 'card_simulated', 2, '[["APP-TEE-M",1]]', NULL),
      (c_org_b, c_b1, 'pos', 'completed', NULL, 'b0000000-0000-4000-8000-000000000103', 'b0000000-0000-4000-8000-000000000503', 'cash', 6, '[["DRK-AGUA-500",4]]', NULL),
      (c_org_b, c_b1, 'pos', 'completed', 'b0000000-0000-4000-8000-000000000210', 'b0000000-0000-4000-8000-000000000103', 'b0000000-0000-4000-8000-000000000503', 'card_simulated', 3, '[["SUP-PRE-30",1],["APP-GORRA",1]]', NULL),
      (c_org_b, c_b1, 'online', 'pending_pickup', 'b0000000-0000-4000-8000-000000000210', NULL, NULL, NULL, 0, '[["SUP-WHEY-2LB",1]]', NULL)
    ) AS x(org, loc, channel, status, member, seller, seller_staff, payment, days, lines, reason) LOOP
    v_sale := gen_random_uuid();
    SELECT sum(a.subtotal_cents), sum(a.ivu_state_cents), sum(a.ivu_municipal_cents), bool_or(p.age_restricted)
      INTO v_sub, v_st, v_mu, v_restricted
      FROM jsonb_array_elements(r.lines) e
      JOIN app.product p ON p.org_id = r.org AND p.sku = e ->> 0,
      LATERAL app.store_line_amounts((e ->> 1)::integer, p.price_cents, p.taxable) a;
    INSERT INTO app.sale (id, org_id, location_id, channel, member_id, status, subtotal_cents, ivu_state_cents,
                          ivu_municipal_cents, total_cents, payment_method, age_verified_by, created_by, created_at,
                          completed_by, completed_at, refunded_by, refunded_at, refund_reason, cancelled_by, cancelled_at)
    VALUES (v_sale, r.org, r.loc, r.channel::app.store_sale_channel, r.member, r.status::app.store_sale_status,
            v_sub, v_st, v_mu, v_sub + v_st + v_mu, r.payment::app.store_payment_method,
            CASE WHEN v_restricted AND r.status IN ('completed', 'refunded') THEN r.seller_staff END,
            CASE WHEN r.channel = 'online' THEN (SELECT person_id FROM app.member WHERE id = r.member) ELSE r.seller END,
            now() - make_interval(days => r.days),
            CASE WHEN r.status IN ('completed', 'refunded') THEN r.seller END,
            CASE WHEN r.status IN ('completed', 'refunded') THEN now() - make_interval(days => r.days) END,
            CASE WHEN r.status = 'refunded' THEN r.seller END,
            CASE WHEN r.status = 'refunded' THEN now() - make_interval(days => r.days) + interval '1 hour' END,
            r.reason,
            CASE WHEN r.status = 'cancelled' THEN (SELECT person_id FROM app.member WHERE id = r.member) END,
            CASE WHEN r.status = 'cancelled' THEN now() - make_interval(days => r.days) + interval '2 hours' END);
    FOR l IN SELECT p.id AS product_id, (e ->> 1)::integer AS qty, p.price_cents, p.taxable, p.age_restricted, a.*
               FROM jsonb_array_elements(r.lines) e
               JOIN app.product p ON p.org_id = r.org AND p.sku = e ->> 0,
               LATERAL app.store_line_amounts((e ->> 1)::integer, p.price_cents, p.taxable) a LOOP
      INSERT INTO app.sale_line (org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
                                 subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
      VALUES (r.org, v_sale, l.product_id, l.qty, l.price_cents, l.taxable, l.age_restricted,
              l.subtotal_cents, l.ivu_state_cents, l.ivu_municipal_cents, l.total_cents);
      IF r.status IN ('completed', 'refunded') THEN
        UPDATE app.inventory_level SET on_hand = on_hand - l.qty
         WHERE org_id = r.org AND product_id = l.product_id AND location_id = r.loc;
        INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id, at)
        VALUES (r.org, l.product_id, r.loc, 'sale', -l.qty, CASE r.channel WHEN 'pos' THEN 'POS' ELSE 'PICKUP' END,
                v_sale, r.seller, now() - make_interval(days => r.days));
      END IF;
      IF r.status = 'refunded' THEN
        UPDATE app.inventory_level SET on_hand = on_hand + l.qty
         WHERE org_id = r.org AND product_id = l.product_id AND location_id = r.loc;
        INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id, at)
        VALUES (r.org, l.product_id, r.loc, 'return', l.qty, 'REFUND', v_sale, r.seller,
                now() - make_interval(days => r.days) + interval '1 hour');
      END IF;
      IF r.status = 'pending_pickup' THEN
        UPDATE app.inventory_level SET reserved = reserved + l.qty
         WHERE org_id = r.org AND product_id = l.product_id AND location_id = r.loc;
      END IF;
    END LOOP;
  END LOOP;

  -- One transfer: 24 bottles of water San Juan → Bayamón (the Bayamón shelf was at its reorder point).
  v_transfer := 'a0000000-0009-4000-8000-000000000101';
  INSERT INTO app.stock_transfer (id, org_id, from_location_id, to_location_id, note, created_by, created_at)
  VALUES (v_transfer, c_org_a, c_a1, c_a2, 'Demo reposición semanal', 'a0000000-0000-4000-8000-000000000101',
          now() - interval '1 day');
  INSERT INTO app.stock_transfer_line (org_id, transfer_id, product_id, qty)
  VALUES (c_org_a, v_transfer, 'a0000000-0009-4000-8000-000000000004', 24);
  UPDATE app.inventory_level SET on_hand = on_hand - 24
   WHERE product_id = 'a0000000-0009-4000-8000-000000000004' AND location_id = c_a1;
  UPDATE app.inventory_level SET on_hand = on_hand + 24
   WHERE product_id = 'a0000000-0009-4000-8000-000000000004' AND location_id = c_a2;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, transfer_id, by_person_id, at) VALUES
    (c_org_a, 'a0000000-0009-4000-8000-000000000004', c_a1, 'transfer_out', -24, 'TRANSFER', v_transfer,
     'a0000000-0000-4000-8000-000000000101', now() - interval '1 day'),
    (c_org_a, 'a0000000-0009-4000-8000-000000000004', c_a2, 'transfer_in', 24, 'TRANSFER', v_transfer,
     'a0000000-0000-4000-8000-000000000101', now() - interval '1 day');

  -- One count correction with its reason.
  UPDATE app.inventory_level SET on_hand = on_hand - 1
   WHERE product_id = 'a0000000-0009-4000-8000-000000000008' AND location_id = c_a1;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, reason, by_person_id, at)
  VALUES (c_org_a, 'a0000000-0009-4000-8000-000000000008', c_a1, 'adjust', -1, 'ADJUST',
          'Demo: unidad dañada en exhibición', 'a0000000-0000-4000-8000-000000000102', now() - interval '3 days');

  ALTER TABLE app.product FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.inventory_level FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.sale FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.sale_line FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_movement FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_transfer FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.stock_transfer_line FORCE ROW LEVEL SECURITY;
END $seed$;
