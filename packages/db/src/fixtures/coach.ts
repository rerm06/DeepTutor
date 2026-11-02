import type pg from "pg";
import type { OrgFixture } from "../testing.js";

/** Test fixtures for module coach. */
export async function seed(_c: pg.Client, _org: OrgFixture, _label: "A" | "B"): Promise<void> {}
