import type { Lang } from "../i18n/dict";

const DEFAULT_TZ = "America/Puerto_Rico";

export function formatDateTime(iso: string | null | undefined, lang: Lang, timeZone = DEFAULT_TZ) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Short, non-identifying form of a UUID for dense tables. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "";
}
