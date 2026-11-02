import { useState } from "react";
import { Link } from "react-router-dom";
import { useModuleT } from "../i18n";
import { WELCOME_KEY, type Welcome, joinEnv } from "./api";
import { dict } from "./dict";

function readWelcome(): Welcome | null {
  try {
    const raw = joinEnv.storage()?.getItem(WELCOME_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Partial<Welcome>;
    if (typeof w.name === "string" && typeof w.brand === "string" && typeof w.location === "string")
      return { name: w.name, brand: w.brand, location: w.location };
  } catch {
    // Missing or corrupt: no note.
  }
  return null;
}

/** One-time welcome note with the three next steps, shown on /me/account right after an online sign-up. */
export function JoinWelcome() {
  const { t } = useModuleT(dict);
  const [w, setW] = useState<Welcome | null>(readWelcome);
  if (!w) return null;
  const dismiss = () => {
    try {
      joinEnv.storage()?.removeItem(WELCOME_KEY);
    } catch {
      // ignore
    }
    setW(null);
  };
  return (
    <section className="join-welcome" aria-labelledby="join-welcome-title">
      <div className="join-welcome__head">
        <h2 id="join-welcome-title" className="join-welcome__title">
          {t("welcome.title", { brand: w.brand, name: w.name })}
        </h2>
        <button
          type="button"
          className="btn btn--ghost"
          aria-label={t("welcome.dismiss")}
          onClick={dismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p>{t("welcome.lede", { location: w.location })}</p>
      <ol className="join-welcome__steps">
        <li>
          <Link className="btn btn--primary" to="/me/membership" data-tour-id="welcome-buy">
            {t("welcome.step1")}
          </Link>
        </li>
        <li>
          <Link className="btn" to="/me/classes" data-tour-id="welcome-book">
            {t("welcome.step2")}
          </Link>
        </li>
        <li>
          <Link className="btn" to="/me/credential" data-tour-id="welcome-credential">
            {t("welcome.step3")}
          </Link>
        </li>
      </ol>
    </section>
  );
}
