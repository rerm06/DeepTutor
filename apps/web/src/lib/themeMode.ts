import { useSyncExternalStore } from "react";

/**
 * Colour mode. Precedence: the person's explicit choice (stored on this device) → the brand's default mode
 * (tenant theme `mode`) → the operating system. The resolved mode is written to <html data-theme>, which the
 * stylesheet reads alongside `prefers-color-scheme`.
 */
export type Mode = "light" | "dark";
export type Pref = Mode | "system";

const KEY = "gym.theme";
let brandMode: Mode | undefined;
const listeners = new Set<() => void>();

function readPref(): Pref {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked (private mode, sandbox): fall back to brand/system.
  }
  return "system";
}

function systemMode(): Mode {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolvedMode(): Mode {
  const p = readPref();
  if (p !== "system") return p;
  return brandMode ?? systemMode();
}

function apply(): void {
  const root = document.documentElement;
  const p = readPref();
  const forced = p !== "system" ? p : brandMode;
  if (forced) root.dataset.theme = forced;
  else delete root.dataset.theme;
  for (const l of listeners) l();
}

export function setPref(p: Pref): void {
  try {
    if (p === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, p);
  } catch {
    // Not persisted; still applied for this page.
  }
  apply();
}

/** Called by the brand loader; `undefined` clears it (e.g. on persona switch). */
export function setBrandMode(m: Mode | undefined): void {
  if (m === brandMode) return;
  brandMode = m;
  apply();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  let mq: MediaQueryList | undefined;
  try {
    mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", cb);
  } catch {
    mq = undefined;
  }
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener("change", cb);
  };
}

export function useMode(): Mode {
  return useSyncExternalStore(subscribe, resolvedMode, () => "light");
}
