import { describe, expect, it } from "vitest";
import {
  buildVars,
  neededVars,
  normalizeVar,
  previewSegments,
  previewText,
} from "../src/lib/template";

const REMINDER =
  "{{brand}}: Hola {{name}}, te recordamos tu clase en {{location}} el {{date}} a las {{time}}.";
const FAILED =
  "{{brand}}: Hi {{name}}, we could not process your payment of {{amount}}. Update at {{link}}";

describe("template preview", () => {
  it("substitutes client variables and keeps server variables as placeholders", () => {
    const text = previewText(REMINDER, { date: "2026-11-20", time: "18:30" }, (n, kind) =>
      kind === "server" ? `<${n}:system>` : `<${n}:missing>`,
    );
    expect(text).toBe(
      "<brand:system>: Hola <name:system>, te recordamos tu clase en <location:system> el 2026-11-20 a las 18:30.",
    );
  });

  it("marks client variables that are still empty", () => {
    const segs = previewSegments(REMINDER, { date: "2026-11-20" });
    expect(segs.filter((s) => s.kind === "client")).toEqual([
      { kind: "client", name: "date", value: "2026-11-20" },
      { kind: "client", name: "time", value: null },
    ]);
    expect(
      segs.filter((s) => s.kind === "server").map((s) => s.kind === "server" && s.name),
    ).toEqual(["brand", "name", "location"]);
  });

  it("never substitutes server variables even if the client passes a value", () => {
    const vars = { amount: "$12.34", link: "https://evil.example" } as Record<string, string>;
    const text = previewText(FAILED, vars);
    expect(text).toContain("$12.34");
    expect(text).toContain("{{link}}");
    expect(text).not.toContain("evil");
  });

  it("knows which variables each template needs", () => {
    expect(neededVars("class.reminder", REMINDER)).toEqual(["date", "time"]);
    expect(neededVars("membership.renewal_notice", "")).toEqual(["date", "amount"]);
    expect(neededVars("payment.failed", FAILED)).toEqual(["amount"]);
    expect(neededVars("card.expiring", "")).toEqual(["last4", "date"]);
    expect(neededVars("promo.generic", "")).toEqual(["discount", "date"]);
    expect(neededVars("new.key", "{{brand}} {{time}} {{date}}")).toEqual(["date", "time"]);
  });

  it("normalizes form input to the contract formats", () => {
    expect(normalizeVar("date", "2026-02-30")).toBeNull();
    expect(normalizeVar("date", "2026-02-28")).toBe("2026-02-28");
    expect(normalizeVar("time", "7:05")).toBe("07:05");
    expect(normalizeVar("time", "24:00")).toBeNull();
    expect(normalizeVar("amount", "12.3")).toBe("$12.30");
    expect(normalizeVar("amount", "$1,250")).toBe("$1250.00");
    expect(normalizeVar("amount", "abc")).toBeNull();
    expect(normalizeVar("last4", "123")).toBeNull();
    expect(normalizeVar("last4", "4242")).toBe("4242");
    expect(normalizeVar("discount", "15")).toBe("15%");
    expect(normalizeVar("discount", "0")).toBeNull();
    expect(normalizeVar("discount", "100")).toBeNull();
  });

  it("sends only the variables the template needs", () => {
    const res = buildVars(["amount"], { amount: "9", date: "2026-01-01", time: "10:00" });
    expect(res).toEqual({ vars: { amount: "$9.00" }, invalid: [] });
    expect(buildVars(["date", "time"], { date: "2026-01-01" }).invalid).toEqual(["time"]);
  });
});
