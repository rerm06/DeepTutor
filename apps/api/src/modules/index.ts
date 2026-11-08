import type { FastifyInstance } from "fastify";
import { routes as access } from "./access.js";
import { routes as auth } from "./auth.js";
import { routes as billing } from "./billing.js";
import { routes as coach } from "./coach.js";
import { routes as crm } from "./crm.js";
import { routes as engagement } from "./engagement.js";
import { routes as equipment } from "./equipment.js";
import { routes as finance } from "./finance.js";
import { routes as floor } from "./floor.js";
import { routes as health } from "./health.js";
import { routes as live } from "./live.js";
import { routes as photo } from "./photo.js";
import { routes as portal } from "./portal.js";
import { routes as reports } from "./reports.js";
import { routes as schedule } from "./schedule.js";
import { routes as store } from "./store.js";

/** Register every module's routes under /v1. */
export async function moduleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(billing, { prefix: "/v1" });
  await app.register(schedule, { prefix: "/v1" });
  await app.register(crm, { prefix: "/v1" });
  await app.register(store, { prefix: "/v1" });
  await app.register(health, { prefix: "/v1" });
  await app.register(floor, { prefix: "/v1" });
  await app.register(equipment, { prefix: "/v1" });
  await app.register(engagement, { prefix: "/v1" });
  await app.register(finance, { prefix: "/v1" });
  await app.register(reports, { prefix: "/v1" });
  await app.register(coach, { prefix: "/v1" });
  await app.register(portal, { prefix: "/v1" });
  await app.register(photo, { prefix: "/v1" });
  await app.register(live, { prefix: "/v1" });
  await app.register(access, { prefix: "/v1" });
  await app.register(auth, { prefix: "/v1" });
}
