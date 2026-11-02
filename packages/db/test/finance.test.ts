import { randomUUID } from "node:crypto";
import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (org: OrgFixture, role: Role) => t.claims(org, role);
const A = () => t.fx.A;
const B = () => t.fx.B;
const FINANCE_TABLES = [
  "finance_policy",
  "vendor",
  "bill",
  "bill_approval",
  "recurring_expense",
  "expense",
  "commission",
  "journal_export",
];
const NO_FINANCE: Role[] = [
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "member",
  "guardian",
];
const DECIDE = "SELECT app.decide_bill($1, $2, $3) AS status";
const PAY = "SELECT app.pay_bill($1, $2, $3)";
const VOID = "SELECT app.void_bill($1, $2)";

async function denied(
  claims: ReturnType<typeof as>,
  sql: string,
  params: unknown[],
  code: string,
  msg?: RegExp,
) {
  await expect(asCaller(t.api, claims, (tx) => tx.query(sql, params))).rejects.toMatchObject({
    code,
    ...(msg ? { message: expect.stringMatching(msg) } : {}),
  });
}
async function rolledBack<T>(
  claims: ReturnType<typeof as>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const c = await t.api.pool.connect();
  try {
    await c.query("BEGIN");
    await bindClaims(c, t.api, claims);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
async function vendorOf(org: OrgFixture): Promise<string> {
  const { rows } = await t.admin.query("SELECT id FROM app.vendor WHERE org_id = $1 LIMIT 1", [
    org.orgId,
  ]);
  return rows[0].id;
}
/** A pending bill of its own for each case (admin path), entered by `creator`. */
async function newBill(
  org: OrgFixture,
  amount: number,
  opts: { loc?: 0 | 1; creator?: Role; issued?: string } = {},
): Promise<string> {
  const { rows } = await t.admin.query(
    `INSERT INTO app.bill (org_id, vendor_id, location_id, number, category, issued_on, due_on, amount_cents, created_by)
     VALUES ($1, $2, $3, $4, 'maintenance', $5, $5::date + 30, $6, $7) RETURNING id`,
    [
      org.orgId,
      await vendorOf(org),
      org.locations[opts.loc ?? 0],
      `T-${randomUUID().slice(0, 8)}`,
      opts.issued ?? "2026-10-01",
      amount,
      org.people[opts.creator ?? "accountant"],
    ],
  );
  return rows[0].id;
}
async function billRow(id: string) {
  const { rows } = await t.admin.query("SELECT * FROM app.bill WHERE id = $1", [id]);
  return rows[0];
}
async function staffId(org: OrgFixture, role: Role): Promise<string> {
  const { rows } = await t.admin.query(
    "SELECT id FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = $3",
    [org.orgId, org.people[role], role],
  );
  return rows[0].id;
}

describe("finance · visibility by role", () => {
  it("owner and accountant read every finance table at every location; the manager only their location", async () => {
    for (const role of ["owner", "accountant"] as const) {
      await asCaller(t.api, as(A(), role), async (tx) => {
        for (const table of FINANCE_TABLES) {
          const { rowCount } = await tx.query(`SELECT 1 FROM app.${table}`);
          expect(rowCount, `${role} ${table}`).toBeGreaterThan(0);
        }
        const locs = await tx.query("SELECT DISTINCT location_id FROM app.bill");
        expect(locs.rowCount).toBe(2);
      });
    }
    await asCaller(t.api, as(A(), "location_manager"), async (tx) => {
      for (const table of ["bill", "expense", "recurring_expense", "commission"]) {
        const { rows } = await tx.query(`SELECT DISTINCT location_id FROM app.${table}`);
        expect(
          rows.map((r) => r.location_id),
          table,
        ).toEqual([A().locations[0]]);
      }
      expect((await tx.query("SELECT 1 FROM app.journal_export")).rowCount).toBe(0);
      expect((await tx.query("SELECT 1 FROM app.vendor")).rowCount).toBeGreaterThan(0);
    });
  });

  it.each(NO_FINANCE)(
    "%s sees nothing in finance and cannot call its read models",
    async (role) => {
      await asCaller(t.api, as(A(), role), async (tx) => {
        for (const table of FINANCE_TABLES) {
          const { rowCount } = await tx.query(`SELECT 1 FROM app.${table}`);
          expect(rowCount, `${role} ${table}`).toBe(0);
        }
      });
      await denied(as(A(), role), "SELECT * FROM app.finance_pnl('2026-01-01')", [], "42501");
      await denied(as(A(), role), "SELECT * FROM app.finance_deferred()", [], "42501");
      await denied(as(A(), role), "SELECT app.generate_journal_export('2026-01-01')", [], "42501");
      await denied(
        as(A(), role),
        `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents)
       VALUES ($1, $2, 'X-1', '2026-10-01', '2026-10-31', 100)`,
        [await vendorOf(A()), A().locations[0]],
        "42501",
      );
    },
  );

  it("other organisation: rows invisible, functions refuse, P&L lists only own locations", async () => {
    const billA = await newBill(A(), 10000);
    await asCaller(t.api, as(B(), "owner"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.bill WHERE id = $1", [billA])).rowCount).toBe(0);
      const pnl = await tx.query("SELECT location_id FROM app.finance_pnl('2026-01-01')");
      expect(pnl.rows.map((r) => r.location_id).sort()).toEqual([...B().locations].sort());
    });
    await denied(as(B(), "owner"), DECIDE, [billA, "approve", null], "42501", /^forbidden$/);
    await denied(as(B(), "owner"), PAY, [billA, "2026-10-02", "X"], "42501", /^forbidden$/);
    await denied(as(B(), "owner"), VOID, [billA, "duplicada"], "42501", /^forbidden$/);
    // A bill pointing at another org's vendor fails on the composite key, not silently.
    await denied(
      as(B(), "owner"),
      `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents)
       VALUES ($1, $2, 'X-2', '2026-10-01', '2026-10-31', 100)`,
      [await vendorOf(A()), B().locations[0]],
      "23503",
    );
    expect((await billRow(billA)).status).toBe("pending_approval");
  });

  it("other location: the manager cannot read, enter or decide bills of a location they are not assigned to", async () => {
    const other = await newBill(A(), 10000, { loc: 1 });
    await asCaller(t.api, as(A(), "location_manager"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.bill WHERE id = $1", [other])).rowCount).toBe(0);
      const pnl = await tx.query("SELECT location_id FROM app.finance_pnl('2026-01-01')");
      expect(pnl.rows.map((r) => r.location_id)).toEqual([A().locations[0]]);
    });
    await denied(as(A(), "location_manager"), DECIDE, [other, "approve", null], "42501");
    await denied(
      as(A(), "location_manager"),
      `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents)
       VALUES ($1, $2, 'X-3', '2026-10-01', '2026-10-31', 100)`,
      [await vendorOf(A()), A().locations[1]],
      "42501",
    );
    await denied(
      as(A(), "location_manager"),
      "INSERT INTO app.expense (location_id, category, amount_cents, spent_on) VALUES ($1, 'other', 100, '2026-10-01')",
      [A().locations[1]],
      "42501",
    );
    expect((await billRow(other)).status).toBe("pending_approval");
  });
});

describe("finance · bill approval policy", () => {
  it("manager enters a bill at their location; it starts pending with the caller as creator (audited)", async () => {
    const id = await asCaller(t.api, as(A(), "location_manager"), async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.bill (vendor_id, location_id, number, category, issued_on, due_on, amount_cents)
         VALUES ($1, $2, 'MGR-1', 'supplies', '2026-10-01', '2026-10-31', 45000) RETURNING id, status, created_by`,
        [await vendorOf(A()), A().locations[0]],
      );
      expect(rows[0].status).toBe("pending_approval");
      expect(rows[0].created_by).toBe(A().people.location_manager);
      return rows[0].id;
    });
    const audit = await t.admin.query(
      "SELECT actor_person_id FROM app.audit_log WHERE action = 'bill.insert' AND entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ actor_person_id: A().people.location_manager }]);
    // Segregation of duties: the creator never decides their own bill, even within the threshold.
    await denied(
      as(A(), "location_manager"),
      DECIDE,
      [id, "approve", null],
      "42501",
      /approver_is_creator/,
    );
    await denied(as(A(), "location_manager"), DECIDE, [id, "reject", null], "42501");
    const st = await asCaller(t.api, as(A(), "owner"), async (tx) => {
      return (await tx.query(DECIDE, [id, "approve", "OK"])).rows[0].status;
    });
    expect(st).toBe("approved");
  });

  it("the owner cannot approve a bill they entered themself", async () => {
    const id = await newBill(A(), 90000, { creator: "owner" });
    await denied(as(A(), "owner"), DECIDE, [id, "approve", null], "42501", /approver_is_creator/);
    expect((await billRow(id)).status).toBe("pending_approval");
  });

  it("manager threshold: ≤ $500.00 approves, $500.01 is owner-only (boundary)", async () => {
    const at = await newBill(A(), 50000);
    const above = await newBill(A(), 50001);
    const ok = await asCaller(
      t.api,
      as(A(), "location_manager"),
      async (tx) => (await tx.query(DECIDE, [at, "approve", null])).rows[0].status,
    );
    expect(ok).toBe("approved");
    await denied(
      as(A(), "location_manager"),
      DECIDE,
      [above, "approve", null],
      "42501",
      /above_threshold/,
    );
    await denied(
      as(A(), "location_manager"),
      DECIDE,
      [above, "reject", null],
      "42501",
      /above_threshold/,
    );
    expect((await billRow(above)).status).toBe("pending_approval");
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(DECIDE, [above, "approve", null]));
    const b = await billRow(above);
    expect(b.status).toBe("approved");
    expect(b.approved_by).toBe(A().people.owner);
    const approval = await t.admin.query(
      "SELECT approver_person_id, approver_role, decision, amount_cents, threshold_cents FROM app.bill_approval WHERE bill_id = $1",
      [above],
    );
    expect(approval.rows).toEqual([
      {
        approver_person_id: A().people.owner,
        approver_role: "owner",
        decision: "approve",
        amount_cents: 50001,
        threshold_cents: 50000,
      },
    ]);
  });

  it("the threshold is configurable per org by the owner only", async () => {
    const big = await newBill(A(), 80000);
    await rolledBack(as(A(), "owner"), async (tx) => {
      const u = await tx.query(
        "UPDATE app.finance_policy SET manager_approval_max_cents = 100000, updated_at = now()",
      );
      expect(u.rowCount).toBe(1);
    });
    for (const role of ["location_manager", "accountant"] as const) {
      await asCaller(t.api, as(A(), role), async (tx) => {
        const u = await tx.query(
          "UPDATE app.finance_policy SET manager_approval_max_cents = 999999",
        );
        expect(u.rowCount, role).toBe(0);
      });
    }
    // Raise it for real (owner), then the manager may approve $800.00; restore afterwards.
    await asCaller(t.api, as(A(), "owner"), (tx) =>
      tx.query("UPDATE app.finance_policy SET manager_approval_max_cents = 100000"),
    );
    try {
      const st = await asCaller(
        t.api,
        as(A(), "location_manager"),
        async (tx) => (await tx.query(DECIDE, [big, "approve", null])).rows[0].status,
      );
      expect(st).toBe("approved");
    } finally {
      await t.admin.query(
        "UPDATE app.finance_policy SET manager_approval_max_cents = 50000 WHERE org_id = $1",
        [A().orgId],
      );
    }
    const audit = await t.admin.query(
      "SELECT meta FROM app.audit_log WHERE action = 'finance_policy.update' AND org_id = $1",
      [A().orgId],
    );
    expect(audit.rows.map((r) => r.meta.manager_approval_max_cents)).toContain(100000);
  });

  it("reject voids the bill; a decided bill cannot be decided again", async () => {
    const id = await newBill(A(), 20000);
    await asCaller(t.api, as(A(), "location_manager"), (tx) =>
      tx.query(DECIDE, [id, "reject", "Monto incorrecto"]),
    );
    const b = await billRow(id);
    expect(b.status).toBe("void");
    expect(b.void_reason).toBe("rejected: Monto incorrecto");
    await denied(as(A(), "owner"), DECIDE, [id, "approve", null], "22023", /invalid_status/);
  });

  it("the table itself refuses approved_by = created_by (defence in depth)", async () => {
    const id = await newBill(A(), 1000, { creator: "owner" });
    await expect(
      t.admin.query(
        "UPDATE app.bill SET status = 'approved', approved_by = created_by, approved_at = now() WHERE id = $1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("CONCURRENCY: owner approving and manager rejecting the same bill at once — exactly one decision wins", async () => {
    const id = await newBill(A(), 10000);
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    let second: unknown = null;
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, as(A(), "owner"));
      await c1.query(DECIDE, [id, "approve", null]); // holds the bill lock
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as(A(), "location_manager"));
      const racing = c2.query(DECIDE, [id, "reject", null]).catch((e: unknown) => {
        second = e;
      });
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      await racing;
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(second).toMatchObject({ message: "invalid_status" });
    expect((await billRow(id)).status).toBe("approved");
    const n = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.bill_approval WHERE bill_id = $1",
      [id],
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe("finance · paying and voiding bills", () => {
  it("an approved bill is paid once; a paid bill is immutable for every role and path", async () => {
    const id = await newBill(A(), 30000);
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(DECIDE, [id, "approve", null]));
    // Pending/approved checks: future date and hostile reference are refused.
    await denied(as(A(), "owner"), PAY, [id, "2099-01-01", "CHK 1"], "22023", /invalid_date/);
    await denied(as(A(), "owner"), PAY, [id, "2026-10-02", "=1+1"], "22023", /invalid_reference/);
    await denied(as(A(), "owner"), PAY, [id, "2026-10-02", "CHK\n1"], "22023", /invalid_reference/);
    await asCaller(t.api, as(A(), "location_manager"), (tx) =>
      tx.query(PAY, [id, "2026-10-02", "ACH 20261002"]),
    );
    const b = await billRow(id);
    expect(b.status).toBe("paid");
    expect(b.payment_ref).toBe("ACH 20261002");
    expect(b.paid_recorded_by).toBe(A().people.location_manager);

    await denied(as(A(), "owner"), VOID, [id, "error de entrada"], "22023", /bill_immutable/);
    await denied(as(A(), "owner"), PAY, [id, "2026-10-03", "CHK 2"], "22023", /bill_immutable/);
    await denied(as(A(), "owner"), DECIDE, [id, "reject", null], "22023", /invalid_status/);
    // No UPDATE/DELETE grant for request traffic at all.
    await denied(
      as(A(), "owner"),
      "UPDATE app.bill SET amount_cents = 1 WHERE id = $1",
      [id],
      "42501",
    );
    await denied(as(A(), "owner"), "DELETE FROM app.bill WHERE id = $1", [id], "42501");
    // Even the schema owner / superuser path hits the trigger.
    await expect(
      t.admin.query("UPDATE app.bill SET amount_cents = 1 WHERE id = $1", [id]),
    ).rejects.toMatchObject({ message: "bill_immutable" });
    await expect(
      t.admin.query(
        "UPDATE app.bill SET status = 'void', voided_at = now(), void_reason = 'xxx' WHERE id = $1",
        [id],
      ),
    ).rejects.toMatchObject({ message: "bill_immutable" });
    await expect(t.admin.query("DELETE FROM app.bill WHERE id = $1", [id])).rejects.toMatchObject({
      message: "bill_immutable",
    });
    expect((await billRow(id)).amount_cents).toBe(30000);
    const audit = await t.admin.query(
      "SELECT action, actor_person_id FROM app.audit_log WHERE entity_id = $1 AND action LIKE 'bill.%' ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "bill.decision",
      "bill.approved",
      "bill.paid",
    ]);
  });

  it("an approved bill keeps its amount; pending bills cannot be paid; above-threshold payment is owner-only", async () => {
    const small = await newBill(A(), 1000);
    await denied(as(A(), "owner"), PAY, [small, "2026-10-02", "CHK 3"], "22023", /invalid_status/);
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(DECIDE, [small, "approve", null]));
    await expect(
      t.admin.query("UPDATE app.bill SET amount_cents = 999999 WHERE id = $1", [small]),
    ).rejects.toMatchObject({ message: "bill_immutable" });
    const big = await newBill(A(), 75000);
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(DECIDE, [big, "approve", null]));
    await denied(
      as(A(), "location_manager"),
      PAY,
      [big, "2026-10-02", "CHK 4"],
      "42501",
      /above_threshold/,
    );
    await denied(as(A(), "location_manager"), VOID, [big, "duplicada"], "42501", /above_threshold/);
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(VOID, [big, "Factura duplicada"]));
    expect((await billRow(big)).status).toBe("void");
  });
});

describe("finance · columns, hostile input and accountant read-only", () => {
  it("request traffic cannot write status, creator, approval or payment columns", async () => {
    const v = await vendorOf(A());
    for (const [col, val] of [
      ["status", "paid"],
      ["created_by", A().people.accountant],
      ["approved_by", A().people.owner],
      ["payment_ref", "X"],
      ["org_id", B().orgId],
      // Even the value the policy would accept: the column itself is not writable (column grant, not only RLS).
      ["status", "pending_approval"],
      ["created_by", A().people.owner],
    ]) {
      await denied(
        as(A(), "owner"),
        `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents, ${col})
         VALUES ($1, $2, 'COL-1', '2026-10-01', '2026-10-31', 100, $3)`,
        [v, A().locations[0], val],
        "42501",
        /permission denied/,
      );
    }
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.expense (location_id, category, amount_cents, spent_on, recurring_id) VALUES ($1, 'rent', 1, '2026-10-01', NULL)",
      [A().locations[0]],
      "42501",
    );
    await denied(as(A(), "owner"), "UPDATE app.expense SET amount_cents = 1", [], "42501");
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.commission (staff_member_id, location_id, source, source_ref, amount_cents, earned_on, status) VALUES ($1, $2, 'sale', 'S-1', 100, '2026-10-01', 'paid')",
      [await staffId(A(), "trainer"), A().locations[0]],
      "42501",
    );
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.journal_export (period, line_count, debit_total_cents, credit_total_cents, csv, generated_by) VALUES ('2026-01-01', 0, 0, 0, 'x', $1)",
      [A().people.owner],
      "42501",
    );
  });

  it("hostile text and amounts are refused by the table", async () => {
    const v = await vendorOf(A());
    const bill = `INSERT INTO app.bill (vendor_id, location_id, number, memo, issued_on, due_on, amount_cents)
                  VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const L = A().locations[0];
    for (const params of [
      [v, L, "BAD\nNUM", null, "2026-10-01", "2026-10-31", 100],
      [v, L, "=HYPERLINK(1)", null, "2026-10-01", "2026-10-31", 100],
      [v, L, "OK-1", "memo\u0007bell", "2026-10-01", "2026-10-31", 100],
      [v, L, "OK-2", null, "2026-10-01", "2026-10-31", 0],
      [v, L, "OK-3", null, "2026-10-01", "2026-10-31", -500],
      [v, L, "OK-4", null, "2026-10-01", "2026-09-30", 100],
      [v, L, "OK-5", null, "1999-12-31", "2000-01-31", 100],
    ]) {
      await denied(as(A(), "owner"), bill, params, "23514");
    }
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.vendor (name) VALUES ($1)",
      ["Demo\r\nInjected"],
      "23514",
    );
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.vendor (name, contact_email) VALUES ('Demo Correo', $1)",
      ["no es correo"],
      "23514",
    );
    await denied(
      as(A(), "owner"),
      "INSERT INTO app.commission (staff_member_id, location_id, source, source_ref, amount_cents, earned_on) VALUES ($1, $2, 'sale', $3, 100, '2026-10-01')",
      [await staffId(A(), "trainer"), L, "ref with spaces; DROP"],
      "23514",
    );
    const id = await newBill(A(), 1000);
    await denied(as(A(), "owner"), DECIDE, [id, "approve", "nota\u0000"], "22021");
    await denied(
      as(A(), "owner"),
      DECIDE,
      [id, "approve", "nota\u001b[31m"],
      "22023",
      /invalid_note/,
    );
    await denied(
      as(A(), "owner"),
      DECIDE,
      [id, "approve", "x".repeat(301)],
      "22023",
      /invalid_note/,
    );
    // The same vendor invoice number cannot be entered twice (case-insensitive).
    const dup = `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents)
                 VALUES ($1, $2, $3, '2026-10-01', '2026-10-31', 100)`;
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(dup, [v, L, "DUP-77"]));
    await denied(as(A(), "owner"), dup, [v, L, "dup-77"], "23505");
  });

  it("accountant reads everything and generates exports, but cannot write anything else", async () => {
    const pending = await newBill(A(), 1000, { creator: "owner" });
    const acc = as(A(), "accountant");
    const v = await vendorOf(A());
    await denied(
      acc,
      `INSERT INTO app.bill (vendor_id, location_id, number, issued_on, due_on, amount_cents)
       VALUES ($1, $2, 'ACC-1', '2026-10-01', '2026-10-31', 100)`,
      [v, A().locations[0]],
      "42501",
    );
    await denied(
      acc,
      "INSERT INTO app.expense (location_id, category, amount_cents, spent_on) VALUES ($1, 'other', 100, '2026-10-01')",
      [A().locations[0]],
      "42501",
    );
    await denied(acc, "INSERT INTO app.vendor (name) VALUES ('Demo Contable')", [], "42501");
    await denied(
      acc,
      "INSERT INTO app.recurring_expense (location_id, category, description, amount_cents, next_on) VALUES ($1, 'rent', 'x', 1, '2026-10-01')",
      [A().locations[0]],
      "42501",
    );
    await denied(
      acc,
      "INSERT INTO app.commission (staff_member_id, location_id, source, source_ref, amount_cents, earned_on) VALUES ($1, $2, 'sale', 'ACC-S', 100, '2026-10-01')",
      [await staffId(A(), "trainer"), A().locations[0]],
      "42501",
    );
    await denied(acc, DECIDE, [pending, "approve", null], "42501", /^forbidden$/);
    await denied(acc, VOID, [pending, "duplicada"], "42501", /^forbidden$/);
    await denied(acc, "SELECT app.run_recurring_expenses(NULL)", [], "42501");
    const exp = (
      await t.admin.query("SELECT id FROM app.expense WHERE org_id = $1 LIMIT 1", [A().orgId])
    ).rows[0].id;
    await denied(acc, "SELECT app.void_expense($1, 'nope nope')", [exp], "42501");
    const com = (
      await t.admin.query("SELECT id FROM app.commission WHERE org_id = $1 LIMIT 1", [A().orgId])
    ).rows[0].id;
    await denied(acc, "SELECT app.set_commission_status($1, 'approved', NULL)", [com], "42501");
    await asCaller(t.api, acc, async (tx) => {
      for (const sql of [
        "UPDATE app.recurring_expense SET amount_cents = 1",
        "UPDATE app.vendor SET name = 'x'",
        "UPDATE app.finance_policy SET manager_approval_max_cents = 1",
      ]) {
        expect((await tx.query(sql)).rowCount, sql).toBe(0);
      }
      expect((await tx.query("SELECT * FROM app.finance_pnl('2026-01-01')")).rowCount).toBe(2);
      expect((await tx.query("SELECT * FROM app.finance_deferred()")).rowCount).toBe(2);
      expect((await tx.query("SELECT * FROM app.points_liability()")).rowCount).toBe(1);
    });
    const id = await asCaller(t.api, acc, async (tx) => {
      return (await tx.query("SELECT app.generate_journal_export('2026-01-01') AS id")).rows[0].id;
    });
    const row = await t.admin.query("SELECT generated_by FROM app.journal_export WHERE id = $1", [
      id,
    ]);
    expect(row.rows[0].generated_by).toBe(A().people.accountant);
    // The manager does not export.
    await denied(
      as(A(), "location_manager"),
      "SELECT app.generate_journal_export('2026-01-01')",
      [],
      "42501",
    );
    // Exports are append-only even for the schema owner.
    await expect(
      t.admin.query("UPDATE app.journal_export SET csv = 'x' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ message: "append_only" });
  });
});

describe("finance · expenses, recurring and commissions", () => {
  it("manager records and voids an expense at their location; a voided expense is final", async () => {
    const id = await asCaller(t.api, as(A(), "location_manager"), async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.expense (location_id, category, amount_cents, spent_on, receipt_note)
         VALUES ($1, 'supplies', 1999, '2026-10-05', 'Demo recibo tienda') RETURNING id, recorded_by`,
        [A().locations[0]],
      );
      expect(rows[0].recorded_by).toBe(A().people.location_manager);
      return rows[0].id;
    });
    await asCaller(t.api, as(A(), "location_manager"), (tx) =>
      tx.query("SELECT app.void_expense($1, 'Duplicado')", [id]),
    );
    await denied(
      as(A(), "owner"),
      "SELECT app.void_expense($1, 'otra vez')",
      [id],
      "22023",
      /invalid_status/,
    );
    await expect(
      t.admin.query("UPDATE app.expense SET amount_cents = 1 WHERE id = $1", [id]),
    ).rejects.toMatchObject({ message: "expense_immutable" });
    const audit = await t.admin.query(
      "SELECT action FROM app.audit_log WHERE entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["expense.insert", "expense.void"]);
  });

  it("recurring templates materialise each due month once, even when two runs race", async () => {
    const tpl = await asCaller(t.api, as(A(), "owner"), async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO app.recurring_expense (location_id, category, description, amount_cents, interval_months, next_on)
         VALUES ($1, 'utilities', 'Demo luz', 18000, 1, '2024-01-01') RETURNING id`,
        [A().locations[0]],
      );
      return rows[0].id;
    });
    const RUN = "SELECT app.run_recurring_expenses('2024-03-15') AS n";
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    let n2: number | null = null;
    let n1: number | null = null;
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, as(A(), "owner"));
      n1 = (await c1.query(RUN)).rows[0].n;
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as(A(), "location_manager"));
      const racing = c2.query(RUN).then((r) => {
        n2 = r.rows[0].n;
      });
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("COMMIT");
      await racing;
      await c2.query("COMMIT");
    } finally {
      c1.release();
      c2.release();
    }
    expect(n1).toBe(3);
    expect(n2).toBe(0);
    const rows = await t.admin.query(
      "SELECT spent_on::text AS d FROM app.expense WHERE recurring_id = $1 ORDER BY spent_on",
      [tpl],
    );
    expect(rows.rows.map((r) => r.d)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    const next = await t.admin.query(
      "SELECT next_on::text AS d FROM app.recurring_expense WHERE id = $1",
      [tpl],
    );
    expect(next.rows[0].d).toBe("2024-04-01");
    // Moving the template back never duplicates an occurrence (unique template + date).
    await asCaller(t.api, as(A(), "owner"), (tx) =>
      tx.query("UPDATE app.recurring_expense SET next_on = '2024-02-01' WHERE id = $1", [tpl]),
    );
    const rerun = await asCaller(
      t.api,
      as(A(), "owner"),
      async (tx) => (await tx.query(RUN)).rows[0].n,
    );
    expect(rerun).toBe(0);
    const again = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.expense WHERE recurring_id = $1",
      [tpl],
    );
    expect(again.rows[0].n).toBe(3);
    await denied(
      as(A(), "owner"),
      "SELECT app.run_recurring_expenses('2099-01-01')",
      [],
      "22023",
      /invalid_date/,
    );
    await t.admin.query("UPDATE app.recurring_expense SET active = false WHERE id = $1", [tpl]);
  });

  it("commissions: manager proposes for staff of their location; only the owner approves and pays; paid is final", async () => {
    const trainer = await staffId(A(), "trainer");
    const ins = `INSERT INTO app.commission (staff_member_id, location_id, source, source_ref, amount_cents, earned_on)
                 VALUES ($1, $2, 'session', $3, 3000, '2026-10-03') RETURNING id`;
    const id = await asCaller(
      t.api,
      as(A(), "location_manager"),
      async (tx) => (await tx.query(ins, [trainer, A().locations[0], "SES-100"])).rows[0].id,
    );
    // The trainer is not assigned to location 1.
    await denied(as(A(), "owner"), ins, [trainer, A().locations[1], "SES-101"], "42501");
    // One commission per staff + source + ref.
    await denied(as(A(), "owner"), ins, [trainer, A().locations[0], "SES-100"], "23505");
    const SET = "SELECT app.set_commission_status($1, $2, $3)";
    await denied(as(A(), "location_manager"), SET, [id, "approved", null], "42501");
    await denied(as(A(), "owner"), SET, [id, "paid", "2026-10-05"], "22023", /invalid_status/);
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(SET, [id, "approved", null]));
    await asCaller(t.api, as(A(), "owner"), (tx) => tx.query(SET, [id, "paid", "2026-10-05"]));
    await denied(as(A(), "owner"), SET, [id, "void", null], "22023", /commission_immutable/);
    await expect(
      t.admin.query("UPDATE app.commission SET amount_cents = 1 WHERE id = $1", [id]),
    ).rejects.toMatchObject({ message: "commission_immutable" });
  });
});

// ── P&L and journal export against a hand-built month (March 2025, org A) ───────────────────────────────
describe("finance · P&L and journal equal the fixture sums", () => {
  const M = "2025-03-01";
  let le = "";
  let invNo = 900;
  async function invoice(o: {
    loc: string;
    sub?: number;
    ivu?: number;
    issued: string;
    status?: "open" | "paid" | "void";
    period?: [string, string];
  }): Promise<string> {
    const a = A();
    const subtotal = o.sub ?? 0;
    const ivu = o.ivu ?? 0;
    const total = subtotal + ivu;
    const fee = Math.floor((total * 100 + 5000) / 10000);
    const subId = o.period
      ? (
          await t.admin.query("SELECT id FROM app.subscription WHERE org_id = $1 LIMIT 1", [
            a.orgId,
          ])
        ).rows[0].id
      : null;
    invNo += 1;
    const { rows } = await t.admin.query(
      `INSERT INTO app.invoice (org_id, legal_entity_id, number, member_id, location_id, subscription_id, period_start,
         period_end, subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents, application_fee_bps,
         application_fee_cents, status, issued_at, due_date, paid_at, voided_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,100,$12,$13::text::app.invoice_status,$14,'2025-04-30',
               CASE WHEN $13::text = 'paid' THEN $14::timestamptz END,
               CASE WHEN $13::text = 'void' THEN $14::timestamptz END, $15)
       RETURNING id`,
      [
        a.orgId,
        le,
        invNo,
        a.members[0],
        o.loc,
        subId,
        o.period?.[0] ?? null,
        o.period?.[1] ?? null,
        subtotal,
        ivu,
        total,
        fee,
        o.status ?? "open",
        o.issued,
        a.people.front_desk,
      ],
    );
    return rows[0].id;
  }
  async function sale(o: {
    loc: string;
    sub: number;
    ivu: number;
    completed: string;
    refunded?: string;
  }) {
    const a = A();
    await t.admin.query(
      `INSERT INTO app.sale (org_id, location_id, channel, status, subtotal_cents, ivu_state_cents, ivu_municipal_cents,
         total_cents, payment_method, created_by, completed_by, completed_at, refunded_by, refunded_at, refund_reason)
       VALUES ($1,$2,'pos',$3,$4,$5,0,$6,'cash',$7,$7,$8,$9,$10,$11)`,
      [
        a.orgId,
        o.loc,
        o.refunded ? "refunded" : "completed",
        o.sub,
        o.ivu,
        o.sub + o.ivu,
        a.people.front_desk,
        o.completed,
        o.refunded ? a.people.location_manager : null,
        o.refunded ?? null,
        o.refunded ? "Demo devolución" : null,
      ],
    );
  }
  async function bill(loc: string, amount: number, status: string, issued: string, paid?: string) {
    const a = A();
    const v = await vendorOf(a);
    const approved = status === "approved" || status === "paid";
    await t.admin.query(
      `INSERT INTO app.bill (org_id, vendor_id, location_id, number, category, issued_on, due_on, amount_cents, status,
         created_by, approved_by, approved_at, paid_on, payment_ref, paid_recorded_by, voided_at, void_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$6::date + 30,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        a.orgId,
        v,
        loc,
        `PL-${randomUUID().slice(0, 8)}`,
        amount === 60000 ? "utilities" : "maintenance",
        issued,
        amount,
        status,
        a.people.location_manager,
        approved ? a.people.owner : null,
        approved ? issued : null,
        paid ?? null,
        paid ? "CHK 55" : null,
        paid ? a.people.owner : null,
        status === "void" ? issued : null,
        status === "void" ? "Demo anulada" : null,
      ],
    );
  }

  beforeAll(async () => {
    const a = A();
    const [l0, l1] = a.locations;
    le = (await t.admin.query("SELECT legal_entity_id FROM app.location WHERE id = $1", [l0]))
      .rows[0].legal_entity_id;
    // Billing at l0: membership 31.00 for Mar 15 → Apr 15 (17/31 days in March = 17.00), a 15.00 exempt pass,
    // and a voided invoice that must not count.
    const mem = await invoice({
      loc: l0,
      sub: 3100,
      ivu: 357,
      issued: "2025-03-15T16:00:00Z",
      status: "paid",
      period: ["2025-03-15", "2025-04-15"],
    });
    await invoice({ loc: l0, sub: 1500, issued: "2025-03-20T16:00:00Z" });
    await invoice({
      loc: l0,
      sub: 9999,
      ivu: 1000,
      issued: "2025-03-21T16:00:00Z",
      status: "void",
    });
    await t.admin.query(
      `INSERT INTO app.payment (org_id, invoice_id, member_id, location_id, method, amount_cents, idempotency_key,
         recorded_by, received_at)
       VALUES ($1,$2,$3,$4,'cash',3457,'pl-test-pay-1',$5,'2025-03-16T16:00:00Z')`,
      [a.orgId, mem, a.members[0], l0, a.people.front_desk],
    );
    // Store at l0: 20.00 in March; 10.00 sold in Feb refunded in March; 5.00 sold in March refunded in April;
    // 1.00 completed at 23:00 local on March 31 (04-01 UTC) counts in March.
    await sale({ loc: l0, sub: 2000, ivu: 230, completed: "2025-03-10T16:00:00Z" });
    await sale({
      loc: l0,
      sub: 1000,
      ivu: 115,
      completed: "2025-02-27T16:00:00Z",
      refunded: "2025-03-05T16:00:00Z",
    });
    await sale({
      loc: l0,
      sub: 500,
      ivu: 58,
      completed: "2025-03-20T16:00:00Z",
      refunded: "2025-04-02T16:00:00Z",
    });
    await sale({ loc: l0, sub: 100, ivu: 12, completed: "2025-04-01T03:00:00Z" });
    // Expenses: 100.00 rent + 25.00 supplies at l0; voided and April ones excluded; 40.00 at l1.
    await t.admin.query(
      `INSERT INTO app.expense (org_id, location_id, category, amount_cents, spent_on, recorded_by, voided_at, voided_by, void_reason)
       VALUES ($1,$2,'rent',10000,'2025-03-01',$4,NULL,NULL,NULL),
              ($1,$2,'supplies',2500,'2025-03-31',$4,NULL,NULL,NULL),
              ($1,$2,'other',7777,'2025-03-10',$4,now(),$4,'Demo anulado'),
              ($1,$2,'other',3333,'2025-04-01',$4,NULL,NULL,NULL),
              ($1,$3,'marketing',4000,'2025-03-12',$4,NULL,NULL,NULL)`,
      [a.orgId, l0, l1, a.people.owner],
    );
    // Bills at l0: approved 400.00 and paid 600.00 count; pending and void do not; a February bill paid in March
    // is cash out only.
    await bill(l0, 40000, "approved", "2025-03-03");
    await bill(l0, 60000, "paid", "2025-03-04", "2025-03-20");
    await bill(l0, 11111, "pending_approval", "2025-03-05");
    await bill(l0, 22222, "void", "2025-03-06");
    await bill(l0, 5000, "paid", "2025-02-20", "2025-03-02");
    // Commissions at l0: approved 15.00 and paid 5.00 count; pending does not.
    const trainer = await staffId(a, "trainer");
    await t.admin.query(
      `INSERT INTO app.commission (org_id, staff_member_id, location_id, source, source_ref, amount_cents, earned_on,
         status, created_by, decided_by, decided_at, paid_on)
       VALUES ($1,$2,$3,'session','PL-1',1500,'2025-03-12','approved',$4,$4,now(),NULL),
              ($1,$2,$3,'sale','PL-2',999,'2025-03-12','pending',$4,NULL,NULL,NULL),
              ($1,$2,$3,'membership','PL-3',500,'2025-03-13','paid',$4,$4,now(),'2025-03-31')`,
      [a.orgId, trainer, l0, a.people.owner],
    );
  });

  it("owner and accountant: per-location P&L equals the hand-computed sums (accrual) plus the cash view", async () => {
    const [l0, l1] = A().locations;
    for (const role of ["owner", "accountant"] as const) {
      const rows = await asCaller(t.api, as(A(), role), async (tx) => {
        return (await tx.query("SELECT * FROM app.finance_pnl($1)", [M])).rows;
      });
      const r0 = rows.find((r) => r.location_id === l0);
      const r1 = rows.find((r) => r.location_id === l1);
      expect(rows).toHaveLength(2);
      expect(r0).toMatchObject({
        membership_revenue_cents: "1700",
        other_billing_revenue_cents: "1500",
        store_revenue_cents: "1600", // 2000 + 500 + 100 − 1000
        revenue_cents: "4800",
        expenses_cents: "12500",
        bills_cents: "100000",
        commissions_cents: "2000",
        platform_fees_cents: "50", // 35 + 15 (void excluded)
        costs_cents: "114550",
        net_cents: "-109750",
        cash_in_cents: "5242", // 3457 + (2230 + 558 + 112) − 1115
        cash_out_cents: "77500", // 12500 + 60000 + 5000
      });
      expect(r1).toMatchObject({ revenue_cents: "0", expenses_cents: "4000", net_cents: "-4000" });
    }
    // April receives the rest of the membership period: 31.00 − 17.00.
    const apr = await asCaller(t.api, as(A(), "owner"), async (tx) => {
      return (
        await tx.query("SELECT * FROM app.finance_pnl('2025-04-01') WHERE location_id = $1", [l0])
      ).rows[0];
    });
    expect(apr.membership_revenue_cents).toBe("1400");
    // The manager gets only their location, with the same numbers.
    const mgr = await asCaller(t.api, as(A(), "location_manager"), async (tx) => {
      return (await tx.query("SELECT * FROM app.finance_pnl($1)", [M])).rows;
    });
    expect(mgr.map((r) => r.location_id)).toEqual([l0]);
    expect(mgr[0].net_cents).toBe("-109750");
  });

  it("the journal export balances per location, matches the P&L, and is QuickBooks-shaped", async () => {
    const [l0] = A().locations;
    const id = await asCaller(t.api, as(A(), "owner"), async (tx) => {
      return (await tx.query("SELECT app.generate_journal_export($1) AS id", [M])).rows[0].id;
    });
    const { rows } = await t.admin.query("SELECT * FROM app.journal_export WHERE id = $1", [id]);
    const ex = rows[0];
    expect(ex.debit_total_cents).toBe(ex.credit_total_cents);
    const lines: string[] = ex.csv.trim().split("\r\n");
    expect(lines[0]).toBe("JournalNo,JournalDate,Account,Debits,Credits,Description,Location");
    expect(lines.length - 1).toBe(ex.line_count);
    const parse = (l: string) => l.slice(1, -1).split('","');
    const loc0 = (await t.admin.query("SELECT name FROM app.location WHERE id = $1", [l0])).rows[0]
      .name;
    const byAccount = new Map(
      lines
        .slice(1)
        .map(parse)
        .filter((c) => c[6] === loc0)
        .map((c) => [c[2], { dr: c[3], cr: c[4], date: c[1], no: c[0] }]),
    );
    expect(byAccount.get("Membership Revenue")).toMatchObject({
      dr: "",
      cr: "17.00",
      date: "03/31/2025",
    });
    expect(byAccount.get("Deferred Revenue")).toMatchObject({ cr: "14.00" });
    expect(byAccount.get("Packs and Passes Revenue")).toMatchObject({ cr: "15.00" });
    expect(byAccount.get("Store Sales")).toMatchObject({ cr: "16.00" });
    expect(byAccount.get("Rent Expense")).toMatchObject({ dr: "100.00" });
    expect(byAccount.get("Repairs and Maintenance")).toMatchObject({ dr: "400.00" });
    expect(byAccount.get("Utilities Expense")).toMatchObject({ dr: "600.00" });
    expect(byAccount.get("Commissions Expense")).toMatchObject({ dr: "20.00" });
    expect(byAccount.get("Platform Fees")).toMatchObject({ dr: "0.50" });
    expect(byAccount.get("Accounts Payable")).toMatchObject({ cr: "350.00" }); // 1000 accrued − 650 paid
    expect(byAccount.get("Bank")).toMatchObject({ cr: "775.00" });
    // Every journal entry (JournalNo) balances on its own.
    const sums = new Map<string, number>();
    for (const c of lines.slice(1).map(parse)) {
      const cents = (s: string) => (s ? Math.round(Number(s) * 100) : 0);
      sums.set(c[0], (sums.get(c[0]) ?? 0) + cents(c[3]) - cents(c[4]));
    }
    expect(sums.size).toBe(2);
    for (const v of sums.values()) expect(v).toBe(0);
    const audit = await t.admin.query(
      "SELECT actor_person_id FROM app.audit_log WHERE action = 'journal.export' AND entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ actor_person_id: A().people.owner }]);
  });

  it("CSV cells are quoted and formula-neutralised (a hostile location name cannot run in a spreadsheet)", async () => {
    const csv = await rolledBack(as(A(), "owner"), async (tx) => {
      // The strictest name the location CHECK still allows that a spreadsheet would treat as a formula.
      await tx.query("UPDATE app.location SET name = $1 WHERE id = $2", [
        "-2-3 Demo 'Sur'",
        A().locations[1],
      ]);
      const id = (await tx.query("SELECT app.generate_journal_export($1) AS id", [M])).rows[0].id;
      return (await tx.query("SELECT csv FROM app.journal_export WHERE id = $1", [id])).rows[0].csv;
    });
    expect(csv).toContain(`"'-2-3 Demo 'Sur'"`);
    expect(csv).not.toMatch(/(^|,)"?-2-3/m);
    // The cell encoder itself (defence in depth for any future free-text column).
    const { rows } = await t.admin.query(
      "SELECT app.fin_csv('=1+1') a, app.fin_csv('+1') b, app.fin_csv('@SUM(A1)') c, app.fin_csv(E'\\tx') d, app.fin_csv('a\"b,c') e, app.fin_csv(NULL) f",
    );
    expect(rows[0]).toEqual({
      a: `"'=1+1"`,
      b: `"'+1"`,
      c: `"'@SUM(A1)"`,
      d: `"'\tx"`,
      e: `"a""b,c"`,
      f: `""`,
    });
  });

  it("a future period cannot be exported; any day of a month means that month", async () => {
    await denied(
      as(A(), "owner"),
      "SELECT app.generate_journal_export('2099-01-01')",
      [],
      "22023",
      /invalid_date/,
    );
    const id = await asCaller(t.api, as(A(), "owner"), async (tx) => {
      return (await tx.query("SELECT app.generate_journal_export('2025-03-17') AS id")).rows[0].id;
    });
    const r = await t.admin.query(
      "SELECT period::text AS p FROM app.journal_export WHERE id = $1",
      [id],
    );
    expect(r.rows[0].p).toBe("2025-03-01");
  });

  it("deferred revenue: unearned membership days and the remaining value of live credit packs", async () => {
    const a = A();
    const [l0] = a.locations;
    // A 120.00 class pack with 7 of 10 credits left → 84.00 deferred (informational).
    const { rows: pk } = await t.admin.query(
      "SELECT pp.id AS product, pr.id AS price FROM app.plan_product pp JOIN app.price pr ON pr.product_id = pp.id WHERE pp.org_id = $1 AND pp.kind = 'class_pack' LIMIT 1",
      [a.orgId],
    );
    const inv = await invoice({
      loc: l0,
      sub: 12000,
      issued: new Date().toISOString(),
      status: "paid",
    });
    await t.admin.query(
      `INSERT INTO app.invoice_line (org_id, invoice_id, product_id, price_id, description, quantity, unit_amount_cents, tax_category)
       VALUES ($1,$2,$3,$4,'Demo paquete',1,12000,'exempt')`,
      [a.orgId, inv, pk[0].product, pk[0].price],
    );
    await t.admin.query(
      `INSERT INTO app.credit_balance (org_id, member_id, product_id, location_id, invoice_id, credits_total, credits_remaining, expires_at)
       VALUES ($1,$2,$3,$4,$5,10,7, now() + interval '30 days'),
              ($1,$2,$3,$4,$5,10,5, now() - interval '1 day')`,
      [a.orgId, a.members[0], pk[0].product, l0, inv],
    );
    const rows = await asCaller(t.api, as(a, "owner"), async (tx) => {
      return (await tx.query("SELECT * FROM app.finance_deferred()")).rows;
    });
    const r0 = rows.find((r) => r.location_id === l0);
    expect(r0.unused_credits_cents).toBe("8400");
    // The fixture membership invoice (29.95 for the month starting today) is mostly unearned.
    expect(Number(r0.prepaid_periods_cents)).toBeGreaterThan(0);
    expect(Number(r0.prepaid_periods_cents)).toBeLessThanOrEqual(2995);
  });
});
