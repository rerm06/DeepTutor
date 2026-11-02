import type { Claims } from "@gym/shared";
import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Run `fn` inside a transaction as `app_authenticated`, with the verified JWT claims bound to
 * `request.jwt.claims`. This is the ONLY way request traffic (API and agents) touches tables:
 * the API login role holds no table privileges of its own, so forgetting this wrapper fails closed.
 */
export async function withClaims<T>(
  db: Db,
  claims: Claims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
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

export async function audit(
  tx: Tx,
  entry: { action: string; entity: string; entityId?: string; locationId?: string; meta?: unknown },
): Promise<void> {
  await tx.query(
    "INSERT INTO app.audit_log (action, entity, entity_id, location_id, meta) VALUES ($1, $2, $3, $4, $5)",
    [
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.locationId ?? null,
      JSON.stringify(entry.meta ?? {}),
    ],
  );
}
