import { type FormEvent, useId, useRef, useState } from "react";
import { Icon } from "../../components/icons";
import { useModuleT } from "../i18n";
import { type JoinAccepted, adoptSession, joinEnv } from "../signup/api";
import { type AccessKey, dict } from "./dict";

type Session = NonNullable<JoinAccepted["session"]> & { refresh?: string };
type Res =
  | { ok: true; data: { session?: Session; must_change?: boolean } }
  | { ok: false; error: string };

async function post(path: string, body: unknown): Promise<Res> {
  try {
    const r = await joinEnv.fetch(`${joinEnv.baseUrl}${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok
      ? { ok: true, data: j as { session?: Session; must_change?: boolean } }
      : { ok: false, error: j.error ?? "unknown" };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Staff sign-in with e-mail and password; first sign-in replaces the owner-given password. */
export function StaffSignIn() {
  const { t } = useModuleT(dict);
  const uid = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<"login" | "change">("login");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<AccessKey | null>(null);
  const nextRef = useRef<HTMLInputElement>(null);

  const fail = (e: string): AccessKey =>
    e === "locked"
      ? "staff.locked"
      : e === "weak_password"
        ? "staff.weak"
        : e === "rate_limited"
          ? "signin.rate"
          : e === "network"
            ? "signin.error"
            : "staff.bad";

  const done = (s: Session) => adoptSession(s, null, "/"); // full navigation; the router opens the role's home

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await post("/public/auth/password", { email: email.trim(), password });
    setBusy(false);
    if (!r.ok) return setMsg(fail(r.error));
    if (r.data.must_change) {
      setStep("change");
      requestAnimationFrame(() => nextRef.current?.focus());
      return;
    }
    if (r.data.session) done(r.data.session);
  }

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== again) return setMsg("staff.mismatch");
    setBusy(true);
    const r = await post("/public/auth/password/change", {
      email: email.trim(),
      password,
      new_password: next,
    });
    setBusy(false);
    if (!r.ok) return setMsg(fail(r.error));
    if (r.data.session) done(r.data.session);
  }

  // Live hint for the new password (the server applies the full rule).
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const nextErr =
    next && (next.length < 10 || (local.length > 2 && next.toLowerCase().includes(local)))
      ? t("staff.rule")
      : undefined;

  return (
    <section className="section acc-entry" aria-labelledby={`${uid}-t`}>
      <div className="section__head">
        <h2 id={`${uid}-t`} className="section__title">
          <Icon name="building" size={24} />
          {step === "login" ? t("staff.title") : t("staff.changeTitle")}
        </h2>
      </div>
      <p className="lede">{step === "login" ? t("staff.lede") : t("staff.changeLede")}</p>
      {step === "login" ? (
        <form key="login" className="form acc-signin" onSubmit={signIn} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-e`}>{t("staff.email")}</label>
            <input
              id={`${uid}-e`}
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-p`}>{t("staff.password")}</label>
            <input
              id={`${uid}-p`}
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="acc-check">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              data-agent="auto"
            />
            <span>{t("staff.show")}</span>
          </label>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !email.includes("@") || !password}
              data-tour-id="staff-signin"
            >
              {busy ? t("staff.signingIn") : t("staff.signin")}
              <Icon name="arrowRight" size={18} />
            </button>
          </div>
        </form>
      ) : (
        <form key="change" className="form acc-signin" onSubmit={changePw} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-n`}>{t("staff.new")}</label>
            <input
              ref={nextRef}
              id={`${uid}-n`}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={next}
              data-live-error={nextErr}
              aria-describedby={`${uid}-rule`}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="help" id={`${uid}-rule`}>
              {t("staff.rule")}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-a`}>{t("staff.confirm")}</label>
            <input
              id={`${uid}-a`}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              maxLength={128}
              value={again}
              data-live-error={again && again !== next ? t("staff.mismatch") : undefined}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
          <label className="acc-check">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              data-agent="auto"
            />
            <span>{t("staff.show")}</span>
          </label>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || next.length < 10 || next !== again}
            >
              {t("staff.save")}
            </button>
          </div>
        </form>
      )}
      <output className={`acc-msg${msg ? " acc-msg--error" : ""}`} aria-live="polite">
        {msg ? t(msg) : null}
      </output>
    </section>
  );
}
