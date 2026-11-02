import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { applyTheme, sanitizeTheme } from "../../src/lib/brandTheme";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import {
  ExecutiveOverview,
  delta,
  moneyCompact,
  monthLabel,
} from "../../src/modules/reports/Executive";
import type { Executive } from "../../src/modules/reports/api";
import { niceTicks } from "../../src/modules/reports/charts";
import { SessionProvider } from "../../src/session/SessionContext";
import { fakeBackend, json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const months = [
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
];
const rev = [21, 22, 24, 23, 25, 26, 27, 26, 28, 30, 31, 33].map((k) => k * 100_000);
const EXEC: Executive = {
  as_of: "2026-11-02T15:00:00Z",
  currency: "USD",
  months,
  kpis: {
    revenue_month_cents: { value: 3_350_000, prev: 3_100_000, series: rev },
    active_members: { value: 212, prev: 205, series: rev.map((_, i) => 180 + i * 3) },
    net_profit_month_cents: { value: 920_000, prev: 1_000_000, series: rev.map((v) => v / 3) },
    checkins_today: { value: 41, prev: 0, series: Array(14).fill(30) },
  },
  revenue_vs_expenses: months.map((m, i) => ({
    month: m,
    revenue_cents: rev[i] ?? 0,
    expenses_cents: Math.round((rev[i] ?? 0) * 0.68),
  })),
  new_members: months.map((m, i) => ({ month: m, joins: 10 + i, cancellations: 3 })),
  member_status: { active: 212, expired: 31, frozen: 9, other: 4 },
  sales_mix: [
    {
      kind: "single_session",
      label_es: "Sesión suelta",
      label_en: "Single session",
      units: 420,
      revenue_cents: 1_050_000,
    },
    {
      kind: "session_pack",
      label_es: "Paquete de sesiones",
      label_en: "Session pack",
      units: 60,
      revenue_cents: 900_000,
    },
  ],
};

function renderExec(role: string, lang: "es" | "en" = "es") {
  const calls: string[] = [];
  const core = fakeBackend(role);
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/reports/executive")) return json(200, EXEC);
    return core(input, init);
  };
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({ storage, fetchImpl: fetchImpl as typeof fetch });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <ExecutiveOverview locationId="loc-1" />
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return calls;
}

describe("executive overview", () => {
  it("shows the four KPI tiles with values, signed deltas and the comparison period", async () => {
    const calls = renderExec("owner");
    const tile = await screen.findByText("Ingresos del mes");
    const card = tile.closest(".exec-kpi") as HTMLElement;
    expect(card.textContent).toContain("33,500");
    expect(card.textContent).toContain("+8.1");
    expect(card.textContent).toContain("vs mes anterior");
    // A drop is announced as a drop (arrow + word for screen readers), not by colour alone.
    const profit = screen.getByText("Utilidad neta del mes").closest(".exec-kpi") as HTMLElement;
    expect(profit.textContent).toContain("Baja");
    expect(profit.textContent).toContain("-8");
    // No baseline → no invented percentage.
    const checkins = screen.getByText("Check-ins hoy").closest(".exec-kpi") as HTMLElement;
    expect(checkins.textContent).toContain("Sin base para comparar");
    expect(calls.some((u) => u.includes("/reports/executive?location_id=loc-1"))).toBe(true);
  });

  it("every chart has an accessible name and a data table with the same numbers", async () => {
    renderExec("owner");
    await screen.findByText("Ingresos del mes");
    for (const name of [
      "Tendencia de ingresos",
      "Estado de socios",
      "Altas y bajas",
      "Ingresos vs gastos",
    ])
      expect(screen.getByRole("img", { name })).toBeTruthy();
    const tables = screen.getAllByText("Ver datos en tabla");
    expect(tables.length).toBe(5);
    const statusCard = screen
      .getByRole("heading", { name: "Estado de socios" })
      .closest("section") as HTMLElement;
    fireEvent.click(within(statusCard).getByText("Ver datos en tabla"));
    const row = within(statusCard).getByRole("row", { name: /Vencidos/ });
    expect(row.textContent).toContain("31");
    // Legend states the share too (identity never by colour alone).
    expect(statusCard.textContent).toContain("83 %");
  });

  it("keyboard reaches the revenue chart and moves the crosshair readout", async () => {
    renderExec("owner", "en");
    const plot = await screen.findByRole("img", { name: "Revenue trend" });
    fireEvent.focus(plot);
    expect((await screen.findByRole("status")).textContent).toContain("$33,000");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toContain("$31,000");
  });
});

describe("executive helpers", () => {
  it("formats and compares without inventing numbers", () => {
    expect(niceTicks(3_300_000)).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(moneyCompact(3_300_000, "en")).toBe("$33K");
    expect(moneyCompact(950_000, "en")).toBe("$9,500");
    expect(monthLabel("2026-01", "es")).toBe("ene 26");
    expect(monthLabel("2026-03", "en")).toBe("Mar");
    expect(delta({ value: 5, prev: 0, series: [] })).toBeNull();
    expect(delta({ value: -50, prev: -100, series: [] })).toBeCloseTo(0.5);
  });
});

describe("brand dark mode", () => {
  it("keeps the dark accent pair only when it is readable", () => {
    const ok = sanitizeTheme({
      mode: "dark",
      colors: { accent: "#6D6128", accent_dark: "#D4A63E", accent_dark_text: "#111111" },
    });
    expect(ok.mode).toBe("dark");
    expect(ok.colors?.accent_dark).toBe("#D4A63E");
    const bad = sanitizeTheme({
      mode: "neon" as "dark",
      colors: { accent_dark: "#222222", accent_dark_text: "#111111" },
    });
    expect(bad.mode).toBeUndefined();
    expect(bad.colors?.accent_dark).toBeUndefined();
  });

  it("swaps the accent for the dark pair only while the console is dark", () => {
    const theme = sanitizeTheme({
      colors: {
        accent: "#6D6128",
        accent_text: "#FFFFFF",
        accent_dark: "#D4A63E",
        accent_dark_text: "#111111",
      },
    });
    const root = document.createElement("div");
    let undo = applyTheme(theme, root, "light");
    expect(root.style.getPropertyValue("--accent")).toBe("#6D6128");
    undo();
    undo = applyTheme(theme, root, "dark");
    expect(root.style.getPropertyValue("--accent")).toBe("#D4A63E");
    expect(root.style.getPropertyValue("--accent-text")).toBe("#111111");
    undo();
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });
});
