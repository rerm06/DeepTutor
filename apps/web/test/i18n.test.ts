import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES, translate } from "../src/i18n/dict";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("i18n dictionary", () => {
  it("has identical keys in es and en", () => {
    expect(Object.keys(DICTIONARIES.en).sort()).toEqual(Object.keys(DICTIONARIES.es).sort());
  });

  it("has no empty strings and the same placeholders in both languages", () => {
    for (const [key, es] of Object.entries(DICTIONARIES.es)) {
      const en = DICTIONARIES.en[key as keyof typeof DICTIONARIES.en];
      expect(es.trim(), key).not.toBe("");
      expect(en.trim(), key).not.toBe("");
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(en), key).toEqual(ph(es));
    }
  });

  it("interpolates parameters", () => {
    expect(translate("es", "members.count", { n: 3 })).toBe("3 socios");
    expect(translate("en", "block.no_consent")).toBe("No consent for this channel and purpose");
    expect(translate("es", "block.no_consent")).toBe(
      "Sin consentimiento para este canal y propósito",
    );
  });

  it("never uses the regulated nutrition titles (Ley 82) anywhere in the app", () => {
    // Built from parts so the words themselves never appear in the codebase either.
    const forbidden = new RegExp(`${"nutri"}${"cionista"}|${"diet"}${"ista"}`, "i");
    for (const s of [...Object.values(DICTIONARIES.es), ...Object.values(DICTIONARIES.en)])
      expect(s).not.toMatch(forbidden);
    const root = join(__dirname, "..");
    const files = [...filesUnder(join(root, "src")), join(root, "index.html")];
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(forbidden);
  });
});
