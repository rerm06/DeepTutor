import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { PosScreen } from "../../src/modules/store/PosScreen";
import { ShopScreen } from "../../src/modules/store/ShopScreen";
import { money, parsePriceCents } from "../../src/modules/store/api";
import { storeDict } from "../../src/modules/store/dict";
import { module } from "../../src/modules/store/index";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const CATALOGUE = [
  {
    product_id: "p-prot",
    sku: "DEMO-PROT",
    name: "Demo Proteína",
    category: "supplement",
    age_restricted: true,
    taxable: true,
    price_cents: 3999,
    available: 5,
  },
  {
    product_id: "p-agua",
    sku: "DEMO-AGUA",
    name: "Demo Agua",
    category: "drink",
    age_restricted: false,
    taxable: true,
    price_cents: 150,
    available: 20,
  },
];

/** Fake server: the quote's IVU numbers come from here, as they do from the real API (never from the UI). */
function fakeQuote(lines: Array<{ product_id: string; qty: number }>) {
  const out = lines.map((l) => {
    const p = CATALOGUE.find((c) => c.product_id === l.product_id);
    if (!p) throw new Error(`unknown product ${l.product_id}`);
    const sub = p.price_cents * l.qty;
    const st = Math.round(sub * 0.105);
    const mu = Math.round(sub * 0.01);
    return {
      ...p,
      qty: l.qty,
      unit_price_cents: p.price_cents,
      subtotal_cents: sub,
      ivu_state_cents: st,
      ivu_municipal_cents: mu,
      total_cents: sub + st + mu,
    };
  });
  const sum = (k: "subtotal_cents" | "ivu_state_cents" | "ivu_municipal_cents" | "total_cents") =>
    out.reduce((n, l) => n + l[k], 0);
  return {
    lines: out,
    subtotal_cents: sum("subtotal_cents"),
    ivu_state_cents: sum("ivu_state_cents"),
    ivu_municipal_cents: sum("ivu_municipal_cents"),
    total_cents: sum("total_cents"),
    age_restricted: out.some((l) => l.age_restricted),
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function backend(role: string, calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
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
    if (url.includes("/store/catalogue")) return json(200, { data: CATALOGUE });
    if (url.endsWith("/store/quote")) return json(200, fakeQuote(body.lines));
    if (url.endsWith("/store/sales") && method === "POST") {
      const q = fakeQuote(body.lines);
      return json(201, {
        id: "abcdef12-0000-4000-8000-000000000000",
        location_id: "l1",
        location_name: "Sede Demo",
        channel: "pos",
        member_id: null,
        status: "completed",
        payment_method: body.payment_method,
        age_verified: body.age_verified,
        created_at: "2026-11-02T15:00:00Z",
        ...q,
      });
    }
    if (url.includes("/store/sales")) return json(200, { data: [] });
    return json(404, { error: "not_found" });
  };
}

function renderStore(role: string, ui: ReactNode, lang: "es" | "en" = "es", calls: Call[] = []) {
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: backend(role, calls) as typeof fetch });
  return render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

describe("Punto de venta", () => {
  it("search, scan by SKU, server IVU breakdown, age check only when needed, charge", async () => {
    const calls: Call[] = [];
    renderStore("front_desk", <PosScreen />, "es", calls);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Punto de venta");
    const search = await screen.findByLabelText("Buscar o escanear SKU");
    expect(search.getAttribute("data-tour-id")).toBe("store-pos-search");
    await screen.findByRole("option", { name: "Sede Demo" });

    // Search by name and add a non-restricted product: no age checkbox.
    fireEvent.change(search, { target: { value: "agua" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Agregar\s*:\s*Demo Agua$/ }));
    await screen.findByText("IVU estatal (10.5 %)");
    expect(document.querySelector('[data-tour-id="store-pos-age"]')).toBeNull();
    const ivu = document.querySelector('[data-tour-id="store-ivu"]') as HTMLElement;
    await waitFor(() => expect(within(ivu).getByText(money(16, "es"))).toBeTruthy());

    // Scanner: exact SKU + Enter adds the restricted supplement; the age checkbox and disclaimer appear.
    fireEvent.change(search, { target: { value: "DEMO-PROT" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const age = await screen.findByRole("checkbox", { name: /Verifiqué una identificación/ });
    expect(age.getAttribute("data-tour-id")).toBe("store-pos-age");
    expect(document.querySelector('[data-tour-id="store-supplement-disclaimer"]')).not.toBeNull();
    const total = 150 + 16 + 2 + 3999 + 420 + 40;
    const charge = await screen.findByRole("button", { name: `Cobrar ${money(total, "es")}` });
    expect((charge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(age);
    await waitFor(() => expect((charge as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta (simulada)" }));
    fireEvent.click(charge);

    await screen.findByRole("heading", { name: "Recibo" });
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/store/sales"));
    expect(post?.body).toEqual({
      location_id: "l1",
      lines: [
        { product_id: "p-agua", qty: 1 },
        { product_id: "p-prot", qty: 1 },
      ],
      payment_method: "card_simulated",
      age_verified: true,
    });
    expect(
      screen.getByRole("button", { name: "Imprimir recibo" }).getAttribute("data-tour-id"),
    ).toBe("store-receipt-print");
  });

  it("renders in English", async () => {
    renderStore("front_desk", <PosScreen />, "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Point of sale");
    await screen.findByLabelText("Search or scan SKU");
    expect(screen.getByText("The cart is empty.")).toBeTruthy();
  });
});

describe("Tienda (member)", () => {
  it("lists products neutrally, with the supplement disclaimer and pickup ID note; never 'recommended'", async () => {
    renderStore("member", <ShopScreen />);
    await screen.findByText("Demo Proteína");
    expect(screen.getAllByText(/no han sido evaluadas por la FDA/).length).toBe(1);
    expect(screen.getByText("Se verifica identificación al recoger.")).toBeTruthy();
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/recomend|recommend/);
    fireEvent.click(screen.getByRole("button", { name: /^Agregar\s*:\s*Demo Agua$/ }));
    const order = await screen.findByRole("button", { name: "Ordenar para recoger" });
    expect(order.getAttribute("data-tour-id")).toBe("store-shop-order");
  });

  it("guardians browse but cannot order", async () => {
    renderStore("guardian", <ShopScreen />);
    await screen.findByText("Demo Proteína");
    expect(screen.queryByRole("button", { name: /Agregar/ })).toBeNull();
  });
});

describe("module contract", () => {
  it("store routes follow the role matrix", () => {
    const can = (path: string, role: string) =>
      module.routes.some((r) => r.path === path && allows(r.audience, role));
    for (const role of ["trainer", "nutritionist", "chef", "clinician"])
      expect(
        module.routes.some((r) => allows(r.audience, role)),
        role,
      ).toBe(false);
    expect(can("/staff/store/sales", "accountant")).toBe(true);
    expect(can("/staff/store/pos", "accountant")).toBe(false);
    expect(can("/staff/store/products", "front_desk")).toBe(false);
    expect(can("/staff/store/pos", "front_desk")).toBe(true);
    expect(can("/me/store", "member")).toBe(true);
    expect(can("/staff/store/pos", "member")).toBe(false);
  });

  it("ES and EN dictionaries carry the same keys and no regulated titles", () => {
    expect(Object.keys(storeDict.es).sort()).toEqual(Object.keys(storeDict.en).sort());
    const all = JSON.stringify(storeDict).toLowerCase();
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/);
    for (const n of module.nav) expect(n.label.es && n.label.en).toBeTruthy();
  });

  it("price input is parsed strictly to cents", () => {
    expect(parsePriceCents("24.99")).toBe(2499);
    expect(parsePriceCents("5")).toBe(500);
    expect(parsePriceCents("0.5")).toBe(50);
    for (const bad of ["", "-1", "1,50", "1.999", "1000.01", "abc", "1e3"])
      expect(parsePriceCents(bad), bad).toBeNull();
  });
});
