import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { FunnelScreen } from "../../src/modules/crm/Funnel";
import { LeadDetailScreen } from "../../src/modules/crm/LeadDetail";
import { LeadsBoard } from "../../src/modules/crm/LeadsBoard";
import { TasksScreen } from "../../src/modules/crm/Tasks";
import { taskBucket } from "../../src/modules/crm/api";
import { dict } from "../../src/modules/crm/dict";
import { SessionProvider } from "../../src/session/SessionContext";
import { fakeBackend, json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const LEADS = [
  {
    id: "lead-1",
    location_id: "l1",
    source: "instagram",
    stage: "new",
    lost_reason: null,
    owner_staff_id: null,
    owner_name: null,
    full_name: "Valeria Demo",
    email: "valeria@demo.invalid",
    phone: null,
    notes: null,
    member_id: null,
    created_at: "2026-10-30T12:00:00Z",
    stage_changed_at: "2026-10-30T12:00:00Z",
  },
  {
    id: "lead-2",
    location_id: "l1",
    source: "web",
    stage: "trial",
    lost_reason: null,
    owner_staff_id: "s1",
    owner_name: "Marisol Demo",
    full_name: "Jorge Demo",
    email: null,
    phone: "+1 787 555 0100",
    notes: null,
    member_id: null,
    created_at: "2026-10-20T12:00:00Z",
    stage_changed_at: "2026-10-25T12:00:00Z",
  },
];

type Call = { method: string; url: string; body: unknown };

/** Core fake backend plus canned /crm responses; records every request. */
function backend(role: string, overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const core = fakeBackend(role);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    for (const [k, fn] of Object.entries(overrides)) if (url.includes(k)) return fn();
    if (url.includes("/crm/leads/lead-1/convert")) return json(201, { member_id: "m9" });
    if (url.includes("/crm/leads/lead-1") && method === "GET")
      return json(200, {
        ...LEADS[0],
        activities: [
          {
            id: "a1",
            kind: "stage_change",
            body: null,
            from_stage: "new",
            to_stage: "contacted",
            at: "2026-10-31T12:00:00Z",
            by_name: "Marisol Demo",
          },
          {
            id: "a2",
            kind: "call",
            body: "Demo: llamada",
            from_stage: null,
            to_stage: null,
            at: "2026-10-31T13:00:00Z",
            by_name: "Marisol Demo",
          },
        ],
      });
    if (url.includes("/crm/leads/") && method === "PATCH")
      return json(200, { id: "lead-1", stage: body.stage });
    if (url.includes("/crm/leads")) return json(200, { data: LEADS });
    if (url.includes("/crm/tasks") && method === "PATCH")
      return json(200, { id: "t1", status: body.status });
    if (url.includes("/crm/tasks"))
      return json(200, {
        data: [
          {
            id: "t1",
            location_id: "l1",
            title: "Demo: llamar a Valeria",
            due_at: "2020-01-01T12:00:00Z",
            status: "open",
            assigned_staff_id: "s5",
            assignee_name: "Ricardo Demo",
            lead_id: null,
            lead_name: null,
            member_id: "m1",
            member_name: "Socio Demo Uno",
          },
        ],
      });
    if (url.includes("/crm/staff"))
      return json(200, { data: [{ id: "s1", display_name: "Marisol Demo", role: "front_desk" }] });
    if (url.includes("/crm/funnel"))
      return json(200, {
        data: [
          {
            location_id: "l1",
            source: "web",
            total: 3,
            new: 1,
            contacted: 1,
            tour_booked: 0,
            trial: 0,
            won: 1,
            lost: 0,
            conversion_pct: 33.3,
          },
        ],
      });
    return core(input, init);
  };
  return { calls, fetchImpl };
}

function renderWith(role: string, ui: ReactNode, path = "/", overrides = {}) {
  const b = backend(role, overrides);
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: b.fetchImpl as typeof fetch });
  render(
    <I18nProvider lang="es">
      <SessionProvider api={api}>
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          {ui}
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return b;
}

describe("crm · leads board", () => {
  it("shows one column per stage and moves a lead with a keyboard-operable select + button", async () => {
    const b = renderWith("front_desk", <LeadsBoard />);
    await screen.findByText("Valeria Demo");
    for (const stage of ["Nuevo", "Contactado", "Tour agendado", "En prueba", "Ganado", "Perdido"])
      expect(screen.getByRole("heading", { level: 2, name: new RegExp(`^${stage}`) })).toBeTruthy();

    const card = screen.getByText("Valeria Demo").closest("article") as HTMLElement;
    const select = within(card).getByLabelText("Mover a etapa") as HTMLSelectElement;
    // 'won' is never offered: conversion is the only way in.
    expect([...select.options].map((o) => o.value)).not.toContain("won");
    expect(select.getAttribute("data-tour-id")).toBe("crm-lead-stage");
    const move = within(card).getByRole("button", { name: "Mover" });
    expect((move as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(select, { target: { value: "contacted" } });
    fireEvent.click(move);
    await waitFor(() => expect(b.calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = b.calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("/crm/leads/lead-1");
    expect(patch?.body).toEqual({ stage: "contacted" });
    await screen.findByText("Valeria Demo pasó a «Contactado».");
  });

  it("marking a lead as lost requires a reason, which is sent", async () => {
    const b = renderWith("front_desk", <LeadsBoard />);
    await screen.findByText("Jorge Demo");
    const card = screen.getByText("Jorge Demo").closest("article") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("Mover a etapa"), { target: { value: "lost" } });
    const move = within(card).getByRole("button", { name: "Mover" }) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText("Motivo de pérdida"), {
      target: { value: "Demo: precio" },
    });
    expect(move.disabled).toBe(false);
    fireEvent.click(move);
    await waitFor(() =>
      expect(b.calls.find((c) => c.method === "PATCH")?.body).toEqual({
        stage: "lost",
        lost_reason: "Demo: precio",
      }),
    );
  });

  it("the capture form says that a lead creates no messaging consent", async () => {
    renderWith("front_desk", <LeadsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo lead" }));
    const note = await screen.findByText(/NO crea consentimiento/);
    expect(note.getAttribute("data-tour-id")).toBe("crm-consent-note");
    expect(screen.getByLabelText(/Nombre completo/)).toBeTruthy();
    expect(screen.getByLabelText("Teléfono")).toBeTruthy();
  });
});

describe("crm · lead detail", () => {
  const detail = (
    <Routes>
      <Route path="/staff/crm/leads/:id" element={<LeadDetailScreen />} />
    </Routes>
  );

  it("shows the timeline, including the automatic stage change, and converts after confirmation", async () => {
    const b = renderWith("front_desk", detail, "/staff/crm/leads/lead-1");
    await screen.findByText("Cambio de etapa: Nuevo → Contactado");
    expect(screen.getByText("Demo: llamada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Convertir en socio" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar conversión de Valeria Demo" }));
    await screen.findByText("Valeria Demo ya es socio.");
    expect(b.calls.filter((c) => c.url.endsWith("/convert") && c.method === "POST")).toHaveLength(
      1,
    );
  });

  it("a second conversion (409) is explained, not hidden", async () => {
    renderWith("front_desk", detail, "/staff/crm/leads/lead-1", {
      "/convert": () => json(409, { error: "conflict" }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Convertir en socio" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar conversión de Valeria Demo" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ya fue convertido");
  });
});

describe("crm · tasks", () => {
  it("a trainer sees their tasks grouped (overdue first), asks only for their own, and can mark one done", async () => {
    const b = renderWith("trainer", <TasksScreen />);
    await screen.findByText("Demo: llamar a Valeria");
    expect(screen.getByRole("heading", { name: "Vencidas (1)" })).toBeTruthy();
    expect(b.calls.some((c) => c.url.includes("/crm/tasks?mine=true"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Nueva tarea" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marcar hecha: Demo: llamar a Valeria" }));
    await waitFor(() =>
      expect(b.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "done" }),
    );
  });

  it("buckets: closed, overdue, today and upcoming", () => {
    const now = new Date("2026-11-02T16:00:00Z"); // 12:00 in Puerto Rico
    expect(taskBucket({ status: "done", due_at: "2020-01-01T00:00:00Z" }, now)).toBe("closed");
    expect(taskBucket({ status: "open", due_at: "2026-11-02T15:00:00Z" }, now)).toBe("overdue");
    expect(taskBucket({ status: "open", due_at: "2026-11-02T22:00:00Z" }, now)).toBe("today");
    expect(taskBucket({ status: "open", due_at: "2026-11-03T05:00:00Z" }, now)).toBe("upcoming");
  });
});

describe("crm · funnel", () => {
  it("renders the table and text-labelled bars (not colour alone)", async () => {
    renderWith("owner", <FunnelScreen />);
    await screen.findByText("Sede Demo · Web: 33.3 % (1 de 3)");
    const table = screen.getByRole("table");
    expect(table.textContent).toContain("33.3 %");
    expect(within(table).getByRole("columnheader", { name: "Conversión" })).toBeTruthy();
  });
});

describe("crm · navigation and copy", () => {
  it("nav follows the database roles: trainer → Tareas only; owner → all; member → none", async () => {
    renderWith("trainer", <AppRoutes />, "/staff/members");
    let nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Tareas");
    expect(nav.textContent).not.toContain("Leads");
    expect(nav.textContent).not.toContain("Embudo");
    cleanup();
    renderWith("owner", <AppRoutes />, "/staff/members");
    nav = await screen.findByRole("navigation");
    for (const label of ["Leads", "Tareas", "Embudo"]) expect(nav.textContent).toContain(label);
    cleanup();
    renderWith("member", <AppRoutes />, "/me/account");
    nav = await screen.findByRole("navigation");
    for (const label of ["Leads", "Tareas", "Embudo"]) expect(nav.textContent).not.toContain(label);
  });

  it("a front desk cannot reach the funnel by URL", async () => {
    renderWith("front_desk", <AppRoutes />, "/staff/crm/funnel");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Socios"),
    );
  });

  it("ES and EN carry the same keys and never use the regulated nutrition titles", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    const all = [...Object.values(dict.es), ...Object.values(dict.en)].join(" ");
    expect(all).not.toMatch(/nutricionist|dietist|nutritionist|dietitian/i);
  });
});
