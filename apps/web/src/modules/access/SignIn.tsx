import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useModuleT } from "../i18n";
import { adoptSession } from "../signup/api";
import { loginStart, loginVerify, tokenFromScan } from "./api";
import { type AccessKey, dict } from "./dict";

export interface GymChoice {
  id: string;
  name: string;
}

/** Passwordless sign-in: e-mail → 6-digit code → member portal (or `next`). */
export function CodeSignIn({
  gyms,
  defaultGym,
  next = "/me/home",
  onBack,
}: {
  gyms: GymChoice[];
  defaultGym?: string;
  next?: string;
  onBack?: () => void;
}) {
  const { t } = useModuleT(dict);
  const uid = useId();
  const [gym, setGym] = useState(defaultGym ?? gyms[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ key: AccessKey; code?: string; tone: "info" | "error" } | null>(
    null,
  );
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gym && gyms[0]) setGym(gyms[0].id);
  }, [gym, gyms]);

  const err = (e: string): AccessKey =>
    e === "rate_limited"
      ? "signin.rate"
      : e === "login_delivery_unavailable"
        ? "signin.unavailable"
        : e === "invalid_code"
          ? "signin.bad"
          : "signin.error";

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await loginStart(gym, email.trim());
    setBusy(false);
    if (!r.ok) {
      setMsg({ key: err(r.error), tone: "error" });
      return;
    }
    setStep("code");
    setMsg(
      r.data.demo_code
        ? { key: "signin.demoCode", code: r.data.demo_code, tone: "info" }
        : { key: "signin.noAccount", tone: "info" },
    );
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await loginVerify(gym, email.trim(), code.trim());
    if (!r.ok) {
      setBusy(false);
      setMsg({ key: err(r.error), tone: "error" });
      return;
    }
    adoptSession(r.data.session, null, next); // full navigation into the portal
  }

  return (
    <div className="acc-signin">
      {step === "email" ? (
        <form className="form" onSubmit={send} noValidate>
          {gyms.length > 1 ? (
            <div className="field">
              <label htmlFor={`${uid}-gym`}>{t("signin.gym")}</label>
              <select id={`${uid}-gym`} value={gym} onChange={(e) => setGym(e.target.value)}>
                {gyms.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={`${uid}-email`}>{t("signin.email")}</label>
            <input
              id={`${uid}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.includes("@")}
            >
              {busy ? t("signin.sending") : t("signin.send")}
              <Icon name="arrowRight" size={18} />
            </button>
            {onBack ? (
              <button type="button" className="btn btn--ghost" onClick={onBack}>
                {t("signin.back")}
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <form className="form" onSubmit={verify} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-code`}>{t("signin.codeLabel")}</label>
            <input
              ref={codeRef}
              id={`${uid}-code`}
              className="acc-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
              {busy ? t("signin.verifying") : t("signin.verify")}
              <Icon name="arrowRight" size={18} />
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setStep("email");
                setCode("");
                setMsg(null);
              }}
            >
              {t("signin.change")}
            </button>
          </div>
        </form>
      )}
      <output className={`acc-msg${msg ? ` acc-msg--${msg.tone}` : ""}`} aria-live="polite">
        {msg ? t(msg.key, msg.code ? { code: msg.code } : undefined) : null}
      </output>
    </div>
  );
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** In-app QR scanner for the door codes (BarcodeDetector). Falls back to "use your phone camera". */
export function DoorScanner({ onClose }: { onClose(): void }) {
  const { t } = useModuleT(dict);
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "live" | "unsupported" | "denied">("starting");
  const [notDoor, setNotDoor] = useState(false);

  useEffect(() => {
    const Ctor = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
      .BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    const detector = new Ctor({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        if (alive) setState("denied");
        return;
      }
      if (!alive || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setState("live");
      const tick = async () => {
        if (!alive || !video.current) return;
        try {
          const codes = await detector.detect(video.current);
          for (const c of codes) {
            const tok = tokenFromScan(c.rawValue);
            if (tok) {
              alive = false;
              const q = c.rawValue.match(/[?&]o=([0-9a-f-]{36})/i)?.[1];
              navigate(`/door/${encodeURIComponent(tok)}${q ? `?o=${q}` : ""}`);
              return;
            }
            setNotDoor(true);
          }
        } catch {
          /* frame not ready */
        }
        raf = window.setTimeout(tick, 250) as unknown as number;
      };
      void tick();
    })();
    return () => {
      alive = false;
      window.clearTimeout(raf);
      for (const tr of stream?.getTracks() ?? []) tr.stop();
    };
  }, [navigate]);

  return (
    <div className="acc-scan">
      <p className="acc-scan__help">{t("scan.help")}</p>
      {state === "unsupported" || state === "denied" ? (
        <p className="note">{t(state === "denied" ? "scan.denied" : "scan.unsupported")}</p>
      ) : (
        <div className="acc-scan__frame">
          <video
            ref={video}
            playsInline
            muted
            className="acc-scan__video"
            aria-label={t("scan.title")}
          />
          <span className="acc-scan__target" aria-hidden="true" />
        </div>
      )}
      {notDoor ? <p className="acc-msg acc-msg--error">{t("scan.notDoor")}</p> : null}
      <button type="button" className="btn" onClick={onClose}>
        {t("scan.close")}
      </button>
    </div>
  );
}
