import type pg from "pg";
import type { OrgFixture } from "../testing.js";
import { seed as billing } from "./billing.js";
import { seed as coach } from "./coach.js";
import { seed as crm } from "./crm.js";
import { seed as engagement } from "./engagement.js";
import { seed as finance } from "./finance.js";
import { seed as floor } from "./floor.js";
import { seed as health } from "./health.js";
import { seed as portal } from "./portal.js";
import { seed as reports } from "./reports.js";
import { seed as schedule } from "./schedule.js";
import { seed as signup } from "./signup.js";
import { seed as store } from "./store.js";

/** Run every module's fixture seeder for one org (after the core seed). Order = migration order. */
export async function seedModules(c: pg.Client, org: OrgFixture, label: "A" | "B"): Promise<void> {
  await billing(c, org, label);
  await schedule(c, org, label);
  await crm(c, org, label);
  await store(c, org, label);
  await health(c, org, label);
  await floor(c, org, label);
  await engagement(c, org, label);
  await finance(c, org, label);
  await reports(c, org, label);
  await coach(c, org, label);
  await signup(c, org, label);
  await portal(c, org, label);
}
