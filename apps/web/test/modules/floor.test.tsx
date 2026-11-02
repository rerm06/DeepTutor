import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { EquipmentScreen } from "../../src/modules/floor/EquipmentScreen";
import { MyCircuitsScreen } from "../../src/modules/floor/MyCircuitsScreen";
import { StationScreen } from "../../src/modules/floor/StationScreen";
import { floorDict } from "../../src/modules/floor/dict";
import { SessionProvider } from "../../src/session/SessionContext";
import { fakeBackend, json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const asset = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  location_id: "l1",
  equipment_type: "barbell",
  brand: "Demo Equipos",
  model: null,
  station_code: "A1-BAR-01",
  status: "ok",
  notes: null,
  open_issues: 1,
  ...over,
});
const circuitDetail = {
  id: "c1",
  location_id: "l1",
  name: "Circuito Fuerza Demo",
  active: true,
  steps: [
    {
      id: "s1",
      position: 1,
      exercise_id: "e-squat",
      exercise_name: "Sentadilla con barra",
      movement_pattern: "squat",
      cues: "Pies al ancho de hombros.",
      asset_id: "a1",
      station_code: "A1-BAR-01",
      asset_status: "ok",
      equipment_type: "barbell",
      sets: 3,
      reps: 10,
      rest_seconds: 60,
    },
  ],
};

/** Canned floor endpoints on top of the shared core fake; records every request. */
function floorBackend(role: string, calls: Call[]) {
  const core = fakeBackend(role);
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = url.replace(/^.*\/api\/v1/, "");
    if (path.startsWith("/floor/stations/A1-BAR-01"))
      return json(200, {
        asset: { ...asset(), location_name: "Sede Demo" },
        exercises: [
          {
            id: "e-squat",
            name: "Sentadilla con barra",
            movement_pattern: "squat",
            equipment_type: "barbell",
            cues: "Pies al ancho de hombros.\nPecho arriba.",
          },
        ],
        circuit_steps: [{ circuit_id: "c1", circuit_name: "Circuito Fuerza Demo", position: 1 }],
      });
    if (path.startsWith("/floor/stations/")) return json(404, { error: "not_found" });
    if (path.startsWith("/floor/assets") && method === "GET") return json(200, { data: [asset()] });
    if (path.startsWith("/floor/issues") && method === "GET")
      return json(200, {
        data: [
          {
            id: "i1",
            asset_id: "a1",
            station_code: "A1-BAR-01",
            equipment_type: "barbell",
            asset_status: "ok",
            location_id: "l1",
            kind: "out_of_service",
            status: "reported",
            note: "Demo: ruido",
            reported_at: "2026-11-02T14:00:00Z",
            mine: false,
          },
        ],
      });
    if (path === "/floor/issues/i1/confirm")
      return json(200, { id: "i1", status: "confirmed", asset_status: "out_of_service" });
    if (path === "/floor/circuits" && method === "GET")
      return json(200, {
        data: [
          { id: "c1", location_id: "l1", name: "Circuito Fuerza Demo", active: true, steps: 1 },
        ],
      });
    if (path === "/floor/circuits/c1") return json(200, circuitDetail);
    if (path === "/floor/circuits/c1/runs") return json(201, { id: "r1" });
    if (path === "/floor/assets/a1/issues") return json(201, { id: "i9" });
    if (path.startsWith("/floor/substitutes"))
      return json(200, {
        data: [
          {
            exercise_id: "e-lp",
            name: "Prensa de piernas",
            movement_pattern: "squat",
            equipment_type: "leg_press",
            cues: "Espalda apoyada.",
            asset_id: "a-lp",
            station_code: "A1-LP-01",
            same_exercise: false,
          },
        ],
      });
    if (path === "/floor/sets" && method === "POST") return json(201, { id: "set1" });
    if (path.startsWith("/floor/sets")) return json(200, { data: [] });
    return core(input, init);
  };
}

function renderFloor(role: string, ui: ReactNode, path = "/", lang: "es" | "en" = "es") {
  const calls: Call[] = [];
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: floorBackend(role, calls) as typeof fetch });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          {ui}
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return calls;
}

describe("floor: dictionary", () => {
  it("has the same keys and placeholders in ES and EN, and no regulated titles", () => {
    expect(Object.keys(floorDict.en).sort()).toEqual(Object.keys(floorDict.es).sort());
    const forbidden = new RegExp(`${"nutri"}${"cionista"}|${"diet"}${"ista"}`, "i");
    for (const [k, es] of Object.entries(floorDict.es)) {
      const en = floorDict.en[k as keyof typeof floorDict.en];
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(en), k).toEqual(ph(es));
      expect(es.trim() && en.trim(), k).toBeTruthy();
      expect(`${es} ${en}`).not.toMatch(forbidden);
    }
  });
});

describe("floor: navigation by role", () => {
  it("members get Mis circuitos and Escanear estación; not the staff screens", async () => {
    renderFloor("member", <AppRoutes />, "/me/account");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Mis circuitos");
    expect(nav.textContent).toContain("Escanear estación");
    expect(nav.textContent).not.toContain("Equipos");
  });

  it("front desk sees Equipos but not the library or circuit builder; chef sees none", async () => {
    renderFloor("front_desk", <AppRoutes />, "/staff/members");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Equipos");
    expect(nav.textContent).not.toContain("Circuitos");
    expect(nav.textContent).not.toContain("Ejercicios");
    cleanup();
    renderFloor("chef", <AppRoutes />, "/staff/members");
    const chefNav = await screen.findByRole("navigation");
    expect(chefNav.textContent).not.toContain("Equipos");
  });
});

describe("floor: member station lookup", () => {
  it("normalises the typed code and shows the exercise card with cues", async () => {
    const calls = renderFloor("member", <StationScreen />);
    const input = screen.getByLabelText("Código de estación");
    expect(input.getAttribute("data-tour-id")).toBe("floor-station-code");
    fireEvent.change(input, { target: { value: "  a1-bar-01 " } });
    fireEvent.click(screen.getByRole("button", { name: "Ver ejercicios" }));
    expect(await screen.findByText("Sentadilla con barra")).toBeTruthy();
    expect(screen.getByText(/Pecho arriba/)).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/floor/stations/A1-BAR-01"))).toBe(true);
  });

  it("refuses malformed codes without calling the server and explains not-found", async () => {
    const calls = renderFloor("member", <StationScreen />);
    const input = screen.getByLabelText("Código de estación");
    fireEvent.change(input, { target: { value: "<script>" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver ejercicios" }));
    expect((await screen.findByRole("alert")).textContent).toContain("letras, números y guiones");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.url.includes("/floor/stations/"))).toBe(false);
    fireEvent.change(input, { target: { value: "ZZ-404" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver ejercicios" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No encontramos");
  });
});

describe("floor: member runs a circuit", () => {
  it("busy machine → reports busy, offers substitutes, and logs the set on the substitute", async () => {
    const calls = renderFloor("member", <MyCircuitsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Empezar/ }));
    expect(await screen.findByText("Paso 1 de 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Máquina ocupada" }));
    const use = await screen.findByRole("button", { name: "Usar Prensa de piernas" });
    const report = calls.find((c) => c.url.endsWith("/floor/assets/a1/issues"));
    expect(report?.body).toEqual({ kind: "busy" });
    expect(calls.some((c) => c.url.includes("exclude_asset_id=a1"))).toBe(true);
    fireEvent.click(use);
    expect(await screen.findByText(/Usando alternativa: Prensa de piernas/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value: "80,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar serie" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/floor/sets"))?.body).toEqual(
        {
          exercise_id: "e-lp",
          location_id: "l1",
          asset_id: "a-lp",
          circuit_run_id: "r1",
          reps: 10,
          weight_kg: 80.5,
        },
      ),
    );
    expect(document.querySelector('[data-tour-id="floor-run-oos"]')).not.toBeNull();
  });

  it("renders in English", async () => {
    renderFloor("member", <MyCircuitsScreen />, "/", "en");
    expect(await screen.findByRole("heading", { level: 1, name: "My circuits" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Start/ })).toBeTruthy();
  });
});

describe("floor: staff equipment screen", () => {
  it("front desk confirms an issue but cannot change status or add equipment", async () => {
    const calls = renderFloor("front_desk", <EquipmentScreen />);
    const confirm = await screen.findByRole("button", { name: /Confirmar fuera de servicio/ });
    expect(confirm.getAttribute("data-tour-id")).toBe("floor-issue-confirm");
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).toBeNull();
    expect(document.querySelector('[data-tour-id="floor-asset-status"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Resolver/ })).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/floor/issues/i1/confirm"))).toBe(true),
    );
    expect(await screen.findByText(/A1-BAR-01 quedó fuera de servicio/)).toBeTruthy();
  });

  it("a trainer gets the status control, the new-equipment form and the printable list", async () => {
    renderFloor("trainer", <EquipmentScreen />);
    await screen.findAllByText("A1-BAR-01", { selector: "th" });
    expect(screen.getByRole("button", { name: "Nuevo equipo" }).getAttribute("data-tour-id")).toBe(
      "floor-asset-new",
    );
    const status = screen.getByLabelText("Estado de A1-BAR-01") as HTMLSelectElement;
    expect(status.value).toBe("ok");
    fireEvent.click(screen.getByRole("button", { name: "Lista imprimible de códigos" }));
    expect(await screen.findByRole("region", { name: "Códigos de estación" })).toBeTruthy();
    expect(await screen.findByAltText("Código QR de la estación A1-BAR-01")).toBeTruthy();
  });
});
