// Writes docs/copiloto/CATALOGO-ACCIONES.md from the copilot action registry.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderCatalog } from "../src/copilot/catalog-doc.js";
import { ACTIONS } from "../src/copilot/registry.js";

const out = join(import.meta.dirname, "..", "..", "..", "docs", "copiloto", "CATALOGO-ACCIONES.md");
writeFileSync(out, renderCatalog(ACTIONS));
console.log(`${ACTIONS.length} acciones → ${out}`);
