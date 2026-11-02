import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../src/App";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { JoinScreen, ageOn, normalizePhone, validate } from "../../src/modules/signup/JoinScreen";
import { JoinWelcome } from "../../src/modules/signup/JoinWelcome";
import { SESSION_KEY, WELCOME_KEY, joinEnv } from "../../src/modules/signup/api";
import { DEMO_JOIN_ORGS } from "../../src/modules/signup/demoOrgs";
import { dict } from "../../src/modules/signup/dict";
import { module as signupModule } from "../../src/modules/signup/index";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage } from "../helpers";

const ORG = "a0000000-0000-4000-8000-000000000001";
const INFO = {
  org_id: ORG,
  org_name: "Fitness R Us",
  brand: {
    id: "b1",
    name: "Fitness R Us",
    theme: {
      logo_url: "/brand/fitnessrus-logo.png",
      logo_alt: "Fitness R Us",
      colors: { accent: "#6D6128", accent_text: "#FFFFFF" },
      tagline_es: "Solo pagas tu sesión de entrenamiento",
    },
  },
  locations: [
    { id: "l1", name: "Demo Sede San Juan", municipality: "San Juan", brand_id: "b1" },
    { id: "l2", name: "Demo Sede Bayamón", municipality: "Bayamón", brand_id: "b1" },
  ],
  agreements: (["terms", "waiver", "sms_reminder", "sms_marketing"] as const).flatMap((kind) =>
    (["es", "en"] as const).map((locale) => ({
      kind,
      version: "v2026-11",
      locale,
      title: `${kind} ${locale}`,
      body: `Texto ${kind} ${locale}. Responde BAJA o STOP.`,
    })),
  ),
  model: { pay_per_session: true, session_from_cents: 1500 },
};

type Call = { method: string; path: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let store: ReturnType<typeof memoryStorage>;
let go: ReturnType<typeof vi.fn>;
const original = { ...joinEnv };

function backend(
  post: (b: Record<string, unknown>) => Response,
  info: () => Response = () => json(200, INFO),
) {
  joinEnv.fetch = async (input, init) => {
    const url = new URL(String(input), "http://x");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
    if (url.pathname === `/api/v1/public/join/${ORG}`) return info();
    if (url.pathname === "/api/v1/public/join" && init?.method === "POST") return post(body);
    return json(404, { error: "not_found" });
  };
}

beforeEach(() => {
  calls = [];
  store = memoryStorage();
  go = vi.fn();
  joinEnv.storage = () => store;
  joinEnv.go = go as unknown as (url: string) => void;
});
afterEach(() => {
  cleanup();
  Object.assign(joinEnv, original);
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-branded");
});

function renderJoin(lang: "es" | "en" = "es") {
  const api = createApiClient({
    storage: memoryStorage(),
    fetchImpl: (async () => json(404, {})) as typeof fetch,
  });
  return render(
    <I18nProvider lang={lang}>
      <SessionProvider api={api}>
        <MemoryRouter initialEntries={[`/join/${ORG}`]} future={ROUTER_FUTURE}>
          <Routes>
            <Route path="/join/:orgId" element={<JoinScreen />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

const es = dict.es;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
function fill(over: Partial<Record<"name" | "email" | "phone" | "birth", string>> = {}) {
  fireEvent.click(screen.getByLabelText(/Demo Sede San Juan/));
  fireEvent.change(field(es["form.name"]), { target: { value: over.name ?? "Lucía Torres Demo" } });
  fireEvent.change(field(es["form.email"]), {
    target: { value: over.email ?? "lucia@demo.invalid" },
  });
  fireEvent.change(field(es["form.phone"]), { target: { value: over.phone ?? "" } });
  fireEvent.change(field(es["form.birth"]), { target: { value: over.birth ?? "1990-05-15" } });
  fireEvent.click(field(es["form.acceptTerms"]));
  fireEvent.click(field(es["form.acceptWaiver"]));
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: es["form.submit"] }));

describe("signup · public join page", () => {
  it("shows the brand, the pay-per-session model and the open locations; applies the brand colours", async () => {
    backend(() => json(500, {}));
    renderJoin();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Únete a Fitness R Us" }),
    ).toBeTruthy();
    expect(screen.getByAltText("Fitness R Us")).toBeTruthy();
    for (const k of [
      "model.noMonthly",
      "model.noContract",
      "model.noEnrolment",
      "model.noMaintenance",
    ] as const)
      expect(screen.getByText(es[k])).toBeTruthy();
    expect(
      screen.getByText(/Solo pagas tu sesión de entrenamiento · desde \$15\.00 \+ IVU/),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#6D6128");
    expect(
      screen.getByRole("button", { name: es["form.submit"] }).getAttribute("data-tour-id"),
    ).toBe("join-submit");
  });

  it("SMS consent boxes start unchecked, carry the full TCPA text, and the agreements are versioned", async () => {
    backend(() => json(500, {}));
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    const reminders = field(es["form.smsReminders"]);
    const marketing = field(es["form.smsMarketing"]);
    expect(reminders.checked).toBe(false);
    expect(marketing.checked).toBe(false);
    expect(field(es["form.acceptTerms"]).checked).toBe(false);
    expect(field(es["form.acceptWaiver"]).checked).toBe(false);
    const desc = document.getElementById(marketing.getAttribute("aria-describedby") as string);
    expect(desc?.textContent).toContain("sms_marketing es");
    expect(desc?.textContent).toContain("STOP");
    expect(screen.getByText("Leer terms es (versión v2026-11)")).toBeTruthy();
  });

  it("an empty submit announces every error and marks the fields invalid; nothing is sent", async () => {
    backend(() => json(500, {}));
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    submit();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Revisa 6 campo(s):")).toBeTruthy();
    for (const k of [
      "err.location",
      "err.name",
      "err.email",
      "err.birth",
      "err.terms",
      "err.waiver",
    ] as const)
      expect(within(alert).getByText(es[k])).toBeTruthy();
    expect(field(es["form.name"]).getAttribute("aria-invalid")).toBe("true");
    const describedBy = field(es["form.email"]).getAttribute("aria-describedby") ?? "";
    expect(
      describedBy
        .split(" ")
        .some((id) => document.getElementById(id)?.textContent === es["err.email"]),
    ).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("inline validation: non-demo e-mail, bad phone, under 21, SMS without a phone", async () => {
    backend(() => json(500, {}));
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.change(field(es["form.email"]), { target: { value: "ana@gmail.com" } });
    fireEvent.blur(field(es["form.email"]));
    expect(screen.getByText(es["err.email"])).toBeTruthy();
    fireEvent.change(field(es["form.phone"]), { target: { value: "+1-787-555-0200" } });
    fireEvent.blur(field(es["form.phone"]));
    expect(screen.getByText(es["err.phone"])).toBeTruthy();
    const y = new Date().getFullYear() - 19;
    fireEvent.change(field(es["form.birth"]), { target: { value: `${y}-01-01` } });
    fireEvent.blur(field(es["form.birth"]));
    expect(screen.getByText(es["err.age"])).toBeTruthy();
    fireEvent.change(field(es["form.phone"]), { target: { value: "" } });
    fireEvent.click(field(es["form.smsReminders"]));
    submit();
    expect(within(screen.getByRole("alert")).getByText(es["err.smsPhone"])).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("success with a session: stores it, keeps unticked consents false, and opens /me/account", async () => {
    const session = {
      token: "tok-new",
      expires_in: 900,
      persona: {
        id: "join-1",
        org: "A",
        org_name: "Fitness R Us",
        role: "member",
        display_name: "Lucía Torres Demo",
        home: "Demo Sede San Juan",
      },
    };
    backend(() => json(202, { session, message: null }));
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    fill({ phone: "7875550142" });
    fireEvent.blur(field(es["form.phone"]));
    expect(field(es["form.phone"]).value).toBe("+1-787-555-0142");
    fireEvent.click(field(es["form.smsReminders"]));
    submit();
    await waitFor(() => expect(go).toHaveBeenCalledWith("/me/account"));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({
      org_id: ORG,
      location_id: "l1",
      full_name: "Lucía Torres Demo",
      email: "lucia@demo.invalid",
      phone: "+1-787-555-0142",
      birth_date: "1990-05-15",
      terms_version: "v2026-11",
      waiver_version: "v2026-11",
      accept_terms: true,
      accept_waiver: true,
      sms_reminders: true,
      sms_marketing: false,
      locale: "es",
    });
    expect(JSON.parse(store.getItem(SESSION_KEY) as string)).toEqual({
      token: "tok-new",
      persona: session.persona,
    });
    expect(JSON.parse(store.getItem(WELCOME_KEY) as string)).toEqual({
      name: "Lucía",
      brand: "Fitness R Us",
      location: "Demo Sede San Juan",
    });
  });

  it("no session (existing e-mail or demo off): a generic confirmation, no redirect, nothing stored", async () => {
    backend(() =>
      json(202, {
        session: null,
        message: "Recibimos tu solicitud. Si ya tienes cuenta, entra desde tu sede.",
      }),
    );
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    fill();
    submit();
    expect(await screen.findByRole("heading", { name: es["done.title"] })).toBeTruthy();
    expect(screen.getByText(/Si ya tienes cuenta, entra desde tu sede/)).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
    expect(store.getItem(SESSION_KEY)).toBeNull();
  });

  it("server refusals land on the right field (age) or the form (rate limit)", async () => {
    let answer = json(400, { error: "age_requires_guardian" });
    backend(() => answer);
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    fill();
    submit();
    expect(await within(screen.getByRole("alert")).findByText(es["err.age"])).toBeTruthy();
    expect(field(es["form.birth"]).getAttribute("aria-invalid")).toBe("true");
    answer = json(429, { error: "rate_limited" });
    fireEvent.change(field(es["form.birth"]), { target: { value: "1980-01-01" } });
    submit();
    expect(await screen.findByText(es["err.rate"])).toBeTruthy();
  });

  it("an org without online sign-up shows a clear note", async () => {
    backend(
      () => json(500, {}),
      () => json(404, { error: "not_found" }),
    );
    renderJoin();
    expect(await screen.findByText(es["join.notFound"])).toBeTruthy();
  });

  it("switches to English", async () => {
    backend(() => json(500, {}));
    renderJoin();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: es["join.langSwitchLabel"] }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Join Fitness R Us" }),
    ).toBeTruthy();
    expect(screen.getByLabelText(dict.en["form.smsMarketing"])).toBeTruthy();
  });
});

describe("signup · pure rules", () => {
  const ok = {
    location: "l1",
    name: "Ana Rivera",
    email: "ana@demo.invalid",
    phone: "",
    birth: "1990-01-01",
    terms: true,
    waiver: true,
    smsReminders: false,
    smsMarketing: false,
  };
  it("accepts a valid form and refuses each guard", () => {
    expect(validate(ok, "2026-11-02")).toEqual({});
    expect(validate({ ...ok, email: "ana@gmail.com" }, "2026-11-02").email).toBe("err.email");
    expect(validate({ ...ok, phone: "+1-212-555-0101" }, "2026-11-02").phone).toBe("err.phone");
    expect(validate({ ...ok, phone: "+1-939-555-0199" }, "2026-11-02").phone).toBeUndefined();
    expect(validate({ ...ok, birth: "2005-11-03" }, "2026-11-02").birth).toBe("err.age");
    expect(validate({ ...ok, birth: "2005-11-02" }, "2026-11-02").birth).toBeUndefined();
    expect(validate({ ...ok, birth: "2027-01-01" }, "2026-11-02").birth).toBe("err.birth");
    expect(validate({ ...ok, name: "{{brand}}" }, "2026-11-02").name).toBe("err.name");
    expect(validate({ ...ok, name: "www.evil.com" }, "2026-11-02").name).toBe("err.name");
    expect(validate({ ...ok, smsMarketing: true }, "2026-11-02").phone).toBe("err.smsPhone");
  });
  it("age and phone helpers", () => {
    expect(ageOn("2005-11-02", "2026-11-02")).toBe(21);
    expect(ageOn("2005-11-03", "2026-11-02")).toBe(20);
    expect(normalizePhone("(787) 555-0142")).toBe("+1-787-555-0142");
    expect(normalizePhone("1 939 555 0101")).toBe("+1-939-555-0101");
    expect(normalizePhone("abc")).toBe("abc");
  });
});

describe("signup · wiring", () => {
  it("the entry screen offers Únete / Join for each demo org, and /join is reachable without a session", async () => {
    const api = createApiClient({
      storage: memoryStorage(),
      fetchImpl: (async (input: RequestInfo | URL) =>
        String(input).endsWith("/demo/personas")
          ? json(200, {
              data: [
                {
                  id: "A-owner",
                  org: "A",
                  org_name: "Fitness R Us",
                  role: "owner",
                  display_name: "Carmen",
                  home: null,
                },
                {
                  id: "B-owner",
                  org: "B",
                  org_name: "Demo Club Sur",
                  role: "owner",
                  display_name: "Héctor",
                  home: null,
                },
              ],
            })
          : json(404, {})) as typeof fetch,
    });
    render(
      <I18nProvider lang="es">
        <SessionProvider api={api}>
          <MemoryRouter initialEntries={["/"]} future={ROUTER_FUTURE}>
            <AppRoutes />
          </MemoryRouter>
        </SessionProvider>
      </I18nProvider>,
    );
    const a = await screen.findByRole("link", { name: "Únete a Fitness R Us" });
    expect(a.getAttribute("href")).toBe(`/join/${DEMO_JOIN_ORGS.A}`);
    expect(a.getAttribute("data-tour-id")).toBe("entry-join");
    expect(screen.getByRole("link", { name: "Únete a Demo Club Sur" }).getAttribute("href")).toBe(
      `/join/${DEMO_JOIN_ORGS.B}`,
    );
    backend(() => json(500, {}));
    await act(async () => {
      fireEvent.click(a);
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Únete a Fitness R Us" }),
    ).toBeTruthy();
    // Public screen: no app shell navigation.
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("welcome note with the three next steps; dismiss removes it for good", () => {
    store.setItem(
      WELCOME_KEY,
      JSON.stringify({ name: "Lucía", brand: "Fitness R Us", location: "Demo Sede San Juan" }),
    );
    render(
      <I18nProvider lang="es">
        <MemoryRouter future={ROUTER_FUTURE}>
          <JoinWelcome />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "¡Bienvenido a Fitness R Us, Lucía!" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: es["welcome.step1"] }).getAttribute("href")).toBe(
      "/me/membership",
    );
    expect(screen.getByRole("link", { name: es["welcome.step2"] }).getAttribute("href")).toBe(
      "/me/classes",
    );
    expect(screen.getByRole("link", { name: es["welcome.step3"] }).getAttribute("href")).toBe(
      "/me/credential",
    );
    fireEvent.click(screen.getByRole("button", { name: es["welcome.dismiss"] }));
    expect(screen.queryByRole("heading", { name: /Bienvenido/ })).toBeNull();
    expect(store.getItem(WELCOME_KEY)).toBeNull();
  });

  it("module export: switch for owner/manager, agreements tab for front of house; ES/EN keys match", () => {
    expect(signupModule.routes.map((r) => [r.path, r.audience])).toEqual([
      ["/staff/online-join", ["owner", "location_manager"]],
    ]);
    expect(signupModule.memberTabs?.[0]?.audience).toEqual([
      "owner",
      "location_manager",
      "front_desk",
    ]);
    expect(Object.keys(dict.es).sort()).toEqual(Object.keys(dict.en).sort());
    expect(JSON.stringify(dict).toLowerCase()).not.toMatch(
      /nutricionista|dietista|nutritionist|dietitian/,
    );
  });
});
