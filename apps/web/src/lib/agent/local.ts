/**
 * Local assistant: runs entirely in the browser when Gemini Live is not configured or not reachable.
 * It is a guided interviewer, not a language model: it walks the screen's fields in order, asks each one with the
 * browser's speech synthesis, listens with the Web Speech API (or reads the typed answer), normalises the answer,
 * writes it through the same bridge as Gemini, reads back the validation and re-asks on errors.
 * Commands: "saltar", "repetir", "parar"; outside an interview: "ir a <módulo>", "<campo> es <valor>",
 * "preguntar todo".
 */
import {
  type FieldInfo,
  bestMatch,
  describeScreen,
  fillField,
  norm,
  press,
  resolveModule,
} from "./bridge";
import { NO, REPEAT, SKIP, STOP, YES, normalizeAnswer } from "./spoken";
import type { ToolLog } from "./tools";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function speechRecognitionAvailable(): boolean {
  const w = globalThis as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export interface LocalCallbacks {
  onStatus(s: "ready" | "listening" | "speaking" | "closed"): void;
  onUserText(t: string, final: boolean): void;
  onAgentText(t: string, final: boolean): void;
  onLog(l: ToolLog): void;
  navigate(path: string): void;
}

const COPY = {
  es: {
    hello:
      "Soy el asistente local. Te voy a preguntar los datos uno a uno; puedes contestar hablando o escribiendo, y corregir cualquier campo a mano.",
    nothing: "No veo campos para completar en esta pantalla.",
    ask: (f: FieldInfo) =>
      f.kind === "checkbox"
        ? `¿Marco «${f.label}»? Di sí o no.`
        : f.options?.length
          ? `${f.label}. Opciones: ${f.options.slice(0, 6).join(", ")}.`
          : `¿${f.label}?`,
    invalid: (m?: string) =>
      `Ese dato no es válido${m ? `: ${clean(m)}` : ""}. Inténtalo otra vez.`,
    noOption: (o: string[]) => `No encontré esa opción. Puedes decir: ${o.slice(0, 6).join(", ")}.`,
    got: (f: string, v: string) => `${f}: ${v}.`,
    manual: (l: string[]) => `Obligatorio, márcalo tú: ${l.join("; ")}.`,
    manualOpt: (l: string[]) => `Opcional, si quieres márcalo tú: ${l.join("; ")}.`,
    submit: (a: string) => `¿Envío el formulario con «${a}»? Di sí o no.`,
    protected: (a: string) => `Resalté «${a}». Tócalo tú cuando estés listo.`,
    done: "Listo. Revisa los datos; puedes cambiar cualquiera a mano.",
    stopped: "Detenido.",
    notUnderstood:
      "No entendí. Di por ejemplo «ir a Agenda», «Teléfono es 787…» o «preguntar todo».",
    went: (m: string) => `Abrí ${m}.`,
    skipped: "Lo dejo en blanco.",
  },
  en: {
    hello:
      "I'm the local assistant. I'll ask for each item one at a time; answer by voice or typing, and fix any field by hand.",
    nothing: "I don't see fields to fill on this screen.",
    ask: (f: FieldInfo) =>
      f.kind === "checkbox"
        ? `Tick "${f.label}"? Say yes or no.`
        : f.options?.length
          ? `${f.label}. Options: ${f.options.slice(0, 6).join(", ")}.`
          : `${f.label}?`,
    invalid: (m?: string) => `That isn't valid${m ? `: ${clean(m)}` : ""}. Please try again.`,
    noOption: (o: string[]) =>
      `I couldn't find that option. You can say: ${o.slice(0, 6).join(", ")}.`,
    got: (f: string, v: string) => `${f}: ${v}.`,
    manual: (l: string[]) => `Required, please tick yourself: ${l.join("; ")}.`,
    manualOpt: (l: string[]) => `Optional, tick yourself if you want: ${l.join("; ")}.`,
    submit: (a: string) => `Submit the form with "${a}"? Say yes or no.`,
    protected: (a: string) => `I highlighted "${a}". Tap it yourself when ready.`,
    done: "Done. Review the data; you can change any field by hand.",
    stopped: "Stopped.",
    notUnderstood: 'I didn\'t get that. Try "go to Schedule", "Phone is 787…" or "ask everything".',
    went: (m: string) => `Opened ${m}.`,
    skipped: "Leaving it blank.",
  },
};

/** First sentence of a long consent label, for speech. */
const short = (s: string) =>
  s.length > 70 ? `${s.slice(0, s.indexOf(".") > 20 ? s.indexOf(".") : 70)}…` : s;
const clean = (m?: string) => m?.replace(/[.\s]+$/, "");

export class LocalAgent {
  private rec: Rec | null = null;
  private pending: ((t: string) => void) | null = null;
  private stopped = false;
  private busy = false;
  voice = true;

  constructor(
    private readonly cb: LocalCallbacks,
    private readonly lang: "es" | "en",
  ) {}

  private get t() {
    return COPY[this.lang];
  }

  async say(text: string): Promise<void> {
    this.cb.onAgentText(text, true);
    const synth = globalThis.speechSynthesis;
    if (!this.voice || !synth || typeof SpeechSynthesisUtterance === "undefined") return;
    this.cb.onStatus("speaking");
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.lang === "es" ? "es-PR" : "en-US";
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.cancel();
      synth.speak(u);
      window.setTimeout(resolve, Math.min(12_000, 900 + text.length * 70));
    });
    this.cb.onStatus("ready");
  }

  /** Typed answer (or a command when no question is pending). */
  input(text: string) {
    const t = text.trim();
    if (!t) return;
    this.cb.onUserText(t, true);
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.rec?.abort();
      p(t);
      return;
    }
    void this.command(t);
  }

  private listen(): Promise<string> {
    return new Promise((resolve) => {
      this.pending = resolve;
      if (!this.voice || !speechRecognitionAvailable()) return;
      const w = globalThis as unknown as {
        SpeechRecognition?: new () => Rec;
        webkitSpeechRecognition?: new () => Rec;
      };
      const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => Rec;
      const rec = new Ctor();
      this.rec = rec;
      rec.lang = this.lang === "es" ? "es-PR" : "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = "";
      rec.onresult = (e) => {
        let s = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          s += r[0]?.transcript ?? "";
          if (r.isFinal) finalText = s;
        }
        this.cb.onUserText(s, false);
      };
      rec.onerror = () => {};
      rec.onend = () => {
        this.rec = null;
        this.cb.onStatus("ready");
        if (this.pending !== resolve) return; // answered by typing
        if (finalText) {
          this.pending = null;
          this.cb.onUserText(finalText, true);
          resolve(finalText);
        }
        // No speech: keep waiting for a typed answer or a tap on the mic.
      };
      this.cb.onStatus("listening");
      try {
        rec.start();
      } catch {
        this.rec = null;
      }
    });
  }

  /** Re-open the microphone for the pending question (mic button). */
  relisten() {
    if (!this.pending || this.rec) return;
    const p = this.pending;
    this.pending = null;
    void this.listen().then(p);
  }

  private async ask(q: string): Promise<string> {
    await this.say(q);
    return this.listen();
  }

  stop() {
    this.stopped = true;
    this.rec?.abort();
    globalThis.speechSynthesis?.cancel();
    const p = this.pending;
    this.pending = null;
    p?.("parar");
    this.cb.onStatus("closed");
  }

  async interview(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.stopped = false;
    try {
      await this.say(this.t.hello);
      const first = describeScreen().fields;
      const todo = first.filter((f) => !f.manual && f.state !== "valid");
      if (!todo.length && !first.some((f) => f.manual)) {
        await this.say(this.t.nothing);
        return;
      }
      for (const f0 of todo) {
        let tries = 0;
        while (!this.stopped && tries < 3) {
          // Re-read: the screen may have changed (a field appears after a choice).
          const f = describeScreen().fields.find((x) => x.id === f0.id) ?? f0;
          if (f.state === "valid" && tries === 0 && f.value) break;
          const raw = await this.ask(this.t.ask(f));
          if (this.stopped || STOP.test(raw)) {
            this.stopped = true;
            break;
          }
          if (REPEAT.test(raw)) continue;
          if (SKIP.test(raw)) {
            await this.say(this.t.skipped);
            break;
          }
          const value = normalizeAnswer(f.kind, f.label, raw, this.lang);
          const r = await fillField(f.id, value);
          this.cb.onLog({
            tool: "fill_field",
            label: f.label,
            ok: r.ok && r.state !== "invalid",
            detail: r.ok ? (r.state === "invalid" ? r.message : r.value) : r.error,
          });
          if (r.ok && r.state !== "invalid") {
            await this.say(this.t.got(f.label, r.value ?? value));
            break;
          }
          tries += 1;
          await this.say(
            r.error === "option_not_found"
              ? this.t.noOption(r.options ?? f.options ?? [])
              : this.t.invalid(r.message),
          );
        }
        if (this.stopped) break;
      }
      if (this.stopped) {
        await this.say(this.t.stopped);
        return;
      }
      const screen = describeScreen();
      const manual = screen.fields
        .filter((f) => f.manual && f.state !== "valid")
        .map((f) => f.label);
      if (manual.length) await this.say(this.t.manual(manual));
      const submit = screen.actions.find((a) => a.kind === "submit");
      if (submit) {
        if (submit.protected) {
          await press(submit.name);
          await this.say(this.t.protected(submit.name));
        } else {
          const ans = await this.ask(this.t.submit(submit.name));
          if (YES.test(ans) && !NO.test(ans)) {
            const r = await press(submit.name, true);
            this.cb.onLog({
              tool: "press",
              label: submit.name,
              ok: r.ok,
              detail: r.ok ? undefined : r.error,
            });
            if (r.invalid?.length)
              await this.say(this.t.invalid(r.invalid[0]?.message ?? r.invalid[0]?.field));
          }
        }
      }
      await this.say(this.t.done);
    } finally {
      this.busy = false;
    }
  }

  private async command(raw: string) {
    const s = norm(raw);
    if (/^(preguntar todo|pregunta todo|llenar|registr|ask everything|fill)/.test(s))
      return this.interview();
    const go = s.match(/^(ir a|ve a|abre|abrir|go to|open)\s+(.+)$/);
    if (go?.[2]) {
      const m = resolveModule(go[2]);
      if (m) {
        this.cb.navigate(m.path);
        this.cb.onLog({ tool: "navigate", label: m.name, ok: true });
        return this.say(this.t.went(m.name));
      }
    }
    const set = raw.match(/^(.{2,40}?)\s*(?:\bes\b|\bis\b|:|=)\s*(.+)$/i);
    if (set?.[1] && set[2]) {
      const fields = describeScreen().fields;
      const i = bestMatch(
        set[1],
        fields.map((f) => f.label),
      );
      const f = fields[i];
      if (f) {
        const r = await fillField(f.id, normalizeAnswer(f.kind, f.label, set[2], this.lang));
        this.cb.onLog({
          tool: "fill_field",
          label: f.label,
          ok: r.ok && r.state !== "invalid",
          detail: r.ok ? (r.state === "invalid" ? r.message : r.value) : r.error,
        });
        return this.say(
          r.ok && r.state !== "invalid"
            ? this.t.got(f.label, r.value ?? "")
            : this.t.invalid(r.message),
        );
      }
    }
    return this.say(this.t.notUnderstood);
  }
}
