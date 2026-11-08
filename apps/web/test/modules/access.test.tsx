import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { ROUTER_FUTURE } from "../../src/lib/roles";
import { CodeSignIn } from "../../src/modules/access/SignIn";
import { doorUrl, tokenFromScan } from "../../src/modules/access/api";
import { joinEnv } from "../../src/modules/signup/api";

afterEach(cleanup);
const TOKEN = "d1.a0000000-0000-4000-8000-000000000002.i.59000000.0123456789abcdef0123456789abcdef";
const ORG = "a0000000-0000-4000-8000-000000000001";

describe("door code helpers", () => {
  it("builds the URL a phone camera opens and reads it back", () => {
    const url = doorUrl(TOKEN, ORG);
    expect(url).toContain(`/door/${TOKEN}?o=${ORG}`);
    expect(tokenFromScan(url)).toBe(TOKEN);
    expect(tokenFromScan(TOKEN)).toBe(TOKEN);
    expect(tokenFromScan("https://example.com/whatever")).toBeNull();
    // A member credential (v1.…) is not a door code.
    expect(
      tokenFromScan(
        "v1.a0000000-0000-4000-8000-000000000002.59000000.0123456789abcdef0123456789abcdef",
      ),
    ).toBeNull();
  });
});

describe("sign-in with a code", () => {
  it("e-mail → demo code shown → verify → session adopted into the portal", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(joinEnv, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, body });
      if (url.endsWith("/public/login/start"))
        return new Response(JSON.stringify({ sent: true, expires_in: 600, demo_code: "482913" }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({
          session: {
            token: "t",
            expires_in: 900,
            persona: {
              id: "login-1",
              org: "A",
              org_name: "Fitness R Us",
              org_logo_url: null,
              role: "member",
              display_name: "Ana",
              home: "San Juan",
            },
          },
        }),
        { status: 200 },
      );
    });
    const go = vi.spyOn(joinEnv, "go").mockImplementation(() => {});
    render(
      <I18nProvider lang="es">
        <MemoryRouter future={ROUTER_FUTURE}>
          <CodeSignIn gyms={[{ id: ORG, name: "Fitness R Us" }]} next="/me/home" />
        </MemoryRouter>
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "ana@demo.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Recibir código/ }));
    await screen.findByText(/tu código es 482913/);
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), {
      target: { value: "48-29 13" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("/me/home"));
    expect(calls[1]).toMatchObject({
      body: { org_id: ORG, email: "ana@demo.invalid", code: "482913" },
    });
  });

  it("explains a missing delivery channel outside the demo", async () => {
    vi.spyOn(joinEnv, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "login_delivery_unavailable" }), { status: 503 }),
    );
    render(
      <I18nProvider lang="es">
        <MemoryRouter future={ROUTER_FUTURE}>
          <CodeSignIn gyms={[{ id: ORG, name: "Fitness R Us" }]} />
        </MemoryRouter>
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "ana@demo.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Recibir código/ }));
    await screen.findByText(/aún no está configurado/);
  });
});
