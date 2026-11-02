import type { MessageVars } from "../api/types";

/** Variables the client supplies (contract: POST /messages `vars`). */
export const CLIENT_VARS = ["date", "time", "amount", "last4", "discount"] as const;
export type ClientVar = (typeof CLIENT_VARS)[number];

/** Variables the server fills in when it renders the message. Never sent by the client. */
export const SERVER_VARS = ["brand", "name", "location", "link"] as const;
export type ServerVar = (typeof SERVER_VARS)[number];

/** Contract: variables needed per template. */
const NEEDED: Record<string, readonly ClientVar[]> = {
  "class.reminder": ["date", "time"],
  "membership.renewal_notice": ["date", "amount"],
  "payment.failed": ["amount"],
  "card.expiring": ["last4", "date"],
  "promo.generic": ["discount", "date"],
};

function isClientVar(v: string): v is ClientVar {
  return (CLIENT_VARS as readonly string[]).includes(v);
}
function isServerVar(v: string): v is ServerVar {
  return (SERVER_VARS as readonly string[]).includes(v);
}

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** The client variables a template needs: the contract list, or the body's placeholders for new keys. */
export function neededVars(key: string, body: string): ClientVar[] {
  const known = NEEDED[key];
  if (known) return [...known];
  const found = new Set<ClientVar>();
  for (const m of body.matchAll(PLACEHOLDER)) {
    const name = m[1] ?? "";
    if (isClientVar(name)) found.add(name);
  }
  return CLIENT_VARS.filter((v) => found.has(v));
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "client"; name: ClientVar; value: string | null }
  | { kind: "server"; name: ServerVar }
  | { kind: "unknown"; name: string };

/**
 * Splits a template body for the live preview: client variables are substituted with the values typed
 * so far (null when still empty), server variables stay as placeholders the UI labels "filled by the
 * system", and anything else is kept verbatim as unknown.
 */
export function previewSegments(body: string, vars: MessageVars): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(PLACEHOLDER)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: "text", text: body.slice(last, index) });
    const name = m[1] ?? "";
    if (isClientVar(name)) {
      const value = vars[name];
      out.push({ kind: "client", name, value: value ? value : null });
    } else if (isServerVar(name)) out.push({ kind: "server", name });
    else out.push({ kind: "unknown", name });
    last = index + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** Plain-text preview: client values substituted, other placeholders rendered by `placeholder`. */
export function previewText(
  body: string,
  vars: MessageVars,
  placeholder: (name: string, kind: "server" | "client" | "unknown") => string = (n) => `{{${n}}}`,
): string {
  return previewSegments(body, vars)
    .map((s) => {
      if (s.kind === "text") return s.text;
      if (s.kind === "client") return s.value ?? placeholder(s.name, "client");
      return placeholder(s.name, s.kind);
    })
    .join("");
}

/** Raw form input per variable → contract format, or null when invalid. */
export function normalizeVar(name: ClientVar, raw: string): string | null {
  const v = raw.trim();
  switch (name) {
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      const d = new Date(`${v}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
    }
    case "time": {
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return null;
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    case "amount": {
      const cleaned = v.replace(/^\$/, "").replace(/,/g, "");
      if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null;
      return `$${Number(cleaned).toFixed(2)}`;
    }
    case "last4":
      return /^\d{4}$/.test(v) ? v : null;
    case "discount": {
      const cleaned = v.replace(/%$/, "");
      if (!/^\d{1,2}$/.test(cleaned)) return null;
      const n = Number(cleaned);
      return n >= 1 && n <= 99 ? `${n}%` : null;
    }
  }
}

/** Builds the `vars` payload with only the variables this template needs. */
export function buildVars(
  needed: readonly ClientVar[],
  raw: Partial<Record<ClientVar, string>>,
): { vars: MessageVars; invalid: ClientVar[] } {
  const vars: MessageVars = {};
  const invalid: ClientVar[] = [];
  for (const name of needed) {
    const value = normalizeVar(name, raw[name] ?? "");
    if (value === null) invalid.push(name);
    else vars[name] = value;
  }
  return { vars, invalid };
}
