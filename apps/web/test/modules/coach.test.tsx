import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { ChatScreen } from "../../src/modules/coach/ChatScreen";
import { MemoryScreen } from "../../src/modules/coach/MemoryScreen";
import { CoachMemberTab } from "../../src/modules/coach/StaffTabs";
import { TodayScreen } from "../../src/modules/coach/TodayScreen";
import { dict } from "../../src/modules/coach/dict";
import { module as coach } from "../../src/modules/coach/index";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const member = {
  id: "m1",
  status: "active",
  member_no: "A-1",
  home_location_id: "l1",
  full_name: "Socio Demo Uno",
  email: "socio1@demo.invalid",
};

interface Backend {
  role: string;
  enabled?: boolean;
  chat?: Record<string, unknown>;
  today?: Record<string, unknown>;
  memory?: unknown[];
  summary?: Record<string, unknown>;
}
function backend(b: Backend, calls: Array<{ method: string; url: string }>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.endsWith("/me"))
      return json(200, {
        organization: { id: "o1", name: "Org Demo A", saas_plan: "pro" },
        person: { id: "x", email: "p@demo.invalid" },
        role: b.role,
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
            municipality: "San Juan",
          },
        ],
      });
    if (url.includes("/members") && method === "GET" && !url.includes("/coach/"))
      return json(200, { data: [member] });
    if (url.endsWith("/coach/status"))
      return json(200, { provider: b.enabled ? "scripted" : "disabled", enabled: !!b.enabled });
    if (url.endsWith("/coach/chat")) return json(200, b.chat ?? {});
    if (url.includes("/coach/actions/") && url.endsWith("/confirm"))
      return json(200, { id: "a1", status: "executed", error: null });
    if (url.includes("/coach/today")) return json(200, b.today ?? {});
    if (url.includes("/coach/memory") && method === "GET")
      return json(200, { member_id: "m1", data: b.memory ?? [] });
    if (url.includes("/coach/members/")) return json(200, b.summary ?? {});
    return json(404, { error: "not_found" });
  };
}
function renderWith(b: Backend, ui: ReactNode, lang: "es" | "en" = "es") {
  const calls: Array<{ method: string; url: string }> = [];
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(b.role) }),
  });
  const api = createApiClient({ storage, fetchImpl: backend(b, calls) as typeof fetch });
  render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter future={ROUTER_FUTURE}>{ui}</MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
  return calls;
}

describe("coach module UI", () => {
  it("chat without a provider: disabled state, AI disclosure and 'Hablar con una persona'", async () => {
    renderWith({ role: "member", enabled: false }, <ChatScreen />);
    expect(
      await screen.findByText(
        "El coach conversacional se activa cuando el gimnasio configure su proveedor de IA. Mientras tanto, usa Hoy y Mi memoria.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Estás hablando con una inteligencia artificial/)).toBeTruthy();
    const human = screen.getByRole("button", { name: "Hablar con una persona" });
    expect(human.getAttribute("data-tour-id")).toBe("coach-chat-human");
  });

  it("a proposed action is only a card until the member confirms it", async () => {
    const calls = renderWith(
      {
        role: "member",
        enabled: true,
        chat: {
          enabled: true,
          reply: "Te dejé una propuesta para que la confirmes o la rechaces.",
          emergency: false,
          human_handoff: false,
          proposals: [
            {
              id: "a1",
              tool: "book_class",
              summary: "Reservar la clase Yoga del 04/11/2026 18:00",
            },
          ],
        },
      },
      <ChatScreen />,
    );
    const input = await screen.findByLabelText("Escribe tu mensaje");
    fireEvent.change(input, { target: { value: "Resérvame yoga" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Reservar la clase Yoga del 04/11/2026 18:00")).toBeTruthy();
    expect(screen.getByText("Nada se registra ni se reserva hasta que confirmes.")).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/confirm"))).toBe(false);
    const confirm = screen.getByRole("button", { name: /^Confirmar/ });
    expect(confirm.getAttribute("data-tour-id")).toBe("coach-proposal-confirm");
    fireEvent.click(confirm);
    expect(await screen.findByText("Hecho.")).toBeTruthy();
    expect(
      calls.filter((c) => c.url.endsWith("/coach/actions/a1/confirm") && c.method === "POST"),
    ).toHaveLength(1);
  });

  it("an emergency reply shows the 911 banner from the health module", async () => {
    renderWith(
      {
        role: "member",
        enabled: false,
        chat: {
          enabled: false,
          reply: "Llama al 911 ahora.",
          emergency: true,
          human_handoff: false,
          proposals: [],
        },
      },
      <ChatScreen />,
    );
    fireEvent.change(await screen.findByLabelText("Escribe tu mensaje"), {
      target: { value: "dolor de pecho" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Emergencia: llama al 911")).toBeTruthy();
  });

  it("Hoy: baseline message, 'estimación' notice and a non-alarming 'habla con tu entrenador'", async () => {
    renderWith(
      {
        role: "member",
        today: {
          member_id: "m1",
          checkin: { id: "c1", score: null, escalated: true, emergency: false },
          band: "baseline",
          baseline_days: 3,
          plan: {
            id: "p1",
            title: "Demo plan de fuerza",
            approver_name: "Ricardo Santos",
            body: { sections: [] },
          },
          suggestion: "talk_to_trainer",
        },
      },
      <TodayScreen />,
    );
    expect(await screen.findByText("Estableciendo tu línea base: 3 de 7 días.")).toBeTruthy();
    expect(screen.getByText("Estimación, no es un dispositivo médico.")).toBeTruthy();
    expect(
      screen.getByText(/Habla con tu entrenador antes de entrenar; ya le avisamos/),
    ).toBeTruthy();
    expect(screen.getByText("Aprobado por Ricardo Santos")).toBeTruthy();
    expect(screen.queryByText(/fatiga|CNS|diagn/i)).toBeNull();
  });

  it("Hoy (EN) shows the check-in form when there is none yet", async () => {
    renderWith(
      {
        role: "member",
        today: {
          member_id: "m1",
          checkin: null,
          band: null,
          baseline_days: 0,
          plan: null,
          suggestion: "checkin_first",
        },
      },
      <TodayScreen />,
      "en",
    );
    expect(await screen.findByText("Today's check-in")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Send check-in" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(submit.getAttribute("data-tour-id")).toBe("coach-checkin-submit");
    expect(screen.getByText("Estimate, not a medical device.")).toBeTruthy();
  });

  it("Mi memoria lists facts and asks before deleting", async () => {
    renderWith(
      {
        role: "member",
        memory: [
          {
            id: "f1",
            category: "injury",
            topic: "injury_knee",
            content: "Molestia en la rodilla",
            source: "member",
            updated_at: "2026-11-01T12:00:00Z",
          },
        ],
      },
      <MemoryScreen />,
    );
    expect(await screen.findByText("Molestia en la rodilla")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Borrar/ }));
    expect(
      screen.getByText("¿Borrar «Molestia en la rodilla»? No se puede deshacer."),
    ).toBeTruthy();
  });

  it("staff Coach tab shows the trend and follow-ups; only trainer and location manager get the tab", async () => {
    renderWith(
      {
        role: "trainer",
        summary: {
          member_id: "m1",
          memory: [],
          checkins: [
            {
              id: "c1",
              local_date: "2026-11-01",
              sleep: 2,
              energy: 2,
              pain: 6,
              pain_area: "knee",
              pain_acute: false,
              note: null,
              score: null,
              baseline_days: 0,
              escalated: true,
              emergency: false,
            },
          ],
          escalations: [
            {
              id: "e1",
              reason: "checkin_pain",
              status: "open",
              created_at: "2026-11-01T12:00:00Z",
              assigned_to: "Demo Trainer",
              has_task: true,
            },
          ],
        },
      },
      <CoachMemberTab memberId="m1" />,
    );
    expect(await screen.findByText("Dolor en el check-in")).toBeTruthy();
    expect(screen.getByText("6/10 · Rodilla")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Marcar atendido" }).getAttribute("data-tour-id"),
    ).toBe("coach-esc-ack");
    const tab = coach.memberTabs?.find((x) => x.id === "coach");
    for (const role of ["trainer", "location_manager"])
      expect(allows(tab?.audience ?? [], role)).toBe(true);
    for (const role of ["owner", "front_desk", "chef", "accountant", "nutritionist", "member"])
      expect(allows(tab?.audience ?? [], role), role).toBe(false);
  });

  it("dictionary: same keys in ES and EN, no regulated nutrition titles", () => {
    expect(Object.keys(dict.es).sort()).toEqual(Object.keys(dict.en).sort());
    const all = JSON.stringify(dict);
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/i);
    expect(all).not.toMatch(/CNS|fatiga del sistema nervioso/i);
  });
});
