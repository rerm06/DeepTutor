import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bestMatch, describeScreen, fillField, press } from "../src/lib/agent/bridge";
import {
  normalizeAnswer,
  spokenDate,
  spokenDigits,
  spokenEmail,
  spokenName,
} from "../src/lib/agent/spoken";

beforeAll(() => {
  (globalThis as { __AGENT_NO_LAYOUT__?: boolean }).__AGENT_NO_LAYOUT__ = true;
});
afterEach(cleanup);

/** A small React form that follows the app's `.field` convention, like every module form. */
function Form({ onSubmit }: { onSubmit?: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("");
  const [terms, setTerms] = useState(false);
  const [loc, setLoc] = useState("");
  const emailErr =
    email && !/@demo\.invalid$/.test(email) ? "Usa un correo @demo.invalid" : undefined;
  return (
    <main>
      <h1>Nuevo socio</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="field">
          <label htmlFor="n">Nombre completo</label>
          <input id="n" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="e">Correo electrónico</label>
          <input
            id="e"
            type="email"
            value={email}
            data-live-error={emailErr}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p">Plan</label>
          <select id="p" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Elige</option>
            <option value="s1">Sesión suelta</option>
            <option value="b10">Paquete de 10 sesiones</option>
          </select>
        </div>
        <fieldset>
          <legend>Sede</legend>
          <label>
            <input type="radio" name="loc" checked={loc === "a"} onChange={() => setLoc("a")} />{" "}
            Bayamón
          </label>
          <label>
            <input type="radio" name="loc" checked={loc === "b"} onChange={() => setLoc("b")} />{" "}
            Caguas
          </label>
        </fieldset>
        <div className="field">
          <label>
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />{" "}
            Acepto los términos
          </label>
        </div>
        <output data-testid="state">{JSON.stringify({ name, email, plan, loc, terms })}</output>
        <button type="submit">Crear socio</button>
        <button type="button">Cobrar $25.00</button>
      </form>
    </main>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");

describe("bridge: describe_screen", () => {
  it("lists fields (radio group as one), manual consents, actions and protected actions", () => {
    render(<Form />);
    const s = describeScreen();
    expect(s.title).toBe("Nuevo socio");
    expect(s.fields.map((f) => [f.label, f.kind])).toEqual([
      ["Nombre completo", "text"],
      ["Correo electrónico", "email"],
      ["Plan", "select"],
      ["Sede", "radio"],
      ["Acepto los términos", "checkbox"],
    ]);
    expect(s.fields.find((f) => f.kind === "checkbox")?.manual).toBe(true);
    expect(s.fields.find((f) => f.kind === "select")?.options).toEqual([
      "Sesión suelta",
      "Paquete de 10 sesiones",
    ]);
    expect(s.actions).toEqual([
      { name: "Crear socio", kind: "submit", protected: false },
      { name: "Cobrar $25.00", kind: "button", protected: true },
    ]);
  });
});

describe("bridge: fill_field drives React state", () => {
  it("text, select (by option text), radio (by label) — marked as AI-filled", async () => {
    render(<Form />);
    expect((await fillField("nombre", "Ana Rivera")).ok).toBe(true);
    expect((await fillField("Plan", "paquete de 10")).value).toBe("Paquete de 10 sesiones");
    expect((await fillField("Sede", "caguas")).ok).toBe(true);
    expect(state()).toMatchObject({ name: "Ana Rivera", plan: "b10", loc: "b" });
    expect(document.querySelector("#n")?.closest(".field")?.getAttribute("data-filled-by")).toBe(
      "ai",
    );
  });

  it("returns the form's live validation message", async () => {
    render(<Form />);
    const bad = await fillField("correo", "ana@gmail.com");
    expect(bad).toMatchObject({
      ok: true,
      state: "invalid",
      message: "Usa un correo @demo.invalid",
    });
    const good = await fillField("correo", "ana@demo.invalid");
    expect(good).toMatchObject({ ok: true, state: "valid" });
  });

  it("never ticks a consent box", async () => {
    render(<Form />);
    const r = await fillField("Acepto los términos", "true");
    expect(r).toMatchObject({ ok: false, error: "manual_only" });
    expect(state().terms).toBe(false);
  });

  it("unknown field / option are reported, not guessed", async () => {
    render(<Form />);
    expect((await fillField("Seguro social", "123")).error).toBe("field_not_found");
    expect((await fillField("Plan", "anual ilimitado")).error).toBe("option_not_found");
  });
});

describe("bridge: press", () => {
  it("money actions need the person's tap; submit needs an explicit confirmation", async () => {
    let sent = 0;
    render(<Form onSubmit={() => sent++} />);
    expect(await press("cobrar")).toMatchObject({ ok: false, error: "needs_user_tap" });
    expect(screen.getByText("Cobrar $25.00").getAttribute("data-agent-highlight")).toBe("true");
    expect(await press("crear socio")).toMatchObject({ ok: false, error: "needs_confirmation" });
    expect(sent).toBe(0);
    expect((await press("crear socio", true)).ok).toBe(true);
    expect(sent).toBe(1);
  });
});

describe("spoken answers", () => {
  it("emails dictated in Spanish or English", () => {
    expect(spokenEmail("Ana punto Rivera arroba demo punto invalid")).toBe(
      "ana.rivera@demo.invalid",
    );
    expect(spokenEmail("luis guion bajo ortiz at demo dot invalid")).toBe(
      "luis_ortiz@demo.invalid",
    );
  });
  it("digits from words or numbers", () => {
    expect(spokenDigits("siete ocho siete 555 cero uno cuatro dos")).toBe("7875550142");
    expect(spokenDigits("(787) 555-0142")).toBe("7875550142");
  });
  it("dates", () => {
    expect(spokenDate("15 de marzo de 1990")).toBe("1990-03-15");
    expect(spokenDate("March 15, 1990", "en")).toBe("1990-03-15");
    expect(spokenDate("15/03/1990", "es")).toBe("1990-03-15");
    expect(spokenDate("03/15/1990", "en")).toBe("1990-03-15");
    expect(spokenDate("31 de febrero de 1990")).toBeNull();
  });
  it("names and kinds", () => {
    expect(spokenName("ana maría rivera")).toBe("Ana María Rivera");
    expect(normalizeAnswer("tel", "Teléfono", "787 555 0142", "es")).toBe("7875550142");
    expect(normalizeAnswer("checkbox", "x", "sí, márcalo", "es")).toBe("true");
  });
  it("fuzzy matching prefers exact, then prefix, then containment", () => {
    expect(bestMatch("agenda", ["Inicio", "Agenda / Clases", "Pagos"])).toBe(1);
    expect(bestMatch("pagos y pos", ["Inicio", "Pagos y POS", "Tienda"])).toBe(1);
    expect(bestMatch("zzz", ["Inicio"])).toBe(-1);
  });
});
