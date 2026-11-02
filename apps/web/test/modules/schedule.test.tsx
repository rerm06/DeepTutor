import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { AgendaScreen } from "../../src/modules/schedule/AgendaScreen";
import { CheckInScreen, searchMembers } from "../../src/modules/schedule/CheckInScreen";
import { MyClassesScreen } from "../../src/modules/schedule/MyClassesScreen";
import { MyCredentialScreen, QR_REFRESH_MS } from "../../src/modules/schedule/MyCredentialScreen";
import { dict } from "../../src/modules/schedule/dict";
import { module as scheduleModule } from "../../src/modules/schedule/index";
import { tzOffsetMinutes, weekStart, zonedToUtc } from "../../src/modules/schedule/time";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Call = { method: string; path: string; body: unknown };

const LOC = {
  id: "l1",
  name: "Sede Demo",
  brand_id: "b1",
  timezone: "America/Puerto_Rico",
  municipality: "Demo",
};
const MEMBERS = [
  {
    id: "m1",
    status: "active",
    member_no: "A-0001",
    home_location_id: "l1",
    full_name: "Socio Demo Uno",
    email: "uno@demo.invalid",
  },
  {
    id: "m2",
    status: "frozen",
    member_no: "A-0002",
    home_location_id: "l1",
    full_name: "Socia Demo Dos",
    email: "dos@demo.invalid",
  },
];
const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function backend(role: string, calls: Call[], overrides: Record<string, unknown> = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://x");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: `${path}${url.search}`, body });
    const key = `${method} ${path}`;
    if (key in overrides) {
      const v = overrides[key];
      return typeof v === "function" ? (v as (b: unknown) => Response)(body) : json(200, v);
    }
    if (path === "/me")
      return json(200, {
        organization: { id: "o1", name: "Org Demo A", saas_plan: "pro" },
        person: { id: "p1", email: "persona@demo.invalid" },
        role,
        location_ids: ["l1"],
      });
    if (path === "/locations") return json(200, { data: [LOC] });
    if (path === "/members") return json(200, { data: MEMBERS });
    if (path === "/schedule/check-ins" && method === "GET") return json(200, { data: [] });
    if (path === "/schedule/location-policies")
      return json(200, {
        data: [
          {
            location_id: "l1",
            cancel_window_hours: 12,
            no_show_penalty: false,
            deny_past_due: false,
          },
        ],
      });
    if (path === "/schedule/my-members")
      return json(200, {
        data: [
          {
            id: "m1",
            full_name: "Socio Demo Uno",
            member_no: "A-0001",
            status: "active",
            home_location_id: "l1",
          },
        ],
      });
    if (path === "/schedule/bookings" && method === "GET") return json(200, { data: [] });
    if (path === "/schedule/sessions" && method === "GET") return json(200, { data: [] });
    return json(404, { error: "not_found" });
  };
}

function renderWith(
  role: string,
  ui: ReactNode,
  calls: Call[],
  overrides: Record<string, unknown> = {},
  lang: "es" | "en" = "es",
) {
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(role) }),
  });
  const api = createApiClient({
    storage,
    fetchImpl: backend(role, calls, overrides) as typeof fetch,
  });
  return render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

describe("dictionary and module contract", () => {
  it("ES and EN carry the same keys and placeholders, never empty, never the regulated titles", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    const forbidden = new RegExp(
      `${"nutri"}${"cionista"}|${"diet"}${"ista"}|${"nutri"}tionist|${"dieti"}tian`,
      "i",
    );
    for (const [k, es] of Object.entries(dict.es)) {
      const en = dict.en[k as keyof typeof dict.en];
      expect(es.trim(), k).not.toBe("");
      expect(en.trim(), k).not.toBe("");
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(en), k).toEqual(ph(es));
      expect(es + en, k).not.toMatch(forbidden);
    }
  });

  it("exposes staff and member routes with the right audiences", () => {
    const paths = scheduleModule.routes.map((r) => r.path);
    expect(paths).toEqual([
      "/staff/schedule",
      "/staff/check-in",
      "/staff/appointments",
      "/me/classes",
      "/me/credential",
    ]);
    const checkin = scheduleModule.routes.find((r) => r.path === "/staff/check-in");
    expect(checkin?.audience).toEqual(["owner", "location_manager", "front_desk"]);
    expect(scheduleModule.memberTabs?.[0]?.audience).not.toContain("chef");
  });
});

describe("time helpers", () => {
  it("Puerto Rico is UTC-4 all year and local input maps to the right instant", () => {
    expect(tzOffsetMinutes("America/Puerto_Rico", new Date("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(zonedToUtc("2026-11-03", "18:00", "America/Puerto_Rico").toISOString()).toBe(
      "2026-11-03T22:00:00.000Z",
    );
    expect(weekStart(new Date("2026-11-05T15:00:00Z"), "America/Puerto_Rico")).toBe("2026-11-02");
  });

  it("member search matches name, email or member number, from 2 characters", () => {
    const m = MEMBERS as never[];
    expect(searchMembers(m, "u")).toEqual([]);
    expect(searchMembers(m, "uno").map((x: { id: string }) => x.id)).toEqual(["m1"]);
    expect(searchMembers(m, "A-0002").map((x: { id: string }) => x.id)).toEqual(["m2"]);
    expect(searchMembers(m, "DOS@DEMO").map((x: { id: string }) => x.id)).toEqual(["m2"]);
  });
});

describe("Check-in rápido", () => {
  it("search + one tap checks a member in and shows an allowed verdict", async () => {
    const calls: Call[] = [];
    renderWith("front_desk", <CheckInScreen />, calls, {
      "POST /schedule/check-ins": (b: { member_id?: string }) =>
        json(201, {
          id: "c1",
          result: "allowed",
          reason: "active",
          member_id: b.member_id,
          full_name: "Socio Demo Uno",
          member_no: "A-0001",
          member_status: "active",
        }),
    });
    const search = await screen.findByLabelText("Buscar socio: nombre, email o número");
    expect(search.getAttribute("data-tour-id")).toBe("checkin-search");
    fireEvent.change(search, { target: { value: "uno" } });
    const btn = await screen.findByRole("button", {
      name: /^Registrar entrada\s*: Socio Demo Uno$/,
    });
    expect(btn.getAttribute("data-tour-id")).toBe("checkin-member");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    const verdict = document.querySelector('[data-tour-id="checkin-result"]') as HTMLElement;
    await waitFor(() => expect(verdict.textContent).toContain("Acceso permitido"));
    expect(verdict.textContent).toContain("Membresía activa");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      location_id: "l1",
      member_id: "m1",
    });
  });

  it("a scanned token is sent as-is; an expired one shows a denied verdict with its reason", async () => {
    const calls: Call[] = [];
    renderWith("front_desk", <CheckInScreen />, calls, {
      "POST /schedule/check-ins": () =>
        json(201, {
          id: "c2",
          result: "denied",
          reason: "expired_token",
          member_id: "m1",
          full_name: "Socio Demo Uno",
          member_no: null,
          member_status: "active",
        }),
    });
    const input = await screen.findByLabelText("Código QR escaneado");
    await screen.findByRole("option", { name: "Sede Demo" });
    fireEvent.change(input, { target: { value: "v1.abc.123.def" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar código" }));
    const verdict = document.querySelector('[data-tour-id="checkin-result"]') as HTMLElement;
    await waitFor(() => expect(verdict.textContent).toContain("Acceso denegado"));
    expect(verdict.textContent).toContain("Código vencido");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      location_id: "l1",
      token: "v1.abc.123.def",
    });
  });
});

describe("Agenda", () => {
  const session = {
    id: "s1",
    location_id: "l1",
    class_type_id: "ct1",
    class_name: "Demo Spinning",
    instructor_id: null,
    instructor_name: "Demo Coach",
    room: "Salon 1",
    starts_at: new Date().toISOString(),
    ends_at: soon(1),
    capacity: 10,
    cancelled: false,
    booked: 10,
    waitlisted: 2,
  };

  it("owner sees 'Nueva sesión' and the week shows occupancy and waitlist", async () => {
    renderWith("owner", <AgendaScreen />, [], { "GET /schedule/sessions": { data: [session] } });
    const btn = await screen.findByRole("button", { name: "Nueva sesión" });
    expect(btn.getAttribute("data-tour-id")).toBe("schedule-session-new");
    expect(await screen.findByText("10/10 reservas")).toBeTruthy();
    expect(screen.getByText("2 en espera")).toBeTruthy();
  });

  it("trainer does not get 'Nueva sesión' and can open the roster to mark attendance", async () => {
    const calls: Call[] = [];
    renderWith("trainer", <AgendaScreen />, calls, {
      "GET /schedule/sessions": { data: [session] },
      "GET /schedule/sessions/s1/roster": {
        data: [
          {
            booking_id: "b1",
            member_id: "m1",
            full_name: "Socio Demo Uno",
            member_no: null,
            status: "booked",
            waitlist_position: null,
            late_cancel: false,
          },
        ],
      },
      "POST /schedule/bookings/b1/attendance": { id: "b1", status: "attended" },
    });
    const open = await screen.findByRole("button", { name: /^Ver lista/ });
    expect(screen.queryByRole("button", { name: "Nueva sesión" })).toBeNull();
    fireEvent.click(open);
    const mark = await screen.findByRole("button", { name: /^Asistió\s*: Socio Demo Uno$/ });
    fireEvent.click(mark);
    await screen.findByText("Socio Demo Uno: Asistió.");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ status: "attended" });
  });
});

describe("Clases (member)", () => {
  it("a full class offers the waitlist; booking reports the position", async () => {
    const calls: Call[] = [];
    renderWith("member", <MyClassesScreen />, calls, {
      "GET /schedule/sessions": {
        data: [
          {
            id: "s9",
            location_id: "l1",
            class_type_id: "ct",
            class_name: "Demo Yoga",
            instructor_id: null,
            instructor_name: null,
            room: null,
            starts_at: soon(48),
            ends_at: soon(49),
            capacity: 5,
            cancelled: false,
            booked: 5,
            waitlisted: 1,
          },
        ],
      },
      "POST /schedule/bookings": { id: "b9", status: "waitlisted", waitlist_position: 2 },
    });
    expect(await screen.findByText("Llena · 1 en espera")).toBeTruthy();
    const btn = await screen.findByRole("button", {
      name: /^Unirme a la lista de espera\s*: Demo Yoga$/,
    });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText("Estás en la lista de espera de Demo Yoga (posición 2).");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      session_id: "s9",
      member_id: "m1",
    });
  });
});

describe("Mi credencial", () => {
  it("renders the QR, warns about screenshots and refreshes every 25 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const calls: Call[] = [];
    let n = 0;
    renderWith(
      "member",
      <MyCredentialScreen />,
      calls,
      {
        "GET /schedule/qr-token": () => {
          n += 1;
          return json(200, { token: `v1.m1.${n}.abc`, expires_at: soon(1), window_seconds: 30 });
        },
      },
      "en",
    );
    const img = await screen.findByRole("img", { name: "Access QR code for Socio Demo Uno" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText(/Screenshots stop working/)).toBeTruthy();
    expect(n).toBe(1);
    expect(QR_REFRESH_MS).toBe(25_000);
    await act(async () => {
      vi.advanceTimersByTime(QR_REFRESH_MS);
    });
    await waitFor(() => expect(n).toBe(2));
    const qrCalls = calls.filter((c) => c.path.startsWith("/schedule/qr-token"));
    expect(qrCalls.every((c) => c.path === "/schedule/qr-token?member_id=m1")).toBe(true);
  });
});
