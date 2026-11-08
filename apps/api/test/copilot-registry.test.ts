import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { renderCatalog } from "../src/copilot/catalog-doc.js";
import { ACTIONS, AUDIENCES, KNOWLEDGE_DOCS, RISKS, ROLES } from "../src/copilot/registry.js";

// Guarantee for "todas y cada una": every real route of the API is an action of the copilot registry, and every
// action is complete (schema, roles with evidence, risk, audit event, test). Fails the gate otherwise.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
let routes: Array<{ method: string; url: string }> = [];
const cache = new Map<string, string>();
function src0(rel: string): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  const text = read(rel);
  cache.set(rel, text);
  return text;
}

beforeAll(async () => {
  const seen: Array<{ method: string; url: string }> = [];
  const app = await buildApp({
    db: {} as never,
    jwtSecret: "x".repeat(40),
    jwtIssuer: "copilot-registry",
    jwtAudience: "copilot-registry",
    demo: true, // the demo routes exist in some deployments, so they are catalogued too
    onRoute: (r) => seen.push(r),
  });
  await app.ready();
  await app.close();
  routes = seen.filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS");
});

/** Every screen path the web app declares (module routes, route constants and App.tsx). */
function webPaths(): string[] {
  const out = new Set<string>();
  const scan = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${f.name}`;
      if (f.isDirectory()) scan(rel);
      else if (/\.(ts|tsx)$/.test(f.name))
        // Route paths are declared literally or through route constants (e.g. REPORTS_ROUTES): take every
        // app-path literal.
        for (const m of read(rel).matchAll(/"(\/(?:staff|me|s|door|account|join)(?:\/[^"\s]*)?)"/g))
          if (m[1]) out.add(m[1]);
    }
  };
  scan("apps/web/src");
  return [...out];
}
const matchesWeb = (ui: string, paths: string[]) =>
  paths.some((p) =>
    new RegExp(`^${p.replace(/:[a-zA-Z_]+/g, "[^/]+")}$`).test(ui.split("?")[0] ?? ui),
  );

describe("copilot action registry: coverage", () => {
  it("maps every route of the API to exactly one action", () => {
    expect(routes.length).toBeGreaterThan(200);
    const missing: string[] = [];
    const dup: string[] = [];
    for (const r of routes) {
      const hits = ACTIONS.filter((a) => a.route?.method === r.method && a.route.url === r.url);
      if (hits.length === 0) missing.push(`${r.method} ${r.url}`);
      if (hits.length > 1) dup.push(`${r.method} ${r.url}`);
    }
    expect(missing.join("\n"), "routes without an action").toBe("");
    expect(dup.join("\n"), "routes with more than one action").toBe("");
  });

  it("every routed action points at a route that exists", () => {
    const real = new Set(routes.map((r) => `${r.method} ${r.url}`));
    const stale = ACTIONS.filter(
      (a) => a.route && !real.has(`${a.route.method} ${a.route.url}`),
    ).map((a) => a.id);
    expect(stale.join("\n")).toBe("");
  });
});

describe("copilot action registry: every action is complete", () => {
  const ids = ACTIONS.map((a) => a.id);
  const ui = webPaths();

  it("ids are stable modulo.verbo and unique", () => {
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z_]*\.[a-z][a-z0-9_]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("description, roles with evidence, risk, audience, audit event and knowledge are valid", () => {
    const bad: string[] = [];
    for (const a of ACTIONS) {
      const why: string[] = [];
      if (a.description.trim().length < 10) why.push("description");
      if (a.module !== a.id.split(".")[0]) why.push("module≠id prefix");
      // Public, device and system routes run without a staff or member role (their evidence says what guards them).
      const needsRole = a.audience === "staff" || a.audience === "member";
      if ((needsRole && a.roles.length === 0) || a.roles.some((r) => !ROLES.includes(r)))
        why.push("roles");
      if (!a.rolesEvidence.trim() || a.rolesEvidence.includes("[VERIFICAR]"))
        why.push("rolesEvidence");
      if (!RISKS.includes(a.risk)) why.push("risk");
      if (!AUDIENCES.includes(a.audience)) why.push("audience");
      if (a.auditEvent !== a.id) why.push("auditEvent");
      if (a.knowledge.some((k) => !KNOWLEDGE_DOCS.includes(k))) why.push("knowledge");
      // A GET is R0 unless it exports personal data (R3). A POST is R0 only when it writes nothing (stated in notes).
      const exportsPersonal = a.risk === "R3" && /\.exportar_/.test(a.id);
      if (a.route?.method === "GET" && a.risk !== "R0" && !exportsPersonal)
        why.push("GET must be R0");
      if (
        a.route &&
        a.route.method !== "GET" &&
        a.risk === "R0" &&
        !a.notes.startsWith("Sin escritura")
      )
        why.push("write cannot be R0");
      if (a.copilot && a.audience === "staff" && a.examples.length < 2) why.push("examples");
      if (a.copilot && !a.roles.includes("owner"))
        why.push("copilot action not available to owner");
      if (why.length) bad.push(`${a.id}: ${why.join(", ")}`);
    }
    expect(bad.join("\n")).toBe("");
  });

  it("input schemas named by an action are declared in its service file", () => {
    const bad: string[] = [];
    for (const a of ACTIONS.filter((x) => x.status === "existente")) {
      const file = a.service.split(":")[0] ?? "";
      if (!existsSync(join(ROOT, file))) {
        bad.push(`${a.id}: service file ${file}`);
        continue;
      }
      const src = read(file);
      for (const raw of [a.input.params, a.input.query, a.input.body]) {
        // "inline {…}" = a zod object written in the handler; "csvOf(X)" / "joinBodyFor(…)" wrap a named schema.
        if (!raw || raw.startsWith("inline")) continue;
        const name = raw.match(/^\w+\((\w+)/)?.[1] ?? raw.match(/^(\w+)\(/)?.[1] ?? raw;
        if (
          name &&
          !new RegExp(`\\b(const|function|import[^;]*)\\s*\\{?[^;]*\\b${name}\\b`).test(src)
        )
          bad.push(`${a.id}: schema ${name} not in ${file}`);
      }
      if (a.input.body && !/^Empty/.test(a.input.body) && a.fields.length === 0)
        bad.push(`${a.id}: body without fields`);
    }
    expect(bad.join("\n")).toBe("");
  });

  it("every existing action has a test that exercises its route", () => {
    const bad: string[] = [];
    for (const a of ACTIONS.filter((x) => x.status === "existente")) {
      if (!a.test || !existsSync(join(ROOT, a.test))) {
        bad.push(`${a.id}: no test`);
        continue;
      }
      const url = a.route?.url.replace(/^\/v1/, "") ?? "";
      // Module test files often call through a helper that adds the module prefix (e.g. "/engagement").
      const full = url.split("/:")[0] ?? url;
      const head = src0(a.test).includes(full) ? full : `/${full.split("/").slice(2).join("/")}`;
      const tail =
        url
          .split("/")
          .filter((s) => s && !s.startsWith(":"))
          .pop() ?? "";
      const src = src0(a.test);
      if (!src.includes(head) || !src.includes(tail))
        bad.push(`${a.id}: ${a.test} never calls ${url}`);
    }
    expect(bad.join("\n")).toBe("");
  });

  it("every screen named by an action exists in the web app", () => {
    const bad = ACTIONS.filter((a) => a.ui && !matchesWeb(a.ui, ui)).map((a) => `${a.id}: ${a.ui}`);
    expect(bad.join("\n")).toBe("");
  });

  it("NUEVO actions have no route yet and say what is missing", () => {
    for (const a of ACTIONS.filter((x) => x.status === "nuevo")) {
      expect(a.route, a.id).toBeNull();
      expect(a.notes, a.id).toMatch(/NUEVO/);
    }
  });

  it("the catalog document is generated from this registry (not edited by hand)", () => {
    expect(read("docs/copiloto/CATALOGO-ACCIONES.md")).toBe(renderCatalog(ACTIONS));
  });
});
