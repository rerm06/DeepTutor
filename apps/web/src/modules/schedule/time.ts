/** Time helpers for the schedule screens. Sessions are shown and entered in the LOCATION's time zone. */

const DAY = 86_400_000;

/** Minutes the zone is ahead of UTC at `at` (Puerto Rico: -240). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** "2026-11-03" + "18:00" in `timeZone` → the UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const offset = tzOffsetMinutes(timeZone, new Date(guess));
  const first = guess - offset * 60_000;
  // Re-check once across a DST edge (no-op for Puerto Rico).
  const offset2 = tzOffsetMinutes(timeZone, new Date(first));
  return new Date(guess - offset2 * 60_000);
}

/** Calendar day "YYYY-MM-DD" of an instant in `timeZone`. */
export function dayKey(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof at === "string" ? new Date(at) : at);
}

/** Monday (YYYY-MM-DD) of the week containing `at` in `timeZone`, shifted by `weeks`. */
export function weekStart(at: Date, timeZone: string, weeks = 0): string {
  const key = dayKey(at, timeZone);
  const d = new Date(`${key}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY + weeks * 7 * DAY).toISOString().slice(0, 10);
}

/** The 7 day keys starting at `monday`. */
export function weekDays(monday: string): string[] {
  const base = new Date(`${monday}T12:00:00Z`).getTime();
  return Array.from({ length: 7 }, (_, i) => new Date(base + i * DAY).toISOString().slice(0, 10));
}

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
}

export function formatTime(iso: string, lang: string, timeZone: string): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDay(day: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T12:00:00Z`));
}

export function formatDateTimeIn(iso: string, lang: string, timeZone: string): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const DEFAULT_TZ = "America/Puerto_Rico";
