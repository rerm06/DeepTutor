import { z } from "zod";

/** The 10 roles of spec §3.1. Must match the `app.role_name` enum in packages/db/migrations/0001. */
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

export const STAFF_ROLES: readonly Role[] = ROLES.filter((r) => r !== "member" && r !== "guardian");
/** Roles that see the whole organisation; every other staff role is scoped to assigned locations. */
export const ORG_WIDE_ROLES: readonly Role[] = ["owner", "accountant"];
/** Roles that can register members and sell at the front desk. */
export const FRONT_OF_HOUSE: readonly Role[] = ["owner", "location_manager", "front_desk"];
/** Roles whose licence must be verified before they can sign plans (spec §6.7, §6.6). */
export const LICENSED_ROLES: readonly Role[] = ["nutritionist", "clinician"];

/**
 * Claims carried by every request JWT (spec §3.1). `app_role` instead of `role` so it never collides
 * with the Postgres role claim used by Supabase-style gateways.
 */
export const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  org_id: z.string().uuid(),
  app_role: z.enum(ROLES),
  location_ids: z.array(z.string().uuid()).max(500).default([]),
  /** Token expiry (epoch seconds). Re-checked inside Postgres by app.claims(). */
  exp: z.number().int().positive(),
});
export type Claims = z.infer<typeof ClaimsSchema>;

/** Platform commission by SaaS plan (spec §5.1, P: to validate in F0). Basis points to avoid float drift. */
export const APPLICATION_FEE_BPS = { esencial: 100, pro: 75, elite: 50 } as const;
export type SaasPlan = keyof typeof APPLICATION_FEE_BPS;

/** One-off payments: application_fee_amount = round(amount × rate), computed server-side (spec §5.1). */
export function applicationFeeAmount(amountCents: number, plan: SaasPlan): number {
  if (!Number.isInteger(amountCents) || amountCents < 0)
    throw new RangeError("amountCents must be a non-negative integer");
  return Math.round((amountCents * APPLICATION_FEE_BPS[plan]) / 10_000);
}

export * from "./messages.js";
export * from "./demo.js";
