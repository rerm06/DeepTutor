import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../src/api/client";
import { json, memoryStorage, persona } from "./helpers";

function authOf(init?: RequestInit): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

function setup(responses: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return next(url, init);
  });
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "old", persona: persona("front_desk", "per-1") }),
  });
  const api = createApiClient({ fetchImpl: fetchImpl as typeof fetch, storage });
  return { api, calls, storage };
}

const session = (token: string) => () =>
  json(200, { token, expires_in: 900, persona: persona("front_desk", "per-1") });

describe("api client · 401 rule", () => {
  it("renews the session for the same persona once, then retries with the new token", async () => {
    const { api, calls, storage } = setup([
      () => json(401, { error: "unauthenticated" }),
      session("new"),
      () => json(200, { data: [] }),
    ]);

    await expect(api.members()).resolves.toEqual({ data: [] });

    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/members",
      "/api/v1/demo/session",
      "/api/v1/members",
    ]);
    expect(authOf(calls[0]?.init)).toBe("Bearer old");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ persona_id: "per-1" });
    expect(authOf(calls[1]?.init)).toBeUndefined();
    expect(authOf(calls[2]?.init)).toBe("Bearer new");
    expect(storage.map.get("gym.demo.session")).toContain('"token":"new"');
  });

  it("does not loop: a second 401 ends the session and surfaces unauthenticated", async () => {
    const { api, calls } = setup([
      () => json(401, { error: "unauthenticated" }),
      session("new"),
      () => json(401, { error: "unauthenticated" }),
    ]);
    const lost = vi.fn();
    api.subscribe(lost);

    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("unauthenticated");
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith("/demo/session"))).toHaveLength(1);
    expect(api.hasSession).toBe(false);
    expect(lost).toHaveBeenLastCalledWith(null);
  });

  it("ends the session when the renewal itself fails", async () => {
    const { api, calls } = setup([
      () => json(401, { error: "unauthenticated" }),
      () => json(404, { error: "not_found" }),
    ]);
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(calls).toHaveLength(2);
    expect(api.hasSession).toBe(false);
  });

  it("shares one renewal between concurrent 401s", async () => {
    const { api, calls } = setup([
      () => json(401, { error: "unauthenticated" }),
      () => json(401, { error: "unauthenticated" }),
      session("new"),
      () => json(200, { data: ["a"] }),
      () => json(200, { data: ["b"] }),
    ]);
    const [a, b] = await Promise.all([api.locations(), api.templates()]);
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/demo/session"))).toHaveLength(1);
    expect(calls.slice(3).every((c) => authOf(c.init) === "Bearer new")).toBe(true);
  });

  it("does not try to renew without a persona", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "unauthenticated" }));
    const api = createApiClient({ fetchImpl: fetchImpl as typeof fetch, storage: null });
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("api client · errors and storage", () => {
  it("maps contract error codes", async () => {
    const { api } = setup([() => json(403, { error: "forbidden" })]);
    await expect(api.auditLog()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("maps a network failure", async () => {
    const api = createApiClient({
      fetchImpl: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
      storage: null,
    });
    await expect(api.personas()).rejects.toMatchObject({ code: "network" });
  });

  it("keeps working in memory when storage throws", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/demo/session")
        ? json(200, { token: "t1", expires_in: 900, persona: persona("owner") })
        : json(200, { auth: authOf(init) }),
    );
    const api = createApiClient({ fetchImpl: fetchImpl as typeof fetch, storage: broken });
    await api.startSession("p-owner");
    await expect(api.request("GET", "/me")).resolves.toEqual({ auth: "Bearer t1" });
  });

  it("sends JSON bodies and only the query params that are set", async () => {
    const { api, calls } = setup([() => json(200, { data: [] }), () => json(201, { id: "n" })]);
    await api.members();
    await api.createMember({ email: "a@demo.invalid", full_name: "Demo", home_location_id: "l1" });
    expect(calls[0]?.url).toBe("/api/v1/members");
    expect(calls[1]?.init?.method).toBe("POST");
    expect((calls[1]?.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });
});
