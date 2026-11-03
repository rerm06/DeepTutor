/**
 * Demo organisations of the entry screen (labels "A"/"B" of GET /v1/demo/personas) and their public join pages.
 * Must match DEMO_IDS in packages/shared/src/demo.ts (the web app does not depend on @gym/shared).
 */
export const DEMO_JOIN_ORGS: Readonly<Record<string, string>> = {
  A: "a0000000-0000-4000-8000-000000000001",
  B: "b0000000-0000-4000-8000-000000000001",
};

/**
 * Hero photo of the public join page for the demo tenants. The public payload (app_public.join_info) only carries
 * the theme keys it whitelists, without hero_url, so the page uses theme.hero_url when present and this demo map
 * otherwise. Only own /brand assets; tenants without an entry get the plain hero.
 */
export const DEMO_JOIN_HERO: Readonly<Record<string, string>> = {
  "a0000000-0000-4000-8000-000000000001": "/brand/fitnessrus-hero.jpg",
};
