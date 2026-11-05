import type {
  AuditEntry,
  Brand,
  Consent,
  ConsentChange,
  DemoSession,
  InboxItem,
  ListOf,
  Location,
  Me,
  Member,
  MemberStatus,
  Message,
  NewMember,
  Persona,
  SendMessage,
  SendResult,
  Template,
} from "./types";

/** Error codes of the contract plus two client-side ones. Each maps to an i18n key `error.<code>`. */
export const ERROR_CODES = [
  "invalid_input",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "network",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_CODE: Record<number, ErrorCode> = {
  400: "invalid_input",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(`api_error:${status}:${code}`);
    this.name = "ApiError";
  }
}

export function toErrorCode(err: unknown): ErrorCode {
  return err instanceof ApiError ? err.code : "unknown";
}

interface StoredSession {
  token: string;
  persona: Persona;
  /** Rotating refresh token of a password / code sign-in (absent for demo personas). */
  refresh?: string;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Session storage, or null to keep the token in memory only. Defaults to window.sessionStorage. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

const STORAGE_KEY = "gym.demo.session";

function defaultStorage(): ApiClientOptions["storage"] {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readStored(storage: ApiClientOptions["storage"]): StoredSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token === "string" && parsed.persona && typeof parsed.persona.id === "string")
      return {
        token: parsed.token,
        persona: parsed.persona,
        ...(typeof parsed.refresh === "string" ? { refresh: parsed.refresh } : {}),
      };
  } catch {
    // Private mode, blocked storage or corrupt value: start with no session.
  }
  return null;
}

function writeStored(storage: ApiClientOptions["storage"], value: StoredSession | null): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(STORAGE_KEY, JSON.stringify(value));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is a convenience; the in-memory token keeps working.
  }
}

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Fetch wrapper for /api/v1. Adds the bearer token and JSON handling, maps errors to contract codes,
 * and applies the contract's 401 rule: on a 401 it requests a new demo session for the SAME persona
 * once, then retries the original call once. A second 401 (or a failed re-login) ends the session.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api/v1";
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  let session: StoredSession | null = readStored(storage);
  /** One shared re-login when several calls hit 401 at the same time. */
  let renewing: Promise<string> | null = null;
  const listeners = new Set<(persona: Persona | null) => void>();

  function setSession(next: StoredSession | null): void {
    session = next;
    writeStored(storage, next);
    for (const l of listeners) l(next?.persona ?? null);
  }

  async function send(method: string, path: string, body: unknown, token: string | null) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network");
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    let code: ErrorCode = STATUS_CODE[res.status] ?? "unknown";
    try {
      const payload = (await res.json()) as { error?: unknown };
      const c = payload?.error;
      if (typeof c === "string" && (ERROR_CODES as readonly string[]).includes(c))
        code = c as ErrorCode;
    } catch {
      // Body was not JSON; keep the status-derived code.
    }
    throw new ApiError(res.status, code);
  }

  async function startSession(personaId: string): Promise<DemoSession> {
    const res = await send("POST", "/demo/session", { persona_id: personaId }, null);
    const created = await parse<DemoSession>(res);
    setSession({ token: created.token, persona: created.persona });
    return created;
  }

  /** A signed-in person (password or code) renews with their refresh token; a demo persona re-logs in. */
  async function refreshSession(refresh: string): Promise<string> {
    const res = await send("POST", "/public/session/refresh", { refresh }, null);
    const r = await parse<{ session: { token: string; refresh: string; persona: Persona } }>(res);
    setSession({ token: r.session.token, persona: r.session.persona, refresh: r.session.refresh });
    return r.session.token;
  }

  function renew(personaId: string): Promise<string> {
    if (!renewing) {
      const refresh = session?.refresh;
      renewing = (
        refresh ? refreshSession(refresh) : startSession(personaId).then((s) => s.token)
      ).finally(() => {
        renewing = null;
      });
    }
    return renewing;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const usedToken = session?.token ?? null;
    const res = await send(method, path, body, usedToken);
    if (res.status !== 401 || !session) return parse<T>(res);

    const personaId = session.persona.id;
    let fresh: string;
    try {
      // Another call may already have renewed the token while this one was in flight.
      fresh = session.token !== usedToken ? session.token : await renew(personaId);
    } catch (err) {
      // A network failure keeps the session for a later try; any other failed re-login ends it.
      if (err instanceof ApiError && err.code === "network") throw err;
      setSession(null);
      throw new ApiError(401, "unauthenticated");
    }
    const retry = await send(method, path, body, fresh);
    // Still 401 after one renewal: the session is gone for good; subscribers send the user back.
    if (retry.status === 401) setSession(null);
    return parse<T>(retry);
  }

  return {
    get persona(): Persona | null {
      return session?.persona ?? null;
    },
    get hasSession(): boolean {
      return session !== null;
    },
    startSession,
    /** Notified whenever the session starts, renews or ends. Returns the unsubscribe function. */
    subscribe(listener: (persona: Persona | null) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    endSession(): void {
      setSession(null);
    },
    request,

    personas: () => request<ListOf<Persona>>("GET", "/demo/personas"),
    me: () => request<Me>("GET", "/me"),
    brands: () => request<ListOf<Brand>>("GET", "/brand"),
    locations: () => request<ListOf<Location>>("GET", "/locations"),
    auditLog: () => request<ListOf<AuditEntry>>("GET", "/audit-log"),
    members: (locationId?: string) =>
      request<ListOf<Member>>("GET", `/members${query({ location_id: locationId })}`),
    createMember: (m: NewMember) => request<{ id: string }>("POST", "/members", m),
    setMemberStatus: (id: string, status: MemberStatus) =>
      request<{ id: string; status: MemberStatus }>("PATCH", `/members/${encodeURIComponent(id)}`, {
        status,
      }),
    consents: (memberId: string) =>
      request<ListOf<Consent>>("GET", `/members/${encodeURIComponent(memberId)}/consents`),
    setConsent: (memberId: string, change: ConsentChange) =>
      request<{ id: string }>("PUT", `/members/${encodeURIComponent(memberId)}/consents`, change),
    optOut: (memberId: string, brandId: string, source: ConsentChange["source"]) =>
      request<{ revoked: number }>("POST", `/members/${encodeURIComponent(memberId)}/opt-out`, {
        brand_id: brandId,
        source,
      }),
    templates: () => request<ListOf<Template>>("GET", "/templates"),
    sendMessage: (m: SendMessage) => request<SendResult>("POST", "/messages", m),
    messages: (memberId: string) =>
      request<ListOf<Message>>("GET", `/messages${query({ member_id: memberId })}`),
    inbox: (locationId?: string) =>
      request<ListOf<InboxItem>>("GET", `/inbox${query({ location_id: locationId })}`),
  };
}
