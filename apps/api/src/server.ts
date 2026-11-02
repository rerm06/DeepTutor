import { createPool } from "@gym/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const app = await buildApp({
  db: createPool(cfg.DATABASE_URL_API),
  jwtSecret: cfg.JWT_SECRET,
  jwtIssuer: cfg.JWT_ISSUER,
  jwtAudience: cfg.JWT_AUDIENCE,
  logger: true,
});
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
