/**
 * Deployment mode. Production by default on Netlify (netlify.toml sets VITE_DEMO_MODE=false at build); local runs and
 * tests stay in demo mode unless told otherwise. Must match the API's GYM_DEMO_MODE (netlify/server.mts).
 */
const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_DEMO_MODE;
export const DEMO = raw !== "false";

/** The production organisation(s) a visitor can sign in to or join (packages/db/seed/0028_protected_accounts.sql). */
export const PRODUCTION_GYMS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "f1000000-0000-4000-8000-000000000001", name: "Fitness R Us" },
];
