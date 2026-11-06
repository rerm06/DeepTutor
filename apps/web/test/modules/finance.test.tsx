import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { module } from "../../src/modules/finance";
import { FinanceScreen } from "../../src/modules/finance/FinanceScreen";
import { dict } from "../../src/modules/finance/dict";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const pnlRow = (over: Record<string, unknown>) => ({
  membership_revenue_cents: 0,
  other_billing_revenue_cents: 0,
  store_revenue_cents: 0,
  revenue_cents: 0,
  expenses_cents: 0,
  bills_cents: 0,
  commissions_cents: 0,
  platform_fees_cents: 0,
  costs_cents: 0,
  net_cents: 0,
  cash_in_cents: 0,
  cash_out_cents: 0,
  ...over,
});
const bill = (over: Record<string, unknown>) => ({
  id: "b1",
  vendor_id: "v1",
  vendor_name: "Demo Limpieza",
  location_id: "l1",
  location_name: "Sede Demo",
  number: "F-1",
  category: "maintenance",
  memo: null,
  issued_on: "2026-10-01",
  due_on: "2026-10-31",
  amount_cents: 30000,
  status: "pending_approval",
  created_by_me: false,
  approved_at: null,
  paid_on: null,
  payment_ref: null,
  void_reason: null,
  ...over,
});

/** Canned /v1 responses for the finance screens; records every call. */
function backend(role: string) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace(/^\/api\/v1/, "").split("?")[0];
    if (path === "/me")
      return json(200, {
        organization: { id: "o1", name: "Org Demo A", saas_plan: "pro" },
        person: { id: "p1", email: "persona@demo.invalid" },
        role,
        location_ids: ["l1"],
      });
    if (path === "/locations")
      return json(200, {
        data: [
          {
            id: "l1",
            name: "Sede Demo",
            brand_id: "b",
            timezone: "America/Puerto_Rico",
            municipality: "Demo",
          },
        ],
      });
    if (path === "/finance/pnl")
      return json(200, {
        month: "2026-10",
        basis: "accrual",
        locations: [
          pnlRow({
            location_id: "l1",
            location_name: "Sede Demo",
            revenue_cents: 480000,
            net_cents: 123456,
          }),
          pnlRow({
            location_id: "l2",
            location_name: "Sede Dos",
            revenue_cents: 20000,
            net_cents: -5000,
          }),
        ],
        consolidated: pnlRow({ revenue_cents: 500000, net_cents: 118456 }),
      });
    if (path === "/finance/liabilities")
      return json(200, {
        deferred: [],
        totals: { prepaid_periods_cents: 29950, unused_credits_cents: 8400 },
        points:
          role === "location_manager"
            ? null
            : { outstanding_points: 1500, members_with_balance: 9 },
      });
    if (path === "/finance/policy")
      return json(200, { manager_approval_max_cents: 50000, updated_at: null });
    if (path === "/finance/bills" && method === "GET")
      return json(200, {
        data: [
          bill({ id: "b-ok", number: "F-OK" }),
          bill({ id: "b-big", number: "F-BIG", amount_cents: 75000 }),
          bill({ id: "b-mine", number: "F-MINE", created_by_me: true }),
        ],
      });
    if (path === "/finance/bills/b-ok/decision")
      return json(200, bill({ id: "b-ok", number: "F-OK", status: "approved" }));
    if (path === "/finance/vendors") return json(200, { data: [] });
    if (path === "/finance/exports" && method === "POST")
      return json(201, {
        id: "e1",
        period: "2026-10-01",
        line_count: 2,
        debit_total_cents: 10000,
        generated_at: "2026-11-02T12:00:00Z",
        filename: "diario-2026-10.csv",
        csv: 'JournalNo,JournalDate,Account,Debits,Credits,Description,Location\r\n"GYM-202610-01","10/31/2026","Bank","","100.00","Resumen mensual 2026-10","Sede Demo"\r\n',
      });
    if (path === "/finance/exports") return json(200, { data: [] });
    return json(404, { error: "not_found" });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function renderAs(role: string, ui: ReactNode, lang: "es" | "en" = "es") {
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const b = backend(role);
  const api = createApiClient({ storage, fetchImpl: b.fetchImpl });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return b;
}

describe("finance · module contract", () => {
  it("only owner, location manager and accountant reach Finanzas", () => {
    const route = module.routes.find((r) => r.path === "/staff/finance");
    for (const role of ["owner", "location_manager", "accountant"])
      expect(allows(route?.audience ?? [], role), role).toBe(true);
    for (const role of [
      "front_desk",
      "trainer",
      "nutritionist",
      "chef",
      "clinician",
      "member",
      "guardian",
    ]) {
      expect(allows(route?.audience ?? [], role), role).toBe(false);
      expect(module.nav.filter((n) => allows(n.audience, role))).toEqual([]);
    }
    expect(module.nav[0]?.label).toEqual({ es: "Finanzas", en: "Finance" });
  });

  it("ES and EN dictionaries carry the same keys and never use the regulated nutrition titles", () => {
    expect(Object.keys(dict.es).sort()).toEqual(Object.keys(dict.en).sort());
    expect(JSON.stringify(dict).toLowerCase()).not.toMatch(
      /nutricionista|dietista|nutritionist|dietitian/,
    );
  });
});

describe("finance · screen", () => {
  it("P&L: by location plus consolidated, labelled month picker, tabs operable by keyboard", async () => {
    renderAs("accountant", <FinanceScreen />);
    const table = await screen.findByTestId("fin-pnl");
    expect(within(table).getByRole("columnheader", { name: "Consolidado" })).toBeTruthy();
    expect(within(table).getByText("$1,184.56")).toBeTruthy();
    expect(within(table).getByText("-$50.00")).toBeTruthy();
    expect(screen.getByLabelText("Mes").getAttribute("data-tour-id")).toBe("fin-pnl-month");
    await screen.findByText("1500 puntos · 9 socios");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "P&L",
      "Cuentas por pagar",
      "Gastos",
      "Comisiones",
      "Exportar",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("fin-tab-payables");
  });

  it("payables (manager): over-limit and own bills cannot be decided; approving sends only the decision", async () => {
    const b = renderAs("location_manager", <FinanceScreen />);
    expect(screen.queryByRole("tab", { name: "Exportar" })).toBeNull();
    fireEvent.click(await screen.findByRole("tab", { name: "Cuentas por pagar" }));
    await screen.findByText(/Gerentes aprueban hasta \$500\.00/);
    const approve = await screen.findAllByRole("button", { name: "Aprobar la factura F-OK" });
    expect(screen.queryByRole("button", { name: "Aprobar la factura F-BIG" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aprobar la factura F-MINE" })).toBeNull();
    expect(screen.getAllByText("Sobre tu límite: la decide el dueño").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("La registraste tú: otra persona debe aprobarla").length,
    ).toBeGreaterThan(0);
    expect(approve[0]?.getAttribute("data-tour-id")).toBe("fin-bill-approve");
    fireEvent.click(approve[0] as HTMLElement);
    await screen.findByText("Factura F-OK aprobada.");
    const post = b.calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/finance/bills/b-ok/decision"),
    );
    expect(post?.body).toEqual({ decision: "approve" });
    // Bill entry form: every control has a visible label.
    const form = screen.getByRole("form", { name: "Registrar factura de proveedor" });
    for (const el of within(form).getAllByRole("textbox")) expect(el.id).toBeTruthy();
    expect(within(form).getByLabelText("Número de factura")).toBeTruthy();
  });

  it("payables (accountant): read-only, no approve buttons and no entry form", async () => {
    renderAs("accountant", <FinanceScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: "Cuentas por pagar" }));
    await screen.findAllByText("Solo lectura");
    expect(screen.queryByRole("button", { name: /^Aprobar/ })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar factura de proveedor" })).toBeNull();
  });

  it("export (owner): generates the month's CSV and shows it", async () => {
    const b = renderAs("owner", <FinanceScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: "Exportar" }));
    const gen = await screen.findByRole("button", { name: "Generar y descargar CSV" });
    expect(gen.getAttribute("data-tour-id")).toBe("fin-export-generate");
    expect(screen.getByText(/máximo 2 categorías de seguimiento/)).toBeTruthy();
    fireEvent.click(gen);
    await screen.findByText(/diario-2026-10\.csv: 2 líneas/);
    const post = b.calls.find((c) => c.method === "POST" && c.url.endsWith("/finance/exports"));
    expect(post?.body).toEqual({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
    expect(screen.getByTestId("fin-csv-preview").textContent).toContain(
      "JournalNo,JournalDate,Account",
    );
  });

  it("renders in English", async () => {
    renderAs("owner", <FinanceScreen />, "en");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Finance"),
    );
    expect(screen.getByRole("tab", { name: "Payables" })).toBeTruthy();
    expect((await screen.findAllByRole("columnheader", { name: "Consolidated" })).length).toBe(2);
  });
});
