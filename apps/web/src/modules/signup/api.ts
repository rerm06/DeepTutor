import type { ApiClient } from "../../api/client";
import type { BrandTheme, ListOf, Persona } from "../../api/types";

/** Public page payload (GET /v1/public/join/:orgId). */
export interface JoinInfo {
  org_id: string;
  org_name: string;
  brand: { id: string; name: string; theme: BrandTheme };
  locations: Array<{ id: string; name: string; municipality: string | null; brand_id: string }>;
  agreements: Array<{
    kind: string;
    version: string;
    locale: "es" | "en";
    title: string;
    body: string;
  }>;
  model: { pay_per_session: boolean; session_from_cents: number | null };
}

export interface JoinRequest {
  org_id: string;
  location_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  birth_date: string;
  terms_version: string;
  waiver_version: string;
  accept_terms: boolean;
  accept_waiver: boolean;
  sms_reminders: boolean;
  sms_marketing: boolean;
  locale: "es" | "en";
}

export interface JoinAccepted {
  session: { token: string; expires_in: number; persona: Persona } | null;
  message: string | null;
}

/** Outcome of a public call: data, or an error code from the API (or "network"). */
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Seams the public screen uses; tests replace them. */
export const joinEnv = {
  baseUrl: "/api/v1",
  fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, init),
  storage: (): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  },
  /** Full navigation, so the app's API client starts again and picks up the stored session. */
  go: (url: string): void => {
    window.location.assign(url);
  },
};

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await joinEnv.fetch(`${joinEnv.baseUrl}${path}`, {
      method,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Not JSON: keep the status.
  }
  if (res.ok) return { ok: true, data: payload as T };
  const code = (payload as { error?: unknown } | null)?.error;
  return { ok: false, status: res.status, error: typeof code === "string" ? code : "unknown" };
}

export const fetchJoinInfo = (orgId: string) =>
  call<JoinInfo>("GET", `/public/join/${encodeURIComponent(orgId)}`);
export const submitJoin = (req: JoinRequest) => call<JoinAccepted>("POST", "/public/join", req);

/** Must match STORAGE_KEY in api/client.ts: the app reads the session from here when it starts. */
export const SESSION_KEY = "gym.demo.session";
/** One-time welcome note shown on /me/account after an online sign-up. */
export const WELCOME_KEY = "gym.join.welcome";
export interface Welcome {
  name: string;
  brand: string;
  location: string;
}

/** Hand the new session to the app and open the member portal. */
export function adoptSession(s: NonNullable<JoinAccepted["session"]>, welcome: Welcome): void {
  const store = joinEnv.storage();
  try {
    store?.setItem(SESSION_KEY, JSON.stringify({ token: s.token, persona: s.persona }));
    store?.setItem(WELCOME_KEY, JSON.stringify(welcome));
  } catch {
    // Storage blocked: the visitor lands on the start screen and can sign in at the location.
  }
  joinEnv.go("/me/account");
}

// ── Signed-in calls (staff switch, agreements) through the app's API client ─────────────────────────────────
export interface JoinLocation {
  id: string;
  name: string;
  municipality: string | null;
  enabled: boolean;
  updated_at: string | null;
}
export interface Agreement {
  id: string;
  kind: string;
  version: string;
  locale: string;
  source: string;
  accepted_at: string;
}
export const joinLocations = (api: ApiClient) =>
  api.request<ListOf<JoinLocation>>("GET", "/signup/locations");
export const setJoinLocation = (api: ApiClient, id: string, enabled: boolean) =>
  api.request<{ id: string; enabled: boolean }>(
    "PUT",
    `/signup/locations/${encodeURIComponent(id)}`,
    {
      enabled,
    },
  );
export const memberAgreements = (api: ApiClient, memberId: string) =>
  api.request<ListOf<Agreement>>("GET", `/members/${encodeURIComponent(memberId)}/agreements`);
