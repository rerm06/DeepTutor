-- DEMO seed for module finance (Finanzas, gastos y cuentas por pagar). Synthetic data only ("Demo" names, demo
-- UUIDs, @demo.invalid). Runs as the schema owner after the core demo seed. FORCE RLS is lifted only on the
-- finance tables for the duration of this block and restored at the end. Idempotent: does nothing if already
-- applied or if the core demo organisation is missing. Dates are relative to the current month so the P&L of
-- "this month" and "last month" always has data. No journal export is seeded: the accountant generates it live.
DO $seed$
DECLARE
  oa constant uuid := 'a0000000-0000-4000-8000-000000000001';
  ob constant uuid := 'b0000000-0000-4000-8000-000000000001';
  la1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  la2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  lb1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  owner_a constant uuid := 'a0000000-0000-4000-8000-000000000101';
  mgr_a constant uuid := 'a0000000-0000-4000-8000-000000000102';
  owner_b constant uuid := 'b0000000-0000-4000-8000-000000000101';
  sm_front_a constant uuid := 'a0000000-0000-4000-8000-000000000503';
  sm_front_a2 constant uuid := 'a0000000-0000-4000-8000-000000000504';
  sm_trainer_a constant uuid := 'a0000000-0000-4000-8000-000000000505';
  sm_front_b constant uuid := 'b0000000-0000-4000-8000-000000000503';
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
  m0 date := date_trunc('month', current_date)::date;            -- this month
  m1 date := (date_trunc('month', current_date) - interval '1 month')::date;  -- last month
  nxt date := (date_trunc('month', current_date) + interval '1 month')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = oa) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM app.vendor WHERE id = v_clean) THEN RETURN; END IF;

  ALTER TABLE app.finance_policy NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.vendor NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.bill NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.bill_approval NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.recurring_expense NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.expense NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.commission NO FORCE ROW LEVEL SECURITY;

  -- Approval thresholds [P]: org A $500.00 (default), org B $400.00.
  INSERT INTO app.finance_policy (org_id, manager_approval_max_cents) VALUES (oa, 50000), (ob, 40000);

  INSERT INTO app.vendor (id, org_id, name, contact_email, created_by) VALUES
    (v_clean, oa, 'Limpieza Demo Boricua', 'facturas.limpieza@demo.invalid', owner_a),
    (v_power, oa, 'Energía Demo Utilidad', NULL, owner_a),
    (v_equip, oa, 'Equipos Demo Fit', 'servicio.equipos@demo.invalid', mgr_a),
    (v_mkt, oa, 'Mercadeo Demo Digital', 'cuentas.mercadeo@demo.invalid', owner_a),
    (v_rent, oa, 'Arrendadora Demo Plaza', NULL, owner_a),
    (v_b, ob, 'Mantenimiento Demo Sur', 'mantenimiento.sur@demo.invalid', owner_b);

  -- Recurring templates: rent and power. Their occurrences for last month and this month are already recorded.
  INSERT INTO app.recurring_expense (id, org_id, location_id, vendor_id, category, description, amount_cents,
                                     interval_months, next_on, created_by) VALUES
    (r_rent1, oa, la1, v_rent, 'rent', 'Renta local Demo San Juan', 380000, 1, nxt, owner_a),
    (r_rent2, oa, la2, v_rent, 'rent', 'Renta local Demo Bayamón', 290000, 1, nxt, owner_a),
    (r_power1, oa, la1, v_power, 'utilities', 'Luz Demo San Juan (estimado)', 65000, 1, nxt, owner_a),
    (r_rent_b, ob, lb1, NULL, 'rent', 'Renta local Demo Ponce', 210000, 1, nxt, owner_b);

  INSERT INTO app.expense (org_id, location_id, vendor_id, recurring_id, category, amount_cents, spent_on,
                           receipt_note, recorded_by) VALUES
    (oa, la1, v_rent, r_rent1, 'rent', 380000, m1, 'Renta local Demo San Juan', owner_a),
    (oa, la1, v_rent, r_rent1, 'rent', 380000, m0, 'Renta local Demo San Juan', owner_a),
    (oa, la2, v_rent, r_rent2, 'rent', 290000, m1, 'Renta local Demo Bayamón', owner_a),
    (oa, la2, v_rent, r_rent2, 'rent', 290000, m0, 'Renta local Demo Bayamón', owner_a),
    (oa, la1, v_power, r_power1, 'utilities', 65000, m1, 'Luz Demo San Juan (estimado)', owner_a),
    (oa, la1, v_power, r_power1, 'utilities', 65000, m0, 'Luz Demo San Juan (estimado)', owner_a),
    (oa, la1, NULL, NULL, 'supplies', 8950, m1 + 6, 'Demo: papel toalla y desinfectante', mgr_a),
    (oa, la1, NULL, NULL, 'supplies', 4275, m0, 'Demo: bolsas y jabón de manos', mgr_a),
    (oa, la1, v_mkt, NULL, 'marketing', 15000, m1 + 12, 'Demo: anuncios en redes (campaña regreso)', owner_a),
    (oa, la2, NULL, NULL, 'maintenance', 6500, m1 + 18, 'Demo: cambio de bombillas', owner_a),
    (oa, la1, NULL, NULL, 'payroll_export', 520000, m1 + 27, 'Demo: total nómina exportada (no procesada aquí)', owner_a),
    (ob, lb1, NULL, r_rent_b, 'rent', 210000, m1, 'Renta local Demo Ponce', owner_b),
    (ob, lb1, NULL, r_rent_b, 'rent', 210000, m0, 'Renta local Demo Ponce', owner_b),
    (ob, lb1, NULL, NULL, 'supplies', 3990, m0, 'Demo: toallas de papel', owner_b);

  -- Bills. Pending: one the manager can approve (entered by the owner, within $500), one only the owner can
  -- (entered by the manager, above $500) and one the owner can approve (entered by the manager). Approved and
  -- paid ones carry their decision row.
  INSERT INTO app.bill (id, org_id, vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents,
                        status, created_by, approved_by, approved_at, paid_on, payment_ref, paid_recorded_by) VALUES
    ('a0000000-0013-4000-8000-000000000201', oa, v_clean, la1, 'LDB-1043', 'maintenance', 'Limpieza profunda mensual',
     m0, m0 + 30, 32000, 'pending_approval', mgr_a, NULL, NULL, NULL, NULL, NULL),
    ('a0000000-0013-4000-8000-000000000202', oa, v_equip, la1, 'EDF-2210', 'maintenance', 'Reparación de 2 caminadoras',
     m0, m0 + 15, 185000, 'pending_approval', mgr_a, NULL, NULL, NULL, NULL, NULL),
    ('a0000000-0013-4000-8000-000000000203', oa, v_mkt, la1, 'MDD-077', 'marketing', 'Volantes campaña de referidos',
     m0, m0 + 30, 45000, 'pending_approval', owner_a, NULL, NULL, NULL, NULL, NULL),
    ('a0000000-0013-4000-8000-000000000204', oa, v_power, la1, 'EDU-5531', 'utilities', NULL,
     m1 + 20, m0 + 10, 61240, 'approved', mgr_a, owner_a, now() - interval '5 days', NULL, NULL, NULL),
    ('a0000000-0013-4000-8000-000000000205', oa, v_clean, la1, 'LDB-0998', 'maintenance', 'Limpieza profunda mensual',
     m1, m1 + 30, 27500, 'paid', owner_a, mgr_a, now() - interval '25 days', m1 + 25, 'CHK 3102', owner_a),
    ('b0000000-0013-4000-8000-000000000201', ob, v_b, lb1, 'MDS-310', 'maintenance', 'Servicio aire acondicionado',
     m0, m0 + 30, 38000, 'pending_approval', owner_b, NULL, NULL, NULL, NULL, NULL);

  INSERT INTO app.bill_approval (org_id, bill_id, location_id, approver_person_id, approver_role, decision,
                                 amount_cents, threshold_cents, note, at) VALUES
    (oa, 'a0000000-0013-4000-8000-000000000204', la1, owner_a, 'owner', 'approve', 61240, 50000, NULL,
     now() - interval '5 days'),
    (oa, 'a0000000-0013-4000-8000-000000000205', la1, mgr_a, 'location_manager', 'approve', 27500, 50000,
     'Servicio verificado', now() - interval '25 days');

  -- Commissions [P]: proposed by the manager, approved / paid by the owner.
  INSERT INTO app.commission (org_id, staff_member_id, location_id, source, source_ref, amount_cents, earned_on,
                              status, note, created_by, decided_by, decided_at, paid_on) VALUES
    (oa, sm_trainer_a, la1, 'session', 'PT-' || to_char(m0, 'YYYYMM') || '-001', 2500, m0, 'pending',
     'Sesión de entrenamiento personal', mgr_a, NULL, NULL, NULL),
    (oa, sm_trainer_a, la1, 'session', 'PT-' || to_char(m1, 'YYYYMM') || '-014', 2500, m1 + 14, 'approved',
     NULL, mgr_a, owner_a, now() - interval '10 days', NULL),
    (oa, sm_front_a, la1, 'sale', 'POS-' || to_char(m1, 'YYYYMM') || '-031', 850, m1 + 9, 'approved',
     'Venta de suplemento', mgr_a, owner_a, now() - interval '12 days', NULL),
    (oa, sm_front_a2, la2, 'membership', 'MEM-' || to_char(m1, 'YYYYMM') || '-007', 1500, m1 + 3, 'paid',
     NULL, owner_a, owner_a, now() - interval '28 days', m1 + 27),
    (ob, sm_front_b, lb1, 'membership', 'MEM-' || to_char(m0, 'YYYYMM') || '-002', 1500, m0, 'pending',
     NULL, owner_b, NULL, NULL, NULL);

  ALTER TABLE app.finance_policy FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.vendor FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.bill FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.bill_approval FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.recurring_expense FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.expense FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.commission FORCE ROW LEVEL SECURITY;
END $seed$;
