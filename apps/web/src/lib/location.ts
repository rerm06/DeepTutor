import { useSyncExternalStore } from "react";

/**
 * The location picked in the top bar ("" = all my locations). Kept per browser tab session and per organisation;
 * screens still pass it through the API, where RLS decides what the caller may see, so a stale or forged id can
 * only narrow results, never widen them.
 */
const KEY = "gym.location";
let current = "";
let scope = "";
const listeners = new Set<() => void>();

function storageKey(): string {
  return `${KEY}:${scope}`;
}

export function setLocationScope(orgId: string | undefined): void {
  const next = orgId ?? "";
  if (next === scope) return;
  scope = next;
  try {
    current = window.sessionStorage.getItem(storageKey()) ?? "";
  } catch {
    current = "";
  }
  for (const l of listeners) l();
}

export function setLocation(id: string): void {
  current = id;
  try {
    if (id) window.sessionStorage.setItem(storageKey(), id);
    else window.sessionStorage.removeItem(storageKey());
  } catch {
    // Not persisted; still applied.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLocationId(): string {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "",
  );
}
