import type { Role } from "@gym/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "../src/index.js";
import { type OrgFixture, type TestDb, asCaller, createTestDb } from "../src/testing.js";

// Nutrition (0030/0031): every member linked, catalog values, blocks, exclusions, versions, approvals, visibility,
// and the independent review findings of 2026-11-08 (C1, C2, A1, A2, A4, M1, M2, M8, B1).
let t: TestDb;
const person: Record<string, string> = {};
const QUESTIONS_NO = {
  embarazo: false,
  lactancia: false,
  diabetes: false,
  enfermedad_renal: false,
  enfermedad_cardiovascular: false,
  tca_actual: false,
  tca_pasado: false,
  medicamento_apetito_peso: false,
};
let food: Record<number, { kcal: number }> = {};

beforeAll(async () => {
  t = await createTestDb();
  for (const org of [t.fx.A, t.fx.B])
    for (const m of org.members) {
      person[m] = (
        await t.admin.query("SELECT person_id FROM app.member WHERE id = $1", [m])
      ).rows[0].person_id;
    }
  food = Object.fromEntries(
    (await t.admin.query("SELECT fdc_id, kcal::float8 AS kcal FROM app.food")).rows.map((r) => [
      r.fdc_id,
      r,
    ]),
  );
  // A nutritionist with a verified licence in each org (the licensed approval of Ley 82).
  await t.admin.query(
    "UPDATE app.staff_member SET license_no = 'LN-0001', license_verified_at = now() WHERE role = 'nutritionist'",
  );
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

const as = (org: OrgFixture, role: Role, personId?: string) => t.claims(org, role, personId);
const run = <T>(org: OrgFixture, role: Role, fn: (tx: Tx) => Promise<T>, personId?: string) =>
  asCaller(t.api, as(org, role, personId), fn);

/** A complete week whose day totals equal the stored targets (rice + chicken + oats). Fixture member: female, 72 kg,
 * 165 cm, born 1990-05-10 → resting expenditure ≈ 1410 kcal, so each day must be ≥ that. */
function week(extra: Array<{ fdc_id: number; grams: number }> = []) {
  const base = [
    { fdc_id: 168878, grams: 500, meal: "almuerzo", dish: "Arroz con pollo" },
    { fdc_id: 171477, grams: 300, meal: "almuerzo", dish: "Arroz con pollo" },
    { fdc_id: 173904, grams: 120, meal: "desayuno", dish: "Avena" },
    ...extra.map((e) => ({ ...e, meal: "cena", dish: "Cena" })),
  ];
  const items = [];
  const days = [];
  for (let day = 1; day <= 7; day += 1) {
    let kcal = 0;
    base.forEach((b, i) => {
      items.push({
        day,
        meal: b.meal,
        dish: b.dish,
        position: i + 1,
        fdc_id: b.fdc_id,
        grams: b.grams,
      });
      kcal += Math.round((((food[b.fdc_id]?.kcal ?? 0) * b.grams) / 100) * 10) / 10;
    });
    days.push({ day, target_kcal: Math.round(kcal), tdee: Math.round(kcal) });
  }
  return { items, calc: { days } };
}
const create = (
  org: OrgFixture,
  role: Role,
  member: string,
  opts: {
    items?: unknown[];
    calc?: unknown;
    previous?: string | null;
    origin?: string;
    verifier?: unknown;
    as?: string;
  } = {},
) => {
  const w = week();
  return run(
    org,
    role,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          `SELECT app.nutrition_plan_create($1, date_trunc('week', now())::date, $2, '{"peso":"declarado"}'::jsonb,
             $3::jsonb, NULL, $4::jsonb, 'gemini-3.8-flash', 'plan-v1', $5::jsonb, $6) AS id`,
          [
            member,
            opts.origin ?? "ia",
            JSON.stringify(opts.calc ?? w.calc),
            JSON.stringify(opts.verifier ?? { ok: true }),
            JSON.stringify(opts.items ?? w.items),
            opts.previous ?? null,
          ],
        )
      ).rows[0]?.id as string,
    opts.as,
  );
};
const transition = (
  org: OrgFixture,
  role: Role,
  plan: string,
  action: string,
  reason: string | null = null,
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
  );
/** Draft → approved by the owner → licensed → sent. */
async function publish(org: OrgFixture, plan: string) {
  await transition(org, "owner", plan, "approve");
  await transition(org, "nutritionist", plan, "license");
  return transition(org, "owner", plan, "send");
}
const resetProfile = (m: string) =>
  t.admin.query(
    `UPDATE app.nutrition_profile SET birth_date = DATE '1990-05-10', rate_pct_week = 0.5, sex_for_equations = 'femenino',
       goal = 'perder_grasa', daily_activity = 'ligero', allergens = ARRAY['mani'], diet_exclusions = ARRAY['cerdo'],
       health_answers = $2::jsonb, disclaimer_accepted_at = now() WHERE member_id = $1`,
    [m, JSON.stringify(QUESTIONS_NO)],
  );

describe("every member is linked", () => {
  it("each existing member of each org has a profile, and a new member gets one", async () => {
    const { rows } = await t.admin.query(
      `SELECT count(*)::int AS members, count(p.member_id)::int AS profiles
         FROM app.member m LEFT JOIN app.nutrition_profile p ON p.member_id = m.id`,
    );
    expect(rows[0].profiles).toBe(rows[0].members);
    const pid = (
      await t.admin.query(
        "INSERT INTO app.person (email) VALUES ('nuevo.nutri@demo.invalid') RETURNING id",
      )
    ).rows[0].id;
    const m = (
      await t.admin.query(
        "INSERT INTO app.member (org_id, person_id, home_location_id, full_name) VALUES ($1, $2, $3, 'Socio Nuevo') RETURNING id",
        [t.fx.A.orgId, pid, t.fx.A.locations[0]],
      )
    ).rows[0].id;
    const prof = await t.admin.query(
      "SELECT status FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(prof.rows[0].status).toBe("incompleto");
  });

  it("every org has settings with the documented defaults, inside the source ranges", async () => {
    const r = await t.admin.query("SELECT * FROM app.nutrition_settings WHERE org_id = $1", [
      t.fx.A.orgId,
    ]);
    expect(r.rows[0]).toMatchObject({
      plan_model: "gemini-3.8-flash",
      light_model: "gemini-3.1-flash-lite",
    });
    expect(Number(r.rows[0].max_loss_pct_week)).toBe(1);
    await expect(
      run(t.fx.A, "owner", (tx) =>
        tx.query(`SELECT app.nutrition_settings_save('{"protein_max_g_kg":2.5}')`),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      run(t.fx.A, "owner", (tx) =>
        tx.query(`SELECT app.nutrition_settings_save('{"fat_min_pct":15}')`),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      run(t.fx.A, "location_manager", (tx) =>
        tx.query(`SELECT app.nutrition_settings_save('{"fat_min_pct":25}')`),
      ),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("catalog values come from the database", () => {
  it("item kcal and macros are grams × USDA per-100 g", async () => {
    const id = await create(t.fx.A, "owner", t.fx.A.members[0] as string);
    const { rows } = await t.admin.query(
      `SELECT i.grams, i.kcal, i.protein_g, f.kcal AS f_kcal, f.protein_g AS f_p
         FROM app.nutrition_plan_item i JOIN app.food f ON f.fdc_id = i.fdc_id WHERE i.plan_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(21);
    for (const r of rows) {
      expect(Number(r.kcal)).toBeCloseTo((Number(r.f_kcal) * Number(r.grams)) / 100, 0);
      expect(Number(r.protein_g)).toBeCloseTo((Number(r.f_p) * Number(r.grams)) / 100, 0);
    }
  });

  it("the USDA rows are the published values (white rice, cooked, fdc 168878)", async () => {
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

  it("a food that is not in the catalog cannot enter a plan; items and plan rows are immutable", async () => {
    const w = week();
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, {
        items: [{ ...w.items[0], fdc_id: 999999 }],
      }),
    ).rejects.toThrow(/food_not_in_catalog|foreign key/);
    await expect(t.admin.query("UPDATE app.nutrition_plan_item SET grams = 1")).rejects.toThrow(
      /immutable/,
    );
    // M1: even a privileged path cannot rewrite what a plan was built from.
    await expect(
      t.admin.query(`UPDATE app.nutrition_plan SET calc = '{"days":[]}'`),
    ).rejects.toThrow(/plan_is_immutable/);
  });

  it("M8: an AI plan must name its model and prompt version", async () => {
    const w = week();
    await expect(
      run(t.fx.A, "owner", (tx) =>
        tx.query(
          `SELECT app.nutrition_plan_create($1, date_trunc('week', now())::date, 'ia', '{}'::jsonb, $2::jsonb, NULL,
             '{"ok":true}'::jsonb, NULL, NULL, $3::jsonb, NULL)`,
          [t.fx.A.members[0], JSON.stringify(w.calc), JSON.stringify(w.items)],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("C1: health data is never readable across orgs or by roles without health access", () => {
  it("another org's member, front desk, chef and accountant are refused", async () => {
    const target = t.fx.A.members[0] as string;
    const tries: Array<[OrgFixture, Role, string | undefined]> = [
      [t.fx.B, "member", person[t.fx.B.members[0] as string]],
      [t.fx.B, "owner", undefined],
      [t.fx.A, "chef", undefined],
      [t.fx.A, "front_desk", undefined],
      [t.fx.A, "accountant", undefined],
      [t.fx.A, "member", person[t.fx.A.members[1] as string]],
    ];
    for (const [org, role, p] of tries) {
      for (const sql of [
        "SELECT app.nutrition_blocks($1)",
        "SELECT * FROM app.nutrition_latest_body($1)",
      ]) {
        await expect(
          run(org, role, (tx) => tx.query(sql, [target]), p),
          `${role} ${sql}`,
        ).rejects.toThrow(/forbidden/);
      }
    }
    // The member themself and the owner may read.
    const self = await run(
      t.fx.A,
      "member",
      (tx) => tx.query("SELECT app.nutrition_blocks($1) AS b", [target]),
      person[target],
    );
    expect(Array.isArray(self.rows[0].b)).toBe(true);
  });
});

describe("safety blocks", () => {
  it("an incomplete profile is refused with the reasons", async () => {
    await expect(create(t.fx.A, "owner", t.fx.A.members[1] as string)).rejects.toThrow(
      /requiere_evaluacion_profesional:.*cuestionario_pendiente/,
    );
  });

  it("A1: an empty or partial questionnaire never counts as answered", async () => {
    const m = t.fx.A.members[1] as string;
    await expect(
      run(
        A(),
        "member",
        (tx) => tx.query(`SELECT app.nutrition_profile_save($1, '{"health_answers":{}}')`, [m]),
        person[m],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      run(
        A(),
        "member",
        (tx) =>
          tx.query(
            `SELECT app.nutrition_profile_save($1, '{"health_answers":{"embarazo":false}}')`,
            [m],
          ),
        person[m],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("M2: the owner cannot change the member's health answers; the member and a nutritionist can", async () => {
    const m = t.fx.A.members[0] as string;
    await expect(
      run(A(), "owner", (tx) =>
        tx.query(`SELECT app.nutrition_profile_save($1, '{"health_answers":{"embarazo":false}}')`, [
          m,
        ]),
      ),
    ).rejects.toThrow(/forbidden_health_answers/);
    // A nutritionist merges one answer into the complete set.
    await run(A(), "nutritionist", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"health_answers":{"diabetes":false}}')`, [
        m,
      ]),
    );
    const audit = await t.admin.query(
      `SELECT meta FROM app.audit_log WHERE action = 'nutrition.profile_save' AND entity_id = $1 ORDER BY at DESC LIMIT 1`,
      [m],
    );
    expect(audit.rows[0].meta).toMatchObject({ by: "nutritionist", fields: ["health_answers"] });
    expect(JSON.stringify(audit.rows[0].meta)).not.toContain("false");
  });

  it("allergens and excluded diet tags are hard exclusions", async () => {
    const w = week();
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, {
        items: [{ ...w.items[0], fdc_id: 172470 }],
      }),
    ).rejects.toThrow(/food_excluded_for_member/);
    await expect(
      create(t.fx.A, "owner", t.fx.A.members[0] as string, {
        items: [{ ...w.items[0], fdc_id: 168233 }],
      }),
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
      await resetProfile(m);
      await t.admin.query(`UPDATE app.nutrition_profile SET ${sql} WHERE member_id = $1`, [m]);
      try {
        await expect(create(t.fx.B, "owner", m)).rejects.toThrow(new RegExp(reason));
      } finally {
        await resetProfile(m);
      }
    });
  }

  it("A4: a newer declared weight never lifts a low BMI measured by staff", async () => {
    const m = t.fx.B.members[0] as string;
    await resetProfile(m);
    await run(t.fx.B, "owner", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 45, 165, NULL, NULL)", [m]),
    );
    await expect(create(t.fx.B, "owner", m)).rejects.toThrow(/imc_bajo/);
    await run(
      t.fx.B,
      "member",
      (tx) => tx.query("SELECT app.nutrition_measure($1, 72, NULL, NULL, NULL)", [m]),
      person[m],
    );
    await expect(create(t.fx.B, "owner", m)).rejects.toThrow(/imc_bajo/);
    const st = await t.admin.query(
      "SELECT status FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(st.rows[0].status).toBe("requiere_profesional");
  });
});

describe("C2 and A2: approvals re-check everything against the current data", () => {
  it("a plan stops if the member becomes blocked or allergic after approval", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m, {
      items: week([{ fdc_id: 171267, grams: 100 }]).items,
      calc: week([{ fdc_id: 171267, grams: 100 }]).calc,
    });
    await transition(t.fx.A, "owner", plan, "approve");
    await transition(t.fx.A, "nutritionist", plan, "license");
    // The member now declares a milk allergy: the open plans become outdated and cannot be sent.
    await run(
      A(),
      "member",
      (tx) =>
        tx.query(`SELECT app.nutrition_profile_save($1, '{"allergens":["mani","leche"]}')`, [m]),
      person[m],
    );
    await expect(transition(t.fx.A, "owner", plan, "send")).rejects.toThrow(
      /plan_desactualizado|alimento_excluido/,
    );
    await resetProfile(m);
  });

  it("a plan stops if pregnancy is declared after approval", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await transition(t.fx.A, "owner", plan, "approve");
    await t.admin.query(
      `UPDATE app.nutrition_profile SET health_answers = health_answers || '{"embarazo":true}' WHERE member_id = $1`,
      [m],
    );
    await expect(transition(t.fx.A, "nutritionist", plan, "license")).rejects.toThrow(/embarazo/);
    await resetProfile(m);
  });

  it("a member's own draft carries no verifier result, and an under-floor or partial week cannot be approved", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const tiny = [
      { day: 1, meal: "desayuno", dish: "Avena", position: 1, fdc_id: 173904, grams: 40 },
    ];
    const own = await create(t.fx.A, "member", m, {
      origin: "formulario_socio",
      items: tiny,
      calc: { days: [{ day: 1, target_kcal: 152 }] },
      verifier: { ok: true },
      as: person[m],
    });
    const row = await t.admin.query("SELECT verifier FROM app.nutrition_plan WHERE id = $1", [own]);
    expect(row.rows[0].verifier).toBeNull();
    await expect(transition(t.fx.A, "owner", own, "approve")).rejects.toThrow(
      /faltan_dias|debajo_del_piso/,
    );
    // A complete week whose targets sit under the resting expenditure is refused too.
    const w = week();
    const low = await create(t.fx.A, "owner", m, {
      calc: { days: w.calc.days.map((d) => ({ ...d, target_kcal: 900 })) },
    });
    await expect(transition(t.fx.A, "owner", low, "approve")).rejects.toThrow(
      /meta_debajo_del_piso|fuera_de_tolerancia/,
    );
  });
});

describe("versions and approvals", () => {
  it("licensed approval is required to send; the member sees only what was sent; sending archives the same series only", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const v1 = await create(t.fx.A, "owner", m);
    await transition(t.fx.A, "owner", v1, "approve");
    await expect(transition(t.fx.A, "owner", v1, "send")).rejects.toThrow(
      /licensed_approval_required/,
    );
    await transition(t.fx.A, "nutritionist", v1, "license");
    expect(await transition(t.fx.A, "owner", v1, "send")).toBe("enviado");
    const seen = await run(
      t.fx.A,
      "member",
      async (tx) => (await tx.query("SELECT id FROM app.nutrition_plan")).rows,
      person[m],
    );
    expect(seen.map((r) => r.id)).toContain(v1);
    // Another series sent for the same member does not archive v1 (B1); a new version of v1's series does.
    const other = await create(t.fx.A, "owner", m);
    await publish(t.fx.A, other);
    expect(
      (await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [v1])).rows[0]
        .status,
    ).toBe("enviado");
    const v2 = await create(t.fx.A, "owner", m, { previous: v1 });
    const rows = (
      await t.admin.query(
        "SELECT id, series_id, version FROM app.nutrition_plan WHERE id IN ($1, $2)",
        [v1, v2],
      )
    ).rows;
    expect(rows.find((r) => r.id === v2).series_id).toBe(rows.find((r) => r.id === v1).series_id);
    await publish(t.fx.A, v2);
    expect(
      (await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [v1])).rows[0]
        .status,
    ).toBe("archivado");
  });

  it("approval requires a passed verifier; rejection requires a reason; trainers cannot approve", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m, { verifier: { ok: false } });
    await expect(transition(t.fx.A, "owner", plan, "approve")).rejects.toThrow(
      /verifier_not_passed/,
    );
    await expect(transition(t.fx.A, "trainer", plan, "approve")).rejects.toThrow(/forbidden/);
    await expect(transition(t.fx.A, "owner", plan, "reject")).rejects.toThrow(/reason_required/);
    expect(await transition(t.fx.A, "owner", plan, "reject", "Porciones muy grandes")).toBe(
      "rechazado",
    );
  });

  it("a new measurement marks open plans outdated, and an outdated plan cannot be approved", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await run(t.fx.A, "owner", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 71.5, NULL, NULL, NULL)", [m]),
    );
    expect(
      (await t.admin.query("SELECT outdated_reason FROM app.nutrition_plan WHERE id = $1", [plan]))
        .rows[0].outdated_reason,
    ).toBe("nueva_medicion");
    await expect(transition(t.fx.A, "owner", plan, "approve")).rejects.toThrow(
      /plan_desactualizado/,
    );
  });
});

describe("second review (N1–N8)", () => {
  it("N1: the owner cannot remove an allergy or exclusion; the member and a nutritionist can; removals are audited", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    await expect(
      run(A(), "owner", (tx) =>
        tx.query(`SELECT app.nutrition_profile_save($1, '{"allergens":[]}')`, [m]),
      ),
    ).rejects.toThrow(/forbidden_exclusion_removal/);
    await expect(
      run(A(), "owner", (tx) =>
        tx.query(`SELECT app.nutrition_profile_save($1, '{"diet_exclusions":[]}')`, [m]),
      ),
    ).rejects.toThrow(/forbidden_exclusion_removal/);
    // Adding is always allowed.
    await run(A(), "owner", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"allergens":["mani","soya"]}')`, [m]),
    );
    await run(A(), "nutritionist", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"allergens":["mani"]}')`, [m]),
    );
    const audit = await t.admin.query(
      `SELECT meta FROM app.audit_log WHERE action = 'nutrition.profile_save' AND entity_id = $1 ORDER BY at DESC, id DESC LIMIT 1`,
      [m],
    );
    expect(audit.rows[0].meta).toMatchObject({ by: "nutritionist", allergens_removed: ["soya"] });
    await resetProfile(m);
  });

  it("N2: a declared height cannot lift a low BMI from a staff-measured weight", async () => {
    const m = t.fx.B.members[1] as string;
    await t.admin.query(
      `UPDATE app.nutrition_profile SET birth_date = DATE '1990-05-10', sex_for_equations = 'femenino', goal = 'mantener',
         daily_activity = 'ligero', health_answers = $2::jsonb, disclaimer_accepted_at = now() WHERE member_id = $1`,
      [m, JSON.stringify(QUESTIONS_NO)],
    );
    await run(
      t.fx.B,
      "member",
      (tx) => tx.query("SELECT app.nutrition_measure($1, NULL, 165, NULL, NULL)", [m]),
      person[m],
    );
    await run(t.fx.B, "owner", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 47, NULL, NULL, NULL)", [m]),
    );
    await run(
      t.fx.B,
      "member",
      (tx) => tx.query("SELECT app.nutrition_measure($1, NULL, 152, NULL, NULL)", [m]),
      person[m],
    );
    const b = await run(
      t.fx.B,
      "owner",
      async (tx) => (await tx.query("SELECT app.nutrition_blocks($1) AS b", [m])).rows[0].b,
    );
    expect(b).toContain("imc_bajo");
  });

  it("N3: sending needs the licence to be valid at that moment", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await transition(t.fx.A, "owner", plan, "approve");
    await transition(t.fx.A, "nutritionist", plan, "license");
    await t.admin.query(
      "UPDATE app.staff_member SET license_verified_at = NULL WHERE org_id = $1 AND role = 'nutritionist'",
      [t.fx.A.orgId],
    );
    try {
      await expect(transition(t.fx.A, "owner", plan, "send")).rejects.toThrow(
        /license_no_longer_valid/,
      );
    } finally {
      await t.admin.query(
        "UPDATE app.staff_member SET license_verified_at = now() WHERE org_id = $1 AND role = 'nutritionist'",
        [t.fx.A.orgId],
      );
    }
  });

  it("N4: a new block withdraws the plan the member was following", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await publish(t.fx.A, plan);
    await run(
      A(),
      "member",
      (tx) =>
        tx.query("SELECT app.nutrition_profile_save($1, $2::jsonb)", [
          m,
          JSON.stringify({ health_answers: { embarazo: true } }),
        ]),
      person[m],
    );
    const row = await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [plan]);
    expect(row.rows[0].status).toBe("archivado");
    const current = await run(
      A(),
      "member",
      async (tx) =>
        (await tx.query("SELECT id FROM app.nutrition_plan WHERE status = 'enviado'")).rows,
      person[m],
    );
    expect(current).toHaveLength(0);
    await resetProfile(m);
  });

  it("N5: a zero target is reported as missing, not as a database error", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const w = week();
    const plan = await create(t.fx.A, "owner", m, {
      calc: { days: w.calc.days.map((d) => ({ ...d, target_kcal: 0 })) },
    });
    const r = await run(
      t.fx.A,
      "owner",
      async (tx) => (await tx.query("SELECT app.nutrition_plan_check($1) AS r", [plan])).rows[0].r,
    );
    expect(r).toContain("meta_ausente");
  });

  it("N7: no path can send without a licence or delete history", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await transition(t.fx.A, "owner", plan, "approve");
    await expect(
      t.admin.query(
        "UPDATE app.nutrition_plan SET status = 'enviado', sent_at = now() WHERE id = $1",
        [plan],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      t.admin.query("DELETE FROM app.nutrition_plan WHERE id = $1", [plan]),
    ).rejects.toThrow(/permanent/);
  });

  it("N8: a member cannot probe plans; N6: dairy-free members never get bread with milk", async () => {
    const m = t.fx.A.members[0] as string;
    const plan = await create(t.fx.A, "owner", m);
    await expect(
      run(
        A(),
        "member",
        (tx) => tx.query("SELECT app.nutrition_plan_check($1)", [plan]),
        person[m],
      ),
    ).rejects.toThrow(/forbidden/);
    const bread = await t.admin.query("SELECT diet_tags FROM app.food WHERE fdc_id = 174924");
    expect(bread.rows[0].diet_tags).toContain("lacteo");
  });
});

describe("third review: approach B (one-way ratchet) and remaining findings", () => {
  it("H1: the owner cannot lift the minor block by rewriting the birth date; the audit records lifted blocks", async () => {
    const m = t.fx.B.members[0] as string;
    await resetProfile(m);
    await t.admin.query(
      "UPDATE app.nutrition_profile SET birth_date = (current_date - interval '15 years')::date WHERE member_id = $1",
      [m],
    );
    for (const role of ["owner", "location_manager"] as Role[]) {
      await expect(
        run(t.fx.B, role, (tx) =>
          tx.query(`SELECT app.nutrition_profile_save($1, '{"birth_date":"1990-01-01"}')`, [m]),
        ),
        role,
      ).rejects.toThrow(/forbidden_block_removal:menor_de_edad/);
    }
    // A nutritionist of the member's location may correct it, and that is audited.
    await run(t.fx.B, "nutritionist", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"birth_date":"1990-01-01"}')`, [m]),
    );
    const a = await t.admin.query(
      "SELECT meta FROM app.audit_log WHERE action = 'nutrition.block_lifted' AND entity_id = $1 ORDER BY at DESC, id DESC LIMIT 1",
      [m],
    );
    expect(a.rows[0].meta).toMatchObject({ by: "nutritionist", blocks: ["menor_de_edad"] });
    await resetProfile(m);
  });

  it("M2: staff other than a nutritionist or clinician cannot lift a low BMI with a new weight", async () => {
    const m = t.fx.B.members[0] as string;
    await resetProfile(m);
    await run(t.fx.B, "owner", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 45, 165, NULL, NULL)", [m]),
    );
    for (const role of ["owner", "trainer"] as Role[]) {
      await expect(
        run(t.fx.B, role, (tx) =>
          tx.query("SELECT app.nutrition_measure($1, 60, NULL, NULL, NULL)", [m]),
        ),
        role,
      ).rejects.toThrow(/forbidden_block_removal:imc_bajo/);
    }
    await run(t.fx.B, "nutritionist", (tx) =>
      tx.query("SELECT app.nutrition_measure($1, 72, NULL, NULL, NULL)", [m]),
    );
    const b = await run(
      t.fx.B,
      "owner",
      async (tx) => (await tx.query("SELECT app.nutrition_blocks($1) AS b", [m])).rows[0].b,
    );
    expect(b).not.toContain("imc_bajo");
  });

  it("B3: declaring a shorter height never lifts a low BMI", async () => {
    const m = t.fx.B.members[1] as string;
    await run(
      t.fx.B,
      "member",
      (tx) => tx.query("SELECT app.nutrition_measure($1, 45, 170, NULL, NULL)", [m]),
      person[m],
    );
    await run(
      t.fx.B,
      "member",
      (tx) => tx.query("SELECT app.nutrition_measure($1, NULL, 150, NULL, NULL)", [m]),
      person[m],
    );
    const b = await run(
      t.fx.B,
      "owner",
      async (tx) => (await tx.query("SELECT app.nutrition_blocks($1) AS b", [m])).rows[0].b,
    );
    expect(b).toContain("imc_bajo");
  });

  it("M1: a guardian link or a lower safety limit withdraws the sent plan at once; B1: the member never sees it", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const plan = await create(t.fx.A, "owner", m);
    await publish(t.fx.A, plan);
    const gp = (
      await t.admin.query(
        "INSERT INTO app.person (email) VALUES ('tutor.nutri@demo.invalid') RETURNING id",
      )
    ).rows[0].id;
    await t.admin.query(
      "INSERT INTO app.guardian_link (org_id, member_id, guardian_person_id) VALUES ($1, $2, $3)",
      [t.fx.A.orgId, m, gp],
    );
    expect(
      (await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [plan])).rows[0]
        .status,
    ).toBe("archivado");
    const seen = await run(
      A(),
      "member",
      async (tx) =>
        (await tx.query("SELECT id FROM app.nutrition_plan WHERE id = $1", [plan])).rows,
      person[m],
    );
    expect(seen).toHaveLength(0);
    await t.admin.query("DELETE FROM app.guardian_link WHERE guardian_person_id = $1", [gp]);
    // Lowering the loss limit under the member's rate withdraws a newly sent plan too.
    await resetProfile(m);
    const p2 = await create(t.fx.A, "owner", m);
    await publish(t.fx.A, p2);
    await run(A(), "owner", (tx) =>
      tx.query(`SELECT app.nutrition_settings_save('{"max_loss_pct_week":0.25}')`),
    );
    expect(
      (await t.admin.query("SELECT status FROM app.nutrition_plan WHERE id = $1", [p2])).rows[0]
        .status,
    ).toBe("archivado");
    await run(A(), "owner", (tx) =>
      tx.query(`SELECT app.nutrition_settings_save('{"max_loss_pct_week":1}')`),
    );
  });

  it("M3: the weekly change the targets imply must respect the limits, whatever the profile declares", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const w = week();
    // A target 1500 kcal under the day's expenditure is ≈ 2 %/week for 72 kg (> 1 %).
    const plan = await create(t.fx.A, "owner", m, {
      calc: { days: w.calc.days.map((d) => ({ ...d, tdee: d.target_kcal + 1500 })) },
    });
    const r = await run(
      t.fx.A,
      "owner",
      async (tx) => (await tx.query("SELECT app.nutrition_plan_check($1) AS r", [plan])).rows[0].r,
    );
    expect(r).toContain("ritmo_inseguro");
  });

  it("B2: a new triage refreshes the profile status; Info: approver and licensed reviewer are different people", async () => {
    const m = t.fx.A.members[0] as string;
    await resetProfile(m);
    const st = async () =>
      (await t.admin.query("SELECT status FROM app.nutrition_profile WHERE member_id = $1", [m]))
        .rows[0].status;
    await run(A(), "nutritionist", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"goal":"mantener"}')`, [m]),
    );
    expect(await st()).toBe("apto");
    // Same person approving for the gym and signing as the licensed professional is refused.
    const nutriPerson = (
      await t.admin.query(
        "SELECT person_id FROM app.staff_member WHERE org_id = $1 AND role = 'nutritionist'",
        [A().orgId],
      )
    ).rows[0].person_id;
    await t.admin.query(
      "INSERT INTO app.staff_member (org_id, person_id, role, display_name) VALUES ($1, $2, 'owner', 'Dueña y nutri')",
      [A().orgId, nutriPerson],
    );
    try {
      const plan = await create(t.fx.A, "owner", m);
      await asCaller(t.api, t.claims(A(), "owner", nutriPerson), (tx) =>
        tx.query("SELECT app.nutrition_plan_transition($1, 'approve', NULL)", [plan]),
      );
      expect(
        (await t.admin.query("SELECT approved_by FROM app.nutrition_plan WHERE id = $1", [plan]))
          .rows[0].approved_by,
      ).toBe(nutriPerson);
      await expect(transition(t.fx.A, "nutritionist", plan, "license")).rejects.toThrow(
        /same_person_cannot_license/,
      );
    } finally {
      await t.admin.query(
        "DELETE FROM app.staff_member WHERE org_id = $1 AND person_id = $2 AND role = 'owner'",
        [A().orgId, nutriPerson],
      );
    }
  });
});

describe("who sees and who writes", () => {
  it("front desk, chef and accountant see no nutrition rows; another org sees only its own", async () => {
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

  it("only the member accepts the disclaimer; a member cannot write another member's profile", async () => {
    const m = t.fx.A.members[1] as string;
    await run(A(), "owner", (tx) =>
      tx.query(`SELECT app.nutrition_profile_save($1, '{"accept_disclaimer":true}')`, [m]),
    );
    expect(
      (
        await t.admin.query(
          "SELECT disclaimer_accepted_at FROM app.nutrition_profile WHERE member_id = $1",
          [m],
        )
      ).rows[0].disclaimer_accepted_at,
    ).toBeNull();
    await run(
      A(),
      "member",
      (tx) =>
        tx.query(
          `SELECT app.nutrition_profile_save($1, '{"accept_disclaimer":true,"goal":"mantener"}')`,
          [m],
        ),
      person[m],
    );
    const p = await t.admin.query(
      "SELECT disclaimer_accepted_at, goal FROM app.nutrition_profile WHERE member_id = $1",
      [m],
    );
    expect(p.rows[0].disclaimer_accepted_at).not.toBeNull();
    expect(p.rows[0].goal).toBe("mantener");
    await expect(
      run(
        A(),
        "member",
        (tx) =>
          tx.query(`SELECT app.nutrition_profile_save($1, '{"goal":"mantener"}')`, [
            t.fx.A.members[0],
          ]),
        person[m],
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      run(
        A(),
        "member",
        (tx) => tx.query(`SELECT app.nutrition_profile_save($1, '{"liked_foods":[999999]}')`, [m]),
        person[m],
      ),
    ).rejects.toThrow(/unknown_food/);
  });
});

function A() {
  return t.fx.A;
}
