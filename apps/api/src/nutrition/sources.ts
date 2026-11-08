// Closed list of sources the nutrition module may cite. Nothing outside this list is ever cited: generated text can
// only reference these ids, and the verifier rejects any other. Each DOI was resolved and its metadata checked against
// Crossref on 2026-11-08; each web source answered 200 the same day.

export interface Source {
  id: string;
  use: string;
  citation: string;
  url: string;
  verified: string;
}

export const SOURCES: readonly Source[] = [
  {
    id: "mifflin1990",
    use: "Gasto basal",
    citation:
      "Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO (1990). A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr 51(2):241–247.",
    url: "https://doi.org/10.1093/ajcn/51.2.241",
    verified: "2026-11-08",
  },
  {
    id: "deurenberg1991",
    use: "Grasa corporal estimada por IMC",
    citation:
      "Deurenberg P, Weststrate JA, Seidell JC (1991). Body mass index as a measure of body fatness: age- and sex-specific prediction formulas. Br J Nutr 65(2):105–114.",
    url: "https://doi.org/10.1079/BJN19910073",
    verified: "2026-11-08",
  },
  {
    id: "compendium2024",
    use: "Gasto por ejercicio (METs)",
    citation:
      "Herrmann SD y col. (2024). 2024 Adult Compendium of Physical Activities: A third update of the energy costs of human activities. J Sport Health Sci 13(1):6–12. Valores de pacompendium.com.",
    url: "https://doi.org/10.1016/j.jshs.2023.10.010",
    verified: "2026-11-08",
  },
  {
    id: "compendium2011",
    use: "Gasto por ejercicio (edición anterior)",
    citation:
      "Ainsworth BE y col. (2011). 2011 Compendium of Physical Activities. Med Sci Sports Exerc 43(8):1575–1581.",
    url: "https://doi.org/10.1249/MSS.0b013e31821ece12",
    verified: "2026-11-08",
  },
  {
    id: "issn2017",
    use: "Proteína",
    citation:
      "Jäger R y col. (2017). International Society of Sports Nutrition Position Stand: protein and exercise. J Int Soc Sports Nutr 14:20.",
    url: "https://doi.org/10.1186/s12970-017-0177-8",
    verified: "2026-11-08",
  },
  {
    id: "acsm2016",
    use: "Nutrición y rendimiento",
    citation:
      "Thomas DT, Erdman KA, Burke LM (2016). Nutrition and Athletic Performance. Posición conjunta ACSM, Academy of Nutrition and Dietetics y Dietitians of Canada. Med Sci Sports Exerc 48(3):543–568.",
    url: "https://doi.org/10.1249/MSS.0000000000000852",
    verified: "2026-11-08",
  },
  {
    id: "dri2005",
    use: "Ingestas de referencia (AMDR, carbohidratos mínimos, niveles de actividad)",
    citation:
      "National Academies (2005). Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids.",
    url: "https://nap.nationalacademies.org/catalog/10490",
    verified: "2026-11-08",
  },
  {
    id: "dga",
    use: "Patrones de alimentación",
    citation:
      "U.S. Department of Agriculture y U.S. Department of Health and Human Services. Dietary Guidelines for Americans, edición vigente.",
    url: "https://www.dietaryguidelines.gov/",
    verified: "2026-11-08",
  },
  {
    id: "who_bmi",
    use: "Clasificación del IMC",
    citation:
      "Organización Mundial de la Salud. Clasificación del índice de masa corporal en adultos.",
    url: "https://www.who.int/data/gho/data/themes/topics/topic-details/GHO/body-mass-index",
    verified: "2026-11-08",
  },
  {
    id: "usda_fdc",
    use: "Valores de alimentos",
    citation:
      "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, SR Legacy (abril 2018).",
    url: "https://fdc.nal.usda.gov/",
    verified: "2026-11-08",
  },
];

export const SOURCE_IDS = new Set(SOURCES.map((s) => s.id));

/** Visible on every plan, photo analysis and message with recommendations; accepted once by the member. */
export const DISCLAIMER =
  "Este plan es orientativo y se basa en estimaciones. No sustituye la evaluación ni el consejo de un profesional de la salud. Si tienes una condición médica, estás embarazada o tomas medicamentos, consulta a tu médico antes de seguirlo.";
