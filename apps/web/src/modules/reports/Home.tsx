import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../components/icons";
import { ErrorNote } from "../../components/ui";
import { useCurrentBrand } from "../../lib/brandTheme";
import { useNavTargets } from "../../lib/navTargets";
import type { useAsync } from "../../lib/useAsync";
import type { Executive, Today, TodayClass } from "./api";
import { useReportsT } from "./dict";

type Lang = "es" | "en";
type Async<T> = ReturnType<typeof useAsync<T>>;
const locale = (lang: Lang) => (lang === "es" ? "es-PR" : "en-US");

/* ── Hero: greeting + brand line over the brand's photo ── */
export function HomeHero({ name }: { name: string }) {
  const { t } = useReportsT();
  const brand = useCurrentBrand();
  const hero = brand?.theme.hero_url;
  return (
    <section
      className={`home-hero${hero ? " home-hero--photo" : ""}`}
      style={hero ? { ["--hero-img" as string]: `url("${hero}")` } : undefined}
      aria-labelledby="home-hello"
    >
      <h1 id="home-hello" className="home-hero__hello">
        {t("home.hello", { name })} <span aria-hidden="true">👋</span>
      </h1>
      <p className="home-hero__sub">{t("home.sub")}</p>
      <span className="home-hero__rule" aria-hidden="true" />
      <p className="home-hero__motto">
        <span>{t("home.motto1")}</span>
        <span className="home-hero__dot" aria-hidden="true">
          ·
        </span>
        <span className="home-hero__gold">{t("home.motto2")}</span>
        <span className="home-hero__dot" aria-hidden="true">
          ·
        </span>
        <span>{t("home.motto3")}</span>
      </p>
      <p className="home-hero__tag">{t("home.tagline")}</p>
    </section>
  );
}

/* ── KPI cards (icon · label · value · delta) ── */
interface KpiLike {
  value: number | null;
  prev: number | null;
}
function deltaText(
  k: KpiLike | undefined,
  kind: "pct" | "abs" | "pp",
  lang: Lang,
): { text: string; dir: "up" | "down" | "flat" } | null {
  if (!k || k.prev === null || k.value === null) return null;
  const value = k.value;
  const prev = k.prev;
  const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(lang), o);
  if (kind === "pct") {
    if (!prev) return null;
    const d = (value - prev) / Math.abs(prev);
    return {
      text: nf({ style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(d),
      dir: d > 0.0005 ? "up" : d < -0.0005 ? "down" : "flat",
    };
  }
  const d = value - prev;
  const n = nf({ maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(d);
  return { text: kind === "pp" ? `${n} pp` : n, dir: d > 0 ? "up" : d < 0 ? "down" : "flat" };
}

function KpiCard({
  icon,
  label,
  value,
  delta,
  tourId,
}: {
  icon: IconName;
  label: string;
  value: string;
  delta: ReturnType<typeof deltaText>;
  tourId: string;
}) {
  const { t } = useReportsT();
  return (
    <div className="home-kpi" data-tour-id={tourId}>
      <span className="home-kpi__icon">
        <Icon name={icon} size={34} />
      </span>
      <dl className="home-kpi__text">
        <dt className="home-kpi__label">{label}</dt>
        <dd className="home-kpi__line">
          <span className="home-kpi__value">{value}</span>
          {delta ? (
            <span className={`home-kpi__delta home-kpi__delta--${delta.dir}`}>
              <span aria-hidden="true">
                {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "■"}
              </span>
              <span className="sr-only">{t(`exec.${delta.dir}`)} </span>
              {delta.text}
            </span>
          ) : null}
        </dd>
      </dl>
    </div>
  );
}

export function HomeKpis({ exec, today }: { exec: Async<Executive>; today: Async<Today> }) {
  const { t, lang } = useReportsT();
  const k = exec.data?.kpis;
  const n = (v: number) => new Intl.NumberFormat(locale(lang)).format(v);
  const money = (c: number) =>
    new Intl.NumberFormat(locale(lang), {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Math.round(c / 100));
  const classes = k?.classes_today?.value ?? today.data?.classes_today.length;
  const renewal = k?.renewal_rate_pct?.value;
  const dash = "—";
  return (
    <div className="home-kpis">
      {exec.error ? <ErrorNote code={exec.error} onRetry={exec.reload} /> : null}
      <KpiCard
        icon="users"
        label={t("home.kpi.active")}
        value={k ? n(k.active_members.value) : dash}
        delta={deltaText(k?.active_members, "pct", lang)}
        tourId="home-kpi-active"
      />
      <KpiCard
        icon="calendar"
        label={t("home.kpi.classes")}
        value={classes === undefined ? dash : n(classes)}
        delta={deltaText(k?.classes_today, "abs", lang)}
        tourId="home-kpi-classes"
      />
      <KpiCard
        icon="coin"
        label={t("home.kpi.revenue")}
        value={k ? money(k.revenue_month_cents.value) : dash}
        delta={deltaText(k?.revenue_month_cents, "pct", lang)}
        tourId="home-kpi-revenue"
      />
      <KpiCard
        icon="refresh"
        label={t("home.kpi.renewals")}
        value={
          renewal === undefined || renewal === null
            ? dash
            : `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(renewal)}%`
        }
        delta={deltaText(k?.renewal_rate_pct, "pp", lang)}
        tourId="home-kpi-renewals"
      />
    </div>
  );
}

/* ── Today's schedule ── */
const THUMBS: ReadonlyArray<readonly [RegExp, string]> = [
  [/hiit|funcional|functional|cross|boot|circuit/i, "/brand/class-hiit.jpg"],
  [/spin|ciclo|cycl|bike/i, "/brand/class-spinning.jpg"],
  [/movil|mobil|yoga|stretch|estira|pilates|flex/i, "/brand/class-movilidad.jpg"],
];
export function classThumb(name: string): string | null {
  return THUMBS.find(([re]) => re.test(name))?.[1] ?? null;
}
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Puerto_Rico",
  })
    .format(new Date(iso))
    .toLowerCase();
}

function AgendaRow({ c }: { c: TodayClass }) {
  const { t } = useReportsT();
  const thumb = classThumb(c.class_name);
  const pct = c.capacity ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
  return (
    <li className="agenda-row">
      <time className="agenda-row__time" dateTime={c.starts_at}>
        {clock(c.starts_at)}
      </time>
      {thumb ? (
        <img className="agenda-row__thumb" src={thumb} alt="" width={76} height={50} />
      ) : (
        <span className="agenda-row__thumb agenda-row__thumb--icon" aria-hidden="true">
          <Icon name="dumbbell" size={26} />
        </span>
      )}
      <span className="agenda-row__name">
        <strong>{c.class_name}</strong>
        <span>{c.room ?? "—"}</span>
      </span>
      <span className="agenda-row__cap">
        <span className="agenda-row__count">
          <Icon name="users" size={16} />
          <span className="sr-only">{t("home.agenda.booked")} </span>
          {c.booked} / {c.capacity}
        </span>
        <span className="agenda-row__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    </li>
  );
}

export function TodayAgenda({ today }: { today: Async<Today> }) {
  const { t } = useReportsT();
  const rows = useMemo(
    () =>
      [...(today.data?.classes_today ?? [])]
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 3),
    [today.data],
  );
  return (
    <section className="home-card agenda" aria-labelledby="home-agenda">
      <header className="home-card__head">
        <h2 id="home-agenda" className="home-card__title">
          <Icon name="calendar" size={24} className="home-card__icon" />
          {t("home.agenda.title")}
        </h2>
        <Link className="home-card__more" to="/staff/schedule">
          {t("home.agenda.all")} <Icon name="arrowRight" size={18} />
        </Link>
      </header>
      {today.error ? <ErrorNote code={today.error} onRetry={today.reload} /> : null}
      {today.data && rows.length === 0 ? (
        <p className="muted agenda__empty">{t("home.agenda.empty")}</p>
      ) : null}
      {rows.length ? (
        <ul className="agenda__list">
          {rows.map((c) => (
            <AgendaRow key={c.session_id} c={c} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ── AI agent card ── */
export function AgentPromo() {
  const { t } = useReportsT();
  const brand = useCurrentBrand();
  const mark = brand?.theme.icon_url;
  const img = brand?.theme.promo_url;
  return (
    <section
      className={`home-agent${img ? " home-agent--photo" : ""}`}
      style={img ? { ["--promo-img" as string]: `url("${img}")` } : undefined}
      aria-labelledby="home-agent"
    >
      <div className="home-agent__head">
        {mark ? (
          <img className="home-agent__mark" src={mark} alt="" width={78} height={78} />
        ) : (
          <span className="home-agent__mark home-agent__mark--icon" aria-hidden="true">
            <Icon name="sparkle" size={40} />
          </span>
        )}
        <h2 id="home-agent" className="home-agent__title">
          <span>{t("home.agent.title")}</span>
          <span>{brand?.name ?? ""}</span>
        </h2>
      </div>
      <p className="home-agent__body">{t("home.agent.body")}</p>
      <Link className="home-agent__btn" to="/staff/ai" data-tour-id="home-agent-cta">
        {t("home.agent.cta")} <Icon name="arrowRight" size={20} />
      </Link>
    </section>
  );
}

/* ── Quick actions ── */
const ACTIONS: ReadonlyArray<readonly [string, IconName, string]> = [
  ["home.action.member", "userPlus", "/staff/members"],
  ["home.action.payment", "receipt", "/staff/store/pos"],
  ["home.action.class", "calendarPlus", "/staff/schedule"],
  ["home.action.store", "cart", "/staff/store/products"],
  ["home.action.reports", "chart", "/staff/reports/ivu"],
  ["home.action.academy", "academy", "/help"],
];

export function QuickActions() {
  const { t } = useReportsT();
  const allowed = useNavTargets();
  const actions = ACTIONS.filter(([, , to]) => allowed.has(to));
  return (
    <section className="home-actions" aria-label={t("home.actions")}>
      {actions.map(([key, icon, to]) => (
        <Link key={key} className="home-action" to={to}>
          <Icon name={icon} size={46} />
          <span>{t(key as Parameters<typeof t>[0])}</span>
        </Link>
      ))}
    </section>
  );
}
