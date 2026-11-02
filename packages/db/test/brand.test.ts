import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, asCaller, createTestDb } from "../src/testing.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t?.drop();
});

describe("brand theme guard (0015)", () => {
  it("accepts a safe theme from the owner", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
      tx.query(
        `UPDATE app.brand SET theme = '{"logo_url":"/brand/fitnessrus-logo.png","colors":{"accent":"#6D6128"}}' WHERE id = $1`,
        [t.fx.A.brandId],
      ),
    );
  });

  it.each([
    `{"logo_url":"https://evil.invalid/pixel.png"}`,
    `{"logo_url":"javascript:alert(1)"}`,
    `{"colors":{"accent":"red; background:url(x)"}}`,
    `{"tagline_es":"${"x".repeat(200)}"}`,
  ])("rejects unsafe theme %s", async (theme) => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(
        tx.query("UPDATE app.brand SET theme = $2::jsonb WHERE id = $1", [t.fx.A.brandId, theme]),
      ).rejects.toMatchObject({
        code: "23514",
      });
    });
  });

  it("only the owner can change the theme, and only for their org", async () => {
    await asCaller(t.api, t.claims(t.fx.A, "front_desk"), async (tx) => {
      const r = await tx.query("UPDATE app.brand SET theme = '{}' WHERE id = $1", [t.fx.A.brandId]);
      expect(r.rowCount).toBe(0);
    });
    await asCaller(t.api, t.claims(t.fx.B, "owner"), async (tx) => {
      const r = await tx.query("UPDATE app.brand SET theme = '{}' WHERE id = $1", [t.fx.A.brandId]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("brand colour mode (0020)", () => {
  it("accepts light and dark, plus the dark accent pair", async () => {
    for (const mode of ["light", "dark"]) {
      await asCaller(t.api, t.claims(t.fx.A, "owner"), (tx) =>
        tx.query(
          `UPDATE app.brand SET theme = jsonb_build_object('mode', $2::text,
             'colors', '{"accent":"#6D6128","accent_dark":"#D4A63E","accent_dark_text":"#111111"}'::jsonb)
           WHERE id = $1`,
          [t.fx.A.brandId, mode],
        ),
      );
    }
  });

  it.each([
    `{"mode":"neon"}`,
    `{"mode":1}`,
    `{"mode":"dark; x"}`,
    `{"colors":{"accent_dark":"gold"}}`,
    `{"hero_url":"https://evil.invalid/x.jpg"}`,
    `{"promo_url":"/brand/../x.jpg"}`,
  ])("rejects %s", async (theme) => {
    await asCaller(t.api, t.claims(t.fx.A, "owner"), async (tx) => {
      await expect(
        tx.query("UPDATE app.brand SET theme = $2::jsonb WHERE id = $1", [t.fx.A.brandId, theme]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
