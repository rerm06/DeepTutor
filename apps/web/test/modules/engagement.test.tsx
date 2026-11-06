import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { module } from "../../src/modules/engagement";
import { MyPointsScreen, WallScreen } from "../../src/modules/engagement/MemberScreens";
import { StaffChallengesScreen } from "../../src/modules/engagement/StaffChallengesScreen";
import { StaffPointsScreen } from "../../src/modules/engagement/StaffPointsScreen";
import { dict } from "../../src/modules/engagement/dict";
import { allows } from "../../src/modules/types";
import { SessionProvider } from "../../src/session/SessionContext";
import { json, memoryStorage, persona } from "../helpers";

afterEach(cleanup);

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Canned /v1 responses for the engagement screens; records every call. */
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
            brand_id: "b1",
            timezone: "America/Puerto_Rico",
            municipality: "Demo",
          },
        ],
      });
    if (path === "/members")
      return json(200, {
        data: [
          {
            id: "m1",
            status: "active",
            member_no: "1",
            home_location_id: "l1",
            full_name: "Socia Demo",
            email: "s@demo.invalid",
          },
        ],
      });
    if (path === "/engagement/posts" && method === "GET")
      return json(200, {
        data: [
          {
            id: "p-ok",
            author_member_id: "m2",
            author_label: "Luis V.",
            body: "Gran clase hoy",
            status: "approved",
            location_id: "l1",
            created_at: "2026-11-01T12:00:00Z",
            moderated_at: "2026-11-01T13:00:00Z",
          },
          {
            id: "p-mine",
            author_member_id: "m1",
            author_label: "Socia D.",
            body: "Mi mensaje en revisión",
            status: "pending",
            location_id: "l1",
            created_at: "2026-11-02T12:00:00Z",
            moderated_at: null,
          },
        ],
      });
    if (path === "/engagement/posts" && method === "POST")
      return json(201, { id: "p-new", status: "pending" });
    if (path === "/engagement/challenges")
      return json(200, {
        data: [
          {
            id: "c1",
            name: "Reto Demo Noviembre",
            kind: "individual",
            metric: "visits",
            location_id: null,
            starts_on: "2026-11-01",
            ends_on: "2026-11-30",
            goal: 8,
            leaderboard_opt_in_default: false,
          },
        ],
      });
    if (path === "/engagement/challenges/c1/leaderboard")
      return json(200, {
        data: [
          { division: "individual", rank: 1, label: "Ana R.", progress: 3, goal: 8, is_me: false },
        ],
      });
    if (path === "/engagement/challenges/c1/participants")
      return json(200, {
        data: [
          {
            id: "cp1",
            member_id: "m9",
            member_name: "Ana Rivera Demo",
            team_id: null,
            show_on_leaderboard: true,
            compare_mode: "ranked",
            progress: 3,
            goal_reached_at: null,
          },
        ],
      });
    if (path === "/engagement/members/m1/points")
      return json(200, {
        member_id: "m1",
        balance: 425,
        weekly_streak: 3,
        history: [
          {
            id: "h1",
            delta: 10,
            reason: "visit",
            ref: null,
            note: null,
            at: "2026-11-02T12:00:00Z",
          },
        ],
        achievements: [{ code: "first_visit", ref: null, earned_at: "2026-10-01T12:00:00Z" }],
      });
    if (path === "/engagement/liability")
      return json(200, { outstanding_points: 1234, members_with_balance: 7 });
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

describe("engagement · module contract", () => {
  it("routes and nav follow the role rules (guardians never post, refer or redeem; accountant sees Points only)", () => {
    const path = (p: string) => module.routes.find((r) => r.path === p);
    for (const p of ["/me/wall", "/me/refer", "/me/redeem"]) {
      expect(allows(path(p)?.audience ?? [], "member"), p).toBe(true);
      expect(allows(path(p)?.audience ?? [], "guardian"), p).toBe(false);
    }
    expect(allows(path("/me/points")?.audience ?? [], "guardian")).toBe(true);
    expect(allows(path("/staff/engagement/points")?.audience ?? [], "accountant")).toBe(true);
    expect(allows(path("/staff/engagement/challenges")?.audience ?? [], "accountant")).toBe(false);
    expect(allows(path("/staff/engagement/challenges")?.audience ?? [], "trainer")).toBe(true);
    expect(allows(path("/staff/engagement/community")?.audience ?? [], "trainer")).toBe(false);
    for (const role of ["chef", "nutritionist", "clinician"])
      expect(module.nav.filter((n) => allows(n.audience, role))).toEqual([]);
    for (const n of module.nav) expect(n.label.es && n.label.en).toBeTruthy();
  });

  it("the ES and EN dictionaries carry the same keys and never use the regulated nutrition titles", () => {
    expect(Object.keys(dict.es).sort()).toEqual(Object.keys(dict.en).sort());
    const all = JSON.stringify(dict).toLowerCase();
    expect(all).not.toMatch(/nutricionista|dietista|nutritionist|dietitian/);
  });
});

describe("engagement · member wall", () => {
  it("shows approved posts, the member's own pending post, and sends a new post to moderation", async () => {
    const b = renderAs("member", <WallScreen />);
    await screen.findByText("Gran clase hoy");
    expect(screen.getByText("Mi mensaje en revisión")).toBeTruthy();
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(0);

    const send = screen.getByRole("button", { name: "Enviar a revisión" });
    expect(send.getAttribute("data-tour-id")).toBe("eng-wall-post");
    fireEvent.click(send);
    expect((await screen.findByRole("alert")).textContent).toContain("Escribe algo");

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "¡Hola comunidad!" } });
    expect(screen.getByText("16 de 500")).toBeTruthy();
    fireEvent.click(send);
    await screen.findByText("Tu publicación quedó pendiente de revisión.");
    const post = b.calls.find((c) => c.method === "POST" && c.url.endsWith("/engagement/posts"));
    expect(post?.body).toEqual({ member_id: "m1", body: "¡Hola comunidad!" });
  });
});

describe("engagement · staff", () => {
  it("challenges: the leaderboard shows what the server returns (opt-in only) and participants for front desk", async () => {
    renderAs("front_desk", <StaffChallengesScreen />);
    const open = await screen.findByRole("button", { name: /Ver.*Reto Demo Noviembre/ });
    expect(open.getAttribute("data-tour-id")).toBe("eng-challenge-open");
    expect(screen.queryByRole("button", { name: "Crear reto" })).toBeNull(); // front desk does not configure
    fireEvent.click(open);
    const board = await screen.findByTestId("eng-leaderboard");
    expect(within(board).getByText("Ana R.")).toBeTruthy();
    await screen.findByText("Ana Rivera Demo");
  });

  it("points: the accountant sees only the liability; the owner also gets rules and the manual award", async () => {
    renderAs("accountant", <StaffPointsScreen />);
    await screen.findByText("1234");
    expect(screen.queryByRole("button", { name: "Otorgar" })).toBeNull();
    cleanup();
    renderAs("owner", <StaffPointsScreen />);
    await screen.findByText("1234");
    const award = screen.getByRole("button", { name: "Otorgar" });
    expect(award.getAttribute("data-tour-id")).toBe("eng-manual-award");
  });
});

describe("engagement · my points (EN)", () => {
  it("shows balance, weekly streak and achievements in English", async () => {
    renderAs("member", <MyPointsScreen />, "en");
    await screen.findByText("425");
    expect(screen.getByText("Weekly streak")).toBeTruthy();
    expect(screen.getByText("3 weeks")).toBeTruthy();
    expect(screen.getByText("First visit")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("My points"),
    );
  });
});
