import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { module } from "../../src/modules/portal";
import { DocumentsScreen } from "../../src/modules/portal/DocumentsScreen";
import { NutritionScreen } from "../../src/modules/portal/NutritionScreen";
import { ProgramsScreen } from "../../src/modules/portal/ProgramsScreen";
import { ProgressScreen } from "../../src/modules/portal/ProgressScreen";
import { parseGoal } from "../../src/modules/portal/api";
import { dict } from "../../src/modules/portal/dict";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const WEEKS = Array.from({ length: 12 }, (_, i) => ({
  week_start: new Date(Date.UTC(2026, 7, 17 + 7 * i)).toISOString().slice(0, 10),
  trainings: i === 11 ? 3 : i % 4,
  classes_attended: i % 2,
  active_minutes: (i % 4) * 60,
}));

function backend(role: string, opts: { nutritionPlan?: boolean; goalStatus?: number } = {}) {
  const calls: Call[] = [];
  let goal = 5;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const path = url.replace(/^\/api\/v1/, "").split("?")[0] ?? "";
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/me")
      return json(200, {
        organization: { id: "o1", name: "Org Demo A", saas_plan: "pro" },
        person: { id: "p1", email: "persona@demo.invalid" },
        role,
        location_ids: [],
      });
    if (path === "/me/progress")
      return json(200, {
        member_id: "m1",
        goal,
        weeks: WEEKS,
        recent: [
          { at: "2026-11-02T10:00:00Z", kind: "class", label: "Spinning" },
          { at: "2026-11-01T21:00:00Z", kind: "check_in", label: "Sede San Juan" },
          { at: "2026-10-31T21:00:00Z", kind: "circuit", label: "Circuito Fuerza Total" },
        ],
      });
    if (path === "/me/goal" && method === "PUT") {
      if (opts.goalStatus) return json(opts.goalStatus, { error: "forbidden" });
      goal = (JSON.parse(String(init?.body)) as { weekly_trainings: number }).weekly_trainings;
      return json(200, { weekly_trainings: goal });
    }
    if (path === "/me/home")
      return json(200, {
        member: {
          id: "m1",
          first_name: "Ana",
          member_no: "A-0110",
          location_name: "Sede San Juan",
        },
        membership: {
          kind: "credits",
          name: "Paquete 10 sesiones",
          status: "active",
          renews_on: null,
          credits_left: 6,
          expires_on: "2027-02-10",
        },
        next_class: null,
        streak: { days: 12, last7: [true, true, true, true, true, true, true] },
        week: {
          goal: 5,
          trainings: 1,
          classes_booked: 3,
          classes_attended: 1,
          active_minutes: 45,
          pct: 20,
        },
        programs: [
          {
            id: "c1",
            kind: "circuit",
            name: "Circuito Fuerza Total",
            week: null,
            weeks: null,
            pct: 47,
            href: "/me/circuits",
          },
          {
            id: "p1",
            kind: "training_plan",
            name: "Plan de fuerza 8 semanas",
            week: 3,
            weeks: 8,
            pct: 29,
            href: "/me/health/plan",
          },
        ],
        challenge: null,
        coach: { enabled: false },
        documents: 4,
      });
    if (path === "/me/nutrition")
      return json(200, {
        member_id: "m1",
        plan: opts.nutritionPlan
          ? {
              id: "n1",
              title: "Plan alimentario base",
              body: {
                sections: [
                  { heading: "Estructura del día", items: ["Agua como bebida principal"] },
                ],
              },
              approver_name: "Valeria Quiñones",
              approver_license_no: "DEMO-N-0001",
              approved_at: "2026-10-04T12:00:00Z",
              published_at: "2026-10-04T12:00:00Z",
            }
          : null,
        appointment: null,
      });
    if (path === "/me/documents")
      return json(200, {
        member_id: "m1",
        agreements: [
          {
            id: "a1",
            kind: "terms",
            version: "v2026-11",
            locale: "es",
            source: "front_desk",
            accepted_at: "2026-10-01T12:00:00Z",
            title: "Términos de uso",
          },
          {
            id: "a2",
            kind: "waiver",
            version: "v2026-11",
            locale: "es",
            source: "front_desk",
            accepted_at: "2026-10-01T12:00:00Z",
            title: null,
          },
        ],
        consents: [
          {
            id: "c1",
            brand_id: "b1",
            brand_name: "Fitness Demo",
            channel: "sms",
            purpose: "reminder",
            status: "granted",
            since: "2026-10-01T12:00:00Z",
          },
        ],
        invoices: [
          {
            id: "i1",
            number: 6017,
            issued_on: "2026-10-13",
            total_cents: 14495,
            status: "paid",
            href: "/me/membership",
          },
        ],
      });
    return json(404, { error: "not_found" });
  };
  return { calls, fetchImpl };
}

function renderWith(
  role: string,
  ui: ReactNode,
  opts: Parameters<typeof backend>[1] = {},
  lang: "es" | "en" = "es",
) {
  const b = backend(role, opts);
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: b.fetchImpl as typeof fetch });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return b;
}

describe("module wiring", () => {
  it("four member routes and nav items; none for staff", () => {
    expect(module.routes.map((r) => r.path)).toEqual([
      "/me/progress",
      "/me/programs",
      "/me/nutrition",
      "/me/documents",
    ]);
    expect(module.nav.map((n) => n.label.es)).toEqual([
      "Progreso",
      "Mis Programas",
      "Nutrición",
      "Documentos",
    ]);
    expect(module.nav.map((n) => n.label.en)).toEqual([
      "Progress",
      "My Programs",
      "Nutrition",
      "Documents",
    ]);
    for (const n of module.nav) {
      expect(allows(n.audience, "member")).toBe(true);
      expect(allows(n.audience, "guardian")).toBe(true);
      for (const staff of ["owner", "front_desk", "trainer", "nutritionist", "chef", "accountant"])
        expect(allows(n.audience, staff), staff).toBe(false);
    }
  });

  it("ES and EN dictionaries carry the same keys and placeholders", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const [k, es] of Object.entries(dict.es))
      expect(ph(dict.en[k as keyof typeof dict.en]), k).toEqual(ph(es));
  });
});

describe("Progreso", () => {
  it("renders the 12-week chart (with its data table), recent activity and the goal editor", async () => {
    renderWith("member", <ProgressScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Progreso" })).toBeTruthy();
    expect(
      await screen.findByText(
        "Semana a semana, de la más antigua a la actual. Esta semana: 3 de 5 entrenamientos.",
      ),
    ).toBeTruthy();
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(screen.getByText("Spinning")).toBeTruthy();
    expect(screen.getByText("Circuito Fuerza Total")).toBeTruthy();
    expect(screen.getByLabelText("Entrenamientos por semana")).toBeTruthy();
    expect(document.querySelector('[data-tour-id="portal-goal-save"]')).toBeTruthy();
  });

  it("goal editor: rejects 0, 15, decimals and text without calling the API; saves a valid goal", async () => {
    const b = renderWith("member", <ProgressScreen />);
    const input = (await screen.findByLabelText("Entrenamientos por semana")) as HTMLInputElement;
    expect(input.value).toBe("5");
    const save = screen.getByRole("button", { name: "Guardar meta" });
    for (const bad of ["0", "15", "3.5", "abc", "", "-2"]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(save);
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText("Escribe un número entero del 1 al 14.")).toBeTruthy();
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
    expect(b.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.click(save);
    expect(await screen.findByText("Meta guardada: 6 entrenamientos por semana.")).toBeTruthy();
    expect(b.calls.filter((c) => c.method === "PUT")).toEqual([
      { method: "PUT", path: "/me/goal", body: { weekly_trainings: 6 } },
    ]);
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("shows the API refusal instead of a success message", async () => {
    renderWith("member", <ProgressScreen />, { goalStatus: 403 });
    const input = await screen.findByLabelText("Entrenamientos por semana");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar meta" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Meta guardada/)).toBeNull();
  });

  it("guardian: reads the goal, has no editor", async () => {
    renderWith("guardian", <ProgressScreen />);
    expect((await screen.findAllByText(/Meta semanal: 5/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/La meta la define la persona socia/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Entrenamientos por semana")).toBeNull());
    expect(screen.queryByRole("button", { name: "Guardar meta" })).toBeNull();
  });

  it("parseGoal mirrors the 1..14 rule", () => {
    expect(parseGoal("1")).toBe(1);
    expect(parseGoal(" 14 ")).toBe(14);
    for (const bad of ["0", "15", "1.0", "1e1", "", "x", "-1", "007"])
      expect(parseGoal(bad), bad).toBeNull();
  });
});

describe("Mis Programas", () => {
  it("lists programs with week, accessible progress bars and links to the existing member routes", async () => {
    renderWith("member", <ProgramsScreen />);
    expect(await screen.findByText("Plan de fuerza 8 semanas")).toBeTruthy();
    expect(screen.getByText("Semana 3 de 8")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Progreso de Circuito Fuerza Total" });
    expect(bar.getAttribute("value")).toBe("47");
    expect(
      screen.getByRole("link", { name: "Abrir Circuito Fuerza Total" }).getAttribute("href"),
    ).toBe("/me/circuits");
    expect(
      screen.getByRole("link", { name: "Abrir Plan de fuerza 8 semanas" }).getAttribute("href"),
    ).toBe("/me/health/plan");
  });
});

describe("Nutrición", () => {
  it("shows the approved plan with the licensed professional's name and licence", async () => {
    renderWith("member", <NutritionScreen />, { nutritionPlan: true });
    expect(await screen.findByRole("heading", { name: "Plan alimentario base" })).toBeTruthy();
    expect(screen.getByText(/Aprobado por Valeria Quiñones · Licencia DEMO-N-0001/)).toBeTruthy();
    expect(screen.getByText("Agua como bebida principal")).toBeTruthy();
  });

  it("empty state invites an appointment with the licensed specialist; never generated advice", async () => {
    renderWith("member", <NutritionScreen />);
    expect(
      await screen.findByRole("heading", { name: "Todavía no tienes un plan alimentario" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/especialista en nutrición con licencia después de una cita/),
    ).toBeTruthy();
    expect(screen.getByText(/no genera recomendaciones automáticas/)).toBeTruthy();
  });

  it("English copy", async () => {
    renderWith("member", <NutritionScreen />, {}, "en");
    expect(
      await screen.findByRole("heading", { name: "You don't have an eating plan yet" }),
    ).toBeTruthy();
  });
});

describe("Documentos", () => {
  it("lists agreements, consent status and invoices with a link to the receipt view", async () => {
    renderWith("member", <DocumentsScreen />);
    expect(await screen.findByText("Términos de uso")).toBeTruthy();
    expect(screen.getByText("Relevo de responsabilidad")).toBeTruthy(); // title missing → local label
    expect(screen.getByText("Recordatorios")).toBeTruthy();
    expect(screen.getByText("Autorizado")).toBeTruthy();
    expect(screen.getByText("Pagada")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver factura 6017" }).getAttribute("href")).toBe(
      "/me/membership",
    );
    expect(screen.getByRole("link", { name: "Cambiar mis permisos" }).getAttribute("href")).toBe(
      "/me/consents",
    );
    expect(screen.getByText(/144[.,]95/)).toBeTruthy();
  });
});
