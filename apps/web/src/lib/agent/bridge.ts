/**
 * Agent bridge: lets a voice/text agent read and operate ANY screen of the app through the same DOM the user sees.
 * No per-module wiring: every form already follows the `.field > label + control` convention, every action is a
 * button or link with an accessible name, and every module is a link in the shell's <nav>.
 *
 * Safety rules enforced HERE (not left to the model's goodwill):
 *  - Consent boxes, signatures and anything marked data-agent="manual" are never set by the agent: the person
 *    ticks them with their own hand (TCPA / Ley 81 consent must be the person's act [VERIFICAR · legal]).
 *  - Money, deletion, cancellation, sending and signing buttons are never pressed by the agent: it highlights the
 *    button and asks the person to tap it.
 *  - A form submit is pressed only when the model attests the person confirmed out loud (user_confirmed=true).
 *  - Everything the agent writes is marked data-filled-by="ai" and stays editable; a manual edit flips it to
 *    "manual" (FieldAssist listens for trusted input events).
 */

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "password"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio";

export interface FieldInfo {
  id: string;
  label: string;
  kind: FieldKind;
  value: string;
  required: boolean;
  manual: boolean;
  options?: string[];
  help?: string;
  state: "empty" | "valid" | "invalid";
  message?: string;
}
export interface ActionInfo {
  name: string;
  kind: "submit" | "button" | "link" | "tab";
  protected: boolean;
}
export interface ScreenInfo {
  path: string;
  title: string;
  dialog: boolean;
  fields: FieldInfo[];
  actions: ActionInfo[];
  modules: { name: string; path: string }[];
}

const CONTROL = "input, select, textarea";
const IGNORE = "[data-agent-ignore]";
const CONSENT_RE =
  /acept|consent|autoriz|t[ée]rminos|terms|waiver|relevo|firma|signature|sign\b|marketing|promoci|sms|whatsapp|privacidad|privacy|pol[ií]tica|policy|liberaci/i;
const PROTECTED_RE =
  /pagar|cobrar|\bcharge\b|\bpay\b|reembols|refund|eliminar|borrar|delete|remove|quitar|anular|\bvoid\b|cancelar\s+(la\s+)?(membres|suscrip|plan|cuenta|reserva)|cancel\s+(membership|subscription|plan|account)|firmar|\bsign\b|enviar\s+(mensaje|campa|sms|correo)|send\s+(message|campaign|sms|email)|cerrar\s+caja|close\s+(register|drawer)|transferir|transfer/i;

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9@.+\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** CSS.escape where available (jsdom lacks it): enough for ids and radio names in attribute selectors. */
const esc = (s: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
/** Text of an element with a space at every element boundary ("Sede<span>Bayamón</span>" → "Sede Bayamón"),
 *  keeping visually-hidden text (part of the accessible name) and skipping aria-hidden decoration. */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) out.push(n.nodeValue ?? "");
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.getAttribute("aria-hidden") === "true" || e.tagName === "svg") return;
      out.push(" ");
      for (const c of Array.from(e.childNodes)) walk(c);
      out.push(" ");
    }
  };
  walk(el);
  return out
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s+([:;,.)])/g, "$1")
    .trim();
}

/** The area the agent works in: the top open dialog if any, else <main>, else the body. */
export function screenRoot(doc: Document = document): Element {
  const dialogs = Array.from(doc.querySelectorAll("dialog[open]")).filter(
    (d) => !d.closest(IGNORE) && !d.matches(".account-menu, [data-agent-skip]"),
  );
  return dialogs[dialogs.length - 1] ?? doc.querySelector("main") ?? doc.body;
}

function visible(el: Element): boolean {
  if (el.closest(IGNORE)) return false;
  const h = el as HTMLElement;
  if (h.hidden || h.closest("[hidden],[inert]")) return false;
  // jsdom has no layout: treat everything as visible there.
  if (
    typeof h.getClientRects === "function" &&
    h.getClientRects().length === 0 &&
    h.offsetParent === null
  ) {
    return !!(globalThis as { __AGENT_NO_LAYOUT__?: boolean }).__AGENT_NO_LAYOUT__;
  }
  return true;
}

let seq = 0;
function agentId(el: Element): string {
  const h = el as HTMLElement;
  if (!h.dataset.agentId) h.dataset.agentId = `f${++seq}`;
  return h.dataset.agentId;
}

/** Visible label of a control (label[for], wrapping label, aria-label/labelledby, field label, placeholder). */
export function labelOf(el: Element, doc: Document = el.ownerDocument): string {
  return rawLabel(el, doc)
    .replace(/\s*\*\s*$/, "")
    .trim();
}
function rawLabel(el: Element, doc: Document): string {
  const h = el as HTMLInputElement;
  const aria = h.getAttribute("aria-label");
  if (aria) return aria.trim();
  const by = h.getAttribute("aria-labelledby");
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .join(" ")
      .trim();
    if (t) return t;
  }
  if (h.id) {
    const l = doc.querySelector(`label[for="${esc(h.id)}"]`);
    if (l) return text(l);
  }
  const wrap = h.closest("label");
  if (wrap) return text(wrap);
  const field = h.closest(".field");
  const fl = field?.querySelector("label, .field__label");
  if (fl) return text(fl);
  return (h.getAttribute("placeholder") ?? h.name ?? "").trim();
}

function kindOf(el: Element): FieldKind {
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  const t = (el as HTMLInputElement).type;
  if (t === "email" || t === "tel" || t === "date" || t === "number" || t === "password") return t;
  if (t === "checkbox" || t === "radio") return t;
  return "text";
}

function isManual(el: Element, label: string): boolean {
  const h = el as HTMLElement;
  if (h.closest('[data-agent="manual"]')) return true;
  if (h.dataset.agent === "auto") return false;
  const k = kindOf(el);
  if (k === "password") return true;
  return k === "checkbox" && CONSENT_RE.test(label);
}

/** Validation state of a control: data-live-error (the form's own live rule) > aria-invalid > native validity. */
export function stateOf(el: Element): { state: FieldInfo["state"]; message?: string } {
  const h = el as HTMLInputElement;
  const k = kindOf(el);
  const filled = k === "checkbox" || k === "radio" ? h.checked : h.value.trim() !== "";
  const live = h.getAttribute("data-live-error");
  if (live) return { state: "invalid", message: live };
  if (h.getAttribute("aria-invalid") === "true") {
    const field = h.closest(".field, fieldset");
    const msg = text(field?.querySelector(".field-error")) || h.validationMessage || undefined;
    return { state: "invalid", message: msg };
  }
  if (!filled) return { state: "empty" };
  if (typeof h.checkValidity === "function" && !h.checkValidity())
    return { state: "invalid", message: h.validationMessage || undefined };
  return { state: "valid" };
}

function optionsOf(el: Element, root: Element): string[] | undefined {
  if (el instanceof HTMLSelectElement)
    return Array.from(el.options)
      .filter((o) => !o.disabled && o.value !== "")
      .map((o) => text(o) || o.value);
  const h = el as HTMLInputElement;
  if (h.type === "radio" && h.name)
    return Array.from(root.querySelectorAll(`input[type=radio][name="${esc(h.name)}"]`)).map((r) =>
      labelOf(r),
    );
  return undefined;
}

/** Collect the logical fields of the current screen (a radio group is ONE field). */
export function listFields(root: Element = screenRoot()): { info: FieldInfo; el: Element }[] {
  const out: { info: FieldInfo; el: Element }[] = [];
  const seenRadio = new Set<string>();
  for (const el of Array.from(root.querySelectorAll(CONTROL))) {
    const h = el as HTMLInputElement;
    if (h.type === "hidden" || h.type === "submit" || h.type === "button" || h.type === "file")
      continue;
    if (h.disabled || h.readOnly || !visible(el)) continue;
    const kind = kindOf(el);
    let label = labelOf(el);
    let value = h.value;
    if (kind === "radio") {
      const key = h.name || agentId(el);
      if (seenRadio.has(key)) continue;
      seenRadio.add(key);
      const legend = text(h.closest("fieldset")?.querySelector("legend"));
      label = (legend || label).replace(/\s*\*\s*$/, "");
      const checked = h.name
        ? (root.querySelector(
            `input[type=radio][name="${esc(h.name)}"]:checked`,
          ) as HTMLInputElement | null)
        : h.checked
          ? h
          : null;
      value = checked ? labelOf(checked) : "";
    } else if (kind === "checkbox") value = h.checked ? "true" : "false";
    else if (el instanceof HTMLSelectElement) value = text(el.selectedOptions[0]) || el.value;
    const st = kind === "radio" ? (value ? stateOf(el) : { state: "empty" as const }) : stateOf(el);
    const field = h.closest(".field, fieldset");
    const help = text(field?.querySelector(".help")) || undefined;
    out.push({
      el,
      info: {
        id: agentId(el),
        label: label.slice(0, 120),
        kind,
        value: kind === "password" ? (value ? "••••" : "") : value.slice(0, 200),
        required:
          h.required ||
          h.getAttribute("aria-required") === "true" ||
          /(\*|\((obligatorio|required)\))\s*$/i.test(rawLabel(el, el.ownerDocument)) ||
          (kind === "radio" && /\*\s*$/.test(text(h.closest("fieldset")?.querySelector("legend")))),
        manual: isManual(el, label),
        options: optionsOf(el, root),
        help: help?.slice(0, 160),
        ...st,
      },
    });
  }
  return out;
}

function actionName(el: Element): string {
  return (el.getAttribute("aria-label") || text(el) || el.getAttribute("title") || "").slice(0, 80);
}

/** Buttons, tabs and in-page links of the screen (shell navigation is listed separately as modules). */
export function listActions(root: Element = screenRoot()): { info: ActionInfo; el: HTMLElement }[] {
  const out: { info: ActionInfo; el: HTMLElement }[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      "button, a[href], [role=button], [role=tab], input[type=submit]",
    ),
  )) {
    if (!visible(el) || (el as HTMLButtonElement).disabled || el.closest("nav")) continue;
    const name = actionName(el);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const isSubmit =
      (el instanceof HTMLButtonElement && el.type === "submit" && !!el.form) ||
      (el instanceof HTMLInputElement && el.type === "submit");
    const kind: ActionInfo["kind"] = isSubmit
      ? "submit"
      : el.getAttribute("role") === "tab"
        ? "tab"
        : el.tagName === "A"
          ? "link"
          : "button";
    out.push({
      el,
      info: { name, kind, protected: PROTECTED_RE.test(name) || el.dataset.agent === "manual" },
    });
    if (out.length >= 60) break;
  }
  return out;
}

export function listModules(doc: Document = document): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("nav a[href]"))) {
    if (a.closest(IGNORE)) continue;
    const path = a.getAttribute("href") ?? "";
    if (!path.startsWith("/") || seen.has(path)) continue;
    seen.add(path);
    out.push({ name: actionName(a), path });
  }
  return out;
}

export function describeScreen(doc: Document = document): ScreenInfo {
  const root = screenRoot(doc);
  const h1 = root.querySelector("h1, h2") ?? doc.querySelector("main h1");
  return {
    path: doc.location?.pathname ?? "/",
    title: text(h1) || doc.title,
    dialog: root.tagName === "DIALOG",
    fields: listFields(root).map((f) => f.info),
    actions: listActions(root).map((a) => a.info),
    modules: listModules(doc),
  };
}

/** Best match of `query` among `names` (exact → prefix → contains → token overlap). -1 when nothing fits. */
export function bestMatch(query: string, names: string[]): number {
  const q = norm(query);
  if (!q) return -1;
  const n = names.map(norm);
  let i = n.indexOf(q);
  if (i >= 0) return i;
  i = n.findIndex((s) => s.startsWith(q) || q.startsWith(s));
  if (i >= 0) return i;
  i = n.findIndex((s) => s.includes(q) || (s.length > 2 && q.includes(s)));
  if (i >= 0) return i;
  const qt = new Set(q.split(" ").filter((w) => w.length > 2));
  let best = -1;
  let score = 0;
  n.forEach((s, j) => {
    const sc = s.split(" ").filter((w) => qt.has(w)).length;
    if (sc > score) {
      score = sc;
      best = j;
    }
  });
  return best;
}

/** Bring an element into view; instant when the person prefers reduced motion. */
function reveal(el: HTMLElement) {
  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  // React tracks the value through the prototype setter; assigning el.value directly would be swallowed.
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function markAi(el: Element) {
  const field = (el.closest(".field, fieldset") ?? el) as HTMLElement;
  field.dataset.filledBy = "ai";
  (el as HTMLElement).dataset.filledBy = "ai";
  field.classList.remove("is-ai-pulse");
  void field.offsetWidth; // restart the pulse animation
  field.classList.add("is-ai-pulse");
}

const frame = () =>
  new Promise<void>((r) =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => r())
      : setTimeout(r, 0),
  );

export interface FillResult {
  ok: boolean;
  field?: string;
  value?: string;
  state?: FieldInfo["state"];
  message?: string;
  error?: "field_not_found" | "manual_only" | "option_not_found" | "read_only";
  options?: string[];
  hint?: string;
}

/** Fill one field. `field` is the id from describe_screen or (fuzzy) its label. */
export async function fillField(
  field: string,
  value: string,
  doc: Document = document,
): Promise<FillResult> {
  const root = screenRoot(doc);
  const fields = listFields(root);
  let idx = fields.findIndex((f) => f.info.id === field);
  if (idx < 0)
    idx = bestMatch(
      field,
      fields.map((f) => f.info.label),
    );
  const hit = fields[idx];
  if (!hit) return { ok: false, error: "field_not_found" };
  const { el, info } = hit;
  if (info.manual)
    return {
      ok: false,
      field: info.label,
      error: "manual_only",
      hint: "Pide a la persona que lo marque o escriba ella misma.",
    };
  const h = el as HTMLInputElement;
  reveal(h as HTMLElement);
  h.focus?.({ preventScroll: true });
  if (info.kind === "checkbox") {
    const want = /^(true|s[ií]|yes|1|on|marcar|check)/i.test(value.trim());
    if (h.checked !== want) h.click();
  } else if (info.kind === "radio") {
    const radios = h.name
      ? Array.from(
          root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${esc(h.name)}"]`),
        )
      : [h];
    const j = bestMatch(
      value,
      radios.map((r) => labelOf(r)),
    );
    const r = radios[j];
    if (!r)
      return { ok: false, field: info.label, error: "option_not_found", options: info.options };
    r.click();
  } else if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options).filter((o) => !o.disabled);
    let j = opts.findIndex((o) => o.value === value);
    if (j < 0)
      j = bestMatch(
        value,
        opts.map((o) => text(o) || o.value),
      );
    const o = opts[j];
    if (!o)
      return { ok: false, field: info.label, error: "option_not_found", options: info.options };
    setNative(el, o.value);
  } else {
    setNative(h, value);
  }
  markAi(el);
  h.blur?.(); // run the form's blur rules (e.g. phone normalisation, touched → errors shown)
  await frame();
  await frame();
  const fresh = listFields(screenRoot(doc)).find((f) => f.el === el)?.info;
  return {
    ok: true,
    field: info.label,
    value: fresh?.value ?? value,
    state: fresh?.state,
    message: fresh?.message,
  };
}

export interface PressResult {
  ok: boolean;
  action?: string;
  error?: "action_not_found" | "needs_user_tap" | "needs_confirmation";
  hint?: string;
  invalid?: { field: string; message?: string }[];
}

function highlight(el: HTMLElement) {
  reveal(el);
  el.dataset.agentHighlight = "true";
  window.setTimeout(() => {
    delete el.dataset.agentHighlight;
  }, 6000);
}

/** Press a button / tab / link by its visible name. Protected and submit actions follow the rules above. */
export async function press(
  action: string,
  userConfirmed = false,
  doc: Document = document,
): Promise<PressResult> {
  const root = screenRoot(doc);
  const actions = listActions(root);
  const hit =
    actions[
      bestMatch(
        action,
        actions.map((a) => a.info.name),
      )
    ];
  if (!hit) return { ok: false, error: "action_not_found" };
  if (hit.info.protected) {
    highlight(hit.el);
    return {
      ok: false,
      action: hit.info.name,
      error: "needs_user_tap",
      hint: "Acción protegida (dinero, borrado, envío o firma): resalté el botón; la persona debe tocarlo.",
    };
  }
  if (hit.info.kind === "submit" && !userConfirmed) {
    highlight(hit.el);
    return {
      ok: false,
      action: hit.info.name,
      error: "needs_confirmation",
      hint: "Lee el resumen de los datos y pide un 'sí' explícito antes de enviar.",
    };
  }
  hit.el.click();
  await frame();
  await frame();
  const invalid = listFields(screenRoot(doc))
    .filter((f) => f.info.state === "invalid")
    .map((f) => ({ field: f.info.label, message: f.info.message }));
  return { ok: true, action: hit.info.name, invalid: invalid.length ? invalid : undefined };
}

/** Destination of a navigation request among the shell's modules, or null. */
export function resolveModule(
  destination: string,
  doc: Document = document,
): { name: string; path: string } | null {
  const mods = listModules(doc);
  const direct = mods.find((m) => m.path === destination);
  if (direct) return direct;
  return (
    mods[
      bestMatch(
        destination,
        mods.map((m) => m.name),
      )
    ] ?? null
  );
}
