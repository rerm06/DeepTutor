import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { Brand, BrandTheme } from "../api/types";
import { useApi, useSession } from "../session/SessionContext";
import { type Mode, setBrandMode, useMode } from "./themeMode";

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
/** Dark-mode accent pair: used instead of accent/accent_text while the console is dark. */
const DARK_KEYS = ["accent_dark", "accent_dark_text"] as const;

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
  if (theme.hero_url && SAFE_PATH.test(theme.hero_url)) out.hero_url = theme.hero_url;
  if (theme.promo_url && SAFE_PATH.test(theme.promo_url)) out.promo_url = theme.promo_url;
  if (theme.logo_alt) out.logo_alt = theme.logo_alt.slice(0, 80);
  if (theme.tagline_es) out.tagline_es = theme.tagline_es.slice(0, 120);
  if (theme.tagline_en) out.tagline_en = theme.tagline_en.slice(0, 120);
  if (theme.mode === "light" || theme.mode === "dark") out.mode = theme.mode;
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {}))
    if ((k in VARS || (DARK_KEYS as readonly string[]).includes(k)) && v && HEX.test(v)) raw[k] = v;
  const accentText = raw.accent_text ?? "#ffffff";
  const headerOk = raw.header_bg
    ? contrast(raw.header_bg, raw.header_text ?? "#15181d") >= 4.5
    : false;
  const keep = (k: string, v: string): boolean => {
    if (k === "accent" || k === "accent_hover") return contrast(v, accentText) >= 4.5;
    if (k === "header_bg" || k === "header_text") return headerOk;
    if (k === "accent_dark" || k === "accent_dark_text")
      return Boolean(
        raw.accent_dark &&
          raw.accent_dark_text &&
          contrast(raw.accent_dark, raw.accent_dark_text) >= 4.5 &&
          // the dark accent also draws focus rings and selected states on the dark surface (#171a1f)
          contrast(raw.accent_dark, "#171a1f") >= 3,
      );
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
  mode: Mode = "light",
): () => void {
  const set: string[] = [];
  const c = theme.colors ?? {};
  const put = (name: string, v: string) => {
    root.style.setProperty(name, v);
    set.push(name);
  };
  for (const [k, v] of Object.entries(c)) {
    const name = VARS[k];
    if (name && v) put(name, v);
  }
  // Dark console with a brand dark pair: the bright accent replaces the light-mode accent everywhere.
  const dark = mode === "dark" && c.accent_dark && c.accent_dark_text;
  if (dark && c.accent_dark && c.accent_dark_text) {
    put("--accent", c.accent_dark);
    put("--accent-hover", c.accent_dark);
    put("--accent-text", c.accent_dark_text);
    put("--accent-fg", c.accent_dark);
    put("--focus", c.accent_dark);
  } else if (c.accent) {
    put("--focus", c.accent);
  }
  root.dataset.branded = set.length ? "true" : "false";
  return () => {
    for (const name of set) root.style.removeProperty(name);
    root.removeAttribute("data-branded");
  };
}

/* The brand loaded by the shell, readable anywhere (home hero, agent card) without fetching it twice. */
let currentBrand: Brand | null = null;
const brandListeners = new Set<() => void>();
function publishBrand(b: Brand | null): void {
  currentBrand = b;
  for (const l of brandListeners) l();
}
export function useCurrentBrand(): Brand | null {
  return useSyncExternalStore(
    (cb) => {
      brandListeners.add(cb);
      return () => brandListeners.delete(cb);
    },
    () => currentBrand,
    () => null,
  );
}

/** Loads the signed-in organisation's first brand and applies its theme for the session's lifetime. */
export function useBrandTheme(): Brand | null {
  const api = useApi();
  const { persona } = useSession();
  const [brand, setBrand] = useState<Brand | null>(null);
  const mode = useMode();
  useEffect(() => {
    if (!persona) {
      setBrand(null);
      publishBrand(null);
      setBrandMode(undefined);
      return;
    }
    let cancelled = false;
    api
      .brands()
      .then((r) => {
        if (cancelled) return;
        const b = r.data[0];
        if (!b) return;
        const theme = sanitizeTheme(b.theme);
        setBrandMode(theme.mode);
        setBrand({ ...b, theme });
        publishBrand({ ...b, theme });
      })
      .catch(() => setBrand(null));
    return () => {
      cancelled = true;
    };
  }, [api, persona]);
  // Re-apply the CSS variables whenever the brand or the resolved colour mode changes (before paint: no flash).
  useLayoutEffect(() => {
    if (!brand) return;
    return applyTheme(brand.theme, document.documentElement, mode);
  }, [brand, mode]);
  return brand;
}
