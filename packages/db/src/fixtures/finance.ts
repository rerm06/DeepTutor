import type pg from "pg";
import type { OrgFixture } from "../testing.js";

async function one(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (!id) throw new Error(`finance fixture failed: ${sql}`);
  return id;
}

/**
 * Test fixtures for module finance (superuser connection, RLS bypassed): rows in EVERY finance table for this org,
 * all dated January 2026 so tests can use other months without interference.
 *   policy     manager threshold $500.00
 *   vendor     "Demo Limpieza {label}"
 *   bills      FIX-1 $300.00 pending at loc0 (entered by the manager) · FIX-2 $1,200.00 at loc1 entered by the
 *              manager, approved by the owner (bill_approval row) and paid
 *   expenses   rent template at loc0 (next 2026-02-01) with its January occurrence · supplies $45.50 at loc1
 *   commission trainer, session, $25.00 pending at loc0
 *   export     one journal_export row for 2026-01
 */
export async function seed(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  const [l0, l1] = org.locations;
  const P = org.people;
  await c.query(
    "INSERT INTO app.finance_policy (org_id, manager_approval_max_cents) VALUES ($1, 50000)",
    [org.orgId],
  );
  const vendor = await one(
    c,
    `INSERT INTO app.vendor (org_id, name, contact_email, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [org.orgId, `Demo Limpieza ${label}`, `limpieza.${label.toLowerCase()}@demo.invalid`, P.owner],
  );
  await c.query(
    `INSERT INTO app.bill (org_id, vendor_id, location_id, number, category, memo, issued_on, due_on, amount_cents,
       created_by)
     VALUES ($1, $2, $3, 'FIX-1', 'maintenance', 'Demo limpieza enero', '2026-01-05', '2026-02-04', 30000, $4)`,
    [org.orgId, vendor, l0, P.location_manager],
  );
  const paid = await one(
    c,
    `INSERT INTO app.bill (org_id, vendor_id, location_id, number, category, issued_on, due_on, amount_cents, status,
       created_by, approved_by, approved_at, paid_on, payment_ref, paid_recorded_by)
     VALUES ($1, $2, $3, 'FIX-2', 'supplies', '2026-01-10', '2026-02-09', 120000, 'paid', $4, $5,
       '2026-01-11', '2026-01-20', 'CHK 1001', $5) RETURNING id`,
    [org.orgId, vendor, l1, P.location_manager, P.owner],
  );
  await c.query(
    `INSERT INTO app.bill_approval (org_id, bill_id, location_id, approver_person_id, approver_role, decision,
       amount_cents, threshold_cents, at)
     VALUES ($1, $2, $3, $4, 'owner', 'approve', 120000, 50000, '2026-01-11')`,
    [org.orgId, paid, l1, P.owner],
  );
  const rent = await one(
    c,
    `INSERT INTO app.recurring_expense (org_id, location_id, vendor_id, category, description, amount_cents,
       interval_months, next_on, created_by)
     VALUES ($1, $2, NULL, 'rent', 'Demo renta local', 250000, 1, '2026-02-01', $3) RETURNING id`,
    [org.orgId, l0, P.owner],
  );
  await c.query(
    `INSERT INTO app.expense (org_id, location_id, recurring_id, category, amount_cents, spent_on, receipt_note,
       recorded_by)
     VALUES ($1, $2, $3, 'rent', 250000, '2026-01-01', 'Demo renta local', $4),
            ($1, $5, NULL, 'supplies', 4550, '2026-01-15', 'Demo papel toalla', $6)`,
    [org.orgId, l0, rent, P.owner, l1, P.location_manager],
  );
  const trainer = await one(
    c,
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = 'trainer'",
    [org.orgId, P.trainer],
  );
  await c.query(
    `INSERT INTO app.commission (org_id, staff_member_id, location_id, source, source_ref, amount_cents, earned_on,
       created_by)
     VALUES ($1, $2, $3, 'session', 'FIX-SESSION-1', 2500, '2026-01-12', $4)`,
    [org.orgId, trainer, l0, P.location_manager],
  );
  await c.query(
    `INSERT INTO app.journal_export (org_id, period, line_count, debit_total_cents, credit_total_cents, csv,
       generated_by)
     VALUES ($1, '2026-01-01', 0, 0, 0, 'JournalNo,JournalDate,Account,Debits,Credits,Description,Location', $2)`,
    [org.orgId, P.accountant],
  );
}
