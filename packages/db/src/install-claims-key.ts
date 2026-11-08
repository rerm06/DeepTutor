/**
 * Deploy step: install (or rotate) the claims HMAC key. Runs with the OWNER role, never from request traffic.
 * The same hex value must be given to the API as CLAIMS_HMAC_KEY. Rotation: install the new key, then restart
 * the API with it (requests in flight during the switch fail closed, they do not leak).
 */
import { fileURLToPath } from "node:url";
import pg from "pg";

export async function installClaimsKey(ownerUrl: string, keyHex: string): Promise<void> {
  if (!/^[0-9a-f]{64,}$/i.test(keyHex)) throw new Error("CLAIMS_HMAC_KEY must be ≥ 64 hex chars");
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query(
      "INSERT INTO app_private.claims_key (id, key) VALUES (true, decode($1, 'hex')) ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key",
      [keyHex],
    );
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL_OWNER;
  const key = process.env.CLAIMS_HMAC_KEY;
  if (!url || !key) throw new Error("DATABASE_URL_OWNER and CLAIMS_HMAC_KEY are required");
  await installClaimsKey(url, key);
  console.log("claims key installed");
}
