import { useSyncExternalStore } from "react";

/**
 * Install support for the member PWA. Chromium fires `beforeinstallprompt`; we keep the event so the "Descarga la
 * PWA" card can open the native install dialog. Safari (iOS) has no prompt: the card shows the manual steps.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

if (typeof window !== "undefined") {
  try {
    installed = window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    installed = false;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export type InstallState = "installed" | "prompt" | "manual";
function state(): InstallState {
  if (installed) return "installed";
  return deferred ? "prompt" : "manual";
}
export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    state,
    () => "manual" as const,
  );
}
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  emit();
  await ev.prompt();
  return (await ev.userChoice).outcome === "accepted";
}

/** Registers the service worker (production builds only; the dev server serves modules uncached). */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
