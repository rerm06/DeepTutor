// Copilot action registry (Fase 0). One entry per operation a user can perform: every real API route (reads,
// writes, public, member and device routes alike) plus the operations the owner asked for that do not exist yet
// (status "nuevo", no route until approved and built). The coverage test (apps/api/test/copilot-registry.test.ts)
// fails when a route is not mapped or an entry is incomplete. The catalog document is generated from this file.

import { CATALOG } from "./catalog.js";

export const ROLES = [
  "owner",
  "location_manager",
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
  "member",
  "guardian",
] as const;
export type Role = (typeof ROLES)[number];

/** R0 read · R1 reversible write · R2 sensitive (money, prices, roles, bulk messages, health) · R3 irreversible or external money. */
export const RISKS = ["R0", "R1", "R2", "R3"] as const;
export type Risk = (typeof RISKS)[number];

export const AUDIENCES = ["staff", "member", "public", "device", "system"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const KNOWLEDGE_DOCS = [
  "sistema",
  "socio",
  "clase",
  "producto",
  "proveedor",
  "reporte",
] as const;
export type KnowledgeDoc = (typeof KNOWLEDGE_DOCS)[number];

export interface Field {
  name: string;
  type: string;
  required: boolean;
  /** Enum values, unit, default and business rule, as written in the zod schema / SQL CHECK. */
  rule?: string;
}

export interface ActionDef {
  /** Stable id `modulo.verbo` (Spanish, snake_case). */
  id: string;
  module: string;
  /** Plain-Spanish description (one sentence). */
  description: string;
  /** 2–3 ways the owner would say it by voice (es-PR); empty when the copilot does not use the action. */
  examples: string[];
  /** The route that performs it today; null only for status "nuevo". */
  route: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string } | null;
  /** zod schema names the handler parses (declared in `service` file); null = no input of that kind. */
  input: { params: string | null; query: string | null; body: string | null };
  fields: Field[];
  /** Handler file:line and the SQL function / table it writes. */
  service: string;
  /** Web screen where the result is seen, or null. */
  ui: string | null;
  audience: Audience;
  roles: Role[];
  /** File:line (policy, definer check or handler check) that proves `roles`. */
  rolesEvidence: string;
  risk: Risk;
  /** Audit event the command bus will write (Fase 2): always the action id. */
  auditEvent: string;
  /** Event `app.audit()` already writes today, or null when the operation is not audited yet. */
  auditExisting: string | null;
  knowledge: KnowledgeDoc[];
  /** Test file that exercises this route; null only for status "nuevo". */
  test: string | null;
  /** False for routes the owner's copilot must not drive (public sign-in, device, member-only, demo). */
  copilot: boolean;
  status: "existente" | "nuevo";
  notes: string;
}

export const ACTIONS: readonly ActionDef[] = CATALOG;

export const actionById = new Map(ACTIONS.map((a) => [a.id, a]));
export const actionByRoute = new Map(
  ACTIONS.filter((a) => a.route).map((a) => [`${a.route?.method} ${a.route?.url}`, a]),
);
