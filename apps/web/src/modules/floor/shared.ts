import type { Tone } from "../../components/ui";
import type { AssetStatus } from "./api";

export function assetTone(status: AssetStatus | string | null | undefined): Tone {
  if (status === "ok") return "ok";
  if (status === "maintenance") return "warn";
  if (status === "out_of_service") return "blocked";
  return "neutral";
}

export function formatWhen(iso: string, lang: "es" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "es" ? "es-PR" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Puerto_Rico",
  });
}
