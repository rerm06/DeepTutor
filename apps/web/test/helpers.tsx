import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createApiClient } from "../src/api/client";
import type { Persona } from "../src/api/types";
import { I18nProvider } from "../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../src/lib/roles";
import { SessionProvider } from "../src/session/SessionContext";

export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    map,
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function persona(role: string, id = `p-${role}`): Persona {
  return { id, org: "A", org_name: "Org Demo A", role, display_name: `Demo ${role}`, home: null };
}

/** Canned contract responses for a staff/member persona. */
export function fakeBackend(role: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me"))
      return json(200, {
        organization: { id: "o1", name: "Org Demo A", saas_plan: "pro" },
        person: { id: "x", email: "persona@demo.invalid" },
        role,
        location_ids: ["l1"],
      });
    if (url.endsWith("/locations"))
      return json(200, {
        data: [
          {
            id: "l1",
            name: "Sede Demo",
            brand_id: "b1",
            timezone: "America/Puerto_Rico",
            municipality: "Demo",
          },
        ],
      });
    if (url.includes("/members") && method === "GET")
      return json(200, {
        data: [
          {
            id: "m1",
            status: "active",
            member_no: 1,
            home_location_id: "l1",
            full_name: "Socio Demo Uno",
            email: "socio1@demo.invalid",
          },
        ],
      });
    return json(404, { error: "not_found" });
  };
}

export function renderAs(role: string, ui: ReactNode, path = "/") {
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: fakeBackend(role) as typeof fetch });
  return render(
    <I18nProvider lang="es">
      <SessionProvider api={api}>
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          {ui}
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}
