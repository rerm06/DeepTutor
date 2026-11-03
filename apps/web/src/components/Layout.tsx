import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import type { Lang, MessageKey } from "../i18n/dict";
import { useBrandTheme } from "../lib/brandTheme";
import { setLocation, setLocationScope, useLocationId } from "../lib/location";
import { NavTargets } from "../lib/navTargets";
import { promptInstall, useInstallState } from "../lib/pwa";
import { isMemberRole, navFor } from "../lib/roles";
import { setPref, useMode } from "../lib/themeMode";
import { useAsync } from "../lib/useAsync";
import { MODULES } from "../modules/registry";
import { allows } from "../modules/types";
import { useApi, useSession } from "../session/SessionContext";
import { Icon, type IconName } from "./icons";

export { Icon } from "./icons";

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

/** Dark on/off. The choice is stored on this device and wins over the brand's default. */
export function ThemeToggle({ asMenuItem = false }: { asMenuItem?: boolean }) {
  const { t } = useI18n();
  const dark = useMode() === "dark";
  return (
    <button
      type="button"
      className={asMenuItem ? "menu__item" : "icon-btn"}
      aria-pressed={dark}
      data-tour-id="theme-toggle"
      onClick={() => setPref(dark ? "light" : "dark")}
    >
      <Icon name={dark ? "moon" : "sun"} />
      {asMenuItem ? (
        <span>{t("theme.dark")}</span>
      ) : (
        <span className="sr-only">{t("theme.dark")}</span>
      )}
      {asMenuItem ? (
        <span className="menu__state" aria-hidden="true">
          {dark ? "ON" : "OFF"}
        </span>
      ) : null}
    </button>
  );
}

/* ── Navigation model ─────────────────────────────────────────────────────────────────────────────────────────
   The sidebar shows the console's top-level sections, as the client's design shows them. Every module page
   still has a place: it is listed under the section its route belongs to, so nothing is hidden or lost. */

type SectionId =
  | "home"
  | "members"
  | "subs"
  | "agenda"
  | "pos"
  | "store"
  | "crm"
  | "ai"
  | "reports"
  | "config"
  | "help"
  | "account"
  | "panel"
  | "magenda"
  | "plan"
  | "pay"
  | "programs"
  | "progress"
  | "nutrition"
  | "shop"
  | "achievements"
  | "docs"
  | "more";

interface SectionDef {
  id: SectionId;
  icon: IconName;
  match: RegExp;
  badge?: boolean;
}

const STAFF_SECTIONS: SectionDef[] = [
  { id: "home", icon: "home", match: /^\/staff\/(panel|today)(\/|$)/ },
  { id: "members", icon: "users", match: /^\/staff\/(members|health)(\/|$)/ },
  { id: "subs", icon: "doc", match: /^\/staff\/billing(\/|$)/ },
  {
    id: "agenda",
    icon: "calendar",
    match: /^\/staff\/(schedule|check-in|appointments|floor|door)(\/|$)/,
  },
  { id: "pos", icon: "card", match: /^\/staff\/store\/(pos|sales)(\/|$)/ },
  { id: "store", icon: "bag", match: /^\/staff\/store(\/|$)/ },
  { id: "crm", icon: "crm", match: /^\/staff\/(crm|inbox|engagement)(\/|$)/ },
  { id: "ai", icon: "sparkle", match: /^\/staff\/ai(\/|$)/, badge: true },
  { id: "reports", icon: "chart", match: /^\/staff\/(reports|finance|audit)(\/|$)/ },
  { id: "config", icon: "gear", match: /^\/staff\/(org|online-join)(\/|$)/ },
  { id: "more", icon: "star", match: /^\/staff\// },
];
/* Member portal sections, as the client's member design lists them. */
const MEMBER_SECTIONS: SectionDef[] = [
  { id: "account", icon: "home", match: /^\/me\/account(\/|$)/ },
  { id: "panel", icon: "grid", match: /^\/me\/(home|coach)(\/|$)/ },
  { id: "magenda", icon: "calendar", match: /^\/me\/(classes|credential|access)(\/|$)/ },
  { id: "plan", icon: "card", match: /^\/me\/health(\/|$)/ },
  { id: "pay", icon: "receipt", match: /^\/me\/membership(\/|$)/ },
  { id: "programs", icon: "dumbbell", match: /^\/me\/(programs|circuits|station)(\/|$)/ },
  { id: "progress", icon: "chart", match: /^\/me\/progress(\/|$)/ },
  { id: "nutrition", icon: "apple", match: /^\/me\/nutrition(\/|$)/ },
  { id: "shop", icon: "bag", match: /^\/me\/store(\/|$)/ },
  {
    id: "achievements",
    icon: "trophy",
    match: /^\/me\/(points|challenges|wall|refer|redeem)(\/|$)/,
  },
  { id: "docs", icon: "doc", match: /^\/me\/(documents|consents)(\/|$)/ },
  { id: "more", icon: "star", match: /^\/me\// },
];
const HELP: SectionDef = { id: "help", icon: "academy", match: /^\/help(\/|$)/ };
const HELP_MEMBER: SectionDef = { id: "help", icon: "headset", match: /^\/help(\/|$)/ };

export function sectionOf(path: string, member: boolean): SectionId {
  if (HELP.match.test(path)) return "help";
  const list = member ? MEMBER_SECTIONS : STAFF_SECTIONS;
  return list.find((s) => s.match.test(path))?.id ?? "more";
}

interface Item {
  to: string;
  label: string;
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
    // Each section opens on its overview page first, then registry order.
    const first = [
      "/staff/panel",
      "/staff/today",
      "/staff/members",
      "/staff/schedule",
      "/me/account",
      "/me/home",
      "/me/classes",
      "/me/health/plan",
      "/me/programs",
      "/me/challenges",
      "/me/documents",
    ];
    const rank = (to: string) => (first.includes(to) ? first.indexOf(to) : first.length);
    return [...core, ...mods]
      .map((i, n) => ({ ...i, n }))
      .sort((a, b) => rank(a.to) - rank(b.to) || a.n - b.n)
      .map(({ n: _n, ...i }) => i);
  }, [role, t, lang]);
}

/** Member bottom bar (client design): six destinations plus help; phones keep the first three and the menu. */
const MEMBER_TABS: ReadonlyArray<readonly [string, IconName, MessageKey, boolean]> = [
  ["/me/home", "home", "tab.home", true],
  ["/me/classes", "calendar", "tab.agenda", true],
  ["/me/health/plan", "dumbbell", "tab.plan", false],
  ["/me/progress", "chart", "tab.progress", false],
  ["/me/store", "bag", "tab.store", false],
  ["/me/coach/chat", "sparkle", "tab.chat", true],
];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("");
}

/* ── Header pieces ── */

function LocationPicker({ id }: { id: string }) {
  const { t } = useI18n();
  const api = useApi();
  const value = useLocationId();
  const locs = useAsync(() => api.locations(), [api]);
  const list = locs.data?.data ?? [];
  // A remembered location the caller can no longer see falls back to "all".
  useEffect(() => {
    if (value && locs.data && !locs.data.data.some((l) => l.id === value)) setLocation("");
  }, [value, locs.data]);
  if (list.length === 0) return null;
  return (
    <label className="loc-pill" htmlFor={id}>
      <Icon name="dumbbell" className="loc-pill__icon" />
      <span className="sr-only">{t("header.location")}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => setLocation(e.target.value)}
        data-tour-id="header-location"
      >
        {list.length > 1 ? <option value="">{t("header.allLocations")}</option> : null}
        {list.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="loc-pill__chev" size={18} />
    </label>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

interface DashLite {
  overdue_members?: number;
  expiring_credits_7d?: number;
  expiring_passes_7d?: number;
  expiring_memberships_7d?: number;
  low_stock_products?: number;
}

/** Alerts derived from the owner/manager dashboard read model; other roles get no bell. */
function AlertsBell() {
  const { t } = useI18n();
  const api = useApi();
  const loc = useLocationId();
  const pop = usePopover();
  const dash = useAsync(
    () =>
      api.request<DashLite>(
        "GET",
        `/reports/dashboard${loc ? `?location_id=${encodeURIComponent(loc)}` : ""}`,
      ),
    [api, loc],
  );
  const d = dash.data;
  const expiring =
    (d?.expiring_credits_7d ?? 0) +
    (d?.expiring_passes_7d ?? 0) +
    (d?.expiring_memberships_7d ?? 0);
  const alerts: Array<{ key: string; text: string; to: string }> = [];
  if (d?.overdue_members)
    alerts.push({
      key: "overdue",
      text: t("alerts.overdue", { n: String(d.overdue_members) }),
      to: "/staff/panel#rpt-overdue",
    });
  if (expiring)
    alerts.push({
      key: "expiring",
      text: t("alerts.expiring", { n: String(expiring) }),
      to: "/staff/panel#rpt-expiring",
    });
  if (d?.low_stock_products)
    alerts.push({
      key: "stock",
      text: t("alerts.lowStock", { n: String(d.low_stock_products) }),
      to: "/staff/store/inventory",
    });
  return (
    <div className="pop" ref={pop.ref}>
      <button
        type="button"
        className="hdr-icon"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen(!pop.open)}
        data-tour-id="alerts-bell"
      >
        <Icon name="bell" size={24} />
        {alerts.length ? <span className="hdr-icon__dot" aria-hidden="true" /> : null}
        <span className="sr-only">
          {t("alerts.title")}
          {alerts.length ? ` (${alerts.length})` : ""}
        </span>
      </button>
      {pop.open ? (
        <dialog open className="pop__panel" aria-label={t("alerts.title")}>
          <p className="pop__title">{t("alerts.title")}</p>
          {alerts.length === 0 ? (
            <p className="pop__empty">{t("alerts.none")}</p>
          ) : (
            <ul className="pop__list">
              {alerts.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} onClick={() => pop.setOpen(false)}>
                    {a.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </dialog>
      ) : null}
    </div>
  );
}

function AccountMenu({
  name,
  role,
  showName = false,
}: { name: string; role: string; showName?: boolean }) {
  const { t } = useI18n();
  const { logout } = useSession();
  const pop = usePopover();
  return (
    <div className="pop" ref={pop.ref}>
      <button
        type="button"
        className="avatar-btn"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen(!pop.open)}
        data-tour-id="account-menu"
      >
        <span className="avatar avatar--lg" aria-hidden="true">
          {initialsOf(name)}
        </span>
        {showName ? (
          <span className="avatar-btn__name" aria-hidden="true">
            {name}
          </span>
        ) : null}
        <span className="sr-only">
          {t("header.account")}: {name}, {role}
        </span>
        <Icon name="chevronDown" size={18} />
      </button>
      {pop.open ? (
        <dialog open className="pop__panel pop__panel--menu" aria-label={t("header.account")}>
          <p className="pop__who">
            <strong>{name}</strong>
            <span>{role}</span>
          </p>
          <ThemeToggle asMenuItem />
          <button
            type="button"
            className="menu__item"
            data-tour-id="persona-switch"
            onClick={logout}
          >
            <Icon name="logout" />
            <span>{t("session.switch")}</span>
          </button>
        </dialog>
      ) : null}
    </div>
  );
}

interface MemberHomeLite {
  membership?: { kind: string; credits_left: number | null };
  next_class?: { class_name: string; starts_at: string } | null;
  challenge?: { name: string; joined: boolean } | null;
}

/** Member alerts from the member's own dashboard data: low sessions, a class today, a new challenge. */
function MemberBell() {
  const { t } = useI18n();
  const api = useApi();
  const pop = usePopover();
  const home = useAsync(() => api.request<MemberHomeLite>("GET", "/me/home"), [api]);
  const d = home.data;
  const alerts: Array<{ key: string; text: string; to: string }> = [];
  const left = d?.membership?.kind === "credits" ? d.membership.credits_left : null;
  if (left !== null && left !== undefined && left <= 2)
    alerts.push({
      key: "credits",
      text: t("alerts.credits", { n: String(left) }),
      to: "/me/membership",
    });
  if (d?.next_class) {
    const day = (x: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(x);
    if (day(new Date(d.next_class.starts_at)) === day(new Date()))
      alerts.push({
        key: "class",
        text: t("alerts.classToday", { name: d.next_class.class_name }),
        to: "/me/classes",
      });
  }
  if (d?.challenge && !d.challenge.joined)
    alerts.push({
      key: "challenge",
      text: t("alerts.challenge", { name: d.challenge.name }),
      to: "/me/challenges",
    });
  return (
    <div className="pop" ref={pop.ref}>
      <button
        type="button"
        className="hdr-icon"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen(!pop.open)}
        data-tour-id="member-alerts"
      >
        <Icon name="bell" size={26} />
        {alerts.length ? <span className="hdr-icon__dot" aria-hidden="true" /> : null}
        <span className="sr-only">
          {t("alerts.title")}
          {alerts.length ? ` (${alerts.length})` : ""}
        </span>
      </button>
      {pop.open ? (
        <dialog open className="pop__panel" aria-label={t("alerts.title")}>
          <p className="pop__title">{t("alerts.title")}</p>
          {alerts.length === 0 ? (
            <p className="pop__empty">{t("alerts.none")}</p>
          ) : (
            <ul className="pop__list">
              {alerts.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} onClick={() => pop.setOpen(false)}>
                    {a.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </dialog>
      ) : null}
    </div>
  );
}

/** "App {brand} · Descarga la PWA": native install where the browser offers it, manual steps otherwise. */
function PwaCard() {
  const { t } = useI18n();
  const state = useInstallState();
  const [help, setHelp] = useState(false);
  if (state === "installed") return null;
  return (
    <div className="tenant-card-wrap">
      <button
        type="button"
        className="tenant-card"
        onClick={() => (state === "prompt" ? void promptInstall() : setHelp(!help))}
        aria-expanded={state === "prompt" ? undefined : help}
        data-tour-id="pwa-install"
      >
        <Icon name="home" size={34} />
        <span className="tenant-card__text">
          <strong>{t("pwa.title")}</strong>
          <span>{t("pwa.sub")}</span>
        </span>
        <Icon name="download" size={22} />
      </button>
      {help ? <p className="tenant-card__help">{t("pwa.manual")}</p> : null}
    </div>
  );
}

/* ── Shell ── */

export function Layout({ children }: { children: ReactNode }) {
  const { t, tv, lang } = useI18n();
  const { persona, role } = useSession();
  const items = useNavItems();
  const brand = useBrandTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<SectionId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const member = isMemberRole(role);
  const staff = Boolean(role) && !member;
  const tagline = brand
    ? lang === "en"
      ? brand.theme.tagline_en
      : brand.theme.tagline_es
    : undefined;

  useEffect(() => {
    setLocationScope(persona?.org);
  }, [persona?.org]);

  const current = sectionOf(location.pathname, member);
  const sections = useMemo(() => {
    const defs = [...(member ? MEMBER_SECTIONS : STAFF_SECTIONS), member ? HELP_MEMBER : HELP];
    return defs
      .map((s) => ({ ...s, items: items.filter((i) => sectionOf(i.to, member) === s.id) }))
      .filter((s) => s.items.length > 0);
  }, [items, member]);
  const mainSections = sections.filter((s) => s.id !== "help");
  const helpSection = sections.find((s) => s.id === "help");
  const tabs = member
    ? MEMBER_TABS.map(([to, icon, label, phone]) => ({
        to,
        icon,
        label,
        phone,
        ok: items.some((i) => i.to === to),
      })).filter((x) => x.ok)
    : [];
  const hasHelp = items.some((i) => i.to === "/help");

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Route change: close the drawer and fold any section the person opened by hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route change is the trigger
  useEffect(() => {
    setOpen(false);
    setExpanded(null);
  }, [location.pathname]);

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

  const logo = brand?.theme.logo_url ? (
    <img
      className="brandmark__logo"
      src={brand.theme.logo_url}
      alt={brand.theme.logo_alt ?? brand.name}
      height={44}
    />
  ) : (
    <span className="wordmark">{brand?.name ?? t("app.name")}</span>
  );

  const roleLabel = persona
    ? tv("role", String(role ?? persona.role), t("role.unknown", { role: String(role) }))
    : "";
  const hasNav = sections.length > 0;
  const targets = useMemo(() => new Set(items.map((i) => i.to)), [items]);

  const renderSection = (s: (typeof sections)[number]) => {
    const active = s.id === current;
    const show = active || expanded === s.id;
    const subId = `nav-sub-${s.id}`;
    const first = s.items[0] as Item;
    const label = t(
      (s.id === "help" && member ? "nav.sec.helpMember" : `nav.sec.${s.id}`) as MessageKey,
    );
    return (
      <li key={s.id} className={`navsec${active ? " is-active" : ""}`}>
        <div className="navsec__row">
          <Link
            className="navsec__link"
            to={first.to}
            aria-current={active && first.to === location.pathname ? "page" : undefined}
          >
            <Icon name={s.icon} size={22} />
            <span className="navsec__label">{label}</span>
            {s.items.length === 1 && first.label !== label ? (
              <span className="sr-only">: {first.label}</span>
            ) : null}
            {s.badge ? <span className="navsec__badge">IA</span> : null}
          </Link>
          {s.items.length > 1 ? (
            <button
              type="button"
              className="navsec__toggle"
              aria-expanded={show}
              aria-controls={subId}
              onClick={() => setExpanded(show && !active ? null : s.id)}
            >
              <Icon name="chevronDown" size={16} />
              <span className="sr-only">{t("nav.expand", { section: label })}</span>
            </button>
          ) : null}
        </div>
        {s.items.length > 1 ? (
          <ul className="navsec__sub" id={subId} hidden={!show}>
            {s.items.map((item) => (
              <li key={item.to}>
                <NavLink className="nav__link" to={item.to} end>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div
      className={`shell${hasNav ? " shell--nav" : ""}${member ? " shell--member" : ""}${staff ? " shell--staff" : ""}`}
    >
      <a className="skip-link" href="#main">
        {t("app.skip")}
      </a>
      <DemoBanner />
      <header className="topbar" data-inert-when-nav="">
        <div className="topbar__brand">
          {hasNav ? (
            <button
              ref={member ? undefined : toggleRef}
              type="button"
              className="topbar__menu"
              aria-expanded={open}
              aria-controls="appnav-panel"
              onClick={() => setOpen(true)}
            >
              <Icon name="menu" size={22} />
              <span className="sr-only">{t("nav.menu")}</span>
            </button>
          ) : null}
          <span className="brandmark">{logo}</span>
          {staff ? (
            <span className="topbar__product">
              {t("header.product")} <em>{t("header.productAccent")}</em>
            </span>
          ) : member ? (
            <span className="topbar__portal">
              <Icon name="pin" size={28} />
              <span>
                <strong>{t("header.portal")}</strong>
                {persona?.home ? <span>{persona.home}</span> : null}
              </span>
            </span>
          ) : tagline ? (
            <span className="brandmark__tagline">{tagline}</span>
          ) : null}
        </div>
        <div className="topbar__tools">
          {staff ? <LocationPicker id="hdr-location" /> : null}
          {member ? <MemberBell /> : null}
          <LangToggle />
          {role === "owner" || role === "location_manager" ? <AlertsBell /> : null}
          {persona ? (
            <AccountMenu name={persona.display_name} role={roleLabel} showName={member} />
          ) : (
            <ThemeToggle />
          )}
        </div>
      </header>
      <div className="frame">
        {hasNav ? (
          <nav className="appnav" aria-label={t("nav.label")} data-open={open ? "true" : "false"}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only scrim; keyboard users close with Escape or the close button */}
            <div className="appnav__backdrop" aria-hidden="true" onClick={() => close(false)} />
            <div className="appnav__panel" id="appnav-panel" ref={panelRef}>
              <div className="appnav__drawerhead">
                <span className="brandmark">{logo}</span>
                <button
                  type="button"
                  className="appnav__close"
                  aria-label={t("nav.close")}
                  onClick={() => close(true)}
                >
                  <Icon name="close" />
                </button>
              </div>
              {staff ? (
                <div className="appnav__loc">
                  <LocationPicker id="drawer-location" />
                </div>
              ) : null}
              <ul className="appnav__list">{mainSections.map(renderSection)}</ul>
              {helpSection ? (
                <ul className="appnav__list appnav__list--foot">{renderSection(helpSection)}</ul>
              ) : null}
              {staff ? (
                <Link className="tenant-card" to="/staff/org">
                  <Icon name="building" size={30} />
                  <span className="tenant-card__text">
                    <strong>{t("tenant.title")}</strong>
                    <span>{t("tenant.sub")}</span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              ) : member ? (
                <PwaCard />
              ) : null}
            </div>
            {tabs.length ? (
              <ul className="tabbar" data-inert-when-nav="">
                {tabs.map(({ to, icon, label, phone }) => (
                  <li key={to} className={phone ? undefined : "tabbar__wide"}>
                    <NavLink className="tabbar__link" to={to}>
                      <Icon name={icon} size={26} />
                      <span>{t(label)}</span>
                    </NavLink>
                  </li>
                ))}
                {hasHelp ? (
                  <li className="tabbar__wide tabbar__help">
                    <NavLink className="tabbar__helpbtn" to="/help">
                      <Icon name="help" size={30} />
                      <span className="sr-only">{t("nav.sec.helpMember")}</span>
                    </NavLink>
                  </li>
                ) : null}
                <li className="tabbar__menu">
                  <button
                    ref={member ? toggleRef : undefined}
                    type="button"
                    className="tabbar__link"
                    aria-expanded={open}
                    aria-controls="appnav-panel"
                    onClick={() => setOpen(true)}
                  >
                    <Icon name="menu" size={22} />
                    <span>{t("nav.menu")}</span>
                  </button>
                </li>
              </ul>
            ) : null}
          </nav>
        ) : null}
        <div className="workspace" data-inert-when-nav="">
          <main id="main" className="main" tabIndex={-1}>
            <NavTargets.Provider value={targets}>{children}</NavTargets.Provider>
          </main>
        </div>
      </div>
    </div>
  );
}
