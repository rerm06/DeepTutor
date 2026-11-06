import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, bindClaims } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
let licensedNutri: string; // person id: nutritionist with a verified licence at A.locations[0]
let licensedClin: string; // person id: clinician with a verified licence at A.locations[0]
let wardA: string; // member id of the guardian's ward in org A

const NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false };
const YES1 = { ...NO, q3: true };
const BODY = { sections: [{ heading: "Semana 1", items: ["Caminata 20 minutos"] }] };

async function licensedStaff(org: OrgFixture, role: Role, tag: string, licence: string) {
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`${tag}@demo.invalid`],
  );
  const s = await t.admin.query<{ id: string }>(
    `INSERT INTO app.staff_member (org_id, person_id, role, display_name, license_no, license_verified_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [org.orgId, p.rows[0]?.id, role, `Demo ${tag}`, licence],
  );
  await t.admin.query(
    "INSERT INTO app.staff_location (org_id, staff_member_id, location_id) VALUES ($1, $2, $3)",
    [org.orgId, s.rows[0]?.id, org.locations[0]],
  );
  return p.rows[0]?.id as string;
}

let seq = 0;
/** A fresh member per test so cases never depend on each other's data. */
async function newMember(org: OrgFixture, loc = org.locations[0]): Promise<string> {
  seq += 1;
  const p = await t.admin.query<{ id: string }>(
    "INSERT INTO app.person (email) VALUES ($1) RETURNING id",
    [`health${seq}.${Date.now()}@demo.invalid`],
  );
  const m = await t.admin.query<{ id: string }>(
    "INSERT INTO app.member (org_id, person_id, home_location_id, full_name, status) VALUES ($1,$2,$3,$4,'active') RETURNING id",
    [org.orgId, p.rows[0]?.id, loc, `Demo health ${seq}`],
  );
  return m.rows[0]?.id as string;
}

const as = (role: Role, org: OrgFixture = t.fx.A, person?: string) => t.claims(org, role, person);

interface AssessmentInput {
  parq?: Record<string, unknown>;
  resolved?: boolean;
  conditions?: string[];
  acute?: boolean;
}
async function insertAssessment(tx: Tx, member: string, a: AssessmentInput = {}): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO app.assessment (member_id, parq, parq_followup_resolved, declared_conditions, acute_symptoms,
       resting_hr, bp_sys, bp_dia, height_cm, weight_kg, waist_cm, fitness_tests)
     VALUES ($1, $2, $3, $4, $5, 70, 120, 80, 170, 72, 84, '{"pushups": 12}') RETURNING id`,
    [
      member,
      JSON.stringify(a.parq ?? NO),
      a.resolved ?? false,
      a.conditions ?? [],
      a.acute ?? false,
    ],
  );
  return rows[0]?.id as string;
}
/** Create and sign an assessment as the A trainer; returns the triage row. */
async function signedTriage(member: string, a: AssessmentInput = {}, org = t.fx.A) {
  return asCaller(t.api, as("trainer", org), async (tx) => {
    const id = await insertAssessment(tx, member, a);
    const r = await tx.query<{ id: string }>("SELECT app.sign_assessment($1) AS id", [id]);
    const tr = await tx.query("SELECT * FROM app.triage_result WHERE id = $1", [r.rows[0]?.id]);
    return { assessmentId: id, triage: tr.rows[0] };
  });
}
async function createPlan(
  tx: Tx,
  member: string,
  kind: string,
  title = "Demo plan",
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO app.care_plan (member_id, kind, title, body) VALUES ($1, $2, $3, $4) RETURNING id",
    [member, kind, title, JSON.stringify(BODY)],
  );
  return rows[0]?.id as string;
}
async function planInReview(member: string, kind: "training" | "nutrition" | "treatment") {
  const author: Role =
    kind === "training" ? "trainer" : kind === "nutrition" ? "nutritionist" : "clinician";
  return asCaller(t.api, as(author), async (tx) => {
    const id = await createPlan(tx, member, kind);
    await tx.query("SELECT app.submit_care_plan($1)", [id]);
    return id;
  });
}
const status = async (planId: string) =>
  (await t.admin.query("SELECT status FROM app.care_plan WHERE id = $1", [planId])).rows[0]?.status;

beforeAll(async () => {
  t = await createTestDb();
  licensedNutri = await licensedStaff(t.fx.A, "nutritionist", "nutri.lic.a", "LIC-N-777");
  licensedClin = await licensedStaff(t.fx.A, "clinician", "clin.lic.a", "LIC-C-888");
  wardA = (
    await t.admin.query("SELECT member_id FROM app.guardian_link WHERE org_id = $1", [t.fx.A.orgId])
  ).rows[0]?.member_id;
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

describe("triage (spec §6.2 table, rule_version v0-propuesta) — pure function", () => {
  async function triage(a: AssessmentInput & { minor?: boolean }) {
    return asCaller(t.api, as("member"), async (tx) => {
      const { rows } = await tx.query("SELECT * FROM app.health_triage($1, $2, $3, $4, $5)", [
        JSON.stringify(a.parq ?? NO),
        a.resolved ?? false,
        a.conditions ?? [],
        a.acute ?? false,
        a.minor ?? false,
      ]);
      return rows[0];
    });
  }

  it("PAR-Q all no → green / green, no referral", async () => {
    expect(await triage({})).toEqual({
      exercise_level: "green",
      nutrition_level: "green",
      requires_medical_referral: false,
      emergency: false,
      no_calorie_counting: false,
      reasons: ["parq_all_no"],
    });
  });

  it("PAR-Q positive with follow-up resolved → exercise green", async () => {
    const r = await triage({ parq: YES1, resolved: true });
    expect([r.exercise_level, r.nutrition_level, r.reasons]).toEqual([
      "green",
      "green",
      ["parq_positive_resolved"],
    ]);
  });

  it("PAR-Q positive unresolved → exercise amber", async () => {
    const r = await triage({ parq: YES1 });
    expect([r.exercise_level, r.nutrition_level, r.requires_medical_referral]).toEqual([
      "amber",
      "green",
      false,
    ]);
    expect(r.reasons).toEqual(["parq_positive_unresolved"]);
  });

  it.each(["diabetes", "ckd", "cvd"])("%s → amber / amber + medical referral", async (c) => {
    const r = await triage({ conditions: [c] });
    expect([r.exercise_level, r.nutrition_level, r.requires_medical_referral]).toEqual([
      "amber",
      "amber",
      true,
    ]);
    expect(r.reasons).toContain(`condition_${c}`);
  });

  it.each(["pregnancy", "lactation"])("%s → amber / amber (no referral)", async (c) => {
    const r = await triage({ conditions: [c] });
    expect([r.exercise_level, r.nutrition_level, r.requires_medical_referral]).toEqual([
      "amber",
      "amber",
      false,
    ]);
  });

  it("GLP-1 → nutrition amber only", async () => {
    const r = await triage({ conditions: ["glp1"] });
    expect([r.exercise_level, r.nutrition_level, r.requires_medical_referral]).toEqual([
      "green",
      "amber",
      false,
    ]);
  });

  it("ED screen positive → nutrition red", async () => {
    const r = await triage({ conditions: ["eating_disorder_screen_positive"] });
    expect(r.nutrition_level).toBe("red");
    expect(r.exercise_level).toBe("green");
    expect(r.reasons).toContain("condition_eating_disorder_screen_positive");
  });

  it.each(["advanced_ckd", "active_ed", "high_risk_pregnancy"])("%s → nutrition red", async (c) => {
    const r = await triage({ conditions: [c] });
    expect(r.nutrition_level).toBe("red");
    expect(r.requires_medical_referral).toBe(true);
  });

  it("minor (guardian link) → no calorie counting flag", async () => {
    expect((await triage({ minor: true })).no_calorie_counting).toBe(true);
    expect((await triage({ minor: false })).no_calorie_counting).toBe(false);
  });

  it("acute symptoms → emergency flag (exercise red, referral)", async () => {
    const r = await triage({ acute: true });
    expect([r.emergency, r.exercise_level, r.requires_medical_referral]).toEqual([
      true,
      "red",
      true,
    ]);
  });

  it("severity combines to the maximum and is deterministic", async () => {
    const input = { parq: YES1, conditions: ["glp1", "pregnancy", "active_ed"] };
    const a = await triage(input);
    expect([a.exercise_level, a.nutrition_level]).toEqual(["amber", "red"]);
    expect(await triage(input)).toEqual(a);
  });

  it("refuses malformed PAR-Q and unknown conditions (hostile input)", async () => {
    for (const bad of [
      { parq: { ...NO, q8: false } },
      { parq: { q1: false } },
      { parq: { ...NO, q1: "yes" } },
      { parq: [] as unknown as Record<string, unknown> },
      { conditions: ["cancer"] },
      { conditions: ["diabetes'; DROP TABLE app.assessment; --"] },
    ]) {
      await expect(triage(bad)).rejects.toMatchObject({ code: "22023" });
    }
  });
});

describe("assessments", () => {
  it("trainer creates a draft (evaluator forced to their own staff row) and signs it → triage stored and audited", async () => {
    const m = await newMember(t.fx.A);
    const { assessmentId, triage } = await signedTriage(m, { conditions: ["diabetes"] });
    expect(triage).toMatchObject({
      rule_version: "v0-propuesta",
      exercise_level: "amber",
      nutrition_level: "amber",
      requires_medical_referral: true,
    });
    const a = await t.admin.query(
      `SELECT a.status, s.role AS evaluator, sg.role AS signer FROM app.assessment a
         JOIN app.staff_member s ON s.id = a.evaluator_staff_id JOIN app.staff_member sg ON sg.id = a.signed_by
        WHERE a.id = $1`,
      [assessmentId],
    );
    expect(a.rows[0]).toEqual({ status: "signed", evaluator: "trainer", signer: "trainer" });
    const audit = await t.admin.query(
      "SELECT action, actor_role, meta FROM app.audit_log WHERE entity_id = $1 ORDER BY id",
      [assessmentId],
    );
    expect(audit.rows.map((r) => [r.action, r.actor_role])).toEqual([
      ["health.assessment.create", "trainer"],
      ["health.assessment.signed", "trainer"],
    ]);
    // No clinical data leaks into the audit trail.
    for (const r of audit.rows) expect(JSON.stringify(r.meta)).not.toContain("diabetes");
  });

  it.each(["owner", "location_manager", "nutritionist", "clinician"] as Role[])(
    "%s may create and sign an assessment at the member's location",
    async (role) => {
      const m = await newMember(t.fx.A);
      await asCaller(t.api, as(role), async (tx) => {
        const id = await insertAssessment(tx, m);
        await tx.query("SELECT app.sign_assessment($1)", [id]);
      });
    },
  );

  it.each(["front_desk", "chef", "accountant", "member", "guardian"] as Role[])(
    "%s cannot create or sign assessments",
    async (role) => {
      const m = await newMember(t.fx.A);
      await expect(
        asCaller(t.api, as(role), (tx) => insertAssessment(tx, m)),
      ).rejects.toMatchObject({ code: "42501" });
      const draft = await asCaller(t.api, as("trainer"), (tx) => insertAssessment(tx, m));
      await expect(
        asCaller(t.api, as(role), (tx) => tx.query("SELECT app.sign_assessment($1)", [draft])),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("other location: a scoped trainer cannot assess, sign or see a member of another location; the owner can", async () => {
    const m = await newMember(t.fx.A, t.fx.A.locations[1]);
    await expect(
      asCaller(t.api, as("trainer"), (tx) => insertAssessment(tx, m)),
    ).rejects.toMatchObject({ code: "42501" });
    const id = await asCaller(t.api, as("owner"), (tx) => insertAssessment(tx, m));
    await asCaller(t.api, as("trainer"), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.assessment WHERE id = $1", [id])).rowCount).toBe(0);
      const upd = await tx.query("UPDATE app.assessment SET resting_hr = 99 WHERE id = $1", [id]);
      expect(upd.rowCount).toBe(0);
    });
    await expect(
      asCaller(t.api, as("trainer"), (tx) => tx.query("SELECT app.sign_assessment($1)", [id])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("other org: org B staff cannot assess, sign or see org A members", async () => {
    const m = await newMember(t.fx.A);
    const id = await asCaller(t.api, as("trainer"), (tx) => insertAssessment(tx, m));
    await expect(
      asCaller(t.api, as("owner", t.fx.B), (tx) => insertAssessment(tx, m)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/) });
    await expect(
      asCaller(t.api, as("owner", t.fx.B), (tx) =>
        tx.query("SELECT app.sign_assessment($1)", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await asCaller(t.api, as("owner", t.fx.B), async (tx) => {
      expect((await tx.query("SELECT 1 FROM app.assessment WHERE id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("forbidden columns: evaluator, status and signature cannot be written by request traffic", async () => {
    const m = await newMember(t.fx.A);
    const id = await asCaller(t.api, as("trainer"), (tx) => insertAssessment(tx, m));
    const owner = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND role = 'owner'",
      [t.fx.A.orgId],
    );
    for (const [sql, args] of [
      [
        "INSERT INTO app.assessment (member_id, parq, evaluator_staff_id) VALUES ($1, $2, $3)",
        [m, JSON.stringify(NO), owner.rows[0]?.id],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, status) VALUES ($1, $2, 'signed')",
        [m, JSON.stringify(NO)],
      ],
      ["UPDATE app.assessment SET status = 'signed' WHERE id = $1", [id]],
      ["UPDATE app.assessment SET signed_at = now() WHERE id = $1", [id]],
      ["UPDATE app.assessment SET member_id = member_id WHERE id = $1", [id]],
      [
        "INSERT INTO app.triage_result (assessment_id, member_id, exercise_level, nutrition_level, requires_medical_referral, reasons) VALUES ($1, $2, 'green', 'green', false, '{x}')",
        [id, m],
      ],
    ] as Array<[string, unknown[]]>) {
      await expect(
        asCaller(t.api, as("trainer"), (tx) => tx.query(sql, args)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("column grants: request traffic may write exactly the draft columns, nothing else", async () => {
    const { rows } = await t.admin.query<{
      table_name: string;
      privilege_type: string;
      cols: string[];
    }>(
      `SELECT table_name, privilege_type, array_agg(column_name::text ORDER BY column_name) AS cols
         FROM information_schema.column_privileges
        WHERE grantee = 'app_authenticated' AND table_schema = 'app'
          AND table_name IN ('assessment', 'triage_result', 'care_plan')
          AND privilege_type IN ('INSERT', 'UPDATE')
        GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    const draftCols = [
      "acute_symptoms",
      "bp_dia",
      "bp_sys",
      "declared_conditions",
      "fitness_tests",
      "height_cm",
      "parq",
      "parq_followup_resolved",
      "resting_hr",
      "taken_at",
      "waist_cm",
      "weight_kg",
    ];
    expect(rows).toEqual([
      {
        table_name: "assessment",
        privilege_type: "INSERT",
        cols: [...draftCols, "member_id"].sort(),
      },
      { table_name: "assessment", privilege_type: "UPDATE", cols: draftCols },
      {
        table_name: "care_plan",
        privilege_type: "INSERT",
        cols: ["body", "kind", "member_id", "rationale", "title"],
      },
      { table_name: "care_plan", privilege_type: "UPDATE", cols: ["body", "rationale", "title"] },
    ]);
  });

  it("insert policies hold on their own even if a column grant regressed (defence in depth)", async () => {
    const m = await newMember(t.fx.A);
    const owner = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND role = 'owner'",
      [t.fx.A.orgId],
    );
    await t.admin.query(
      `GRANT INSERT (evaluator_staff_id, status, signed_by, signed_at) ON app.assessment TO app_authenticated;
       GRANT INSERT (created_by, status, version, approved_by) ON app.care_plan TO app_authenticated`,
    );
    try {
      for (const [sql, args] of [
        [
          "INSERT INTO app.assessment (member_id, parq, evaluator_staff_id) VALUES ($1, $2, $3)",
          [m, JSON.stringify(NO), owner.rows[0]?.id],
        ],
        [
          "INSERT INTO app.assessment (member_id, parq, status, signed_by, signed_at) VALUES ($1, $2, 'signed', $3, now())",
          [m, JSON.stringify(NO), owner.rows[0]?.id],
        ],
        [
          "INSERT INTO app.care_plan (member_id, kind, title, created_by) VALUES ($1, 'training', 'x', $2)",
          [m, owner.rows[0]?.id],
        ],
        [
          "INSERT INTO app.care_plan (member_id, kind, title, version) VALUES ($1, 'training', 'x', 2)",
          [m],
        ],
      ] as Array<[string, unknown[]]>) {
        await expect(
          asCaller(t.api, as("trainer"), (tx) => tx.query(sql, args)),
          sql,
        ).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await t.admin.query(
        `REVOKE INSERT (evaluator_staff_id, status, signed_by, signed_at) ON app.assessment FROM app_authenticated;
         REVOKE INSERT (created_by, status, version, approved_by) ON app.care_plan FROM app_authenticated`,
      );
    }
  });

  it("hostile input is refused by CHECK constraints", async () => {
    const m = await newMember(t.fx.A);
    const bad: Array<[string, unknown[]]> = [
      [
        "INSERT INTO app.assessment (member_id, parq) VALUES ($1, $2)",
        [m, JSON.stringify({ ...NO, q8: true })],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq) VALUES ($1, $2)",
        [m, JSON.stringify({ ...NO, q1: "<script>" })],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, declared_conditions) VALUES ($1, $2, $3)",
        [m, JSON.stringify(NO), ["cancer"]],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, bp_sys, bp_dia) VALUES ($1, $2, 80, 120)",
        [m, JSON.stringify(NO)],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, resting_hr) VALUES ($1, $2, 900)",
        [m, JSON.stringify(NO)],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, fitness_tests) VALUES ($1, $2, $3)",
        [m, JSON.stringify(NO), JSON.stringify({ notes: "{{x}}" })],
      ],
      [
        "INSERT INTO app.assessment (member_id, parq, fitness_tests) VALUES ($1, $2, $3)",
        [m, JSON.stringify(NO), JSON.stringify({ pushups: "12" })],
      ],
    ];
    for (const [sql, args] of bad) {
      await expect(
        asCaller(t.api, as("trainer"), (tx) => tx.query(sql, args)),
        JSON.stringify(args),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("a signed assessment is immutable (no direct edit, no re-sign, not even for the owner of the schema)", async () => {
    const m = await newMember(t.fx.A);
    const { assessmentId } = await signedTriage(m);
    await asCaller(t.api, as("trainer"), async (tx) => {
      const upd = await tx.query("UPDATE app.assessment SET resting_hr = 99 WHERE id = $1", [
        assessmentId,
      ]);
      expect(upd.rowCount).toBe(0);
    });
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.sign_assessment($1)", [assessmentId]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      t.admin.query("UPDATE app.assessment SET resting_hr = 99 WHERE id = $1", [assessmentId]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      t.admin.query(
        "UPDATE app.triage_result SET nutrition_level = 'green' WHERE assessment_id = $1",
        [assessmentId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a guardian link marks the triage with no calorie counting", async () => {
    const tr = await asCaller(t.api, as("trainer"), async (tx) => {
      const id = await insertAssessment(tx, wardA);
      const r = await tx.query<{ id: string }>("SELECT app.sign_assessment($1) AS id", [id]);
      return (
        await tx.query("SELECT no_calorie_counting, reasons FROM app.triage_result WHERE id = $1", [
          r.rows[0]?.id,
        ])
      ).rows[0];
    });
    expect(tr.no_calorie_counting).toBe(true);
    expect(tr.reasons).toContain("minor_guardian_link");
  });
});

describe("visibility", () => {
  it.each(["A", "B"])(
    "org %s: front desk, chef and accountant see zero rows in every health table",
    async (label) => {
      const org = label === "A" ? t.fx.A : t.fx.B;
      for (const role of ["front_desk", "chef", "accountant"] as Role[]) {
        await asCaller(t.api, as(role, org), async (tx) => {
          for (const table of ["assessment", "triage_result", "care_plan"]) {
            const { rowCount } = await tx.query(`SELECT 1 FROM app.${table}`);
            expect(rowCount, `${role} ${table}`).toBe(0);
          }
        });
      }
    },
  );

  it("the member sees only their own SIGNED assessments and PUBLISHED plans", async () => {
    const A = t.fx.A;
    // Fixture: members[0] has one signed + one draft assessment and one published training plan; add a draft plan.
    await asCaller(t.api, as("trainer"), (tx) =>
      createPlan(tx, A.members[0], "training", "Demo borrador"),
    );
    await asCaller(t.api, as("member"), async (tx) => {
      const a = await tx.query("SELECT member_id, status FROM app.assessment");
      expect(a.rows.length).toBeGreaterThanOrEqual(1);
      for (const r of a.rows) expect(r).toEqual({ member_id: A.members[0], status: "signed" });
      const p = await tx.query("SELECT member_id, status FROM app.care_plan");
      expect(p.rows.length).toBeGreaterThanOrEqual(1);
      for (const r of p.rows) expect(r).toEqual({ member_id: A.members[0], status: "published" });
      const tr = await tx.query("SELECT DISTINCT member_id FROM app.triage_result");
      expect(tr.rows).toEqual([{ member_id: A.members[0] }]);
    });
    const drafts = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.assessment WHERE member_id = $1 AND status = 'draft'",
      [A.members[0]],
    );
    expect(drafts.rows[0].n).toBeGreaterThan(0);
  });

  it("the guardian sees the ward's signed rows and nobody else's", async () => {
    await signedTriage(wardA);
    await asCaller(t.api, as("guardian"), async (tx) => {
      const a = await tx.query("SELECT DISTINCT member_id, status FROM app.assessment");
      expect(a.rows).toEqual([{ member_id: wardA, status: "signed" }]);
    });
  });

  it("scoped health staff see their location; the owner sees the whole org", async () => {
    const far = await newMember(t.fx.A, t.fx.A.locations[1]);
    await asCaller(t.api, as("owner"), (tx) => insertAssessment(tx, far));
    for (const role of ["trainer", "nutritionist", "clinician", "location_manager"] as Role[]) {
      await asCaller(t.api, as(role), async (tx) => {
        const { rows } = await tx.query(
          "SELECT DISTINCT m.home_location_id FROM app.assessment a JOIN app.member m ON m.id = a.member_id",
        );
        expect(rows, role).toEqual([{ home_location_id: t.fx.A.locations[0] }]);
      });
    }
    await asCaller(t.api, as("owner"), async (tx) => {
      const { rows } = await tx.query("SELECT 1 FROM app.assessment WHERE member_id = $1", [far]);
      expect(rows.length).toBe(1);
    });
  });
});

describe("care plans: sign-off rules", () => {
  it("training: trainer drafts, submits, approves and publishes; every transition is audited; the member then sees it", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const id = await planInReview(m, "training");
    await asCaller(t.api, as("trainer"), async (tx) => {
      await tx.query("SELECT app.approve_care_plan($1, false)", [id]);
      await tx.query("SELECT app.publish_care_plan($1)", [id]);
    });
    const row = (
      await t.admin.query(
        "SELECT status, approver_name, approver_license_no FROM app.care_plan WHERE id = $1",
        [id],
      )
    ).rows[0];
    expect(row).toEqual({
      status: "published",
      approver_name: "Demo trainer A",
      approver_license_no: null,
    });
    const audit = await t.admin.query(
      "SELECT action, actor_role FROM app.audit_log WHERE entity = 'care_plan' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "care_plan.create",
      "care_plan.review",
      "care_plan.approved",
      "care_plan.published",
    ]);
  });

  it("training: location_manager may approve; nutritionist, clinician and owner may not", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const id = await planInReview(m, "training");
    for (const role of ["nutritionist", "clinician", "owner", "front_desk"] as Role[]) {
      await expect(
        asCaller(t.api, as(role), (tx) =>
          tx.query("SELECT app.approve_care_plan($1, false)", [id]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await asCaller(t.api, as("location_manager"), (tx) =>
      tx.query("SELECT app.approve_care_plan($1, false)", [id]),
    );
    expect(await status(id)).toBe("approved");
  });

  it("nutrition: an UNLICENSED nutritionist cannot approve; a licensed one can, with licence snapshot", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const id = await planInReview(m, "nutrition");
    await expect(
      asCaller(t.api, as("nutritionist"), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, false)", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501", message: "license_not_verified" });
    expect(await status(id)).toBe("review");
    await asCaller(t.api, as("nutritionist", t.fx.A, licensedNutri), (tx) =>
      tx.query("SELECT app.approve_care_plan($1, false)", [id]),
    );
    const row = (
      await t.admin.query(
        "SELECT status, approver_name, approver_license_no, triage_result_id IS NOT NULL AS has_triage FROM app.care_plan WHERE id = $1",
        [id],
      )
    ).rows[0];
    expect(row).toEqual({
      status: "approved",
      approver_name: "Demo nutri.lic.a",
      approver_license_no: "LIC-N-777",
      has_triage: true,
    });
  });

  it("nutrition: a RED latest nutrition triage blocks approval", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m, { conditions: ["eating_disorder_screen_positive"] });
    const id = await planInReview(m, "nutrition");
    await expect(
      asCaller(t.api, as("nutritionist", t.fx.A, licensedNutri), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, true)", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501", message: "triage_red_blocks_nutrition" });
    expect(await status(id)).toBe("review");
  });

  it("nutrition: the guard trigger refuses a red approval even on a privileged path", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m, { conditions: ["active_ed"] });
    const id = await planInReview(m, "nutrition");
    await expect(
      t.admin.query(
        `UPDATE app.care_plan SET status = 'approved', approved_by = s.id, approved_at = now(),
                approver_name = s.display_name, approver_license_no = s.license_no, referral_acknowledged = true,
                triage_result_id = (SELECT id FROM app.triage_result WHERE member_id = $2)
           FROM app.staff_member s WHERE s.person_id = $3 AND app.care_plan.id = $1`,
        [id, m, licensedNutri],
      ),
    ).rejects.toMatchObject({ code: "42501", message: "triage_red_blocks_nutrition" });
  });

  it("the guard trigger alone enforces licence, approver role and referral acknowledgement", async () => {
    /** Privileged approval (bypasses the definer function) by the staff row of `person` with `role`. */
    const forceApprove = (id: string, member: string, person: string, role: Role, ack: boolean) =>
      t.admin.query(
        `UPDATE app.care_plan SET status = 'approved', approved_by = s.id, approved_at = now(),
                approver_name = s.display_name, approver_license_no = coalesce(s.license_no, 'X'),
                referral_acknowledged = $5,
                triage_result_id = (SELECT id FROM app.triage_result WHERE member_id = $2
                                     ORDER BY computed_at DESC LIMIT 1)
           FROM app.staff_member s
          WHERE s.person_id = $3 AND s.role = $4 AND s.org_id = app.care_plan.org_id AND app.care_plan.id = $1`,
        [id, member, person, role, ack],
      );
    const green = await newMember(t.fx.A);
    await signedTriage(green);
    const p1 = await planInReview(green, "nutrition");
    await expect(
      forceApprove(p1, green, t.fx.A.people.nutritionist, "nutritionist", true),
    ).rejects.toMatchObject({ code: "42501", message: "license_not_verified" });
    await expect(
      forceApprove(p1, green, t.fx.A.people.trainer, "trainer", true),
    ).rejects.toMatchObject({ code: "42501", message: "approver_role" });
    const amber = await newMember(t.fx.A);
    await signedTriage(amber, { conditions: ["glp1"] });
    const p2 = await planInReview(amber, "nutrition");
    await expect(
      forceApprove(p2, amber, licensedNutri, "nutritionist", false),
    ).rejects.toMatchObject({ code: "42501", message: "referral_ack_required" });
    const tr = await newMember(t.fx.A);
    const p3 = await planInReview(tr, "treatment");
    await expect(
      forceApprove(p3, tr, t.fx.A.people.clinician, "clinician", false),
    ).rejects.toMatchObject({ code: "42501", message: "license_not_verified" });
    await expect(
      forceApprove(p3, tr, t.fx.A.people.trainer, "trainer", false),
    ).rejects.toMatchObject({ code: "42501", message: "approver_role" });
    const tp = await newMember(t.fx.A);
    await signedTriage(tp);
    const p4 = await planInReview(tp, "training");
    await expect(forceApprove(p4, tp, licensedNutri, "nutritionist", false)).rejects.toMatchObject({
      code: "42501",
      message: "approver_role",
    });
  });

  it("nutrition: amber needs the medical-referral acknowledgement", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m, { conditions: ["glp1"] });
    const id = await planInReview(m, "nutrition");
    const lic = as("nutritionist", t.fx.A, licensedNutri);
    await expect(
      asCaller(t.api, lic, (tx) => tx.query("SELECT app.approve_care_plan($1, false)", [id])),
    ).rejects.toMatchObject({ code: "42501", message: "referral_ack_required" });
    await asCaller(t.api, lic, (tx) => tx.query("SELECT app.approve_care_plan($1, true)", [id]));
    expect(await status(id)).toBe("approved");
  });

  it("nutrition: no signed assessment → no approval", async () => {
    const m = await newMember(t.fx.A);
    const id = await planInReview(m, "nutrition");
    await expect(
      asCaller(t.api, as("nutritionist", t.fx.A, licensedNutri), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, true)", [id]),
      ),
    ).rejects.toMatchObject({ code: "42501", message: "triage_required" });
  });

  it("only the nutritionist drafts nutrition plans; trainers, owners and front desk cannot", async () => {
    const m = await newMember(t.fx.A);
    for (const role of ["trainer", "owner", "front_desk", "clinician", "member"] as Role[]) {
      await expect(
        asCaller(t.api, as(role), (tx) => createPlan(tx, m, "nutrition")),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("treatment: only a clinician with a verified licence approves", async () => {
    const m = await newMember(t.fx.A);
    const id = await planInReview(m, "treatment");
    for (const claims of [
      as("clinician"),
      as("trainer"),
      as("nutritionist", t.fx.A, licensedNutri),
    ]) {
      await expect(
        asCaller(t.api, claims, (tx) => tx.query("SELECT app.approve_care_plan($1, false)", [id])),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await asCaller(t.api, as("clinician", t.fx.A, licensedClin), (tx) =>
      tx.query("SELECT app.approve_care_plan($1, false)", [id]),
    );
    const row = (
      await t.admin.query("SELECT approver_license_no FROM app.care_plan WHERE id = $1", [id])
    ).rows[0];
    expect(row.approver_license_no).toBe("LIC-C-888");
  });

  it("publish only after approve; nothing skips the state machine", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const draft = await asCaller(t.api, as("trainer"), (tx) => createPlan(tx, m, "training"));
    await expect(
      asCaller(t.api, as("trainer"), (tx) => tx.query("SELECT app.publish_care_plan($1)", [draft])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, false)", [draft]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      t.admin.query(
        "UPDATE app.care_plan SET status = 'published', published_at = now() WHERE id = $1",
        [draft],
      ),
    ).rejects.toMatchObject({ code: "42501", message: "invalid_transition" });
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("UPDATE app.care_plan SET status = 'review' WHERE id = $1", [draft]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query(
          "INSERT INTO app.care_plan (member_id, kind, title, status) VALUES ($1, 'training', 'x', 'published')",
          [m],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("approved/published rows are immutable; a change is a new version that archives the old one on publish", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const v1 = await planInReview(m, "training");
    await asCaller(t.api, as("trainer"), async (tx) => {
      await tx.query("SELECT app.approve_care_plan($1, false)", [v1]);
      await tx.query("SELECT app.publish_care_plan($1)", [v1]);
      const upd = await tx.query("UPDATE app.care_plan SET title = 'cambiado' WHERE id = $1", [v1]);
      expect(upd.rowCount).toBe(0);
    });
    await expect(
      t.admin.query("UPDATE app.care_plan SET title = 'cambiado' WHERE id = $1", [v1]),
    ).rejects.toMatchObject({ code: "42501", message: "plan_immutable" });
    await expect(
      t.admin.query("UPDATE app.care_plan SET approver_license_no = 'X' WHERE id = $1", [v1]),
    ).rejects.toMatchObject({ code: "42501", message: "plan_immutable" });

    const v2 = await asCaller(t.api, as("trainer"), async (tx) => {
      const r = await tx.query<{ id: string }>("SELECT app.new_care_plan_version($1) AS id", [v1]);
      const id = r.rows[0]?.id as string;
      await tx.query("UPDATE app.care_plan SET title = 'Demo v2' WHERE id = $1", [id]);
      await tx.query("SELECT app.submit_care_plan($1)", [id]);
      await tx.query("SELECT app.approve_care_plan($1, false)", [id]);
      await tx.query("SELECT app.publish_care_plan($1)", [id]);
      return id;
    });
    const rows = await t.admin.query(
      "SELECT id, version, status, series_id FROM app.care_plan WHERE id = ANY($1) ORDER BY version",
      [[v1, v2]],
    );
    expect(rows.rows.map((r) => [r.version, r.status])).toEqual([
      [1, "archived"],
      [2, "published"],
    ]);
    expect(rows.rows[0].series_id).toBe(rows.rows[1].series_id);
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.new_care_plan_version($1)", [v2]),
      ),
    ).resolves.toBeDefined();
    await expect(
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.new_care_plan_version($1)", [v2]),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("hostile plan text: regulated titles, links, markup and placeholders are refused", async () => {
    const m = await newMember(t.fx.A);
    for (const [title, body] of [
      ["Plan del nutricionista", BODY],
      ["Plan <b>x</b>", BODY],
      ["Plan", { sections: [{ heading: "A", items: ["visita www.gymbarato.com"] }] }],
      ["Plan", { sections: [{ heading: "A", items: ["{{name}}"] }] }],
      ["Plan", { sections: [{ heading: "A", items: ["Te garantizamos resultados"] }] }],
      ["Plan", { sections: [{ heading: "A", items: [], extra: 1 }] }],
      ["Plan", { sections: "x" }],
    ] as Array<[string, unknown]>) {
      await expect(
        asCaller(t.api, as("trainer"), (tx) =>
          tx.query(
            "INSERT INTO app.care_plan (member_id, kind, title, body) VALUES ($1, 'training', $2, $3)",
            [m, title, JSON.stringify(body)],
          ),
        ),
        title,
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("other location and other org cannot see or act on a plan", async () => {
    const far = await newMember(t.fx.A, t.fx.A.locations[1]);
    const trainerA = await t.admin.query<{ id: string }>(
      "SELECT id FROM app.staff_member WHERE org_id = $1 AND role = 'trainer'",
      [t.fx.A.orgId],
    );
    const id = (
      await t.admin.query<{ id: string }>(
        "INSERT INTO app.care_plan (org_id, member_id, kind, title, created_by, status) VALUES ($1, $2, 'training', 'Demo', $3, 'review') RETURNING id",
        [t.fx.A.orgId, far, trainerA.rows[0]?.id],
      )
    ).rows[0]?.id;
    for (const claims of [
      as("trainer"),
      as("location_manager"),
      as("trainer", t.fx.B),
      as("owner", t.fx.B),
    ]) {
      await asCaller(t.api, claims, async (tx) => {
        expect((await tx.query("SELECT 1 FROM app.care_plan WHERE id = $1", [id])).rowCount).toBe(
          0,
        );
      });
      for (const fn of [
        "approve_care_plan($1, false)",
        "submit_care_plan($1)",
        "return_care_plan($1)",
        "publish_care_plan($1)",
      ]) {
        await expect(
          asCaller(t.api, claims, (tx) => tx.query(`SELECT app.${fn}`, [id])),
        ).rejects.toMatchObject({ code: "42501" });
      }
    }
    expect(await status(id)).toBe("review");
  });
});

describe("concurrency", () => {
  it("a red triage signed concurrently wins over a nutrition approval (member-level lock)", async () => {
    const A = t.fx.A;
    const m = await newMember(A);
    await signedTriage(m); // green baseline: approval would pass on its own
    const plan = await planInReview(m, "nutrition");
    const c1 = await t.api.pool.connect();
    const c2 = await t.api.pool.connect();
    let approveError: unknown = null;
    try {
      await c1.query("BEGIN");
      await bindClaims(c1, t.api, as("trainer"));
      const a = await insertAssessment(c1, m, { conditions: ["eating_disorder_screen_positive"] });
      await c1.query("SELECT app.sign_assessment($1)", [a]); // holds the member lock until COMMIT
      await c2.query("BEGIN");
      await bindClaims(c2, t.api, as("nutritionist", A, licensedNutri));
      let settled = false;
      const approve = c2
        .query("SELECT app.approve_care_plan($1, true)", [plan])
        .catch((e: unknown) => {
          approveError = e;
        })
        .finally(() => {
          settled = true;
        });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false); // waiting on the lock
      await c1.query("COMMIT");
      await approve;
      await c2.query("ROLLBACK");
    } finally {
      c1.release();
      c2.release();
    }
    expect(approveError).toMatchObject({ code: "42501", message: "triage_red_blocks_nutrition" });
    expect(await status(plan)).toBe("review");
  });

  it("two approvals of the same plan: exactly one wins", async () => {
    const m = await newMember(t.fx.A);
    await signedTriage(m);
    const plan = await planInReview(m, "training");
    const results = await Promise.allSettled([
      asCaller(t.api, as("trainer"), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, false)", [plan]),
      ),
      asCaller(t.api, as("location_manager"), (tx) =>
        tx.query("SELECT app.approve_care_plan($1, false)", [plan]),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const audit = await t.admin.query(
      "SELECT count(*)::int AS n FROM app.audit_log WHERE entity_id = $1 AND action = 'care_plan.approved'",
      [plan],
    );
    expect(audit.rows[0].n).toBe(1);
  });
});
