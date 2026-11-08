import type { ActionDef } from "./registry.js";

// Renders docs/copiloto/CATALOGO-ACCIONES.md from the registry. Regenerate with `pnpm --filter @gym/api copilot:doc`;
// the coverage test fails when the document and the registry differ.

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const RISK_TEXT: Record<string, string> = {
  R0: "R0 lectura",
  R1: "R1 reversible",
  R2: "R2 sensible",
  R3: "R3 irreversible / dinero externo",
};

export function renderCatalog(actions: readonly ActionDef[]): string {
  const lines: string[] = [];
  const existing = actions.filter((a) => a.status === "existente");
  const nuevo = actions.filter((a) => a.status === "nuevo");
  const copilot = existing.filter((a) => a.copilot);
  const count = (xs: readonly ActionDef[], r: string) => xs.filter((a) => a.risk === r).length;

  lines.push("# Catálogo de acciones del copiloto");
  lines.push("");
  lines.push(
    "Generado desde `apps/api/src/copilot/registry.ts` (no editar a mano). La prueba `apps/api/test/copilot-registry.test.ts` " +
      "falla si una ruta de la API no está en el registro o si una acción está incompleta.",
  );
  lines.push("");
  lines.push("## Resumen");
  lines.push("");
  lines.push("| | Total | R0 | R1 | R2 | R3 |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(
    `| Acciones existentes (una por ruta) | ${existing.length} | ${count(existing, "R0")} | ${count(existing, "R1")} | ${count(existing, "R2")} | ${count(existing, "R3")} |`,
  );
  lines.push(
    `| …de ellas, disponibles al copiloto del dueño | ${copilot.length} | ${count(copilot, "R0")} | ${count(copilot, "R1")} | ${count(copilot, "R2")} | ${count(copilot, "R3")} |`,
  );
  lines.push(
    `| NUEVO (pedido del dueño, no existe; requiere aprobación) | ${nuevo.length} | ${count(nuevo, "R0")} | ${count(nuevo, "R1")} | ${count(nuevo, "R2")} | ${count(nuevo, "R3")} |`,
  );
  lines.push("");
  lines.push(
    "Riesgo: R0 sin confirmación · R1 confirmación verbal tras repetir los datos · R2 tarjeta con diff + clic del dueño · " +
      "R3 el copiloto solo prepara; ejecuta el dueño en su pantalla.",
  );
  lines.push("");

  const modules = [...new Set(existing.map((a) => a.module))].sort();
  lines.push("## Acciones existentes por módulo");
  for (const m of modules) {
    const xs = existing.filter((a) => a.module === m);
    lines.push("");
    lines.push(`### ${m} (${xs.length})`);
    lines.push("");
    lines.push(
      "| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |",
    );
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const a of xs) {
      lines.push(
        `| \`${a.id}\` | ${esc(a.description)} | ${a.examples.map((e) => `«${esc(e)}»`).join("<br>") || "—"} | \`${a.route?.method} ${a.route?.url}\` | ${a.risk} | ${a.roles.join(", ")} | ${a.ui ? `\`${a.ui}\`` : "—"} | ${a.copilot ? "sí" : "no"} |`,
      );
    }
    lines.push("");
    lines.push("<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>");
    lines.push("");
    for (const a of xs) {
      lines.push(
        `- **\`${a.id}\`** — servicio \`${esc(a.service)}\`; ${RISK_TEXT[a.risk]}; roles por \`${esc(a.rolesEvidence)}\`.`,
      );
      const input = [
        a.input.params && `params ${a.input.params}`,
        a.input.query && `query ${a.input.query}`,
        a.input.body && `body ${a.input.body}`,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  Entrada: ${input || "ninguna"}.`);
      for (const f of a.fields)
        lines.push(
          `  - \`${f.name}\` ${f.type}${f.required ? " (requerido)" : ""}${f.rule ? ` — ${esc(f.rule)}` : ""}`,
        );
      lines.push(
        `  Auditoría: bus \`${a.auditEvent}\`; hoy ${a.auditExisting ? `\`${a.auditExisting}\`` : "**sin auditoría**"}. Conocimiento: ${a.knowledge.join(", ") || "—"}. Prueba: \`${a.test}\`.`,
      );
      if (a.notes) lines.push(`  Nota: ${esc(a.notes)}`);
    }
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");
  lines.push("## NUEVO — requiere aprobación antes de construir");
  lines.push("");
  lines.push("| Acción | Qué hace | Cómo lo diría el dueño | Riesgo | Roles | Por qué falta |");
  lines.push("|---|---|---|---|---|---|");
  for (const a of nuevo) {
    lines.push(
      `| \`${a.id}\` | ${esc(a.description)} | ${a.examples.map((e) => `«${esc(e)}»`).join("<br>")} | ${a.risk} | ${a.roles.join(", ")} | ${esc(a.notes)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
