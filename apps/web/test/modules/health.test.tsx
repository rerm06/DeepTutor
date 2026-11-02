import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { AssessmentsScreen } from "../../src/modules/health/AssessmentsScreen";
import { MyPlanScreen } from "../../src/modules/health/MemberScreens";
import { PlansScreen } from "../../src/modules/health/PlansScreen";
import { dict } from "../../src/modules/health/dict";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

const NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false };
const member = {
  id: "m1",
  status: "active",
  member_no: "A-1",
  home_location_id: "l1",
  full_name: "Socio Demo Uno",
  email: "socio1@demo.invalid",
};
const triage = (nutrition: "green" | "amber" | "red") => ({
  rule_version: "v0-propuesta",
  exercise_level: "green",
  nutrition_level: nutrition,
  requires_medical_referral: nutrition !== "green",
  emergency: false,
  no_calorie_counting: false,
  reasons: nutrition === "red" ? ["parq_all_no", "condition_active_ed"] : ["parq_all_no"],
});
const assessment = (nutrition: "green" | "amber" | "red") => ({
  id: "a1",
  member_id: "m1",
  member_name: member.full_name,
  evaluator_name: "Demo Entrenador",
  taken_at: "2026-10-01T12:00:00Z",
  parq: NO,
  parq_followup_resolved: false,
  declared_conditions: nutrition === "red" ? ["active_ed"] : [],
  resting_hr: 64,
  bp_sys: 118,
  bp_dia: 76,
  height_cm: 168,
  weight_kg: 70,
  waist_cm: 82,
  fitness_tests: {},
  acute_symptoms: false,
  status: "signed",
  signed_by_name: "Demo Entrenador",
  signed_at: "2026-10-01T12:00:00Z",
  triage: triage(nutrition),
});
const plan = (over: Record<string, unknown>) => ({
  id: "p1",
  member_id: "m1",
  member_name: member.full_name,
  series_id: "p1",
  kind: "nutrition",
  version: 1,
  status: "review",
  title: "Demo plan alimentario",
  body: { sections: [{ heading: "Estructura", items: ["Agua como bebida principal"] }] },
  rationale: null,
  created_by_name: "Demo",
  approver_name: null,
  approver_license_no: null,
  approved_at: null,
  published_at: null,
  ...over,
});

interface Backend {
  role: string;
  assessments?: unknown[];
  plans?: unknown[];
  staff?: Record<string, unknown> | null;
}
function backend(b: Backend) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
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
    if (url.includes("/members") && method === "GET") return json(200, { data: [member] });
    if (url.includes("/health/whoami")) return json(200, { role: b.role, staff: b.staff ?? null });
    if (url.includes("/health/assessments") && method === "GET")
      return json(200, { data: b.assessments ?? [] });
    if (url.includes("/health/plans") && method === "GET")
      return json(200, { data: b.plans ?? [] });
    return json(404, { error: "not_found" });
  };
}
function renderWith(b: Backend, ui: ReactNode, path = "/", lang: "es" | "en" = "es") {
  const storage = memoryStorage({
    "gym.demo.session": JSON.stringify({ token: "tok", persona: persona(b.role) }),
  });
  const api = createApiClient({ storage, fetchImpl: backend(b) as typeof fetch });
  return render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
          {ui}
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}
async function pickMember() {
  const select = await screen.findByLabelText("Socio");
  await screen.findByRole("option", { name: member.full_name });
  fireEvent.change(select, { target: { value: "m1" } });
}

describe("health module UI", () => {
  it("member 'Mi plan' shows the licensed sign-off line and the medical-device notice", async () => {
    renderWith(
      {
        role: "member",
        plans: [
          plan({
            status: "published",
            approver_name: "Valeria Quiñones",
            approver_license_no: "DEMO-N-0001",
            published_at: "2026-10-02T12:00:00Z",
          }),
        ],
      },
      <MyPlanScreen />,
    );
    expect(
      await screen.findByText(
        "Plan alimentario aprobado por Valeria Quiñones, licencia DEMO-N-0001",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("No es un dispositivo médico; consulta a un profesional de la salud."),
    ).toBeTruthy();
  });

  it("member never renders a non-published plan even if one were returned", async () => {
    renderWith(
      { role: "member", plans: [plan({ status: "review", title: "Borrador oculto" })] },
      <MyPlanScreen />,
    );
    expect(await screen.findByText("Aún no tienes planes publicados.")).toBeTruthy();
    expect(screen.queryByText("Borrador oculto")).toBeNull();
  });

  it("an unlicensed specialist cannot press Aprobar and is told why", async () => {
    renderWith(
      {
        role: "nutritionist",
        assessments: [assessment("green")],
        plans: [plan({})],
        staff: {
          staff_id: "s1",
          role: "nutritionist",
          display_name: "Demo",
          license_no: null,
          license_verified: false,
        },
      },
      <PlansScreen />,
    );
    await pickMember();
    const approve = await screen.findByRole("button", { name: /^Aprobar/ });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(approve.getAttribute("data-tour-id")).toBe("health-plan-approve");
    expect(screen.getByText("Aprobar requiere una licencia verificada.")).toBeTruthy();
  });

  it("a red nutrition triage blocks approval even for a licensed specialist, with coloured plates", async () => {
    renderWith(
      {
        role: "nutritionist",
        assessments: [assessment("red")],
        plans: [plan({})],
        staff: {
          staff_id: "s1",
          role: "nutritionist",
          display_name: "Valeria",
          license_no: "DEMO-N-0001",
          license_verified: true,
        },
      },
      <PlansScreen />,
    );
    await pickMember();
    expect(await screen.findByText("Firmas como Valeria, licencia DEMO-N-0001.")).toBeTruthy();
    expect(screen.getByText(/Triaje nutricional rojo/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Aprobar/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const plate = screen.getByText("Nutrición: Rojo");
    expect(plate.className).toContain("plate--blocked");
    expect(screen.getByText("Condición declarada: Trastorno alimentario activo")).toBeTruthy();
  });

  it("assessment form: PAR-Q+ yes/no groups, and acute symptoms raise the 911 banner at once", async () => {
    renderWith({ role: "trainer", assessments: [] }, <AssessmentsScreen />);
    await pickMember();
    const open = await screen.findByRole("button", { name: "Nueva evaluación" });
    expect(open.getAttribute("data-tour-id")).toBe("health-assessment-new");
    fireEvent.click(open);
    expect(screen.getAllByRole("radio").length).toBe(14);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Síntomas agudos ahora/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("llama al 911");
    expect(alert.getAttribute("data-tour-id")).toBe("health-emergency");
    // Save stays disabled until every PAR-Q+ question is answered.
    const save = screen.getByRole("button", { name: "Guardar borrador" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("navigation: health staff see Evaluaciones/Planes; front desk, chef and accountant do not; members get Mi plan", async () => {
    for (const role of ["trainer", "nutritionist", "clinician", "location_manager", "owner"]) {
      renderWith({ role }, <AppRoutes />, "/staff/members");
      const nav = await screen.findByRole("navigation");
      expect(nav.textContent, role).toContain("Evaluaciones");
      expect(nav.textContent, role).toContain("Planes");
      cleanup();
    }
    for (const role of ["front_desk", "chef", "accountant"]) {
      renderWith({ role }, <AppRoutes />, "/staff/health/assessments");
      const nav = await screen.findByRole("navigation");
      expect(nav.textContent, role).not.toContain("Evaluaciones");
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Socios"),
      );
      cleanup();
    }
    renderWith({ role: "member" }, <AppRoutes />, "/me/account");
    const nav = await screen.findByRole("navigation");
    expect(nav.textContent).toContain("Mi evaluación");
    expect(nav.textContent).toContain("Mi plan");
  });

  it("dictionary: same keys in ES and EN, and no regulated nutrition titles anywhere", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.es).sort());
    const all = [...Object.values(dict.es), ...Object.values(dict.en)].join(" ");
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/i);
  });

  it("English copy is available", async () => {
    renderWith(
      {
        role: "member",
        plans: [
          plan({
            status: "published",
            approver_name: "V",
            approver_license_no: "N-1",
            published_at: "2026-10-02T12:00:00Z",
          }),
        ],
      },
      <MyPlanScreen />,
      "/",
      "en",
    );
    expect(await screen.findByText("Meal plan approved by V, licence N-1")).toBeTruthy();
    expect(
      screen.getByText("This is not a medical device; consult a health professional."),
    ).toBeTruthy();
  });
});
