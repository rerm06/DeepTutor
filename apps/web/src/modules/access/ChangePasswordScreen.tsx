import { type FormEvent, useId, useState } from "react";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { IconSection } from "../schedule/shared";
import { type JoinAccepted, adoptSession, joinEnv } from "../signup/api";
import { type AccessKey, dict } from "./dict";

/** Any signed-in staff member with a password changes it here, whenever they want. */
export function ChangePasswordScreen() {
  const { t } = useModuleT(dict);
  const { me } = useSession();
  const uid = useId();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<AccessKey | null>(null);
  const email = me?.person.email ?? "";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const nextErr =
    next && (next.length < 10 || (local.length > 2 && next.toLowerCase().includes(local)))
      ? t("staff.rule")
      : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== again) return setMsg("staff.mismatch");
    setBusy(true);
    try {
      const r = await joinEnv.fetch(`${joinEnv.baseUrl}/public/auth/password/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password: cur, new_password: next }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        session?: NonNullable<JoinAccepted["session"]>;
      };
      if (r.ok && j.session) {
        setMsg("pw.done");
        adoptSession(j.session, null, "/");
        return;
      }
      setMsg(
        j.error === "weak_password"
          ? "staff.weak"
          : j.error === "locked"
            ? "staff.locked"
            : "pw.wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">{t("pw.title")}</h1>
      </header>
      <IconSection icon="gear" title={t("pw.title")}>
        <form className="form acc-signin" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={`${uid}-c`}>{t("pw.current")}</label>
            <input
              id={`${uid}-c`}
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-n`}>{t("staff.new")}</label>
            <input
              id={`${uid}-n`}
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={next}
              data-live-error={nextErr}
              aria-describedby={`${uid}-r`}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="help" id={`${uid}-r`}>
              {t("staff.rule")}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-a`}>{t("staff.confirm")}</label>
            <input
              id={`${uid}-a`}
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={again}
              data-live-error={again && again !== next ? t("staff.mismatch") : undefined}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !cur || next.length < 10 || next !== again || !email}
            >
              {t("pw.save")}
            </button>
          </div>
          <output
            aria-live="polite"
            className={`acc-msg${msg && msg !== "pw.done" ? " acc-msg--error" : ""}`}
          >
            {msg ? t(msg) : null}
          </output>
        </form>
      </IconSection>
    </div>
  );
}
