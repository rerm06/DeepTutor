/** Turn dictated answers into field values ("ana punto rivera arroba demo punto invalid" → ana.rivera@demo.invalid). */
import type { FieldKind } from "./bridge";

const DIGIT_WORDS: Record<string, string> = {
  cero: "0",
  zero: "0",
  oh: "0",
  uno: "1",
  una: "1",
  one: "1",
  dos: "2",
  two: "2",
  tres: "3",
  three: "3",
  cuatro: "4",
  four: "4",
  cinco: "5",
  five: "5",
  seis: "6",
  six: "6",
  siete: "7",
  seven: "7",
  ocho: "8",
  eight: "8",
  nueve: "9",
  nine: "9",
};

const MONTHS: Record<string, number> = {
  enero: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  february: 2,
  feb: 2,
  marzo: 3,
  march: 3,
  mar: 3,
  abril: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  june: 6,
  jun: 6,
  julio: 7,
  july: 7,
  jul: 7,
  agosto: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  october: 10,
  oct: 10,
  noviembre: 11,
  november: 11,
  nov: 11,
  diciembre: 12,
  december: 12,
  dec: 12,
};

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function spokenEmail(s: string): string {
  return strip(s)
    .replace(/\s+(arroba|at)\s+/g, "@")
    .replace(/\s*\b(arroba)\b\s*/g, "@")
    .replace(/\s+(punto|dot)\s+/g, ".")
    .replace(/\s*\b(guion bajo|underscore)\b\s*/g, "_")
    .replace(/\s*\b(guion|dash|hyphen)\b\s*/g, "-")
    .replace(/\s*\b(mas|plus)\b\s*/g, "+")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9@._+\-]/g, "");
}

export function spokenDigits(s: string): string {
  return strip(s)
    .split(/[\s,.\-()/]+/)
    .map((w) => DIGIT_WORDS[w] ?? w.replace(/\D/g, ""))
    .join("");
}

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "15 de marzo de 1990", "March 15 1990", "1990-03-15", "15/03/1990" (es: d/m; en: m/d) → YYYY-MM-DD. */
export function spokenDate(s: string, lang: "es" | "en" = "es"): string | null {
  const t = strip(s)
    .replace(/\b(del?|of|the|el)\b/g, " ")
    .replace(/,/g, " ");
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+(m[1] as string), +(m[2] as string), +(m[3] as string));
  m = t.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (m) {
    const a = +(m[1] as string);
    const b = +(m[2] as string);
    const y = +(m[3] as string);
    return lang === "es" ? iso(y, b, a) : iso(y, a, b);
  }
  const words = t.split(/\s+/).filter(Boolean);
  const mi = words.findIndex((w) => MONTHS[w] !== undefined);
  if (mi < 0) return null;
  const month = MONTHS[words[mi] as string] as number;
  const nums = words.filter((w) => /^\d{1,4}$/.test(w)).map(Number);
  const year = nums.find((n) => n >= 1900);
  const day = nums.find((n) => n >= 1 && n <= 31);
  if (!year || !day) return null;
  return iso(year, month, day);
}

/** Capitalise a dictated name ("ana maría rivera" → "Ana María Rivera"). */
export function spokenName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
}

export function normalizeAnswer(
  kind: FieldKind,
  label: string,
  raw: string,
  lang: "es" | "en",
): string {
  const s = raw.trim();
  if (kind === "email" || /correo|e-?mail/i.test(label)) return spokenEmail(s);
  if (kind === "tel" || /tel[eé]fono|phone|celular/i.test(label)) {
    const d = spokenDigits(s);
    return d.length >= 7 ? d : s;
  }
  if (kind === "date") return spokenDate(s, lang) ?? s;
  if (kind === "number") {
    const d = spokenDigits(s);
    return d || s;
  }
  if (kind === "checkbox")
    return /^(s[ií]|yes|claro|ok|correcto|marca)/i.test(s) ? "true" : "false";
  if (/nombre|name/i.test(label) && kind === "text") return spokenName(s);
  return s;
}

export const YES = /^(s[ií]|yes|claro|dale|correcto|confirmo|adelante|ok|okay|de acuerdo|sure)\b/i;
export const NO = /^(no|nop|negativo|todav[ií]a no|not yet)\b/i;
export const SKIP = /^(saltar|salta|siguiente|pr[oó]ximo|omitir|paso|skip|next|pass)\b/i;
export const STOP = /^(parar|para|detener|det[eé]n|basta|cancelar|terminar|stop|cancel|quit)\b/i;
export const REPEAT = /^(repetir|repite|otra vez|repeat|again)\b/i;
