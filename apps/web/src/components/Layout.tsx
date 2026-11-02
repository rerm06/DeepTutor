import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import type { Lang } from "../i18n/dict";
import { useBrandTheme } from "../lib/brandTheme";
import { navFor } from "../lib/roles";
import { MODULES } from "../modules/registry";
import { allows } from "../modules/types";
import { useSession } from "../session/SessionContext";

export function DemoBanner() {
  const { t } = useI18n();
  return (
    <div className="demo-banner" role="note">
      <span className="demo-banner__tag">DEMO</span>
      <span>{t("demo.banner")}</span>
    </div>
  );
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const langs: Lang[] = ["es", "en"];
  return (
    <fieldset className="lang-toggle" data-tour-id="lang-toggle">
      <legend className="sr-only">{t("lang.label")}</legend>
      {langs.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          className="lang-toggle__btn"
          aria-pressed={lang === l}
          aria-label={t(`lang.${l}`)}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, tv, lang } = useI18n();
  const { persona, role, logout } = useSession();
  const items = navFor(role);
  const moduleItems = MODULES.flatMap((m) => m.nav.filter((n) => allows(n.audience, role)));
  const brand = useBrandTheme();
  const tagline = brand
    ? lang === "en"
      ? brand.theme.tagline_en
      : brand.theme.tagline_es
    : undefined;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <DemoBanner />
      <header className="topbar">
        <div className="topbar__brand">
          {brand?.theme.logo_url ? (
            <span className="brandmark">
              <img
                className="brandmark__logo"
                src={brand.theme.logo_url}
                alt={brand.theme.logo_alt ?? brand.name}
                height={36}
              />
              {tagline ? <span className="brandmark__tagline">{tagline}</span> : null}
            </span>
          ) : (
            <span className="wordmark">{brand?.name ?? t("app.name")}</span>
          )}
          {persona ? (
            <span className="topbar__who">
              <span className="sr-only">{t("session.as")} </span>
              <span className="topbar__name">{persona.display_name}</span>
              <span className="topbar__role">
                {tv(
                  "role",
                  String(role ?? persona.role),
                  t("role.unknown", { role: String(role) }),
                )}
              </span>
            </span>
          ) : null}
        </div>
        <div className="topbar__tools">
          <LangToggle />
          {persona ? (
            <button
              type="button"
              className="btn btn--ghost"
              data-tour-id="persona-switch"
              onClick={logout}
            >
              {t("session.switch")}
            </button>
          ) : null}
        </div>
      </header>
      {items.length + moduleItems.length > 0 ? (
        <nav className="nav" aria-label={t("nav.label")}>
          <ul className="nav__list">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink className="nav__link" to={item.to}>
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
            {moduleItems.map((item) => (
              <li key={item.to}>
                <NavLink className="nav__link" to={item.to}>
                  {item.label[lang]}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
