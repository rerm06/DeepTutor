import { describe, expect, it } from "vitest";
import {
  ACTIVITIES,
  type Limits,
  ageYears,
  bmi,
  bmiClass,
  bmiExact,
  bmrMifflin,
  bodyFat,
  bodyFatDeurenberg,
  circuitMinutes,
  classActivity,
  deviationPct,
  exerciseKcal,
  foodValues,
  weekTargets,
} from "../src/nutrition/calc.js";
import { DISCLAIMER, SOURCES, SOURCE_IDS } from "../src/nutrition/sources.js";

// Reference values computed by hand from each published formula (see docs/nutricion/STATE.md, Fase 2).
const LIMITS: Limits = {
  max_loss_pct_week: 1,
  max_gain_pct_week: 0.5,
  protein_min_g_kg: 1.4,
  protein_max_g_kg: 2.0,
  fat_min_pct: 20,
};

describe("formulas against hand-computed reference values", () => {
  it("Mifflin-St Jeor: woman 72 kg, 165 cm, 35 y = 1415; man 80 kg, 180 cm, 30 y = 1780", () => {
    expect(bmrMifflin(72, 165, 35, "femenino")).toBe(1415);
    expect(bmrMifflin(80, 180, 30, "masculino")).toBe(1780);
  });

  it("BMI and WHO class: 72 kg / 1.65 m² = 26.4 (sobrepeso); boundaries 18.5, 25, 30, 35, 40", () => {
    expect(bmi(72, 165)).toBe(26.4);
    expect(bmiClass(26.4)).toBe("sobrepeso");
    expect([18.4, 18.5, 24.9, 25, 29.9, 30, 34.9, 35, 39.9, 40].map(bmiClass)).toEqual([
      "bajo peso",
      "normal",
      "normal",
      "sobrepeso",
      "sobrepeso",
      "obesidad grado I",
      "obesidad grado I",
      "obesidad grado II",
      "obesidad grado II",
      "obesidad grado III",
    ]);
  });

  it("Deurenberg body fat: woman BMI 26.4, 35 y = 34.3 %; man BMI 24.7, 30 y = 20.3 %; margin ±4", () => {
    expect(bodyFatDeurenberg(26.4, 35, "femenino")).toEqual({ pct: 34.3, margin: 4 });
    expect(bodyFatDeurenberg(24.7, 30, "masculino")).toEqual({ pct: 20.3, margin: 4 });
  });

  it("exercise is net of rest: (MET − 1) × kg × h", () => {
    expect(exerciseKcal(5, 70, 60)).toBe(280);
    expect(exerciseKcal(6.8, 72, 45)).toBe(313);
    expect(exerciseKcal(0.9, 70, 60)).toBe(0);
  });

  it("circuit minutes: 3 × (10 reps × 3 s + 60 s) + 3 × (12 × 3 + 60) = 9 min", () => {
    expect(
      circuitMinutes([
        { sets: 3, reps: 10, rest_seconds: 60 },
        { sets: 3, reps: 12, rest_seconds: 60 },
      ]),
    ).toBe(9);
  });

  it("age in whole years respects the birthday", () => {
    expect(ageYears("1990-05-10", "2026-05-09")).toBe(35);
    expect(ageYears("1990-05-10", "2026-05-10")).toBe(36);
  });

  it("Compendium values used are the published ones (2024 adult compendium codes)", () => {
    expect(ACTIVITIES.fuerza_general).toMatchObject({ code: "02054", met: 3.5 });
    expect(ACTIVITIES.bicicleta_estacionaria).toMatchObject({ code: "01200", met: 6.8 });
    expect(ACTIVITIES.caminadora).toMatchObject({ code: "17352", met: 3.5 });
    expect(ACTIVITIES.yoga).toMatchObject({ code: "02175", met: 2.3 });
  });

  it("class names map to activities by keyword", () => {
    expect(classActivity("Spinning 45")).toBe("bicicleta_estacionaria");
    expect(classActivity("Yoga suave")).toBe("yoga");
    expect(classActivity("Zumba")).toBe("aerobicos");
    expect(classActivity("Clase de abdomen")).toBe("clase_general");
  });
});

describe("weekly targets", () => {
  const person = {
    weightKg: 72,
    heightCm: 165,
    age: 35,
    sex: "femenino" as const,
    goal: "perder_grasa" as const,
    ratePctWeek: 0.5,
    dailyActivity: "ligero" as const,
  };

  it("training and rest days differ, and the numbers match the reference", () => {
    const days = weekTargets(
      person,
      [
        {
          day: 2,
          activity: "bicicleta_estacionaria",
          minutes: 45,
          source: "clase",
          label: "Spinning",
        },
      ],
      LIMITS,
    );
    const rest = days[0];
    const train = days[1];
    expect(rest).toMatchObject({
      training: false,
      bmr: 1415,
      living_kcal: 1840,
      tdee: 1840,
      target_kcal: 1444,
    });
    // 2.0 g/kg = 144 g would be 40 % of 1444 kcal; the AMDR ceiling (35 %) gives round(1444 × 0.35 / 4) = 126 g.
    expect(rest).toMatchObject({ protein_g: 126, fat_g: 40, carb_g: 145, carb_below_rda: false });
    expect(train).toMatchObject({
      training: true,
      exercise_kcal: 313,
      tdee: 2153,
      target_kcal: 1757,
    });
    expect(train).toMatchObject({ protein_g: 144, fat_g: 49, carb_g: 185, carb_below_rda: false });
  });

  it("never goes below the resting expenditure, and caps the loss rate", () => {
    const days = weekTargets(
      { ...person, ratePctWeek: 5, dailyActivity: "sedentario" },
      [],
      LIMITS,
    );
    expect(days.every((d) => d.target_kcal >= d.bmr)).toBe(true);
    // 5 %/week requested, 1 %/week applied: 0.01 × 72 × 7700 / 7 = 792 kcal/day deficit, then the floor.
    expect(days[0]?.floor_applied).toBe(true);
    expect(days[0]?.target_kcal).toBe(1415);
  });

  it("protein follows the goal inside the organisation's range; fat never below its minimum share", () => {
    const keep = weekTargets({ ...person, goal: "mantener" }, [], LIMITS)[0];
    expect(keep?.protein_g).toBe(Math.round(1.6 * 72));
    const strict = weekTargets(person, [], {
      ...LIMITS,
      protein_max_g_kg: 1.5,
      fat_min_pct: 30,
    })[0];
    expect(strict?.protein_g).toBe(Math.round(1.5 * 72));
    expect(strict?.fat_g).toBe(Math.round(((strict?.target_kcal ?? 0) * 0.3) / 9));
  });

  it("muscle gain adds a bounded surplus", () => {
    const d = weekTargets({ ...person, goal: "ganar_masa", ratePctWeek: 0.25 }, [], LIMITS)[0];
    expect(d?.adjustment_kcal).toBe(
      Math.min(Math.round(1840 * 0.1), Math.round(((0.25 / 100) * 72 * 7700) / 7)),
    );
  });

  it("food values and deviation", () => {
    expect(foodValues({ kcal: 130, protein_g: 2.69, carb_g: 28.17, fat_g: 0.28 }, 158)).toEqual({
      kcal: 205.4,
      protein_g: 4.3,
      carb_g: 44.5,
      fat_g: 0.4,
    });
    expect(deviationPct(1520, 1444)).toBe(5.3);
  });
});

describe("review fixes (2026-11-08)", () => {
  it("M6: classify with the exact BMI (50.3 kg, 165 cm = 18.476 → bajo peso)", () => {
    expect(bmi(50.3, 165)).toBe(18.5);
    expect(bmiClass(bmiExact(50.3, 165))).toBe("bajo peso");
  });

  it("M4: body fat carries its provenance; the estimate is marked with its margin", () => {
    expect(bodyFat({ pct: 28, method: "bioimpedancia" }, 72, 165, 35, "femenino")).toEqual({
      pct: 28,
      margin: 0,
      provenance: "medido",
      method: "bioimpedancia",
    });
    const e = bodyFat(null, 72, 165, 35, "femenino");
    expect(e).toMatchObject({ provenance: "estimado", margin: 4, method: "deurenberg1991" });
    // 1.2 × 26.446 + 0.23 × 35 − 5.4 = 34.4
    expect(e.pct).toBe(34.4);
  });

  it("M5: protein never exceeds 35 % of the day's energy (150 kg)", () => {
    const d = weekTargets(
      {
        weightKg: 150,
        heightCm: 165,
        age: 40,
        sex: "femenino",
        goal: "perder_grasa",
        ratePctWeek: 0.5,
        dailyActivity: "sedentario",
      },
      [],
      LIMITS,
    )[0];
    expect((d?.protein_g ?? 0) * 4).toBeLessThanOrEqual((d?.target_kcal ?? 0) * 0.35 + 2);
    expect((d?.protein_g ?? 0) * 4 + (d?.fat_g ?? 0) * 9).toBeLessThanOrEqual(d?.target_kcal ?? 0);
    // N9: when the ceiling leaves protein under the organisation's minimum g/kg, it is flagged.
    expect(d?.protein_below_min).toBe(true);
  });

  it("B2: a gain rate of 0 adds no surplus", () => {
    const d = weekTargets(
      {
        weightKg: 72,
        heightCm: 165,
        age: 35,
        sex: "femenino",
        goal: "ganar_masa",
        ratePctWeek: 0,
        dailyActivity: "ligero",
      },
      [],
      LIMITS,
    )[0];
    expect(d?.adjustment_kcal).toBe(0);
  });
});

describe("closed source list and disclaimer", () => {
  it("has the required sources with verified links and the exact disclaimer", () => {
    for (const id of [
      "mifflin1990",
      "deurenberg1991",
      "compendium2011",
      "issn2017",
      "acsm2016",
      "dri2005",
      "dga",
      "who_bmi",
      "usda_fdc",
    ])
      expect(SOURCE_IDS.has(id), id).toBe(true);
    for (const s of SOURCES) expect(s.url).toMatch(/^https:\/\//);
    expect(DISCLAIMER).toContain(
      "No sustituye la evaluación ni el consejo de un profesional de la salud",
    );
  });
});
