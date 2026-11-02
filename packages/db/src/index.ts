import { createHmac } from "node:crypto";
import type { Claims } from "@gym/shared";
import pg from "pg";

export type Tx = pg.PoolClient;
/** A pool for request traffic plus the key that signs bound claims (see app.claims() in migration 0001). */
export interface Db {
  pool: pg.Pool;
  claimsKey: Buffer;
}

export function createDb(connectionString: string, claimsKeyHex: string): Db {
  const claimsKey = Buffer.from(claimsKeyHex, "hex");
  if (claimsKey.length < 32) throw new Error("claims key must be at least 32 bytes (64 hex chars)");
  return { pool: new pg.Pool({ connectionString, max: 10 }), claimsKey };
}

export function signClaims(json: string, key: Buffer): string {
  return createHmac("sha256", key).update(json, "utf8").digest("hex");
}

/**
 * Run `fn` inside a transaction as `app_authenticated`, with the verified JWT claims bound to
 * `request.jwt.claims` and their HMAC to `request.jwt.claims_sig`. This is the ONLY way request traffic
 * (API and agents) touches tables: the API login role holds no table privileges of its own, so forgetting
 * this wrapper fails closed, and rewriting the claims from SQL invalidates the signature (fails closed too).
 */
export async function withClaims<T>(
  db: Db,
  claims: Claims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const json = JSON.stringify(claims);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_authenticated");
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claims_sig', $2, true)",
      [json, signClaims(json, db.claimsKey)],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Append an audit row as the caller; actor, role, org and timestamp are forced by app.audit(). */
export async function audit(
  tx: Tx,
  entry: { action: string; entity: string; entityId?: string; locationId?: string; meta?: unknown },
): Promise<void> {
  await tx.query("SELECT app.audit($1, $2, $3, $4, $5)", [
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.locationId ?? null,
    JSON.stringify(entry.meta ?? {}),
  ]);
}
