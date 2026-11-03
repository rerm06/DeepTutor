/**
 * Demo organisations of the entry screen (labels "A"/"B" of GET /v1/demo/personas) and their public join pages.
 * Must match DEMO_IDS in packages/shared/src/demo.ts (the web app does not depend on @gym/shared).
 */
export const DEMO_JOIN_ORGS: Readonly<Record<string, string>> = {
  A: "a0000000-0000-4000-8000-000000000001",
  B: "b0000000-0000-4000-8000-000000000001",
};
