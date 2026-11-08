import { useMemo } from "react";
import type { ApiClient } from "../../api/client";
import { useSession } from "../../session/SessionContext";
import { type JoinAccepted, joinEnv } from "../signup/api";

export interface DoorPass {
  result: "allowed" | "denied" | "already_in" | "checked_out" | "not_in" | "invalid" | "expired";
  reason: string | null;
  direction: "in" | "out" | null;
  location_id: string | null;
  location_name: string | null;
  member_id: string;
  full_name: string;
  at: string;
}
export interface KioskCode {
  direction: "in" | "out";
  token: string;
  expires_at: string;
}
export interface Inside {
  member_id: string;
  full_name: string;
  member_no: string | null;
  since: string;
  source: string;
}
export interface Activity {
  id: string;
  kind: "in" | "out";
  result: "allowed" | "denied";
  reason: string | null;
  source: string;
  at: string;
  member_id: string | null;
  full_name: string | null;
  member_no: string | null;
}
export interface FaceAccess {
  location_id: string;
  name: string;
  face_access: boolean;
}
export interface Device {
  id: string;
  location_id: string;
  name: string;
  direction: "in" | "out" | "both";
  requires_review: boolean;
  created_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
}
export interface FaceEvent {
  id: string;
  location_id: string;
  device_name: string;
  member_id: string;
  full_name: string;
  member_no: string | null;
  direction: "in" | "out";
  score: number;
  outcome: string;
  reason: string | null;
  at: string;
  reviewed_at: string | null;
}
export interface Consent {
  active: boolean;
  version: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  current_version: string;
  location_enabled: boolean;
}
interface List<T> {
  data: T[];
}

export function accessApi(api: ApiClient) {
  const r = api.request;
  return {
    pass: (token: string) => r<DoorPass>("POST", "/me/door", { token }),
    kiosk: (loc: string) =>
      r<List<KioskCode> & { server_time: string }>("GET", `/door/kiosk/${loc}`),
    inside: (loc: string) => r<List<Inside>>("GET", `/door/inside/${loc}`),
    activity: (loc: string) => r<List<Activity>>("GET", `/door/activity/${loc}`),
    checkOut: (location_id: string, member_id: string) =>
      r<{ id: string }>("POST", "/door/check-out", { location_id, member_id }),
    consent: () => r<Consent>("GET", "/me/biometric-consent"),
    setConsent: (grant: boolean) =>
      r<{ active: boolean }>("PUT", "/me/biometric-consent", { grant }),
    faceAccess: () => r<List<FaceAccess>>("GET", "/door/face-access"),
    setFaceAccess: (location_id: string, on: boolean) =>
      r<{ face_access: boolean }>("PUT", "/door/face-access", { location_id, on }),
    devices: (loc: string) => r<List<Device>>("GET", `/door/devices?location_id=${loc}`),
    createDevice: (
      location_id: string,
      name: string,
      direction: Device["direction"],
      requires_review: boolean,
    ) =>
      r<{ id: string; secret: string }>("POST", "/door/devices", {
        location_id,
        name,
        direction,
        requires_review,
      }),
    setDeviceReview: (id: string, requires_review: boolean) =>
      r<{ requires_review: boolean }>("PUT", `/door/devices/${id}/review`, { requires_review }),
    revokeDevice: (id: string) => r<{ revoked: boolean }>("DELETE", `/door/devices/${id}`),
    faceEvents: (loc: string) => r<List<FaceEvent>>("GET", `/door/face-events?location_id=${loc}`),
    review: (id: string, accept: boolean) =>
      r<{ result: string }>("POST", `/door/face-events/${id}/review`, { accept }),
  };
}
export type AccessApi = ReturnType<typeof accessApi>;
export function useAccessApi(): AccessApi {
  const { api } = useSession();
  return useMemo(() => accessApi(api), [api]);
}

/** The URL a door code encodes: any phone camera opens it; the app finishes the entry/exit. */
export function doorUrl(token: string, orgId?: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/door/${encodeURIComponent(token)}${orgId ? `?o=${encodeURIComponent(orgId)}` : ""}`;
}
/** Extract a door token from a scanned text (full URL or bare token). */
export function tokenFromScan(text: string): string | null {
  const m = text.trim().match(/(?:\/door\/)?(d1\.[0-9a-f-]{36}\.[io]\.[0-9]{1,12}\.[0-9a-f]{32})/i);
  return m?.[1] ?? null;
}

// ── Public sign-in by code (no session yet) ────────────────────────────────────────────────────────────────
type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
async function pub<T>(path: string, body: unknown): Promise<Res<T>> {
  let res: Response;
  try {
    res = await joinEnv.fetch(`${joinEnv.baseUrl}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.ok) return { ok: true, data: payload as T };
  const e = (payload as { error?: unknown } | null)?.error;
  return { ok: false, status: res.status, error: typeof e === "string" ? e : "unknown" };
}
export const loginStart = (org_id: string, email: string) =>
  pub<{ sent: boolean; expires_in: number; demo_code: string | null }>("/public/login/start", {
    org_id,
    email,
  });
export const loginVerify = (org_id: string, email: string, code: string) =>
  pub<{ session: NonNullable<JoinAccepted["session"]> }>("/public/login/verify", {
    org_id,
    email,
    code,
  });
