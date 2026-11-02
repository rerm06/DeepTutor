import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/** Test fixtures for module billing: insert at least one row per org in every table this module adds. */
export async function seed(_c: pg.Client, _org: OrgFixture, _label: "A" | "B"): Promise<void> {}
