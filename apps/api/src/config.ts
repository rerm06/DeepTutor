import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL_API: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Hex key that signs bound claims; the same key is installed in app_private.claims_key by the deploy step. */
  CLAIMS_HMAC_KEY: z.string().regex(/^[0-9a-f]{64,}$/i, "CLAIMS_HMAC_KEY must be ≥ 64 hex chars"),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  PORT: z.coerce.number().int().default(3001),
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .refine((k) => !k || k.startsWith("sk_test_") || k.startsWith("rk_test_"), {
      message: "Only Stripe TEST keys are allowed in this build (sk_test_/rk_test_).",
    }),
});
export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
