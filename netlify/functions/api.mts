/**
 * Netlify Function at /api/*. The API and every dependency are pre-bundled into one ESM file
 * (scripts/bundle-function.mjs) so the runtime never resolves node_modules: fastify's light-my-request pulls the
 * ESM-only cookie@2 through require(), which the Lambda runtime refuses when left unbundled.
 */
import type { Config } from "@netlify/functions";
import handler from "../server-bundle.mjs";

export default handler;
export const config: Config = { path: "/api/*" };
