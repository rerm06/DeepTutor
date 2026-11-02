import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import type { Lang, MessageKey } from "../i18n/dict";
import { useBrandTheme } from "../lib/brandTheme";
import { isMemberRole, navFor } from "../lib/roles";
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

/* ── Navigation model ─────────────────────────────────────────────────────────────────────────────────────────
   Thirty-odd destinations are grouped by the job a person is doing, not by the module that implements them.
   Grouping is derived from the route path so new module routes land in a sensible group without edits here. */

type GroupId =
  | "today"
  | "people"
  | "sales"
  | "training"
  | "loyalty"
  | "admin"
  | "me"
  | "train"
  | "community"
  | "shop"
  | "more";

const STAFF_ORDER: GroupId[] = ["today", "people", "sales", "training", "loyalty", "admin", "more"];
const MEMBER_ORDER: GroupId[] = ["me", "train", "community", "shop", "more"];

const RULES: ReadonlyArray<readonly [RegExp, GroupId]> = [
  [/^\/staff\/(panel|check-in|schedule|appointments|inbox)(\/|$)/, "today"],
  [/^\/staff\/(members|crm)(\/|$)/, "people"],
  [/^\/staff\/(billing|store)(\/|$)/, "sales"],
  [/^\/staff\/(health|floor|coach)(\/|$)/, "training"],
  [/^\/staff\/engagement(\/|$)/, "loyalty"],
  [/^\/staff\/(finance|reports|org|audit)(\/|$)/, "admin"],
  [/^\/me\/(account|membership|credential|consents)(\/|$)/, "me"],
  [/^\/me\/(classes|health|circuits|station|coach)(\/|$)/, "train"],
  [/^\/me\/(points|challenges|wall|refer|redeem)(\/|$)/, "community"],
  [/^\/me\/store(\/|$)/, "shop"],
];

export function groupOf(path: string): GroupId {
  for (const [re, g] of RULES) if (re.test(path)) return g;
  return "more";
}

interface Item {
  to: string;
  label: string;
  group: GroupId;
}

function useNavItems(): Item[] {
  const { t, lang } = useI18n();
  const { role } = useSession();
  return useMemo(() => {
    const core = navFor(role).map((n) => ({ to: n.to, label: t(n.label) }));
    const mods = MODULES.flatMap((m) =>
      m.nav
        .filter((n) => allows(n.audience, role))
        .map((n) => ({ to: n.to, label: n.label[lang] })),
    );
    // Within a group the overview comes first, then registry order.
    const first = ["/staff/panel", "/staff/check-in", "/me/account"];
    const rank = (to: string) => (first.includes(to) ? first.indexOf(to) : first.length);
    return [...core, ...mods]
      .map((i, n) => ({ ...i, group: groupOf(i.to), n }))
      .sort((a, b) => rank(a.to) - rank(b.to) || a.n - b.n)
      .map(({ n: _n, ...i }) => i);
  }, [role, t, lang]);
}

/* Small stroke icons (24-unit grid, 1.75 stroke) drawn for this console; one per group. */
const ICONS: Record<GroupId, string> = {
  today: "M4 13h4l2-6 4 12 2-6h4",
  people:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M21 21v-1a6 6 0 0 0-3.5-5.4",
  sales: "M3 7h18v12H3zM3 11h18M7 15h4",
  training: "M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11",
  loyalty: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z",
  admin: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9v-1a8 8 0 0 1 16 0v1",
  train: "M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11",
  community: "M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12Z",
  shop: "M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/** Member quick bar (phones): the four places a member goes most, plus the full menu. */
const MEMBER_TABS: ReadonlyArray<readonly [string, string]> = [
  ["/me/account", ICONS.me],
  ["/me/classes", "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"],
  [
    "/me/credential",
    "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2",
  ],
  ["/me/circuits", ICONS.train],
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, tv, lang } = useI18n();
  const { persona, role, logout } = useSession();
  const items = useNavItems();
  const brand = useBrandTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const member = isMemberRole(role);
  const tagline = brand
    ? lang === "en"
      ? brand.theme.tagline_en
      : brand.theme.tagline_es
    : undefined;

  const groups = useMemo(() => {
    const order = member ? MEMBER_ORDER : STAFF_ORDER;
    return order
      .map((g) => ({ id: g, items: items.filter((i) => i.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [items, member]);
  const tabs = member
    ? MEMBER_TABS.map(([to, d]) => ({ d, item: items.find((i) => i.to === to) })).filter(
        (x): x is { d: string; item: Item } => Boolean(x.item),
      )
    : [];

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Close the drawer whenever the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route change is the trigger
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // While the drawer is open: Escape closes it, focus moves into it, the page behind is inert.
  useEffect(() => {
    if (!open) return;
    const behind = document.querySelectorAll<HTMLElement>("[data-inert-when-nav]");
    for (const el of behind) el.setAttribute("inert", "");
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of behind) el.removeAttribute("inert");
    };
  }, [open, close]);

  const brandBlock = brand?.theme.logo_url ? (
    <span className="brandmark">
      <img
        className="brandmark__logo"
        src={brand.theme.logo_url}
        alt={brand.theme.logo_alt ?? brand.name}
        height={32}
      />
      {tagline ? <span className="brandmark__tagline">{tagline}</span> : null}
    </span>
  ) : (
    <span className="wordmark">{brand?.name ?? t("app.name")}</span>
  );

  const roleLabel = persona
    ? tv("role", String(role ?? persona.role), t("role.unknown", { role: String(role) }))
    : "";
  const initials = persona
    ? persona.display_name
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
    : "";
  const hasNav = groups.length > 0;

  return (
    <div className={`shell${hasNav ? " shell--nav" : ""}${member ? " shell--member" : ""}`}>
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <DemoBanner />
      <div className="frame">
        {hasNav ? (
          <nav className="appnav" aria-label={t("nav.label")} data-open={open ? "true" : "false"}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only scrim; keyboard users close with Escape or the close button */}
            <div className="appnav__backdrop" aria-hidden="true" onClick={() => close(false)} />
            <div className="appnav__panel" id="appnav-panel" ref={panelRef}>
              <div className="appnav__brand">
                {brandBlock}
                <button
                  type="button"
                  className="appnav__close"
                  aria-label={t("nav.close")}
                  onClick={() => close(true)}
                >
                  <Icon d="M6 6l12 12M18 6 6 18" />
                </button>
              </div>
              <div className="appnav__groups">
                {groups.map((g) => (
                  <div key={g.id} className="navgroup">
                    <span className="navgroup__title" id={`navgroup-${g.id}`}>
                      <Icon d={ICONS[g.id]} size={16} />
                      {t(`nav.group.${g.id}` as MessageKey)}
                    </span>
                    <ul className="navgroup__list" aria-labelledby={`navgroup-${g.id}`}>
                      {g.items.map((item) => (
                        <li key={item.to}>
                          <NavLink className="nav__link" to={item.to}>
                            {item.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {persona ? (
                <div className="appnav__who">
                  <span className="avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="appnav__who-text">
                    <span className="sr-only">{t("session.as")} </span>
                    <span className="appnav__name">{persona.display_name}</span>
                    <span className="appnav__role">{roleLabel}</span>
                  </span>
                </div>
              ) : null}
            </div>
            {tabs.length ? (
              <ul className="tabbar" data-inert-when-nav="">
                {tabs.map(({ d, item }) => (
                  <li key={item.to}>
                    <NavLink className="tabbar__link" to={item.to}>
                      <Icon d={d} size={22} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
                <li>
                  <button
                    ref={member ? toggleRef : undefined}
                    type="button"
                    className="tabbar__link"
                    aria-expanded={open}
                    aria-controls="appnav-panel"
                    onClick={() => setOpen(true)}
                  >
                    <Icon d="M4 7h16M4 12h16M4 17h16" size={22} />
                    <span>{t("nav.menu")}</span>
                  </button>
                </li>
              </ul>
            ) : null}
          </nav>
        ) : null}
        <div className="workspace" data-inert-when-nav="">
          <header className="topbar">
            <div className="topbar__brand">
              {hasNav && !member ? (
                <button
                  ref={member ? undefined : toggleRef}
                  type="button"
                  className="topbar__menu"
                  aria-expanded={open}
                  aria-controls="appnav-panel"
                  onClick={() => setOpen(true)}
                >
                  <Icon d="M4 7h16M4 12h16M4 17h16" size={22} />
                  <span className="sr-only">{t("nav.menu")}</span>
                </button>
              ) : null}
              <span className={hasNav ? "topbar__logo" : undefined}>{brandBlock}</span>
              {persona ? (
                <span className="topbar__who">
                  <span className="sr-only">{t("session.as")} </span>
                  <span className="topbar__name">{persona.display_name}</span>
                  <span className="topbar__role">{roleLabel}</span>
                </span>
              ) : null}
            </div>
            <div className="topbar__tools">
              <LangToggle />
              {persona ? (
                <button
                  type="button"
                  className="btn btn--ghost topbar__switch"
                  data-tour-id="persona-switch"
                  onClick={logout}
                >
                  {t("session.switch")}
                </button>
              ) : null}
            </div>
          </header>
          <main id="main" className="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
