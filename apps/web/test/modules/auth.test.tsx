import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { StaffSignIn } from "../../src/modules/access/StaffSignIn";
import { joinEnv } from "../../src/modules/signup/api";
import { memoryStorage } from "../helpers";

afterEach(cleanup);
const PERSONA = {
  id: "pw-1",
  org: "A",
  org_name: "Fitness R Us",
  org_logo_url: null,
  role: "owner",
  display_name: "Dueña",
  home: null,
};

describe("staff sign-in", () => {
  it("first sign-in → new password (checked live) → session stored with refresh → home", async () => {
    const bodies: unknown[] = [];
    vi.spyOn(joinEnv, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      bodies.push(JSON.parse(String(init?.body)));
      if (url.endsWith("/public/auth/password"))
        return new Response(JSON.stringify({ must_change: true }), { status: 200 });
      return new Response(
        JSON.stringify({
          session: { token: "tok", refresh: "r".repeat(64), expires_in: 900, persona: PERSONA },
        }),
        { status: 200 },
      );
    });
    const go = vi.spyOn(joinEnv, "go").mockImplementation(() => {});
    const store = memoryStorage();
    vi.spyOn(joinEnv, "storage").mockReturnValue(store);
    render(
      <I18nProvider lang="es">
        <MemoryRouter future={ROUTER_FUTURE}>
          <StaffSignIn />
        </MemoryRouter>
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "duena@ejemplo.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Password" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    const next = await screen.findByLabelText("Nueva contraseña");
    const save = screen.getByRole("button", { name: "Guardar y entrar" });
    fireEvent.change(next, { target: { value: "Password" } });
    expect(save).toHaveProperty("disabled", true); // under 10 characters
    fireEvent.change(next, { target: { value: "Gimnasio-Seguro-2026" } });
    fireEvent.change(screen.getByLabelText("Repite la nueva contraseña"), {
      target: { value: "Gimnasio-Seguro-2026" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(go).toHaveBeenCalledWith("/"));
    expect(bodies[1]).toEqual({
      email: "duena@ejemplo.com",
      password: "Password",
      new_password: "Gimnasio-Seguro-2026",
    });
    expect(JSON.parse(store.getItem("gym.demo.session") ?? "{}")).toMatchObject({
      token: "tok",
      refresh: "r".repeat(64),
    });
  });

  it("shows the lockout message", async () => {
    vi.spyOn(joinEnv, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "locked" }), { status: 401 }),
    );
    render(
      <I18nProvider lang="es">
        <MemoryRouter future={ROUTER_FUTURE}>
          <StaffSignIn />
        </MemoryRouter>
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "duena@ejemplo.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    await screen.findByText(/bloqueada 15 minutos/);
  });
});

describe("session renewal", () => {
  it("an expired access token is renewed with the refresh token (not the demo persona)", async () => {
    const store = memoryStorage();
    store.setItem(
      "gym.demo.session",
      JSON.stringify({ token: "old", persona: PERSONA, refresh: "a".repeat(64) }),
    );
    const calls: string[] = [];
    const api = createApiClient({
      storage: store,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        calls.push(`${url} ${auth}`);
        if (url.endsWith("/public/session/refresh"))
          return new Response(
            JSON.stringify({
              session: { token: "new", refresh: "b".repeat(64), persona: PERSONA },
            }),
            { status: 200 },
          );
        if (auth === "Bearer old")
          return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
        return new Response(
          JSON.stringify({ organization: { id: "o", name: "x", saas_plan: "pro" } }),
          { status: 200 },
        );
      },
    });
    await api.me();
    expect(calls.some((c) => c.includes("/demo/session"))).toBe(false);
    expect(JSON.parse(store.getItem("gym.demo.session") ?? "{}")).toMatchObject({
      token: "new",
      refresh: "b".repeat(64),
    });
  });
});
