import type { Lang } from "../types";
import type { PlanKind, PlanSection } from "./api";

/**
 * Simple starting points that a professional edits before submitting. Not generated, not personalised, no health
 * claims; nutrition templates never include calorie counting (safe for minors).
 */
export interface PlanTemplate {
  id: string;
  kind: PlanKind;
  title: Record<Lang, string>;
  sections: Record<Lang, PlanSection[]>;
}

export const TEMPLATES: readonly PlanTemplate[] = [
  {
    id: "training-strength",
    kind: "training",
    title: { es: "Fuerza inicial (4 semanas)", en: "Beginner strength (4 weeks)" },
    sections: {
      es: [
        {
          heading: "Semanas 1 y 2",
          items: ["Calentamiento 10 minutos", "Sentadilla a cajón 3x10", "Remo con banda 3x12"],
        },
        { heading: "Semanas 3 y 4", items: ["Peso muerto rumano 3x10", "Plancha 3x30 segundos"] },
      ],
      en: [
        {
          heading: "Weeks 1 and 2",
          items: ["Warm-up 10 minutes", "Box squat 3x10", "Band row 3x12"],
        },
        { heading: "Weeks 3 and 4", items: ["Romanian deadlift 3x10", "Plank 3x30 seconds"] },
      ],
    },
  },
  {
    id: "training-cardio",
    kind: "training",
    title: { es: "Acondicionamiento aeróbico", en: "Aerobic conditioning" },
    sections: {
      es: [
        {
          heading: "Tres veces por semana",
          items: ["Caminata o bicicleta 20 a 30 minutos", "Estiramientos 5 minutos"],
        },
      ],
      en: [
        {
          heading: "Three times a week",
          items: ["Walk or cycle 20 to 30 minutes", "Stretching 5 minutes"],
        },
      ],
    },
  },
  {
    id: "nutrition-structure",
    kind: "nutrition",
    title: { es: "Estructura de comidas", en: "Meal structure" },
    sections: {
      es: [
        {
          heading: "Estructura del día",
          items: [
            "Tres comidas y una merienda en horarios regulares",
            "Vegetales en almuerzo y cena",
          ],
        },
        { heading: "Hidratación", items: ["Agua como bebida principal"] },
      ],
      en: [
        {
          heading: "Daily structure",
          items: ["Three meals and one snack at regular times", "Vegetables at lunch and dinner"],
        },
        { heading: "Hydration", items: ["Water as the main drink"] },
      ],
    },
  },
  {
    id: "treatment-phases",
    kind: "treatment",
    title: { es: "Readaptación por fases", en: "Phased return to activity" },
    sections: {
      es: [
        { heading: "Fase 1", items: ["Movilidad sin dolor", "Ejercicios isométricos"] },
        { heading: "Fase 2", items: ["Fuerza progresiva según tolerancia"] },
      ],
      en: [
        { heading: "Phase 1", items: ["Pain-free mobility", "Isometric exercises"] },
        { heading: "Phase 2", items: ["Progressive strength as tolerated"] },
      ],
    },
  },
];
