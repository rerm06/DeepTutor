import {
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { LiveSession, type LiveToken } from "../lib/agent/live";
import { LocalAgent, speechRecognitionAvailable } from "../lib/agent/local";
import {
  INTERVIEW_PROMPT,
  TOOLS,
  type ToolLog,
  runTool,
  systemInstruction,
} from "../lib/agent/tools";
import { useCurrentBrand } from "../lib/brandTheme";
import { useModuleT } from "../modules/i18n";
import { useSession } from "../session/SessionContext";
import { Icon } from "./icons";
import "./liveAgent.css";

const dict = {
  es: {
    fab: "Asistente IA",
    title: "Asistente Live",
    close: "Cerrar asistente",
    modeLive: "Gemini Live",
    modeLocal: "Modo local",
    modeIdle: "Listo",
    askAll: "Preguntar todo",
    askAllHelp: "Te pregunta cada dato de esta pantalla, lo escribe y lo valida.",
    mic: "Hablar",
    micOff: "Silenciar micrófono",
    stop: "Detener",
    typeLabel: "Escribe en vez de hablar",
    typePh: "Ej.: ir a Agenda · Teléfono es 787…",
    send: "Enviar",
    disclosure:
      "Asistente de inteligencia artificial. Revisa cada dato: puedes editar cualquier campo a mano. Los consentimientos los marcas tú.",
    privacyLive:
      "Mientras el micrófono está activo, el audio se envía a Google Gemini para procesarlo.",
    privacyLocal: "Modo local: la voz se procesa con el reconocimiento de tu navegador.",
    fallback: "Gemini Live no está disponible ({why}); uso el asistente local.",
    whyOff: "sin clave configurada",
    whyNet: "sin conexión con Gemini",
    micDenied: "No tengo permiso para el micrófono. Puedes escribir tus respuestas abajo.",
    noVoice: "Este navegador no reconoce voz; escribe tus respuestas abajo.",
    connecting: "Conectando…",
    listening: "Escuchando…",
    speaking: "Hablando…",
    ready: "Listo",
    closed: "Sesión terminada",
    you: "Tú",
    agent: "Asistente",
    log: "Acciones",
    empty: "Pulsa «Preguntar todo» o el micrófono para empezar.",
    ok: "hecho",
    fail: "pendiente",
  },
  en: {
    fab: "AI assistant",
    title: "Live assistant",
    close: "Close assistant",
    modeLive: "Gemini Live",
    modeLocal: "Local mode",
    modeIdle: "Ready",
    askAll: "Ask me everything",
    askAllHelp: "Asks for every item on this screen, types it and validates it.",
    mic: "Talk",
    micOff: "Mute microphone",
    stop: "Stop",
    typeLabel: "Type instead of talking",
    typePh: "E.g. go to Schedule · Phone is 787…",
    send: "Send",
    disclosure:
      "Artificial intelligence assistant. Review every item: you can edit any field by hand. You tick the consents yourself.",
    privacyLive: "While the microphone is on, audio is sent to Google Gemini for processing.",
    privacyLocal: "Local mode: speech is processed by your browser's recognition.",
    fallback: "Gemini Live is unavailable ({why}); using the local assistant.",
    whyOff: "no key configured",
    whyNet: "cannot reach Gemini",
    micDenied: "No microphone permission. You can type your answers below.",
    noVoice: "This browser can't recognise speech; type your answers below.",
    connecting: "Connecting…",
    listening: "Listening…",
    speaking: "Speaking…",
    ready: "Ready",
    closed: "Session ended",
    you: "You",
    agent: "Assistant",
    log: "Actions",
    empty: "Press “Ask me everything” or the microphone to start.",
    ok: "done",
    fail: "pending",
  },
};
type K = keyof (typeof dict)["es"];

type Status = "idle" | "connecting" | "ready" | "listening" | "speaking" | "closed" | "error";
interface Line {
  id: number;
  who: "user" | "agent" | "note";
  text: string;
  final: boolean;
}

interface Ctx {
  open(opts?: { interview?: boolean }): void;
  isOpen: boolean;
}
const LiveAgentContext = createContext<Ctx | null>(null);
export function useLiveAgent(): Ctx {
  return useContext(LiveAgentContext) ?? { open: () => {}, isOpen: false };
}

async function fetchToken(
  hasSession: boolean,
  request: (m: string, p: string, b?: unknown) => Promise<unknown>,
  pathname: string,
): Promise<LiveToken> {
  if (hasSession) return (await request("POST", "/live/token", {})) as LiveToken;
  const org = pathname.match(/^\/join\/([0-9a-f-]{36})/i)?.[1];
  if (!org) throw new Error("live_unavailable");
  const res = await fetch("/api/v1/public/live/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org_id: org }),
  });
  if (!res.ok) throw new Error(res.status === 503 ? "live_unavailable" : "live_upstream");
  return (await res.json()) as LiveToken;
}

export function LiveAgentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [autoInterview, setAutoInterview] = useState(0);
  const open = useCallback((opts?: { interview?: boolean }) => {
    setOpen(true);
    if (opts?.interview) setAutoInterview((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);
  return (
    <LiveAgentContext.Provider value={value}>
      {children}
      {createPortal(
        <LiveAgentDock
          isOpen={isOpen}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          autoInterview={autoInterview}
        />,
        document.body,
      )}
    </LiveAgentContext.Provider>
  );
}

function LiveAgentDock({
  isOpen,
  onOpen,
  onClose,
  autoInterview,
}: {
  isOpen: boolean;
  onOpen(): void;
  onClose(): void;
  autoInterview: number;
}) {
  const { t } = useModuleT(dict);
  const { lang } = useI18n();
  const brand = useCurrentBrand();
  const { api } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const uid = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<"none" | "live" | "local">("none");
  const [lines, setLines] = useState<Line[]>([]);
  const [logs, setLogs] = useState<(ToolLog & { id: number })[]>([]);
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState("");
  const live = useRef<LiveSession | null>(null);
  const local = useRef<LocalAgent | null>(null);
  const seq = useRef(0);
  const panelRef = useRef<HTMLDialogElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const note = useCallback((text: string) => {
    setLines((l) => [...l, { id: ++seq.current, who: "note", text, final: true }]);
  }, []);
  const upsert = useCallback((who: "user" | "agent", text: string, final: boolean) => {
    setLines((l) => {
      const last = l[l.length - 1];
      if (last && last.who === who && !last.final)
        return [...l.slice(0, -1), { ...last, text, final }];
      return [...l, { id: ++seq.current, who, text, final }];
    });
  }, []);
  const addLog = useCallback((x: ToolLog) => {
    setLogs((l) => [...l.slice(-30), { ...x, id: ++seq.current }]);
  }, []);
  const go = useCallback((path: string) => navigate(path), [navigate]);

  // Keep the transcript scrolled to the newest line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const startLocal = useCallback(
    (why?: string) => {
      if (!local.current) {
        local.current = new LocalAgent(
          {
            onStatus: (s) => setStatus(s),
            onUserText: (x, f) => upsert("user", x, f),
            onAgentText: (x, f) => upsert("agent", x, f),
            onLog: addLog,
            navigate: go,
          },
          lang === "en" ? "en" : "es",
        );
      }
      setMode("local");
      if (why) note(t("fallback", { why }));
      if (!speechRecognitionAvailable()) note(t("noVoice"));
      setStatus("ready");
      return local.current;
    },
    [addLog, go, lang, note, t, upsert],
  );

  const startLive = useCallback(async (): Promise<LiveSession | null> => {
    if (live.current) return live.current;
    setStatus("connecting");
    let tok: LiveToken;
    try {
      tok = await fetchToken(api.hasSession, (m, p, b) => api.request(m, p, b), pathRef.current);
    } catch (e) {
      const msg = (e as Error).message;
      const off = /unavailable|503/.test(msg) || /api_error:503/.test(msg);
      startLocal(t(off ? "whyOff" : "whyNet"));
      return null;
    }
    const s = new LiveSession(
      {
        onStatus: (x) => {
          setStatus(x === "error" ? "ready" : x);
          if (x === "closed") {
            live.current = null;
            setMode("none");
          }
        },
        onUserText: (x, f) => upsert("user", x, f),
        onAgentText: (x, f) => upsert("agent", x, f),
        onLevel: setLevel,
        onTool: (name, args) => runTool(name, args, go, addLog),
      },
      {
        systemInstruction: systemInstruction(lang === "en" ? "en" : "es", brand?.name ?? ""),
        tools: TOOLS,
      },
    );
    try {
      await s.connect(tok);
    } catch {
      s.close();
      startLocal(t("whyNet"));
      return null;
    }
    live.current = s;
    setMode("live");
    return s;
  }, [addLog, api, brand?.name, go, lang, startLocal, t, upsert]);

  const toggleMic = useCallback(async () => {
    if (mode === "local" && local.current) {
      local.current.relisten();
      return;
    }
    const s = live.current ?? (await startLive());
    if (!s) {
      local.current?.relisten();
      return;
    }
    if (s.micActive) {
      s.stopMic();
      setStatus("ready");
      return;
    }
    try {
      await s.startMic();
    } catch {
      note(t("micDenied"));
    }
  }, [mode, note, startLive, t]);

  const askAll = useCallback(async () => {
    const s = mode === "local" ? null : (live.current ?? (await startLive()));
    if (s) {
      try {
        if (!s.micActive) await s.startMic();
      } catch {
        note(t("micDenied"));
      }
      s.sendText(INTERVIEW_PROMPT[lang === "en" ? "en" : "es"]);
      return;
    }
    const l = local.current ?? startLocal();
    void l.interview();
  }, [lang, mode, note, startLive, startLocal, t]);

  const stopAll = useCallback(() => {
    live.current?.close();
    live.current = null;
    local.current?.stop();
    setMode("none");
    setStatus("idle");
    setLevel(0);
  }, []);

  // "Registrarme con IA" buttons open the dock straight into the interview.
  const lastAuto = useRef(0);
  useEffect(() => {
    if (autoInterview > lastAuto.current) {
      lastAuto.current = autoInterview;
      void askAll();
    }
  }, [autoInterview, askAll]);

  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);
  useEffect(() => () => stopAll(), [stopAll]);

  const close = () => {
    stopAll();
    onClose();
    requestAnimationFrame(() => fabRef.current?.focus());
  };

  const onType = (e: FormEvent) => {
    e.preventDefault();
    const x = typed.trim();
    if (!x) return;
    setTyped("");
    if (live.current) {
      upsert("user", x, true);
      live.current.sendText(x);
    } else (local.current ?? startLocal()).input(x);
  };

  const statusText =
    status === "connecting"
      ? t("connecting")
      : status === "listening"
        ? t("listening")
        : status === "speaking"
          ? t("speaking")
          : status === "closed"
            ? t("closed")
            : t("ready");
  const micOn = status === "listening";
  const hidden = location.pathname === "/" && !api.hasSession;
  if (hidden) return null;

  return (
    <div className="la" data-agent-ignore="" data-open={isOpen ? "true" : "false"}>
      {!isOpen ? (
        <button
          ref={fabRef}
          type="button"
          className="la-fab"
          onClick={onOpen}
          aria-haspopup="dialog"
        >
          <span className="la-fab__orb" aria-hidden="true">
            <Icon name="sparkle" size={20} />
          </span>
          <span className="la-fab__label">{t("fab")}</span>
        </button>
      ) : (
        <dialog
          open
          ref={panelRef}
          className="la-panel"
          aria-labelledby={`${uid}-t`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <header className="la-head">
            <div
              className="la-orb"
              data-status={status}
              style={{ ["--lvl" as string]: String(Math.min(1, level * 3)) }}
            >
              <Icon name="sparkle" size={22} />
            </div>
            <div className="la-head__text">
              <h2 id={`${uid}-t`} className="la-title">
                {t("title")}
              </h2>
              <p className="la-sub">
                <span className={`la-mode la-mode--${mode}`}>
                  {mode === "live"
                    ? t("modeLive")
                    : mode === "local"
                      ? t("modeLocal")
                      : t("modeIdle")}
                </span>
                <output className="la-status">{statusText}</output>
              </p>
            </div>
            <button type="button" className="la-icon-btn" onClick={close} aria-label={t("close")}>
              <Icon name="close" size={20} />
            </button>
          </header>

          <div className="la-cta">
            <button type="button" className="la-ask" onClick={() => void askAll()}>
              <Icon name="chat" size={20} />
              {t("askAll")}
            </button>
            <button
              type="button"
              className={`la-mic${micOn ? " is-on" : ""}`}
              onClick={() => void toggleMic()}
              aria-pressed={micOn}
              aria-label={micOn ? t("micOff") : t("mic")}
            >
              <MicIcon />
            </button>
            {mode !== "none" ? (
              <button
                type="button"
                className="la-icon-btn"
                onClick={stopAll}
                aria-label={t("stop")}
              >
                <span className="la-stop" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <p className="la-help">{t("askAllHelp")}</p>

          <ol className="la-lines" ref={logRef} aria-live="polite" aria-relevant="additions">
            {lines.length === 0 ? <li className="la-empty">{t("empty")}</li> : null}
            {lines.map((l) => (
              <li key={l.id} className={`la-line la-line--${l.who}${l.final ? "" : " is-partial"}`}>
                {l.who !== "note" ? (
                  <span className="sr-only">{l.who === "user" ? t("you") : t("agent")}: </span>
                ) : null}
                {l.text}
              </li>
            ))}
          </ol>

          {logs.length ? (
            <details className="la-log">
              <summary>
                {t("log")} · {logs.length}
              </summary>
              <ul>
                {logs.slice(-8).map((x) => (
                  <li key={x.id} className={x.ok ? "is-ok" : "is-fail"}>
                    <Icon name={x.ok ? "check" : "close"} size={14} />
                    <span className="la-log__label">{x.label}</span>
                    {x.detail ? <span className="la-log__detail">{x.detail}</span> : null}
                    <span className="sr-only">{x.ok ? t("ok") : t("fail")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <form className="la-type" onSubmit={onType}>
            <label className="sr-only" htmlFor={`${uid}-in`}>
              {t("typeLabel")}
            </label>
            <input
              id={`${uid}-in`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t("typePh")}
              autoComplete="off"
            />
            <button type="submit" className="la-send" aria-label={t("send")}>
              <Icon name="arrowRight" size={18} />
            </button>
          </form>
          <p className="la-fine">
            {t("disclosure")}{" "}
            {mode === "live" ? t("privacyLive") : mode === "local" ? t("privacyLocal") : null}
          </p>
        </dialog>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export type { K as LiveAgentKey };
