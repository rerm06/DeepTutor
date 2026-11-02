import { useEffect, useState } from "react";
import type { Brand, BrandTheme } from "../api/types";
import { useApi, useSession } from "../session/SessionContext";

const HEX = /^#[0-9a-f]{6}$/i;
const SAFE_PATH = /^\/brand\/[a-z0-9@._-]{1,80}$/;
/** CSS custom properties a brand may override. Anything else in the theme is ignored. */
const VARS: Record<string, string> = {
  accent: "--accent",
  accent_hover: "--accent-hover",
  accent_text: "--accent-text",
  header_bg: "--header-bg",
  header_text: "--header-text",
  highlight: "--brand-highlight",
};

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Keep only safe theme values: #RRGGBB colours, /brand/ asset paths, and accent/text pairs that pass WCAG AA
 * (4.5:1). A brand can never make the UI unreadable or load third-party assets.
 */
export function sanitizeTheme(theme: BrandTheme | null | undefined): BrandTheme {
  const out: BrandTheme = {};
  if (!theme) return out;
  if (theme.logo_url && SAFE_PATH.test(theme.logo_url)) out.logo_url = theme.logo_url;
  if (theme.icon_url && SAFE_PATH.test(theme.icon_url)) out.icon_url = theme.icon_url;
  if (theme.logo_alt) out.logo_alt = theme.logo_alt.slice(0, 80);
  if (theme.tagline_es) out.tagline_es = theme.tagline_es.slice(0, 120);
  if (theme.tagline_en) out.tagline_en = theme.tagline_en.slice(0, 120);
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {}))
    if (k in VARS && v && HEX.test(v)) raw[k] = v;
  const accentText = raw.accent_text ?? "#ffffff";
  const headerOk = raw.header_bg
    ? contrast(raw.header_bg, raw.header_text ?? "#15181d") >= 4.5
    : false;
  const keep = (k: string, v: string): boolean => {
    if (k === "accent" || k === "accent_hover") return contrast(v, accentText) >= 4.5;
    if (k === "header_bg" || k === "header_text") return headerOk;
    return true;
  };
  const colors = Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => keep(k, v)),
  ) as NonNullable<BrandTheme["colors"]>;
  if (Object.keys(colors).length) out.colors = colors;
  return out;
}

export function applyTheme(
  theme: BrandTheme,
  root: HTMLElement = document.documentElement,
): () => void {
  const set: string[] = [];
  for (const [k, v] of Object.entries(theme.colors ?? {})) {
    const name = VARS[k];
    if (name && v) {
      root.style.setProperty(name, v);
      set.push(name);
    }
  }
  if (theme.colors?.accent) {
    root.style.setProperty("--focus", theme.colors.accent);
    set.push("--focus");
  }
  root.dataset.branded = set.length ? "true" : "false";
  return () => {
    for (const name of set) root.style.removeProperty(name);
    root.removeAttribute("data-branded");
  };
}

/** Loads the signed-in organisation's first brand and applies its theme for the session's lifetime. */
export function useBrandTheme(): Brand | null {
  const api = useApi();
  const { persona } = useSession();
  const [brand, setBrand] = useState<Brand | null>(null);
  useEffect(() => {
    if (!persona) {
      setBrand(null);
      return;
    }
    let undo: (() => void) | undefined;
    let cancelled = false;
    api
      .brands()
      .then((r) => {
        if (cancelled) return;
        const b = r.data[0];
        if (!b) return;
        const theme = sanitizeTheme(b.theme);
        undo = applyTheme(theme);
        setBrand({ ...b, theme });
      })
      .catch(() => setBrand(null));
    return () => {
      cancelled = true;
      undo?.();
    };
  }, [api, persona]);
  return brand;
}
