import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
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
    <section className="section join-welcome" aria-labelledby="join-welcome-title">
      <div className="join-welcome__head">
        <h2 id="join-welcome-title" className="section__title">
          <Icon name="sparkle" size={26} />
          {t("welcome.title", { brand: w.brand, name: w.name })}
        </h2>
        <button
          type="button"
          className="btn btn--ghost join-welcome__close"
          aria-label={t("welcome.dismiss")}
          onClick={dismiss}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <p>{t("welcome.lede", { location: w.location })}</p>
      <ol className="ds-tiles join-welcome__steps">
        <li>
          <Link
            className="ds-tile join-welcome__step join-welcome__step--primary"
            to="/me/membership"
            data-tour-id="welcome-buy"
          >
            <Icon name="card" size={32} />
            <span>{t("welcome.step1")}</span>
          </Link>
        </li>
        <li>
          <Link className="ds-tile join-welcome__step" to="/me/classes" data-tour-id="welcome-book">
            <Icon name="calendarPlus" size={32} />
            <span>{t("welcome.step2")}</span>
          </Link>
        </li>
        <li>
          <Link
            className="ds-tile join-welcome__step"
            to="/me/credential"
            data-tour-id="welcome-credential"
          >
            <Icon name="qr" size={32} />
            <span>{t("welcome.step3")}</span>
          </Link>
        </li>
      </ol>
    </section>
  );
}
