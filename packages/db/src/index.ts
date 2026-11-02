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

/** HMAC over `claims|backend pid|transaction start µs` — must match app.claims() in migration 0001. */
export function signClaims(json: string, key: Buffer, pid: number, txStartMicros: string): string {
  return createHmac("sha256", key).update(`${json}|${pid}|${txStartMicros}`, "utf8").digest("hex");
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
    // Bind the signature to this backend and this transaction so a captured pair cannot be replayed.
    const ctx = await client.query<{ pid: number; ts: string }>(
      "SELECT pg_backend_pid() AS pid, (extract(epoch FROM transaction_timestamp()) * 1000000)::bigint::text AS ts",
    );
    const { pid, ts } = ctx.rows[0] as { pid: number; ts: string };
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claims_sig', $2, true)",
      [json, signClaims(json, db.claimsKey, pid, ts)],
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

// Auditing is done inside Postgres (definer functions and triggers); request code never writes audit rows.
