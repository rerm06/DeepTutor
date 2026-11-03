import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { labelOf, stateOf } from "../lib/agent/bridge";
import { useModuleT } from "../modules/i18n";

/**
 * Live field assistant for EVERY form of the app (no per-form code): while a person or the AI agent types, the field
 * shows its state (typing · valid · needs attention · error) and a chip under it says what is being written and
 * whether it is valid. Rules come from the form itself: data-live-error (the form's live rule, e.g. sign-up), then
 * aria-invalid + .field-error, then the browser's constraint validation, then light type hints (tel, email).
 * The chip is visual only (aria-hidden): the forms keep their own accessible error messages.
 * Writes data-state / data-filled-by on the `.field` container; React does not own those attributes.
 */
const dict = {
  es: {
    typing: "Escribiendo",
    valid: "Válido",
    invalid: "Revisa este dato",
    required: "Obligatorio",
    ai: "Llenado por IA",
    manual: "Editado a mano",
    tel: "Faltan dígitos: un teléfono tiene 10 (787, 939…)",
    email: "Falta el formato nombre@dominio",
    empty: "Vacío",
    checked: "Marcado",
    unchecked: "Sin marcar",
  },
  en: {
    typing: "Typing",
    valid: "Valid",
    invalid: "Check this value",
    required: "Required",
    ai: "Filled by AI",
    manual: "Edited by hand",
    tel: "Missing digits: a phone number has 10",
    email: "Needs the name@domain format",
    empty: "Empty",
    checked: "Ticked",
    unchecked: "Not ticked",
  },
};

type Ctl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const isCtl = (e: EventTarget | null): e is Ctl =>
  e instanceof HTMLInputElement ||
  e instanceof HTMLSelectElement ||
  e instanceof HTMLTextAreaElement;
const skip = (el: Ctl) =>
  el.closest("[data-agent-ignore], [data-assist='off']") !== null ||
  (el instanceof HTMLInputElement &&
    /^(hidden|file|submit|button|range|color|search)$/.test(el.type));

type St = "typing" | "valid" | "invalid" | "hint" | "empty";
interface Chip {
  label: string;
  value: string;
  st: St;
  msg?: string;
  source?: "ai" | "manual";
  rect: { left: number; top: number; width: number };
}

/** Light hints the browser does not check by itself. */
function typeHint(el: Ctl): "tel" | "email" | null {
  if (!(el instanceof HTMLInputElement) || !el.value.trim()) return null;
  if (el.type === "tel") {
    const d = el.value.replace(/\D/g, "");
    return d.length === 10 || (d.length === 11 && d.startsWith("1")) ? null : "tel";
  }
  if (el.type === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim()) ? null : "email";
  return null;
}

export function FieldAssist() {
  const { t } = useModuleT(dict);
  const [chip, setChip] = useState<Chip | null>(null);
  const focused = useRef<Ctl | null>(null);
  const typingTimer = useRef<number>(0);
  const touched = useRef(new WeakSet<Element>());

  useEffect(() => {
    const container = (el: Ctl) =>
      (el.closest(".field, fieldset, .join__option") ?? el.parentElement) as HTMLElement | null;

    const evaluate = (el: Ctl, typing: boolean): { st: St; msg?: string } => {
      const s = stateOf(el);
      const wasTouched = touched.current.has(el);
      const hint = typeHint(el);
      if (typing) {
        if (s.state === "invalid" || hint)
          return { st: "hint", msg: s.message ?? (hint ? t(hint) : undefined) };
        return { st: "typing" };
      }
      if (s.state === "invalid")
        return wasTouched || el.value ? { st: "invalid", msg: s.message } : { st: "empty" };
      if (hint) return { st: wasTouched ? "invalid" : "hint", msg: t(hint) };
      if (s.state === "empty") {
        const req = el.required || el.getAttribute("aria-required") === "true";
        return req && wasTouched ? { st: "invalid", msg: t("required") } : { st: "empty" };
      }
      return { st: "valid" };
    };

    const paint = (el: Ctl, typing: boolean, show: boolean) => {
      const box = container(el);
      const r = evaluate(el, typing);
      if (box) box.dataset.state = r.st;
      if (!show) return;
      const rc = el.getBoundingClientRect();
      const isCheck =
        el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      const value =
        el instanceof HTMLInputElement && el.type === "password"
          ? "•".repeat(Math.min(12, el.value.length))
          : isCheck
            ? (el as HTMLInputElement).checked
              ? t("checked")
              : t("unchecked")
            : el instanceof HTMLSelectElement
              ? (el.selectedOptions[0]?.textContent ?? "").trim()
              : el.value;
      const src = (box?.dataset.filledBy ?? (el as HTMLElement).dataset.filledBy) as Chip["source"];
      setChip({
        label: labelOf(el).replace(/\s*(obligatorio|opcional|required|optional)\s*$/i, ""),
        value: value.length > 60 ? `${value.slice(0, 57)}…` : value,
        st: r.st,
        msg: r.msg,
        source: src === "ai" || src === "manual" ? src : undefined,
        rect: { left: rc.left, top: rc.bottom, width: rc.width },
      });
    };

    const onInput = (e: Event) => {
      const el = e.target;
      if (!isCtl(el) || skip(el)) return;
      const box = container(el);
      if (e.isTrusted && box?.dataset.filledBy === "ai") {
        box.dataset.filledBy = "manual";
        el.dataset.filledBy = "manual";
      }
      const show = focused.current === el || box?.dataset.filledBy === "ai";
      paint(el, e.type === "input" && e.isTrusted, show);
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => {
        if (el.isConnected) paint(el, false, focused.current === el);
      }, 700);
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!isCtl(el) || skip(el)) return;
      focused.current = el;
      paint(el, false, true);
    };
    const onBlur = (e: FocusEvent) => {
      const el = e.target;
      if (!isCtl(el) || skip(el)) return;
      touched.current.add(el);
      if (focused.current === el) focused.current = null;
      // Let the form's own blur rules (normalisation, touched errors) run first.
      requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const ai = container(el)?.dataset.filledBy === "ai";
        paint(el, false, ai);
        if (!ai) setChip(null);
        else window.setTimeout(() => setChip((c) => (focused.current ? c : null)), 2600);
      });
    };
    const reposition = () => {
      const el = focused.current;
      if (!el) return;
      const rc = el.getBoundingClientRect();
      setChip((c) => (c ? { ...c, rect: { left: rc.left, top: rc.bottom, width: rc.width } } : c));
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", onBlur, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", onBlur, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.clearTimeout(typingTimer.current);
    };
  }, [t]);

  if (!chip) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const width = Math.min(360, Math.max(220, chip.rect.width));
  const left = Math.max(8, Math.min(chip.rect.left, vw - width - 8));
  const stText =
    chip.st === "typing"
      ? t("typing")
      : chip.st === "valid"
        ? t("valid")
        : chip.st === "invalid"
          ? t("invalid")
          : chip.st === "hint"
            ? t("typing")
            : t("empty");
  return createPortal(
    <div
      className={`fa-chip fa-chip--${chip.st}`}
      style={{ left, top: chip.rect.top + 6, width }}
      aria-hidden="true"
      data-agent-ignore=""
    >
      <div className="fa-chip__row">
        <span className="fa-chip__dot" />
        <span className="fa-chip__state">{stText}</span>
        {chip.source ? (
          <span className={`fa-chip__src fa-chip__src--${chip.source}`}>
            {chip.source === "ai" ? t("ai") : t("manual")}
          </span>
        ) : null}
      </div>
      {chip.value ? (
        <div className="fa-chip__value">
          <span className="fa-chip__label">{chip.label}:</span> «{chip.value}»
        </div>
      ) : null}
      {chip.msg && chip.st !== "valid" ? <div className="fa-chip__msg">{chip.msg}</div> : null}
    </div>,
    document.body,
  );
}
