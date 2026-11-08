// Placeholder while the Fase 0 route inventory is merged: holds only the NUEVO proposals. The coverage test
// (apps/api/test/copilot-registry.test.ts) stays red until every real route has its action here.
import { NUEVO } from "./nuevo.js";
import type { ActionDef } from "./registry.js";

export const CATALOG: ActionDef[] = [...NUEVO];
