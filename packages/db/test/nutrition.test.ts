import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Nutrition (0030/0031): every member linked, catalog values, blocks, exclusions, versions, approvals, visibility.
let t: TestDb;
let memberA0: string; // person of A.members[0] (complete profile in the fixture)
let memberA1: string; // person of A.members[1] (empty profile)
beforeAll(async () => {
  t = await createTestDb();
  const p = async (id: string) =>
    (await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [id])).rows[0]
      .person_id as string;
  memberA0 = await p(t.fx.A.members[0] as string);
  memberA1 = await p(t.fx.A.members[1] as string);
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (org: OrgFixture, role: Role, personId?: string) => t.claims(org, role, personId);
const run = <T>(org: OrgFixture, role: Role, fn: (tx: Tx) => Promise<T>, personId?: string) =>
  asCaller(t.api, as(org, role, personId), fn);
const ITEMS = [
  {
    day: 1,
    meal: "desayuno",
    dish: "Avena con guineo",
    position: 1,
    fdc_id: 173904,
    grams: 40,
    household: "1/2 taza",
  },
  { day: 1, meal: "desayuno", dish: "Avena con guineo", position: 2, fdc_id: 173944, grams: 118 },
  {
    day: 1,
    meal: "almuerzo",
    dish: "Arroz con habichuelas y pollo",
    position: 1,
    fdc_id: 168878,
    grams: 158,
  },
];
const create = (
  org: OrgFixture,
  role: Role,
  member: string,
  items: unknown[] = ITEMS,
  previous: string | null = null,
) =>
  run(org, role, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `SELECT app.nutrition_plan_create($1, date_trunc('week', now())::date, 'ia', '{"peso":"declarado"}'::jsonb,
         '{"dias":[]}'::jsonb, NULL, '{"ok":true}'::jsonb, 'gemini-3.8-flash', 'plan-v1', $2::jsonb, $3) AS id`,
      [member, JSON.stringify(items), previous],
    );
    return r.rows[0]?.id as string;
  });
const transition = (
  org: OrgFixture,
  role: Role,
  plan: string,
  action: string,
  reason: string | null = null,
  person?: string,
) =>
  run(
    org,
    role,
    async (tx) =>
      (
        await tx.query<{ s: string }>("SELECT app.nutrition_plan_transition($1, $2, $3) AS s", [
          plan,
          action,
          reason,
        ])
      ).rows[0]?.s,
    person,
  );

describe("every member is linked", () => {
  it("each existing member of each org has a profile, and a new member gets one", async () => {
    const { rows } = await t.admin.query(
      `SELECT count(*)::int AS members, count(p.member_id)::int AS profiles
         FROM app.member m LEFT JOIN app.nutrition_profile p ON p.member_id = m.id`,
    );
    expect(rows[0].profiles).toBe(rows[0].members);
    const loc = t.fx.A.locations[0];
    const person = (
      await t.admin.query(
        "INSERT INTO app.person (email) VALUES ('nuevo.nutri@demo.invalid') RETURNING id",
      )
    ).rows[0].id;
    const m = (
      await t.admin.query(
        "INSERT INTO app.member (org_id, person_id, home_location_id, full_name) VALUES ($1, $2, $3, 'Socio Nuevo') RETURNING id",
        [t.fx.A.orgId, person, loc],
      )
    ).rows[0].id;
    const prof = await t.admin.query(
      "SELECT status FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(prof.rows[0].status).toBe("incompleto");
  });

  it("every org has settings with the documented defaults", async () => {
    const r = await t.admin.query("SELECT * FROM app.nutrition_settings WHERE org_id = $1", [
      t.fx.A.orgId,
    ]);
    expect(r.rows[0]).toMatchObject({
      mode: "A",
      plan_model: "gemini-3.8-flash",
      light_model: "gemini-3.1-flash-lite",
    });
    expect(Number(r.rows[0].max_loss_pct_week)).toBe(1);
    expect(Number(r.rows[0].day_tolerance_pct)).toBe(5);
  });
});

describe("catalog values are computed by the database, never taken from the caller", () => {
  it("item kcal and macros are grams × USDA per-100 g, whatever the insert says", async () => {
    const id = await create(t.fx.A, "owner", t.fx.A.members[0] as string);
    const { rows } = await t.admin.query(
      `SELECT i.grams, i.kcal, i.protein_g, i.carb_g, i.fat_g, f.kcal AS f_kcal, f.protein_g AS f_p, f.carb_g AS f_c, f.fat_g AS f_f
         FROM app.nutrition_plan_item i JOIN app.food f ON f.fdc_id = i.fdc_id WHERE i.plan_id = $1 ORDER BY i.meal, i.position`,
      [id],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const g = Number(r.grams) / 100;
      expect(Number(r.kcal)).toBeCloseTo(Number(r.f_kcal) * g, 0);
      expect(Number(r.protein_g)).toBeCloseTo(Number(r.f_p) * g, 0);
      expect(Number(r.carb_g)).toBeCloseTo(Number(r.f_c) * g, 0);
      expect(Number(r.fat_g)).toBeCloseTo(Number(r.f_f) * g, 0);
    }
  });

  it("the USDA rows are the published values (white rice, cooked, fdc 168878: 130 kcal per 100 g)", async () => {
    const r = await t.admin.query(
      "SELECT kcal, protein_g, carb_g, fat_g FROM app.food WHERE fdc_id = 168878",
    );
    expect(r.rows[0]).toMatchObject({
      kcal: "130.00",
      protein_g: "2.69",
      carb_g: "28.17",
      fat_g: "0.28",
    });
  });

  it("a food that is not in the catalog cannot enter a plan", async () => {
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, [{ ...ITEMS[0], fdc_id: 999999 }]),
    ).rejects.toThrow(/food_not_in_catalog|foreign key/);
  });

  it("plan items are immutable", async () => {
    await expect(t.admin.query("UPDATE app.nutrition_plan_item SET grams = 1")).rejects.toThrow(
      /immutable/,
    );
  });
});

describe("safety blocks are enforced in SQL", () => {
  it("an incomplete profile is refused with the reasons", async () => {
    await expect(create(t.fx.A, "owner", t.fx.A.members[1] as string)).rejects.toThrow(
      /requiere_evaluacion_profesional:.*cuestionario_pendiente/,
    );
  });

  it("allergens and excluded diet tags are hard exclusions", async () => {
    // Fixture: members[0] is allergic to peanuts and excludes pork.
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, [{ ...ITEMS[0], fdc_id: 172470 }]),
    ).rejects.toThrow(/food_excluded_for_member/);
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, [{ ...ITEMS[0], fdc_id: 168233 }]),
    ).rejects.toThrow(/food_excluded_for_member/);
  });

  for (const [label, sql, reason] of [
    ["pregnancy", `health_answers = health_answers || '{"embarazo":true}'`, "embarazo"],
    ["past eating disorder", `health_answers = health_answers || '{"tca_pasado":true}'`, "tca"],
    [
      "appetite or weight medication",
      `health_answers = health_answers || '{"medicamento_apetito_peso":true}'`,
      "medicamento_apetito_peso",
    ],
    ["minor", "birth_date = (current_date - interval '16 years')::date", "menor_de_edad"],
    ["unsafe loss rate", "rate_pct_week = 1.5", "ritmo_inseguro"],
  ] as const) {
    it(`${label} blocks generation`, async () => {
      const m = t.fx.B.members[0] as string;
      await t.admin.query(`UPDATE app.nutrition_profile SET ${sql} WHERE member_id = $1`, [m]);
      try {
        await expect(create(t.fx.B, "owner", m)).rejects.toThrow(new RegExp(reason));
      } finally {
        await t.admin.query(
          `UPDATE app.nutrition_profile SET birth_date = DATE '1990-05-10', rate_pct_week = 0.5,
             health_answers = '{"embarazo":false,"lactancia":false,"diabetes":false,"enfermedad_renal":false,
               "enfermedad_cardiovascular":false,"tca_actual":false,"tca_pasado":false,"medicamento_apetito_peso":false}'::jsonb
           WHERE member_id = $1`,
          [m],
        );
      }
    });
  }

  it("BMI under 18.5 and missing height block generation", async () => {
    const m = t.fx.B.members[0] as string;
    const person = (await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [m]))
      .rows[0].person_id;
    await t.admin.query(
      "INSERT INTO app.nutrition_measurement (org_id, member_id, source, weight_kg, recorded_by) VALUES ($1, $2, 'declarado', 45, $3)",
      [t.fx.B.orgId, m, person],
    );
    await expect(create(t.fx.B, "owner", m)).rejects.toThrow(/imc_bajo/);
    await t.admin.query(
      "INSERT INTO app.nutrition_measurement (org_id, member_id, source, weight_kg, recorded_by) VALUES ($1, $2, 'declarado', 72, $3)",
      [t.fx.B.orgId, m, person],
    );
    expect(await create(t.fx.B, "owner", m)).toBeTruthy();
  });
});

describe("versions and approvals", () => {
  it("a new version keeps the series; the member sees nothing until it is sent", async () => {
    const A = t.fx.A;
    const m = A.members[0] as string;
    const v1 = await create(A, "owner", m);
    const v2 = await create(A, "owner", m, ITEMS, v1);
    const rows = (
      await t.admin.query(
        "SELECT id, series_id, version FROM app.nutrition_plan WHERE id IN ($1, $2)",
        [v1, v2],
      )
    ).rows;
    const r1 = rows.find((r) => r.id === v1);
    const r2 = rows.find((r) => r.id === v2);
    expect(r2.series_id).toBe(r1.series_id);
    expect(r2.version).toBe(r1.version + 1);
    const seen = await run(
      A,
      "member",
      async (tx) => (await tx.query("SELECT id FROM app.nutrition_plan")).rows,
      memberA0,
    );
    expect(seen.map((r) => r.id)).not.toContain(v2);
  });

  it("mode A: owner approval is not enough to send; a verified nutritionist must approve too", async () => {
    const A = t.fx.A;
    const m = A.members[0] as string;
    const plan = await create(A, "owner", m);
    expect(await transition(A, "owner", plan, "submit")).toBe("en_revision");
    expect(await transition(A, "owner", plan, "approve")).toBe("aprobado");
    await expect(transition(A, "owner", plan, "send")).rejects.toThrow(
      /licensed_approval_required/,
    );
    // A nutritionist without a verified licence is refused.
    await expect(transition(A, "nutritionist", plan, "license")).rejects.toThrow(
      /license_not_verified/,
    );
    await t.admin.query(
      "UPDATE app.staff_member SET license_no = 'LN-0001', license_verified_at = now() WHERE org_id = $1 AND role = 'nutritionist'",
      [A.orgId],
    );
    expect(await transition(A, "nutritionist", plan, "license")).toBe("aprobado");
    expect(await transition(A, "owner", plan, "send")).toBe("enviado");
    const seen = await run(
      A,
      "member",
      async (tx) => (await tx.query("SELECT id FROM app.nutrition_plan")).rows,
      memberA0,
    );
    expect(seen.map((r) => r.id)).toContain(plan);
    // Sending a newer version archives the one the member had.
    const next = await create(A, "owner", m, ITEMS, plan);
    await transition(A, "owner", next, "approve");
    await transition(A, "nutritionist", next, "license");
    await transition(A, "owner", next, "send");
    const old = await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [plan]);
    expect(old.rows[0].status).toBe("archivado");
  });

  it("approval requires a passed verifier; rejection requires a reason; trainers cannot approve", async () => {
    const A = t.fx.A;
    const m = A.members[0] as string;
    const plan = await create(A, "owner", m);
    await t.admin.query(`UPDATE app.nutrition_plan SET verifier = '{"ok":false}' WHERE id = $1`, [
      plan,
    ]);
    await expect(transition(A, "owner", plan, "approve")).rejects.toThrow(/verifier_not_passed/);
    await expect(transition(A, "trainer", plan, "approve")).rejects.toThrow(/forbidden/);
    await expect(transition(A, "owner", plan, "reject")).rejects.toThrow(/reason_required/);
    expect(await transition(A, "owner", plan, "reject", "Porciones muy grandes")).toBe("rechazado");
  });

  it("a new measurement marks open plans outdated, and an outdated plan cannot be approved", async () => {
    const A = t.fx.A;
    const m = A.members[0] as string;
    const plan = await create(A, "owner", m);
    await run(A, "owner", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 71.5, NULL, NULL, NULL)", [m]),
    );
    const r = await t.admin.query("SELECT outdated_reason FROM app.nutrition_plan WHERE id = $1", [
      plan,
    ]);
    expect(r.rows[0].outdated_reason).toBe("nueva_medicion");
    await expect(transition(A, "owner", plan, "approve")).rejects.toThrow(/plan_outdated/);
  });
});

describe("who sees and who writes", () => {
  it("front desk, chef and accountant see no nutrition data; another org sees nothing", async () => {
    for (const role of ["front_desk", "chef", "accountant"] as Role[]) {
      const n = await run(
        t.fx.A,
        role,
        async (tx) => (await tx.query("SELECT 1 FROM app.nutrition_profile")).rowCount,
      );
      expect(n, role).toBe(0);
    }
    const b = await run(t.fx.B, "owner", async (tx) =>
      (await tx.query("SELECT org_id FROM app.nutrition_profile")).rows.map((r) => r.org_id),
    );
    expect(b.every((o) => o === t.fx.B.orgId)).toBe(true);
  });

  it("the member edits their own profile and is the only one who can accept the disclaimer", async () => {
    const A = t.fx.A;
    const m = A.members[1] as string;
    await run(A, "owner", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"accept_disclaimer":true}')`, [m]),
    );
    let p = await t.admin.query(
      "SELECT disclaimer_accepted_at FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(p.rows[0].disclaimer_accepted_at).toBeNull();
    await run(
      A,
      "member",
      (tx) =>
        tx.query(
          `SELECT app.nutrition_profile_save($1, '{"accept_disclaimer":true,"goal":"mantener"}')`,
          [m],
        ),
      memberA1,
    );
    p = await t.admin.query(
      "SELECT disclaimer_accepted_at, goal FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(p.rows[0].disclaimer_accepted_at).not.toBeNull();
    expect(p.rows[0].goal).toBe("mantener");
    // A member cannot write another member's profile.
    await expect(
      run(
        A,
        "member",
        (tx) =>
          tx.query(`SELECT app.nutrition_profile_save($1, '{"goal":"mantener"}')`, [A.members[0]]),
        memberA1,
      ),
    ).rejects.toThrow(/forbidden/);
  });

  it("only the owner switches to mode B, and only with a written legal attestation", async () => {
    await expect(
      run(t.fx.A, "location_manager", (tx) =>
        tx.query(`SELECT app.nutrition_settings_save('{"mode":"B"}')`),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      run(t.fx.A, "owner", (tx) => tx.query(`SELECT app.nutrition_settings_save('{"mode":"B"}')`)),
    ).rejects.toThrow(/check constraint|violates/);
  });
});
