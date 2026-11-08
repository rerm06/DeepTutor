import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { EquipmentScreen } from "../../src/modules/floor/EquipmentScreen";
import { LiveScreen } from "../../src/modules/floor/LiveScreen";
import { MyCircuitsScreen } from "../../src/modules/floor/MyCircuitsScreen";
import { codeFromScan, stationUrl } from "../../src/modules/floor/api";
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

const useView = (done = 0) => ({
  use: {
    id: "u1",
    asset_id: "a1",
    station_code: "A1-BAR-01",
    equipment_type: "barbell",
    location_id: "l1",
    location_name: "Sede Demo",
    exercise_id: "e-squat",
    exercise_name: "Sentadilla con barra",
    circuit_run_id: "r1",
    started_at: "2026-11-08T15:00:00Z",
    ended_at: null,
  },
  routine: {
    run_id: "r1",
    circuit_id: "c1",
    circuit_name: "Circuito Fuerza Demo",
    location_id: "l1",
    started_at: "2026-11-08T14:55:00Z",
    finished_at: null,
    sets_done: done,
    sets_planned: 6,
    pct: Math.round((done / 6) * 100),
    steps: [
      {
        position: 1,
        exercise_id: "e-squat",
        exercise_name: "Sentadilla con barra",
        sets: 3,
        reps: 10,
        rest_seconds: 60,
        station_code: "A1-BAR-01",
        equipment_type: null,
        done,
      },
      {
        position: 2,
        exercise_id: "e-lp",
        exercise_name: "Prensa de piernas",
        sets: 3,
        reps: 12,
        rest_seconds: 60,
        station_code: null,
        equipment_type: "leg_press",
        done: 0,
      },
    ],
  },
});
const liveBoard = {
  at: "2026-11-08T15:05:00Z",
  totals: { stations: 2, in_use: 1, members_now: 1, uses_today: 5, down: 1 },
  assets: [
    {
      ...asset(),
      uses_today: 5,
      members_today: 3,
      minutes_today: 41,
      sets_today: 12,
      in_use: [
        {
          use_id: "u1",
          member_id: "m1",
          name: "Ana Rivera",
          since: "2026-11-08T15:00:00Z",
          last_activity_at: "2026-11-08T15:04:00Z",
          exercise_name: "Sentadilla con barra",
          circuit_name: "Circuito Fuerza Demo",
        },
      ],
    },
    {
      ...asset({
        id: "a2",
        station_code: "A1-LP-02",
        equipment_type: "leg_press",
        status: "out_of_service",
      }),
      uses_today: 0,
      members_today: 0,
      minutes_today: 0,
      sets_today: 0,
      in_use: [],
    },
  ],
  training: [
    {
      run_id: "r1",
      member_id: "m1",
      name: "Ana Rivera",
      circuit_name: "Circuito Fuerza Demo",
      started_at: "2026-11-08T14:55:00Z",
      sets_done: 2,
      sets_planned: 6,
      pct: 33,
      station_code: "A1-BAR-01",
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
    if (path === "/floor/stations/A1-BAR-01/use" && method === "POST") return json(201, useView());
    if (path === "/floor/stations/A1-LP-02/use") return json(409, { error: "asset_unavailable" });
    if (path.endsWith("/use") && method === "POST") return json(404, { error: "not_found" });
    if (path === "/floor/me/use") return json(200, useView(1));
    if (path === "/floor/uses/u1/end")
      return json(200, { id: "u1", ended_at: "2026-11-08T15:20:00Z" });
    if (path.startsWith("/floor/training"))
      return json(200, {
        member_id: "m1",
        open: { ...useView().routine },
        routines: [{ ...useView().routine }],
        uses: [
          {
            id: "u1",
            station_code: "A1-BAR-01",
            equipment_type: "barbell",
            exercise_name: "Sentadilla con barra",
            circuit_name: "Circuito Fuerza Demo",
            started_at: "2026-11-08T15:00:00Z",
            ended_at: null,
            active: true,
            minutes: 12,
          },
        ],
        by_equipment: [{ equipment_type: "barbell", uses: 4 }],
      });
    if (path.startsWith("/floor/live")) return json(200, liveBoard);
    if (path === "/floor/assets" && method === "POST")
      return json(201, {
        id: "n1",
        station_code: "BIC-01",
        created: [
          { id: "n1", station_code: "BIC-01" },
          { id: "n2", station_code: "BIC-02" },
          { id: "n3", station_code: "BIC-03" },
        ],
      });
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
  it("members get Mis circuitos and Escanear equipo; not the staff screens", async () => {
    renderFloor("member", <AppRoutes />, "/me/account");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Mis circuitos");
    expect(nav.textContent).toContain("Escanear equipo");
    expect(nav.textContent).not.toContain("Equipos");
    expect(nav.textContent).not.toContain("Uso en vivo");
  });

  it("owner and trainer get Uso en vivo; front desk does not", async () => {
    renderFloor("trainer", <AppRoutes />, "/staff/members");
    expect((await screen.findByRole("navigation")).textContent).toContain("Uso en vivo");
    cleanup();
    renderFloor("front_desk", <AppRoutes />, "/staff/members");
    expect((await screen.findByRole("navigation")).textContent).not.toContain("Uso en vivo");
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

describe("floor: scanned QR and station codes", () => {
  it("reads our label URL and bare codes, and ignores anything else", () => {
    expect(codeFromScan("https://gym-saas-f1.netlify.app/s/BAR-01")).toBe("BAR-01");
    expect(codeFromScan("https://x.example/s/a1-bar-01?utm=1")).toBe("A1-BAR-01");
    expect(codeFromScan(" lp-02 ")).toBe("LP-02");
    expect(codeFromScan("https://evil.example/login")).toBeNull();
    expect(codeFromScan("https://gym/door/d1.abc")).toBeNull();
    expect(stationUrl("BAR-01", "https://gym.example")).toBe("https://gym.example/s/BAR-01");
  });
});

describe("floor: member logs equipment use", () => {
  it("typing the code opens the station page: the use is logged and mapped to the routine", async () => {
    const calls = renderFloor("member", <AppRoutes />, "/me/station");
    const input = await screen.findByLabelText("O escribe el código");
    expect(input.getAttribute("data-tour-id")).toBe("floor-station-code");
    fireEvent.change(input, { target: { value: "  a1-bar-01 " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar uso" }));
    expect(await screen.findByRole("heading", { name: "Estación A1-BAR-01" })).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/floor/stations/A1-BAR-01/use"))?.body).toEqual({
      source: "code",
    });
    expect(screen.getByText(/Uso registrado desde/)).toBeTruthy();
    expect(screen.getByText("Tu rutina: Circuito Fuerza Demo")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "0 de 6 series · 0 %" })).toBeTruthy();
    expect(screen.getByText("En este equipo")).toBeTruthy();

    // A set from the station counts toward the routine (run id) and the station (asset id).
    fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Anotar serie" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/floor/sets"))?.body).toEqual(
        {
          exercise_id: "e-squat",
          location_id: "l1",
          asset_id: "a1",
          circuit_run_id: "r1",
          reps: 10,
          weight_kg: 60,
        },
      ),
    );
    expect(await screen.findByRole("progressbar", { name: "1 de 6 series · 17 %" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Terminé con este equipo" }));
    expect(await screen.findByText("Listo. Terminaste con A1-BAR-01.")).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith("/floor/uses/u1/end"))).toBe(true);
  });

  it("refuses malformed codes locally; unknown and out-of-service stations are explained", async () => {
    const calls = renderFloor("member", <AppRoutes />, "/me/station");
    const input = await screen.findByLabelText("O escribe el código");
    fireEvent.change(input, { target: { value: "<script>" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar uso" }));
    expect((await screen.findByRole("alert")).textContent).toContain("letras, números y guiones");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.url.includes("/floor/stations/"))).toBe(false);
    cleanup();
    renderFloor("member", <AppRoutes />, "/s/ZZ-404");
    expect((await screen.findByRole("alert")).textContent).toContain("No encontramos");
    cleanup();
    renderFloor("member", <AppRoutes />, "/s/A1-LP-02");
    expect((await screen.findByRole("alert")).textContent).toContain("no está disponible");
  });

  it("the member sees their own routine progress and recent equipment on the scan page", async () => {
    renderFloor("member", <AppRoutes />, "/me/station");
    expect(await screen.findByText("Mi entrenamiento")).toBeTruthy();
    expect(await screen.findByText(/Rutina en curso/)).toBeTruthy();
    expect(screen.getByText("12 min")).toBeTruthy();
  });

  it("staff opening a station link are pointed to the live board", async () => {
    renderFloor("owner", <AppRoutes />, "/s/A1-BAR-01");
    expect(await screen.findByRole("link", { name: "Ver uso en vivo" })).toBeTruthy();
  });
});

describe("floor: live board", () => {
  it("shows who is on each station now, today's totals and routine progress", async () => {
    const calls = renderFloor("owner", <LiveScreen />);
    expect(await screen.findByRole("heading", { name: "Uso de equipos en vivo" })).toBeTruthy();
    expect((await screen.findAllByText("Ana Rivera")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Hoy · usos: 5 · socios: 3 · 41 min · series: 12")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "2 de 6 series · 33 %" })).toBeTruthy();
    expect(screen.getByText("Fuera de servicio")).toBeTruthy();
    expect(screen.getByText(/Actualizado a las/)).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/floor/live"))).toBe(true);
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

  it("adding several units without a code: generated codes, then labels for just the new ones", async () => {
    const calls = renderFloor("owner", <EquipmentScreen />);
    await screen.findAllByText("A1-BAR-01", { selector: "th" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo equipo" }));
    fireEvent.change(screen.getByLabelText("Tipo de equipo"), { target: { value: "bike" } });
    fireEvent.change(screen.getByLabelText("Cantidad de unidades"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("3 equipos creados: BIC-01, BIC-02, BIC-03.")).toBeTruthy();
    const body = calls.find((c) => c.method === "POST" && c.url.endsWith("/floor/assets"))?.body;
    expect(body).toMatchObject({ equipment_type: "bike", quantity: 3 });
    expect(body).not.toHaveProperty("station_code");
    expect(await screen.findByRole("region", { name: "Códigos de estación" })).toBeTruthy();
  });

  it("a typed code creates a single unit", async () => {
    const calls = renderFloor("owner", <EquipmentScreen />);
    await screen.findAllByText("A1-BAR-01", { selector: "th" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo equipo" }));
    fireEvent.change(screen.getByLabelText(/Código de estación/), {
      target: { value: "rack-sur" },
    });
    expect((screen.getByLabelText("Cantidad de unidades") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "POST" && c.url.endsWith("/floor/assets"))?.body,
      ).toMatchObject({
        station_code: "RACK-SUR",
        quantity: 1,
      }),
    );
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
