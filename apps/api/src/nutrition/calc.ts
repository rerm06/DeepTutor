// Deterministic nutrition calculations (Fase 2). Every number a plan, a photo analysis or a message shows comes from
// here or from the food catalog; models never compute. Each function names its source (sources.ts) and every
// assumption that is not in a source is marked SUPUESTO and editable through settings.

export type Sex = "femenino" | "masculino";
export type Goal = "perder_grasa" | "ganar_masa" | "mantener" | "rendimiento";
export type DailyActivity = "sedentario" | "ligero" | "activo";
export type Provenance = "medido" | "declarado" | "estimado" | "calculado";

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);

/** Whole years on a date (YYYY-MM-DD strings, calendar arithmetic). */
export function ageYears(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** BMI = kg / m² (who_bmi). */
export function bmi(weightKg: number, heightCm: number): number {
  return r1(weightKg / (heightCm / 100) ** 2);
}

/** WHO adult BMI classes (who_bmi). */
export function bmiClass(b: number): string {
  if (b < 18.5) return "bajo peso";
  if (b < 25) return "normal";
  if (b < 30) return "sobrepeso";
  if (b < 35) return "obesidad grado I";
  if (b < 40) return "obesidad grado II";
  return "obesidad grado III";
}

/**
 * Body fat % estimated from BMI, age and sex (deurenberg1991): 1.2·BMI + 0.23·edad − 10.8·sexo − 5.4 (sexo 1 = masculino).
 * Adults only. The paper reports a standard error of estimate of about 4 percentage points, shown as the margin.
 */
export function bodyFatDeurenberg(
  bmiValue: number,
  age: number,
  sex: Sex,
): { pct: number; margin: number } {
  const s = sex === "masculino" ? 1 : 0;
  return { pct: r1(1.2 * bmiValue + 0.23 * age - 10.8 * s - 5.4), margin: 4 };
}

/** Resting energy expenditure, kcal/day (mifflin1990): 10·kg + 6.25·cm − 5·edad + 5 (hombres) o − 161 (mujeres). */
export function bmrMifflin(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  return r0(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "masculino" ? 5 : -161));
}

/**
 * Factor for daily living WITHOUT planned exercise (the exercise is added per day from METs).
 * SUPUESTO: sedentario 1.2, ligero 1.3, activo 1.4 — inside the DRI 2005 "sedentary" physical-activity-level band
 * (dri2005), because planned exercise is counted separately. Editable later.
 */
export const DAILY_ACTIVITY_FACTOR: Record<DailyActivity, number> = {
  sedentario: 1.2,
  ligero: 1.3,
  activo: 1.4,
};

/** Activities with their MET value and Compendium code (compendium2024, values from pacompendium.com, 2026-11-08). */
export const ACTIVITIES = {
  fuerza_general: { code: "02054", met: 3.5, label: "Entrenamiento de fuerza, varios ejercicios" },
  fuerza_vigorosa: { code: "02050", met: 6.0, label: "Fuerza vigorosa (powerlifting, culturismo)" },
  calistenia: { code: "02056", met: 3.0, label: "Ejercicios con peso corporal" },
  circuito_moderado: { code: "02035", met: 5.0, label: "Circuito, esfuerzo moderado" },
  circuito_vigoroso: { code: "02040", met: 7.5, label: "Circuito vigoroso, descanso mínimo" },
  bicicleta_estacionaria: { code: "01200", met: 6.8, label: "Bicicleta estacionaria, general" },
  caminadora: { code: "17352", met: 3.5, label: "Caminadora 2.5–2.9 mph, sin inclinación" },
  trote: { code: "12020", met: 7.5, label: "Trote, ritmo propio" },
  remo: { code: "02071", met: 5.0, label: "Remo estacionario, moderado" },
  eliptica: { code: "02048", met: 5.0, label: "Elíptica, moderada" },
  yoga: { code: "02175", met: 2.3, label: "Yoga, general" },
  pilates: { code: "02105", met: 2.8, label: "Pilates, general" },
  aerobicos: { code: "02000", met: 7.3, label: "Aeróbicos, general" },
  hiit: { code: "02210", met: 7.0, label: "Intervalos de alta intensidad, moderado" },
  clase_general: { code: "02061", met: 5.0, label: "Clase de gimnasio, general" },
} as const;
export type Activity = keyof typeof ACTIVITIES;

/** Equipment type (floor module) → activity. */
export const EQUIPMENT_ACTIVITY: Record<string, Activity> = {
  barbell: "fuerza_general",
  dumbbell: "fuerza_general",
  kettlebell: "fuerza_general",
  cable: "fuerza_general",
  leg_press: "fuerza_general",
  chest_press: "fuerza_general",
  lat_pulldown: "fuerza_general",
  row_machine: "fuerza_general",
  bench: "fuerza_general",
  rack: "fuerza_general",
  smith: "fuerza_general",
  bodyweight_station: "calistenia",
  treadmill: "caminadora",
  bike: "bicicleta_estacionaria",
  rower: "remo",
  other: "fuerza_general",
};

/** Class name → activity, by keywords (accents ignored). Unknown names count as a general gym class. */
export function classActivity(name: string): Activity {
  const n = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/spin|ciclo|bici/.test(n)) return "bicicleta_estacionaria";
  if (/yoga/.test(n)) return "yoga";
  if (/pilates/.test(n)) return "pilates";
  if (/hiit|tabata|interval/.test(n)) return "hiit";
  if (/zumba|aerob|baile|step/.test(n)) return "aerobicos";
  if (/crossfit|funcional|circuito|bootcamp/.test(n)) return "circuito_vigoroso";
  return "clase_general";
}

/**
 * Exercise energy ABOVE rest, kcal: (MET − 1) × kg × hours (compendium2024: 1 MET ≈ 1 kcal/kg/h). Net of rest
 * because resting energy is already in the daily-living total; adding gross METs would count it twice.
 */
export function exerciseKcal(met: number, weightKg: number, minutes: number): number {
  return r0(Math.max(0, met - 1) * weightKg * (minutes / 60));
}

/**
 * Minutes of a circuit (floor module): Σ sets × (reps × 3 s + rest). SUPUESTO: 3 s per repetition.
 */
export function circuitMinutes(
  steps: Array<{ sets: number; reps: number; rest_seconds: number }>,
): number {
  const s = steps.reduce((t, x) => t + x.sets * (x.reps * 3 + x.rest_seconds), 0);
  return r0(s / 60);
}

export interface Session {
  day: number; // ISO weekday 1–7
  activity: Activity;
  minutes: number;
  source: "clase" | "circuito" | "equipo" | "declarado";
  label: string;
}

export interface Limits {
  max_loss_pct_week: number;
  max_gain_pct_week: number;
  protein_min_g_kg: number;
  protein_max_g_kg: number;
  fat_min_pct: number;
}

export interface Person {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  goal: Goal;
  ratePctWeek: number | null;
  dailyActivity: DailyActivity;
}

export interface DayTarget {
  day: number;
  training: boolean;
  sessions: Array<Session & { met: number; code: string; kcal: number }>;
  bmr: number;
  living_kcal: number;
  exercise_kcal: number;
  tdee: number;
  adjustment_kcal: number;
  target_kcal: number;
  floor_applied: boolean;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  carb_below_rda: boolean;
}

/** kcal per kg of body-weight change. SUPUESTO (rule of thumb, not in the closed source list; never cited). */
export const KCAL_PER_KG = 7700;
/** Surplus for muscle gain as a share of the day's total. SUPUESTO, bounded by max_gain_pct_week. */
export const GAIN_SURPLUS_SHARE = 0.1;
/** Fat share of energy (dri2005 AMDR 20–35 %); never below the organisation's minimum. */
export const FAT_SHARE = 0.25;
/** Protein g/kg by goal inside the ISSN 1.4–2.0 g/kg range (issn2017), clamped to the organisation's limits. */
export const PROTEIN_G_KG: Record<Goal, number> = {
  perder_grasa: 2.0,
  ganar_masa: 1.8,
  mantener: 1.6,
  rendimiento: 1.6,
};
/** RDA for carbohydrate, g/day, adults (dri2005). Days under it are flagged, not silently changed. */
export const CARB_RDA_G = 130;

/**
 * Per-day targets: rest × daily-living factor + net exercise of that day, then the goal adjustment, the floor
 * (never below the resting expenditure) and the macro split. Training and rest days differ by construction.
 */
export function weekTargets(p: Person, sessions: Session[], limits: Limits): DayTarget[] {
  const bmr = bmrMifflin(p.weightKg, p.heightCm, p.age, p.sex);
  const living = r0(bmr * DAILY_ACTIVITY_FACTOR[p.dailyActivity]);
  const rate = p.ratePctWeek ?? 0;
  const out: DayTarget[] = [];
  for (let day = 1; day <= 7; day += 1) {
    const s = sessions
      .filter((x) => x.day === day)
      .map((x) => {
        const a = ACTIVITIES[x.activity];
        return { ...x, met: a.met, code: a.code, kcal: exerciseKcal(a.met, p.weightKg, x.minutes) };
      });
    const exercise = s.reduce((t, x) => t + x.kcal, 0);
    const tdee = living + exercise;
    let adjustment = 0;
    if (p.goal === "perder_grasa") {
      const pct = Math.min(rate, limits.max_loss_pct_week);
      adjustment = -r0(((pct / 100) * p.weightKg * KCAL_PER_KG) / 7);
    } else if (p.goal === "ganar_masa") {
      const byRate = r0(
        ((Math.min(rate || limits.max_gain_pct_week, limits.max_gain_pct_week) / 100) *
          p.weightKg *
          KCAL_PER_KG) /
          7,
      );
      adjustment = Math.min(r0(tdee * GAIN_SURPLUS_SHARE), byRate);
    }
    let target = tdee + adjustment;
    const floorApplied = target < bmr;
    if (floorApplied) target = bmr;
    const gkg = Math.min(
      Math.max(PROTEIN_G_KG[p.goal], limits.protein_min_g_kg),
      limits.protein_max_g_kg,
    );
    const protein = r0(gkg * p.weightKg);
    const fat = r0((target * Math.max(FAT_SHARE, limits.fat_min_pct / 100)) / 9);
    const carb = Math.max(0, r0((target - protein * 4 - fat * 9) / 4));
    out.push({
      day,
      training: s.length > 0,
      sessions: s,
      bmr,
      living_kcal: living,
      exercise_kcal: exercise,
      tdee,
      adjustment_kcal: target - tdee,
      target_kcal: target,
      floor_applied: floorApplied,
      protein_g: protein,
      fat_g: fat,
      carb_g: carb,
      carb_below_rda: carb < CARB_RDA_G,
    });
  }
  return out;
}

export interface Totals {
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
}
/** Sum computed item values (from the catalog). */
export function sum(items: Totals[]): Totals {
  return items.reduce(
    (t, x) => ({
      kcal: r1(t.kcal + x.kcal),
      protein_g: r1(t.protein_g + x.protein_g),
      carb_g: r1(t.carb_g + x.carb_g),
      fat_g: r1(t.fat_g + x.fat_g),
    }),
    { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
  );
}

/** Signed deviation of a day's total from its target, in percent. */
export function deviationPct(total: number, target: number): number {
  return target > 0 ? r1(((total - target) / target) * 100) : 0;
}

/** Values of `grams` of a catalog food (per-100 g values), same rounding as the database trigger. */
export function foodValues(
  f: { kcal: number; protein_g: number; carb_g: number; fat_g: number },
  grams: number,
): Totals {
  return {
    kcal: r1((f.kcal * grams) / 100),
    protein_g: r1((f.protein_g * grams) / 100),
    carb_g: r1((f.carb_g * grams) / 100),
    fat_g: r1((f.fat_g * grams) / 100),
  };
}
