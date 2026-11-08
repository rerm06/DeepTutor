import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { PanelScreen } from "../../src/modules/reports/Panel";
import { IvuReportScreen } from "../../src/modules/reports/Reports";
import { TodayScreen } from "../../src/modules/reports/Today";
import { heatLevel, previousMonth } from "../../src/modules/reports/api";
import { dict } from "../../src/modules/reports/dict";
import { module } from "../../src/modules/reports/index";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { fakeBackend, json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const DASHBOARD = {
  location_id: null,
  generated_at: "2026-11-02T15:00:00Z",
  members_active: 412,
  members_new_month: 9,
  members_cancelled_month: 2,
  check_ins_today: 57,
  check_ins_members_today: 55,
  check_ins_week: 230,
  classes_week: 14,
  class_seats_week: 200,
  class_booked_week: 150,
  class_occupancy_pct: 75,
  invoices_today: 6,
  invoiced_today_cents: 12345,
  sessions_sold_today: 8,
  collected_today_cents: 9900,
  store_sales_today: 3,
  store_sales_today_cents: 4500,
  overdue_invoices: 2,
  overdue_members: 2,
  overdue_balance_cents: 3346,
  expiring_credits_7d: 1,
  expiring_passes_7d: 0,
  expiring_memberships_7d: 1,
  leads_open: 7,
  leads_new_month: 4,
  leads_won_month: 1,
  lead_conversion_pct_month: 25,
  low_stock_products: 3,
  points_liability: 1200,
  points_members_with_balance: 30,
};
const HEAT = Array.from({ length: 7 * 24 }, (_, i) => ({
  dow: Math.floor(i / 24) + 1,
  hour: i % 24,
  check_ins: Math.floor(i / 24) === 1 && i % 24 === 6 ? 12 : i % 24 === 18 ? 3 : 0,
}));
const OVERDUE = [
  {
    invoice_id: "i1",
    number: 101,
    member_id: "m1",
    full_name: "Socio Demo Uno",
    member_no: "1",
    location_id: "l1",
    location_name: "Sede Demo",
    due_date: "2026-10-28",
    days_overdue: 5,
    balance_cents: 1673,
  },
];

type Call = { method: string; url: string; body: unknown };
function backend(role: string) {
  const calls: Call[] = [];
  const core = fakeBackend(role);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.includes("/reports/dashboard")) return json(200, DASHBOARD);
    if (url.includes("/reports/heatmap.csv"))
      return json(200, { filename: "horas-pico-4s.csv", csv: "dia,hora\r\n" });
    if (url.includes("/reports/heatmap")) return json(200, { weeks: 4, data: HEAT });
    if (url.includes("/reports/overdue")) return json(200, { data: OVERDUE });
    if (url.includes("/reports/expiring")) return json(200, { data: [] });
    if (url.includes("/reports/today"))
      return json(200, {
        check_ins_today: 21,
        check_ins_members_today: 20,
        check_ins_denied_today: 1,
        overdue_members: 1,
        overdue_invoices: 1,
        classes_today: [
          {
            session_id: "s1",
            location_id: "l1",
            class_name: "Demo Spinning",
            room: "Salon 1",
            starts_at: "2026-11-02T22:00:00Z",
            ends_at: "2026-11-02T22:45:00Z",
            capacity: 12,
            booked: 9,
            waitlisted: 2,
          },
        ],
      });
    if (url.includes("/reports/ivu.csv"))
      return json(200, { filename: "ivu-2026-10.csv", csv: "﻿municipio\r\n" });
    if (url.includes("/reports/ivu-municipalities") && method === "PUT")
      return json(200, {
        id: "x",
        municipality: body.municipality,
        suri_status: body.suri_status,
        note: null,
      });
    if (url.includes("/reports/ivu-municipalities")) return json(200, { data: [] });
    if (url.includes("/reports/ivu"))
      return json(200, {
        month: "2026-10",
        data: [
          {
            municipality: "San Juan",
            suri_status: "participant",
            source: "billing",
            documents: 2,
            taxable_base_cents: 4495,
            exempt_base_cents: 2500,
            ivu_state_cents: 472,
            ivu_municipal_cents: 45,
          },
          {
            municipality: "Bayamón",
            suri_status: "unverified",
            source: "store",
            documents: 1,
            taxable_base_cents: 2500,
            exempt_base_cents: 0,
            ivu_state_cents: 263,
            ivu_municipal_cents: 25,
          },
        ],
      });
    if (url.includes("/schedule/check-ins") && method === "POST")
      return json(201, {
        id: "c1",
        result: "allowed",
        reason: "active",
        member_id: body.member_id,
        full_name: "Socio Demo Uno",
      });
    return core(input, init);
  };
  return { calls, fetchImpl };
}

function renderWith(role: string, ui: ReactNode, lang: "es" | "en" = "es") {
  const b = backend(role);
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

describe("reports · Panel", () => {
  it("renders KPI rows in plain HTML with formatted numbers and links", async () => {
    renderWith("owner", <PanelScreen />);
    // The home greeting is the page heading (client design); the detailed KPI groups follow below.
    expect(await screen.findByRole("heading", { level: 1, name: /^Hola, / })).toBeTruthy();
    await screen.findAllByText("Socios activos");
    const box = (await screen.findAllByText("Socios activos"))
      .map((el) => el.closest(".rpt-kpi"))
      .find(Boolean) as HTMLElement;
    expect(within(box).getByText("412")).toBeTruthy();
    expect(screen.getByText("Saldo vencido")).toBeTruthy();
    expect(screen.getByText(/\$33\.46/)).toBeTruthy();
    expect(screen.getByText("75 %")).toBeTruthy();
    expect(screen.getByText("Pasivo de puntos")).toBeTruthy();
    expect(document.querySelector('[data-tour-id="rpt-kpis"]')).toBeTruthy();
  });

  it("heatmap is an accessible table: caption, day row headers, a number in every cell, legend", async () => {
    renderWith("owner", <PanelScreen />);
    const table = (await screen.findByRole("table", {
      name: /Check-ins por día de la semana/,
    })) as HTMLTableElement;
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(8); // header + 7 days
    expect(within(table).getByRole("rowheader", { name: "Martes" })).toBeTruthy();
    const cells = table.querySelectorAll("td.rpt-heat__cell");
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.textContent).toMatch(/^\d+$/); // never colour alone
    const peakCell = [...cells].find((c) => c.textContent === "12") as HTMLElement;
    expect(peakCell.className).toContain("rpt-heat--4");
    expect(screen.getByText("Hora pico: Martes de 06:00 a 07:00 (12 check-ins).")).toBeTruthy();
    expect(screen.getByText("Escala de color:")).toBeTruthy();
    expect(screen.getByText("Pico")).toBeTruthy();
  });

  it("switching to 8 weeks asks the server for weeks=8", async () => {
    const b = renderWith("owner", <PanelScreen />);
    const eight = (await screen.findByLabelText("Últimas 8 semanas")) as HTMLInputElement;
    fireEvent.click(eight);
    await waitFor(() =>
      expect(b.calls.some((c) => c.url.includes("/reports/heatmap?weeks=8"))).toBe(true),
    );
  });

  it("quick check-in: find a member and check in with one tap", async () => {
    const b = renderWith("owner", <PanelScreen />);
    const search = await screen.findByLabelText("Buscar socio");
    expect(search.getAttribute("data-tour-id")).toBe("rpt-quick-checkin");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "socio demo" } });
    const enter = await screen.findByRole("button", {
      name: "Registrar entrada de Socio Demo Uno",
    });
    fireEvent.click(enter);
    await screen.findByText("Entrada permitida: Socio Demo Uno.");
    const post = b.calls.find((c) => c.method === "POST");
    expect(post?.url).toContain("/schedule/check-ins");
    expect(post?.body).toEqual({ location_id: "l1", member_id: "m1" });
    expect(screen.getByRole("link", { name: "Nuevo socio" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pase diario" })).toBeTruthy();
  });

  it("CSV export goes through the audited endpoint", async () => {
    const b = renderWith("owner", <PanelScreen />);
    const btn = (await screen.findAllByRole("button", { name: "Descargar CSV" })).find(
      (x) => x.getAttribute("data-tour-id") === "rpt-heatmap-csv",
    ) as HTMLElement;
    fireEvent.click(btn);
    await screen.findByText("CSV listo: horas-pico-4s.csv.");
    expect(
      b.calls.some(
        (c) => c.url.includes("/reports/heatmap.csv") && c.url.includes("envelope=json"),
      ),
    ).toBe(true);
  });

  it("English copy", async () => {
    renderWith("owner", <PanelScreen />, "en");
    expect(await screen.findByRole("heading", { level: 1, name: /^Hi, / })).toBeTruthy();
    expect((await screen.findAllByText("Active members")).length).toBeGreaterThan(0);
    expect(screen.getByText("Today's schedule")).toBeTruthy();
    expect(screen.getByText("Peak hour: Tuesday from 06:00 to 07:00 (12 check-ins).")).toBeTruthy();
  });
});

describe("reports · front desk 'Hoy'", () => {
  it("shows check-ins, today's classes and who owes at the desk — no revenue figures", async () => {
    const b = renderWith("front_desk", <TodayScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Hoy" })).toBeTruthy();
    expect(await screen.findByText("21")).toBeTruthy();
    expect(screen.getByText("Demo Spinning")).toBeTruthy();
    expect(screen.getByText("9 de 12")).toBeTruthy();
    // The front desk never calls the revenue-bearing panel.
    expect(b.calls.some((c) => c.url.includes("/reports/dashboard"))).toBe(false);
    for (const label of ["Facturado hoy", "Cobrado hoy", "Tienda hoy", "Pasivo de puntos"])
      expect(screen.queryByText(label)).toBeNull();
  });
});

describe("reports · IVU", () => {
  it("shows municipality rows with SURI status as text, totals, the [VERIFICAR] note and CSV", async () => {
    const b = renderWith("accountant", <IvuReportScreen />);
    const table = await screen.findByRole("table", { name: /IVU por municipio/ });
    expect(within(table).getByText("Participa (SC 2915)")).toBeTruthy();
    expect(within(table).getByText("Sin verificar")).toBeTruthy();
    expect(within(table).getByText("Total del mes")).toBeTruthy();
    expect(within(table).getByText("$7.35")).toBeTruthy(); // 472 + 263 cents
    expect(screen.getByText(/\[VERIFICAR · CPA\]/)).toBeTruthy();
    // The accountant reads but never configures municipalities.
    expect(screen.queryByText("Municipios y planilla SURI")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    await screen.findByText(/ivu-2026-10\.csv/);
    expect(b.calls.some((c) => c.url.includes("/reports/ivu.csv?month="))).toBe(true);
    // Accountant: no "Socios" report link.
    const nav = screen.getByRole("navigation", { name: "Tipo de reporte" });
    expect(within(nav).queryByText("Socios")).toBeNull();
  });

  it("owner records a municipality's SURI participation", async () => {
    const b = renderWith("owner", <IvuReportScreen />);
    await screen.findByText("Municipios y planilla SURI");
    fireEvent.change(screen.getByLabelText("Municipio"), { target: { value: "Bayamón" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "non_participant" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Bayamón: No participa: declarar aparte.");
    expect(b.calls.find((c) => c.method === "PUT")?.body).toEqual({
      municipality: "Bayamón",
      suri_status: "non_participant",
    });
  });
});

describe("reports · module contract", () => {
  const navFor = (role: string) =>
    module.nav.filter((n) => allows(n.audience, role)).map((n) => n.to);
  const routesFor = (role: string) =>
    module.routes.filter((r) => allows(r.audience, role)).map((r) => r.path);

  it("roles see only their entries", () => {
    expect(navFor("owner")).toEqual(["/staff/panel", "/staff/reports/ivu"]);
    expect(navFor("location_manager")).toEqual(["/staff/panel", "/staff/reports/ivu"]);
    expect(navFor("front_desk")).toEqual(["/staff/today"]);
    expect(navFor("accountant")).toEqual(["/staff/reports/ivu"]);
    expect(routesFor("accountant")).not.toContain("/staff/reports/members");
    expect(routesFor("accountant")).not.toContain("/staff/panel");
    for (const role of ["trainer", "nutritionist", "chef", "clinician", "member", "guardian"]) {
      expect(navFor(role), role).toEqual([]);
      expect(routesFor(role), role).toEqual([]);
    }
  });

  it("ES and EN dictionaries have the same keys and no regulated nutrition titles", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    const all = JSON.stringify(dict).toLowerCase();
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/);
  });

  it("heat levels and the default IVU month", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
    expect(previousMonth(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
    expect(previousMonth(new Date("2026-11-02T12:00:00Z"))).toBe("2026-10");
  });
});
