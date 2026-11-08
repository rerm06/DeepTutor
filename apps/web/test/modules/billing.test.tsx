import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { BillingScreen } from "../../src/modules/billing/BillingScreen";
import { MemberBillingTab } from "../../src/modules/billing/MemberBillingTab";
import { MyMembershipScreen } from "../../src/modules/billing/MyMembershipScreen";
import { billingDict } from "../../src/modules/billing/dict";
import { SessionProvider } from "../../src/session/SessionContext";
import { fakeBackend, json, memoryStorage, persona, renderAs } from "../helpers";

afterEach(cleanup);

const catalog = {
  products: [
    {
      id: "pd1",
      kind: "drop_in",
      name: "Sesión de entrenamiento",
      description: null,
      tax_category: "taxable",
      active: true,
    },
    {
      id: "pd2",
      kind: "class_pack",
      name: "Paquete 10 sesiones",
      description: null,
      tax_category: "taxable",
      active: true,
    },
    {
      id: "pd3",
      kind: "membership",
      name: "Membresía mensual",
      description: null,
      tax_category: "taxable",
      active: true,
    },
  ],
  prices: [
    {
      id: "pr1",
      product_id: "pd1",
      location_id: null,
      amount_cents: 1500,
      billing_interval: "none",
      credits: null,
      validity_days: 1,
      commitment_months: 0,
      active: true,
    },
    {
      id: "pr2",
      product_id: "pd2",
      location_id: null,
      amount_cents: 13000,
      billing_interval: "none",
      credits: 10,
      validity_days: 120,
      commitment_months: 0,
      active: true,
    },
    {
      id: "pr3",
      product_id: "pd3",
      location_id: null,
      amount_cents: 3995,
      billing_interval: "month",
      credits: null,
      validity_days: null,
      commitment_months: 0,
      active: true,
    },
  ],
};
const invoice = {
  id: "i1",
  number: 6,
  member_id: "m1",
  member_name: "Socio Demo Uno",
  location_id: "l1",
  subscription_id: null,
  period_start: null,
  period_end: null,
  subtotal_cents: 1500,
  ivu_state_cents: 158,
  ivu_municipal_cents: 15,
  total_cents: 1673,
  balance_cents: 1673,
  status: "open",
  overdue: true,
  issued_at: "2026-10-20T14:00:00Z",
  due_date: "2026-10-23",
};
const billing = {
  subscriptions: [
    {
      id: "s1",
      member_id: "m1",
      product_id: "pd3",
      product_name: "Membresía mensual",
      price_id: "pr3",
      amount_cents: 3995,
      location_id: "l1",
      status: "active",
      billing_interval: "month",
      start_date: "2026-10-15",
      current_period_start: "2026-10-15",
      current_period_end: "2026-11-15",
      commitment_end: null,
      cancel_at_period_end: false,
      ends_on: "2026-11-15",
    },
  ],
  freezes: [],
  invoices: [invoice],
  lines: [
    {
      id: "ln1",
      invoice_id: "i1",
      description: "Sesión de entrenamiento",
      quantity: 1,
      unit_amount_cents: 1500,
      tax_category: "taxable",
      amount_cents: 1500,
      ivu_state_cents: 158,
      ivu_municipal_cents: 15,
    },
  ],
  payments: [],
  credits: [
    {
      id: "c1",
      member_id: "m1",
      product_name: "Paquete 10 sesiones",
      location_id: "l1",
      credits_total: 10,
      credits_remaining: 6,
      expires_at: "2027-02-01T12:00:00Z",
      live: true,
    },
  ],
  passes: [],
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function backend(role: string, calls: Call[]) {
  const core = fakeBackend(role);
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith("/billing/catalog")) return json(200, catalog);
    if (url.endsWith("/members/m1/billing") || url.endsWith("/billing/me"))
      return json(200, billing);
    if (url.endsWith("/members/m1/sales") && method === "POST")
      return json(201, { invoice_id: "i9", number: 7, total_cents: 1673, status: "paid" });
    if (url.endsWith("/subscriptions/s1/cancel") && method === "POST")
      return json(200, { id: "s1", cancel_at_period_end: true, effective_date: "2026-11-15" });
    if (url.includes("/invoices?") || url.endsWith("/invoices"))
      return json(200, { data: [invoice] });
    if (url.endsWith("/billing/fees"))
      return json(200, {
        data: [{ invoice_id: "i1", application_fee_bps: 100, application_fee_cents: 17 }],
      });
    if (url.endsWith("/billing/cycle") && method === "POST")
      return json(200, {
        as_of: "2026-11-02",
        renewed: 2,
        invoices: 2,
        cancelled: 1,
        past_due_members: 1,
      });
    return core(input, init);
  };
}

function renderWith(role: string, ui: ReactNode, lang: "es" | "en" = "es") {
  const calls: Call[] = [];
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: backend(role, calls) as typeof fetch });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return calls;
}

/** WCAG 1.3.1 / 4.1.2: every form control in the rendered tree has a programmatic label. */
function expectAllControlsLabelled() {
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const c = el as HTMLInputElement;
    const named =
      (c.labels?.length ?? 0) > 0 ||
      c.getAttribute("aria-label") ||
      c.getAttribute("aria-labelledby");
    expect(named, c.outerHTML).toBeTruthy();
  }
}

describe("billing dictionary", () => {
  it("ES and EN carry the same keys and never use the regulated nutrition titles", () => {
    expect(Object.keys(billingDict.en).sort()).toEqual(Object.keys(billingDict.es).sort());
    const all = [...Object.values(billingDict.es), ...Object.values(billingDict.en)].join(" ");
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/i);
  });
});

describe("member tab: Membresía y pagos", () => {
  it("front desk: 'Cobrar sesión' is the first action and charges a single session with a fresh idempotency key", async () => {
    const calls = renderWith("front_desk", <MemberBillingTab memberId="m1" />);
    const cta = await screen.findByRole("button", { name: "Cobrar sesión" });
    expect(cta.getAttribute("data-tour-id")).toBe("billing-charge-session");
    // The quick-charge block comes before credits, memberships and invoices.
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf("Cobrar sesión")).toBeLessThan(headings.indexOf("Facturas"));
    expect(screen.getByRole("combobox", { name: "Producto" })).toHaveProperty("value", "pr1");

    fireEvent.click(cta);
    await screen.findByText(/Cobrado: factura Nº 7 por .*16[.,]73/);
    const sale = calls.find((c) => c.method === "POST" && c.url.endsWith("/members/m1/sales"));
    expect(sale?.body).toMatchObject({
      price_id: "pr1",
      location_id: "l1",
      quantity: 1,
      method: "cash",
    });
    expect(
      String((sale?.body as { idempotency_key: string }).idempotency_key).length,
    ).toBeGreaterThanOrEqual(8);
    expectAllControlsLabelled();
  });

  it("shows the IVU breakdown per invoice and per line", async () => {
    renderWith("front_desk", <MemberBillingTab memberId="m1" />);
    const table = await screen.findByRole("region", {
      name: /desplazamiento horizontal: Facturas/,
    });
    expect(within(table).getByRole("columnheader", { name: "IVU estatal 10,5 %" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "IVU municipal 1 %" })).toBeTruthy();
    expect(table.textContent).toMatch(/1[.,]58/);
    expect(table.textContent).toMatch(/0[.,]15/);
    expect(within(table).getByText("Vencida")).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: /Detalle/ }));
    expect(await screen.findByText(/IVU calculado por línea/)).toBeTruthy();
    expect(document.querySelector('[data-tour-id="billing-record-payment"]')).not.toBeNull();
    expect(document.querySelector('[data-tour-id="billing-freeze"]')).not.toBeNull();
    expect(document.querySelector('[data-tour-id="billing-cancel"]')).not.toBeNull();
  });

  it("accountant: read-only (no charge, no payment, no freeze)", async () => {
    renderWith("accountant", <MemberBillingTab memberId="m1" />);
    await screen.findByRole("region", { name: /desplazamiento horizontal: Facturas/ });
    expect(screen.queryByRole("button", { name: "Cobrar sesión" })).toBeNull();
    expect(document.querySelector('[data-tour-id="billing-record-payment"]')).toBeNull();
    expect(document.querySelector('[data-tour-id="billing-freeze"]')).toBeNull();
  });

  it("English", async () => {
    renderWith("front_desk", <MemberBillingTab memberId="m1" />, "en");
    expect(await screen.findByRole("button", { name: "Charge session" })).toBeTruthy();
    expect(await screen.findByText("Membership and payments")).toBeTruthy();
  });
});

describe("member portal: Mi membresía", () => {
  it("sessions and credits come first", async () => {
    renderWith("member", <MyMembershipScreen />);
    const credits = await screen.findByRole("heading", { name: "Mis sesiones y créditos" });
    expect(screen.getByText("6 de 10 sesiones disponibles")).toBeTruthy();
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.indexOf(credits.textContent)).toBeLessThan(headings.indexOf("Mi plan"));
  });

  it("cancels online in three steps with a clear confirmation", async () => {
    const calls = renderWith("member", <MyMembershipScreen />);
    // Step 1
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar mi membresía" }));
    // Step 2: explicit end date and confirmation
    expect(screen.getByText("Paso 2 de 3")).toBeTruthy();
    expect(screen.getByText(/seguirá activa hasta el/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Sí, cancelar" });
    expect(document.activeElement).toBe(confirm);
    expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(false);
    fireEvent.click(confirm);
    // Step 3
    const done = await screen.findByRole("status");
    expect(done.textContent).toMatch(/Cancelación confirmada/);
    expect(screen.getByText("Paso 3 de 3")).toBeTruthy();
    const cancel = calls.find((c) => c.url.endsWith("/subscriptions/s1/cancel"));
    expect(cancel?.body).toEqual({ confirm: true });
  });

  it("member sees no fee, no payment form and no charge button", async () => {
    renderWith("member", <MyMembershipScreen />);
    await screen.findByRole("heading", { name: "Mis facturas" });
    expect(screen.queryByText("Comisión plataforma")).toBeNull();
    expect(document.querySelector('[data-tour-id="billing-record-payment"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Cobrar sesión" })).toBeNull();
  });
});

describe("Facturación screen", () => {
  it("owner sees the fee column and runs the renewal cycle after a confirmation", async () => {
    const calls = renderWith("owner", <BillingScreen />);
    await screen.findByText("Socio Demo Uno");
    expect(await screen.findByRole("columnheader", { name: "Comisión plataforma" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar ciclo de renovación" }));
    expect(calls.some((c) => c.url.endsWith("/billing/cycle"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y ejecutar" }));
    await screen.findByText(/Ciclo completado: 2 renovaciones/);
    expect(document.querySelector('[data-tour-id="billing-quick-member"]')).not.toBeNull();
    expectAllControlsLabelled();
  });

  it("front desk can charge a session from the billing screen but cannot run the cycle or see fees", async () => {
    const calls = renderWith("front_desk", <BillingScreen />);
    const member = await screen.findByRole("combobox", { name: "Socio" });
    await waitFor(() => expect(within(member).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(member, { target: { value: "m1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar sesión" }));
    await screen.findByText(/Cobrado: factura Nº 7/);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/members/m1/sales"))).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Ejecutar ciclo de renovación" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Comisión plataforma" })).toBeNull();
  });
});

describe("navigation", () => {
  it("owner gets Facturación and Catálogo; front desk only Facturación; trainer neither; members Mi membresía", async () => {
    renderAs("owner", <AppRoutes />, "/staff/members");
    let nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Facturación");
    expect(nav.textContent).toContain("Catálogo");
    cleanup();
    renderAs("front_desk", <AppRoutes />, "/staff/members");
    nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Facturación");
    expect(nav.textContent).not.toContain("Catálogo");
    cleanup();
    renderAs("trainer", <AppRoutes />, "/staff/members");
    nav = await screen.findByRole("navigation");
    expect(nav.textContent).not.toContain("Facturación");
    cleanup();
    renderAs("member", <AppRoutes />, "/me/account");
    nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Mi membresía");
  });
});
