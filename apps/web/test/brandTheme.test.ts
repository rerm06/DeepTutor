import { describe, expect, it } from "vitest";
import { applyTheme, contrast, sanitizeTheme } from "../src/lib/brandTheme";

describe("brand theme safety", () => {
  it("keeps the Fitness R Us palette (AA with white text)", () => {
    const t = sanitizeTheme({
      logo_url: "/brand/fitnessrus-logo.png",
      colors: {
        accent: "#6D6128",
        accent_text: "#FFFFFF",
        header_bg: "#000000",
        header_text: "#FFFFFF",
      },
    });
    expect(t.colors?.accent).toBe("#6D6128");
    expect(t.colors?.header_bg).toBe("#000000");
    expect(contrast("#6D6128", "#FFFFFF")).toBeGreaterThan(4.5);
  });

  it("drops colours that would make text unreadable and non-hex values", () => {
    const t = sanitizeTheme({
      colors: { accent: "#FFFF66", accent_text: "#FFFFFF", highlight: "red" },
    });
    expect(t.colors?.accent).toBeUndefined();
    expect(t.colors?.highlight).toBeUndefined();
  });

  it("refuses logos outside /brand/ (no third-party or script URLs)", () => {
    for (const url of [
      "https://evil.invalid/x.png",
      "javascript:alert(1)",
      "/brand/../secret",
      "//evil.invalid/a.png",
    ]) {
      expect(sanitizeTheme({ logo_url: url }).logo_url).toBeUndefined();
    }
  });

  it("applies and removes CSS variables", () => {
    const root = document.createElement("div");
    const undo = applyTheme({ colors: { accent: "#6D6128" } }, root);
    expect(root.style.getPropertyValue("--accent")).toBe("#6D6128");
    undo();
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });
});
