import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toErrorCode } from "../../api/client";
import { Icon, type IconName } from "../../components/icons";
import { ErrorNote } from "../../components/ui";
import { useCurrentBrand } from "../../lib/brandTheme";
import { useNavTargets } from "../../lib/navTargets";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { engagementApi } from "../engagement/api";
import { type MemberHome, memberHomeApi } from "./api";
import { type MemberHomeKey, useMemberHomeT } from "./dict";
import "./memberhome.css";

type Lang = "es" | "en";
const loc = (lang: Lang) => (lang === "es" ? "es-PR" : "en-US");
const TZ = "America/Puerto_Rico";

export function dateLong(ymd: string, lang: Lang): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(loc(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)))
    .replace(".", "");
}

/** "Hoy, 7:00 pm" / "Mañana, 6:00 am" / "jue 5 nov, 6:00 am" in Puerto Rico time. */
export function whenLabel(iso: string, lang: Lang, now = new Date()): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  })
    .format(at)
    .toLowerCase();
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  const d = day(at);
  const words = { es: ["Hoy", "Mañana"], en: ["Today", "Tomorrow"] }[lang];
  if (d === today) return `${words[0]}, ${time}`;
  if (d === tomorrow) return `${words[1]}, ${time}`;
  const date = new Intl.DateTimeFormat(loc(lang), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  }).format(at);
  return `${date.replace(/\./g, "")}, ${time}`;
}

const ACTIONS: ReadonlyArray<readonly [MemberHomeKey, IconName, string]> = [
  ["action.book", "calendarPlus", "/me/classes"],
  ["action.plan", "dumbbell", "/me/health/plan"],
  ["action.pay", "card", "/me/membership"],
  ["action.store", "cart", "/me/store"],
];

export function MemberHomeScreen() {
  const { t, lang } = useMemberHomeT();
  const { api, persona } = useSession();
  const brand = useCurrentBrand();
  const targets = useNavTargets();
  const home = useAsync(() => memberHomeApi(api).home(), [api]);
  const first = home.data?.member.first_name ?? persona?.display_name.split(/\s+/)[0] ?? "";
  const hero = brand?.theme.hero_url ? "/brand/portal-hero.jpg" : undefined;
  const actions = ACTIONS.filter(([, , to]) => targets.size === 0 || targets.has(to));

  return (
    <div className="page mh">
      <div className="mh-grid">
        <div className="mh-main">
          <section
            className={`mh-hero${hero ? " mh-hero--photo" : ""}`}
            style={hero ? { ["--mh-hero" as string]: `url("${hero}")` } : undefined}
            aria-labelledby="mh-hello"
          >
            <h1 id="mh-hello" className="mh-hero__hello">
              {t("hello", { name: first })}
            </h1>
            <p className="mh-hero__sub">{t("sub")}</p>
            <span className="mh-hero__rule" aria-hidden="true" />
            <section className="mh-actions" aria-label={t("actions")}>
              {actions.map(([key, icon, to]) => (
                <Link key={key} className="mh-action" to={to}>
                  <Icon name={icon} size={38} />
                  <span>{t(key)}</span>
                </Link>
              ))}
            </section>
          </section>

          {home.error ? <ErrorNote code={home.error} onRetry={home.reload} /> : null}
          {home.data ? (
            <>
              <div className="mh-row">
                <ProgressCard d={home.data} />
                <ProgramsCard d={home.data} />
              </div>
              {home.data.challenge ? (
                <ChallengeBanner d={home.data} onJoined={home.reload} />
              ) : null}
            </>
          ) : home.loading ? (
            <div className="mh-row" aria-hidden="true">
              <div className="mh-card mh-skeleton" />
              <div className="mh-card mh-skeleton" />
            </div>
          ) : null}
        </div>

        <aside className="mh-side" aria-label={t("membership.title")}>
          {home.data ? (
            <>
              <MembershipCard d={home.data} lang={lang} />
              <NextClassCard d={home.data} lang={lang} />
              <StreakCard d={home.data} />
              <CoachCard d={home.data} />
            </>
          ) : (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="mh-card mh-skeleton" aria-hidden="true" />
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function CardHead({
  icon,
  title,
  to,
  label,
}: { icon: IconName; title: string; to?: string; label?: string }) {
  return (
    <header className="mh-card__head">
      <h2 className="mh-card__title">
        <Icon name={icon} size={26} className="mh-card__icon" />
        {title}
      </h2>
      {to ? (
        <Link className="mh-card__chev" to={to} aria-label={label ?? title}>
          <Icon name="chevronRight" size={22} />
        </Link>
      ) : null}
    </header>
  );
}

function MembershipCard({ d, lang }: { d: MemberHome; lang: Lang }) {
  const { t } = useMemberHomeT();
  const m = d.membership;
  const plate = m.status === "active" ? "ok" : m.status === "none" ? "neutral" : "warn";
  return (
    <section className="mh-card mh-member" aria-labelledby="mh-member">
      <header className="mh-card__head">
        <h2 className="mh-card__title" id="mh-member">
          <Icon name="star" size={26} className="mh-card__icon" />
          {t("membership.title")}
        </h2>
      </header>
      <p className="mh-member__name">
        {m.kind === "none" ? t("membership.none") : (m.name ?? t("membership.credits"))}
      </p>
      <span className={`mh-pill mh-pill--${plate}`}>
        {t(`status.${m.status}` as MemberHomeKey)}
      </span>
      {m.kind === "credits" && m.credits_left !== null ? (
        <p className="mh-member__line">
          {m.credits_left === 1
            ? t("membership.leftOne")
            : t("membership.left", { n: String(m.credits_left) })}
        </p>
      ) : null}
      {m.kind === "subscription" && m.renews_on ? (
        <>
          <p className="mh-member__label">{t("membership.renews")}</p>
          <p className="mh-member__date">
            <Icon name="calendar" size={20} /> {dateLong(m.renews_on, lang)}
          </p>
        </>
      ) : null}
      {m.kind === "credits" && m.expires_on ? (
        <>
          <p className="mh-member__label">{t("membership.expires")}</p>
          <p className="mh-member__date">
            <Icon name="calendar" size={20} /> {dateLong(m.expires_on, lang)}
          </p>
        </>
      ) : null}
      {m.kind === "none" ? (
        <Link className="mh-btn" to="/me/membership">
          {t("membership.buy")} <Icon name="arrowRight" size={18} />
        </Link>
      ) : null}
      <Link
        className="mh-card__chev mh-member__go"
        to="/me/membership"
        aria-label={t("membership.open")}
      >
        <Icon name="chevronRight" size={26} />
      </Link>
    </section>
  );
}

function NextClassCard({ d, lang }: { d: MemberHome; lang: Lang }) {
  const { t } = useMemberHomeT();
  const c = d.next_class;
  const thumb = c ? classThumb(c.class_name) : null;
  return (
    <section className="mh-card" aria-labelledby="mh-next">
      <header className="mh-card__head">
        <h2 className="mh-card__title" id="mh-next">
          <Icon name="calendar" size={26} className="mh-card__icon" />
          {t("next.title")}
        </h2>
      </header>
      {c ? (
        <div className="mh-next">
          {thumb ? (
            <img className="mh-next__thumb" src={thumb} alt="" width={88} height={76} />
          ) : (
            <span className="mh-next__thumb mh-next__thumb--icon" aria-hidden="true">
              <Icon name="dumbbell" size={30} />
            </span>
          )}
          <span className="mh-next__text">
            <strong>{c.class_name}</strong>
            <span>{whenLabel(c.starts_at, lang)}</span>
            <span>{c.room ?? ""}</span>
          </span>
          <Link className="mh-btn" to="/me/classes">
            {t("next.agenda")} <Icon name="arrowRight" size={18} />
          </Link>
        </div>
      ) : (
        <p className="muted mh-empty">
          {t("next.none")} <Link to="/me/classes">{t("next.agenda")}</Link>
        </p>
      )}
    </section>
  );
}

const THUMBS: ReadonlyArray<readonly [RegExp, string]> = [
  [/spin|ciclo|cycl|bike/i, "/brand/class-spinning-2.jpg"],
  [/hiit|funcional|functional|cross|boot|circuit/i, "/brand/class-hiit.jpg"],
  [/movil|mobil|yoga|stretch|estira|pilates|flex/i, "/brand/class-movilidad.jpg"],
];
export function classThumb(name: string): string | null {
  return THUMBS.find(([re]) => re.test(name))?.[1] ?? null;
}

function StreakCard({ d }: { d: MemberHome }) {
  const { t } = useMemberHomeT();
  const s = d.streak;
  return (
    <section className="mh-card mh-streak" aria-labelledby="mh-streak">
      <CardHead icon="flame" title={t("streak.title")} to="/me/progress" />
      <span className="sr-only" id="mh-streak">
        {t("streak.title")}
      </span>
      <div className="mh-streak__body">
        <p className="mh-streak__count">
          <strong>
            {s.days === 1 ? t("streak.day") : t("streak.days", { n: String(s.days) })}
          </strong>
          <span>{t("streak.sub")}</span>
        </p>
        <ol className="mh-streak__days" aria-label={t("streak.week")}>
          {s.last7.slice(-6).map((on, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 6-day window, position is the identity
            <li key={i} className={on ? "is-on" : undefined}>
              {on ? <Icon name="check" size={18} /> : null}
              <span className="sr-only">{on ? t("streak.on") : t("streak.off")}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CoachCard({ d }: { d: MemberHome }) {
  const { t } = useMemberHomeT();
  return (
    <section className="mh-card mh-coach" aria-labelledby="mh-coach">
      <header className="mh-card__head">
        <h2 className="mh-card__title" id="mh-coach">
          <Icon name="sparkle" size={26} className="mh-card__icon" />
          {t("coach.title")}
        </h2>
        <span className="mh-ia">IA</span>
      </header>
      <div className="mh-coach__body">
        <img
          className="mh-coach__bot"
          src="/brand/coach-robot.jpg"
          alt=""
          width={150}
          height={144}
        />
        <div className="mh-coach__text">
          <p>{t("coach.ask")}</p>
          <Link className="mh-btn mh-btn--wide" to="/me/coach/chat" data-tour-id="mh-coach-chat">
            <Icon name="chat" size={20} /> {t("coach.chat")}
          </Link>
          {d.coach.enabled ? null : <p className="mh-coach__note">{t("coach.demo")}</p>}
        </div>
      </div>
    </section>
  );
}

function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <svg
      className="mh-ring"
      viewBox="0 0 168 168"
      width="168"
      height="168"
      role="img"
      aria-label={`${v}% ${label}`}
    >
      <circle cx="84" cy="84" r={r} fill="none" stroke="var(--mh-track)" strokeWidth="12" />
      <circle
        cx="84"
        cy="84"
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`}
        transform="rotate(-90 84 84)"
      />
      <text x="84" y="84" textAnchor="middle" className="mh-ring__pct">
        {v}%
      </text>
      <text x="84" y="110" textAnchor="middle" className="mh-ring__label">
        {label}
      </text>
    </svg>
  );
}

function Meter({
  icon,
  label,
  note,
  value,
  max,
  text,
}: {
  icon: IconName;
  label: string;
  note?: string;
  value: number;
  max: number;
  text: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <li className="mh-meter">
      <Icon name={icon} size={26} className="mh-meter__icon" />
      <span className="mh-meter__label">
        {label} {note ? <small>{note}</small> : null}
      </span>
      <span className="mh-meter__value">{text}</span>
      <span className="mh-meter__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </li>
  );
}

function ProgressCard({ d }: { d: MemberHome }) {
  const { t, lang } = useMemberHomeT();
  const w = d.week;
  const n = (v: number) => new Intl.NumberFormat(loc(lang)).format(v);
  const minutesGoal = Math.max(60, w.goal * 60);
  return (
    <section className="mh-card mh-progress" aria-labelledby="mh-progress">
      <header className="mh-card__head">
        <h2 className="mh-card__title" id="mh-progress">
          <Icon name="chart" size={28} className="mh-card__icon" />
          {t("progress.title")}
        </h2>
        <div className="mh-seg">
          <span className="mh-seg__opt is-on" aria-current="true">
            {t("progress.tabWeek")}
          </span>
          <Link className="mh-seg__opt" to="/me/progress?view=month">
            {t("progress.tabMonth")}
          </Link>
          <Link className="mh-seg__opt" to="/me/progress?view=history">
            {t("progress.tabHistory")}
          </Link>
        </div>
      </header>
      <div className="mh-progress__body">
        <Ring pct={w.pct} label={t("progress.goal")} />
        <ul className="mh-meters">
          <Meter
            icon="dumbbell"
            label={t("progress.trainings")}
            value={w.trainings}
            max={w.goal}
            text={`${n(w.trainings)} / ${n(w.goal)}`}
          />
          <Meter
            icon="calendar"
            label={t("progress.classes")}
            value={w.classes_attended}
            max={Math.max(w.classes_booked, w.classes_attended)}
            text={`${n(w.classes_attended)} / ${n(Math.max(w.classes_booked, w.classes_attended))}`}
          />
          <Meter
            icon="flame"
            label={t("progress.minutes")}
            note={t("progress.minutesNote")}
            value={w.active_minutes}
            max={minutesGoal}
            text={`${n(w.active_minutes)} / ${n(minutesGoal)}`}
          />
        </ul>
      </div>
    </section>
  );
}

function ProgramsCard({ d }: { d: MemberHome }) {
  const { t } = useMemberHomeT();
  const p = d.programs[0];
  return (
    <section className="mh-card mh-programs" aria-labelledby="mh-programs">
      <header className="mh-card__head">
        <h2 className="mh-card__title" id="mh-programs">
          <Icon name="layers" size={28} className="mh-card__icon" />
          {t("programs.title")}
        </h2>
        <Link className="mh-card__chev" to="/me/programs" aria-label={t("programs.all")}>
          <Icon name="chevronRight" size={22} />
        </Link>
      </header>
      {p ? (
        <div className="mh-program">
          <img
            className="mh-program__img"
            src="/brand/program-strength.jpg"
            alt=""
            width={118}
            height={175}
          />
          <div className="mh-program__text">
            <strong>{p.name}</strong>
            {p.week && p.weeks ? (
              <span>{t("programs.week", { w: String(p.week), n: String(p.weeks) })}</span>
            ) : null}
            <span className="mh-program__bar">
              <span className="mh-meter__bar" aria-hidden="true">
                <span style={{ width: `${p.pct}%` }} />
              </span>
              <span>{p.pct}%</span>
            </span>
            <Link className="mh-btn" to={p.href}>
              {t("programs.continue")} <Icon name="arrowRight" size={18} />
            </Link>
          </div>
        </div>
      ) : (
        <p className="muted mh-empty">{t("programs.none")}</p>
      )}
    </section>
  );
}

function ChallengeBanner({ d, onJoined }: { d: MemberHome; onJoined: () => void }) {
  const { t, lang } = useMemberHomeT();
  const { api } = useSession();
  const brand = useCurrentBrand();
  const eng = useMemo(() => engagementApi(api), [api]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ReturnType<typeof toErrorCode> | null>(null);
  const c = d.challenge;
  if (!c) return null;
  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Privacy by default: joining never puts the member on the public leaderboard.
      await eng.join(c.id, d.member.id, null, false);
      onJoined();
    } catch (e) {
      setErr(toErrorCode(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mh-challenge" aria-labelledby="mh-challenge">
      <span className="mh-challenge__badge" aria-hidden="true">
        <Icon name="dumbbell" size={40} />
      </span>
      <div className="mh-challenge__title">
        <span>{t("challenge.kicker", { brand: brand?.name ?? "" })}</span>
        <h2 id="mh-challenge">{c.name}</h2>
        <small>{t("challenge.until", { date: dateLong(c.ends_on, lang) })}</small>
      </div>
      <img
        className="mh-challenge__img"
        src="/brand/challenge-transformation.jpg"
        alt=""
        width={146}
        height={141}
      />
      <ul className="mh-challenge__perks">
        {c.perks.map((p) => (
          <li key={p}>
            <Icon name="checkCircle" size={18} /> {p}
          </li>
        ))}
      </ul>
      <div className="mh-challenge__cta">
        {c.joined ? (
          <span className="mh-pill mh-pill--ok">{t("challenge.joined")}</span>
        ) : (
          <button
            type="button"
            className="mh-btn"
            onClick={join}
            disabled={busy}
            data-tour-id="mh-challenge-join"
          >
            {t("challenge.join")} <Icon name="arrowRight" size={18} />
          </button>
        )}
        {err ? <ErrorNote code={err} /> : null}
      </div>
    </section>
  );
}
