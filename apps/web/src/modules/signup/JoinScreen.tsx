import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { Icon, type IconName } from "../../components/icons";
import { useI18n } from "../../i18n/I18nContext";
import { applyTheme, sanitizeTheme } from "../../lib/brandTheme";
import { setBrandMode, useMode } from "../../lib/themeMode";
import { useModuleT } from "../i18n";
import { type JoinInfo, adoptSession, fetchJoinInfo, submitJoin } from "./api";
import { type SignupKey, dict } from "./dict";

export type Field = "location" | "name" | "email" | "phone" | "birth" | "terms" | "waiver";
export interface JoinValues {
  location: string;
  name: string;
  email: string;
  phone: string;
  birth: string;
  terms: boolean;
  waiver: boolean;
  smsReminders: boolean;
  smsMarketing: boolean;
}
const EMPTY: JoinValues = {
  location: "",
  name: "",
  email: "",
  phone: "",
  birth: "",
  terms: false,
  waiver: false,
  smsReminders: false, // TCPA: consent boxes always start unticked
  smsMarketing: false,
};
const ORDER: Field[] = ["location", "name", "email", "phone", "birth", "terms", "waiver"];

// Same rules as the API and the database (demo PII guard [VERIFICAR · lift with a real identity provider]).
const EMAIL = /^[a-z0-9][a-z0-9._+-]{0,63}@demo\.invalid$/;
const PHONE = /^\+1-(787|939)-555-01[0-9]{2}$/;
const NAME = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü '.-]*[A-Za-zÁÉÍÓÚÑÜáéíóúñü.]$/;

/** Today's date (YYYY-MM-DD) in Puerto Rico, where the age of majority is 21 [VERIFICAR · legal]. */
export function todayInPR(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Puerto_Rico" }).format(now);
}
export function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
/** Accept 7875550142 / (787) 555-0142 and store the canonical +1-787-555-0142. */
export function normalizePhone(v: string): string {
  const d = v.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `+1-${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : v.trim();
}
function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) && s >= "1900-01-01";
}

/** Client-side checks; the server repeats every one of them. */
export function validate(v: JoinValues, today = todayInPR()): Partial<Record<Field, SignupKey>> {
  const e: Partial<Record<Field, SignupKey>> = {};
  if (!v.location) e.location = "err.location";
  const name = v.name.trim().replace(/ +/g, " ");
  if (name.length < 2 || name.length > 120 || !NAME.test(name) || /\.[^ ]/.test(name))
    e.name = "err.name";
  if (!EMAIL.test(v.email.trim().toLowerCase())) e.email = "err.email";
  const phone = v.phone.trim();
  if (phone && !PHONE.test(phone)) e.phone = "err.phone";
  else if (!phone && (v.smsReminders || v.smsMarketing)) e.phone = "err.smsPhone";
  if (!validDate(v.birth) || v.birth > today) e.birth = "err.birth";
  else if (ageOn(v.birth, today) < 21) e.birth = "err.age";
  if (!v.terms) e.terms = "err.terms";
  if (!v.waiver) e.waiver = "err.waiver";
  return e;
}

const SERVER_FIELD: Record<string, [Field, SignupKey]> = {
  invalid_location: ["location", "err.location"],
  invalid_name: ["name", "err.name"],
  invalid_email: ["email", "err.email"],
  invalid_phone: ["phone", "err.phone"],
  phone_required_for_sms: ["phone", "err.smsPhone"],
  invalid_birth_date: ["birth", "err.birth"],
  age_requires_guardian: ["birth", "err.age"],
  agreements_required: ["terms", "err.terms"],
};
const SERVER_FORM: Record<string, SignupKey> = {
  agreement_outdated: "err.outdated",
  rate_limited: "err.rate",
  network: "err.network",
};

function money(cents: number, lang: string): string {
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-PR", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** The four "zeros" of the pay-per-session model, shown as gold badges (visual "0 + word"; full phrase for AT). */
const ZEROS: ReadonlyArray<readonly [SignupKey, SignupKey, IconName]> = [
  ["model.noMonthly", "model.zero.monthly", "calendar"],
  ["model.noContract", "model.zero.contract", "doc"],
  ["model.noEnrolment", "model.zero.enrolment", "card"],
  ["model.noMaintenance", "model.zero.maintenance", "gear"],
];

const NEXT: ReadonlyArray<readonly [SignupKey, IconName]> = [
  ["welcome.step1", "card"],
  ["welcome.step2", "calendarPlus"],
  ["welcome.step3", "qr"],
];

type Load =
  | { state: "loading" }
  | { state: "ready"; info: JoinInfo }
  | { state: "notfound" }
  | { state: "error" };

/** Public "Únete" page: outside the staff/member shell, no session, themed with the gym's brand. */
export function JoinScreen() {
  const { orgId = "" } = useParams();
  const { lang, setLang } = useI18n();
  const { t } = useModuleT(dict);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reloads on demand
  useEffect(() => {
    let alive = true;
    setLoad({ state: "loading" });
    fetchJoinInfo(orgId).then((r) => {
      if (!alive) return;
      if (r.ok) setLoad({ state: "ready", info: r.data });
      else setLoad(r.status === 404 ? { state: "notfound" } : { state: "error" });
    });
    return () => {
      alive = false;
    };
  }, [orgId, tick]);

  const info = load.state === "ready" ? load.info : null;
  const mode = useMode();
  // The public page wears the brand like the console does: its colours and its default colour mode. Layout
  // effects: applied before the first paint, so there is no flash of unbranded colours.
  useLayoutEffect(() => {
    if (!info) return;
    const th = sanitizeTheme(info.brand.theme);
    setBrandMode(th.mode);
    return () => setBrandMode(undefined);
  }, [info]);
  useLayoutEffect(() => {
    if (!info) return;
    return applyTheme(sanitizeTheme(info.brand.theme), document.documentElement, mode);
  }, [info, mode]);

  const theme = info ? sanitizeTheme(info.brand.theme) : null;
  const tagline = theme ? (lang === "en" ? theme.tagline_en : theme.tagline_es) : undefined;

  return (
    <div className="join">
      <header className="join__header">
        <div className="join__brand">
          {info && theme?.logo_url ? (
            <img
              className="join__logo"
              src={theme.logo_url}
              alt={theme.logo_alt ?? info.brand.name}
              height={40}
            />
          ) : (
            <span className="join__wordmark">{info?.brand.name ?? ""}</span>
          )}
          {tagline ? <span className="join__tagline">{tagline}</span> : null}
        </div>
        <button
          type="button"
          className="btn join__lang"
          lang={lang === "es" ? "en" : "es"}
          aria-label={t("join.langSwitchLabel")}
          onClick={() => setLang(lang === "es" ? "en" : "es")}
        >
          {t("join.langSwitch")}
        </button>
      </header>
      <main className="join__main" id="main">
        {load.state === "loading" ? (
          <div className="join__wrap">
            <output className="join__loading">{t("join.loading")}</output>
            <div className="join__skeleton" aria-hidden="true" />
          </div>
        ) : null}
        {load.state === "notfound" ? (
          <div className="join__wrap">
            <div className="section ds-empty join__state">
              <Icon name="building" size={40} />
              <strong>{t("join.notFound")}</strong>
              <Link className="btn" to="/">
                {t("join.back")}
              </Link>
            </div>
          </div>
        ) : null}
        {load.state === "error" ? (
          <div className="join__wrap">
            <div className="note note--error" role="alert">
              <span>{t("join.loadError")}</span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setTick((n) => n + 1)}
              >
                {t("join.retry")}
              </button>
            </div>
          </div>
        ) : null}
        {info ? <JoinForm info={info} /> : null}
      </main>
    </div>
  );
}

function JoinForm({ info }: { info: JoinInfo }) {
  const { lang } = useI18n();
  const { t } = useModuleT(dict);
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;
  const [v, setV] = useState<JoinValues>(() => ({
    ...EMPTY,
    location: info.locations.length === 1 ? (info.locations[0]?.id ?? "") : "",
  }));
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<Partial<Record<Field, SignupKey>>>({});
  const [formError, setFormError] = useState<SignupKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const texts = useMemo(() => {
    const pick = (kind: string) =>
      info.agreements.find((a) => a.kind === kind && a.locale === lang) ??
      info.agreements.find((a) => a.kind === kind);
    return {
      terms: pick("terms"),
      waiver: pick("waiver"),
      reminder: pick("sms_reminder"),
      marketing: pick("sms_marketing"),
    };
  }, [info, lang]);

  const local = validate(v);
  const errors: Partial<Record<Field, SignupKey>> = {};
  for (const f of ORDER) {
    const e = server[f] ?? ((submitted || touched[f]) && local[f]);
    if (e) errors[f] = e;
  }
  const errorList = ORDER.filter((f) => errors[f]);

  const set = useCallback(<K extends keyof JoinValues>(k: K, value: JoinValues[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setServer((prev) => {
      const field = (k === "smsReminders" || k === "smsMarketing" ? "phone" : k) as Field;
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setFormError(null);
  }, []);
  const blur = (f: Field) => setTouched((p) => ({ ...p, [f]: true }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServer({});
    setFormError(null);
    if (Object.keys(validate(v)).length > 0) {
      // Move focus to the summary (role=alert) so the errors are announced and reachable.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setBusy(true);
    const r = await submitJoin({
      org_id: info.org_id,
      location_id: v.location,
      full_name: v.name.trim().replace(/ +/g, " "),
      email: v.email.trim().toLowerCase(),
      phone: v.phone.trim() || null,
      birth_date: v.birth,
      terms_version: texts.terms?.version ?? "",
      waiver_version: texts.waiver?.version ?? "",
      accept_terms: v.terms,
      accept_waiver: v.waiver,
      sms_reminders: v.smsReminders,
      sms_marketing: v.smsMarketing,
      locale: lang === "en" ? "en" : "es",
    });
    if (r.ok) {
      const s = r.data.session;
      if (s) {
        adoptSession(s, {
          name: v.name.trim().split(/\s+/)[0] ?? "",
          brand: info.brand.name,
          location: info.locations.find((l) => l.id === v.location)?.name ?? "",
        });
        return; // full navigation follows
      }
      setBusy(false);
      setDone(r.data.message ?? t("done.next"));
      requestAnimationFrame(() => doneRef.current?.focus());
      return;
    }
    setBusy(false);
    const field = SERVER_FIELD[r.error];
    if (field) setServer({ [field[0]]: field[1] });
    else setFormError(SERVER_FORM[r.error] ?? "err.unknown");
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  if (done) {
    return (
      <div className="join__wrap">
        <section className="section ds-empty join__state" aria-labelledby={id("done")}>
          <Icon name="checkCircle" size={48} />
          <h1 className="page__title" id={id("done")} ref={doneRef} tabIndex={-1}>
            {t("done.title")}
          </h1>
          <output className="join__done">{done}</output>
        </section>
      </div>
    );
  }

  const describe = (f: Field, help?: string) =>
    [help, errors[f] ? id(`${f}-error`) : null].filter(Boolean).join(" ") || undefined;
  const err = (f: Field) =>
    errors[f] ? (
      <p className="field-error" id={id(`${f}-error`)}>
        {t(errors[f] as SignupKey)}
      </p>
    ) : null;
  const m = info.model;
  const hero = sanitizeTheme(info.brand.theme).hero_url;

  return (
    <div className="join__layout">
      <section
        className={`join__hero${hero ? " join__hero--photo" : ""}`}
        style={hero ? { ["--join-hero" as string]: `url("${hero}")` } : undefined}
        aria-labelledby={id("title")}
      >
        <div className="join__hero-inner">
          <div className="join__intro">
            <h1 className="page__title join__title" id={id("title")}>
              {t("join.title", { brand: info.brand.name })}
            </h1>
            <p className="lede join__lede">{t("join.lede")}</p>
            <span className="join__rule" aria-hidden="true" />
          </div>
          <h2 className="join__h2 join__model-title">{t("model.title")}</h2>
          {m.pay_per_session ? (
            <>
              <ul className="ds-stats join__zeros">
                {ZEROS.map(([full, word, icon]) => (
                  <li key={full} className="ds-stat join__zero">
                    <Icon name={icon} size={30} />
                    <span className="ds-stat__text" aria-hidden="true">
                      <span className="ds-stat__value join__zero-value">0</span>
                      <span className="join__zero-word">{t(word)}</span>
                    </span>
                    <span className="sr-only">{t(full)}</span>
                  </li>
                ))}
              </ul>
              <p className="join__pay">
                <Icon name="dumbbell" size={26} />
                {t("model.payPerSession")}
                {m.session_from_cents !== null
                  ? ` · ${t("model.from", { price: money(m.session_from_cents, lang) })}`
                  : ""}
              </p>
            </>
          ) : (
            <p className="join__other">{t("model.other")}</p>
          )}
        </div>
      </section>

      <div className="join__wrap join__wrap--wide">
        <form
          className="section join__form"
          noValidate
          onSubmit={onSubmit}
          aria-labelledby={id("form")}
        >
          <div className="join__form-head">
            <h2 className="section__title" id={id("form")}>
              <Icon name="userPlus" size={26} />
              {t("form.title")}
            </h2>
            <p className="help">{t("form.required")}</p>
          </div>

          <div ref={summaryRef} tabIndex={-1} role="alert" className="join__summary">
            {(submitted || Object.keys(server).length > 0) && errorList.length > 0 ? (
              <div className="note note--error join__errors">
                <p>{t("form.errorsTitle", { n: errorList.length })}</p>
                <ul>
                  {errorList.map((f) => (
                    <li key={f}>
                      <a href={`#${id(f)}`}>{t(errors[f] as SignupKey)}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {formError ? <p className="note note--error">{t(formError)}</p> : null}
          </div>

          <fieldset className="join__fieldset" aria-describedby={describe("location")}>
            <legend className="join__legend">
              <Icon name="pin" size={22} />
              {t("form.location")}
            </legend>
            <div className="join__options">
              {info.locations.map((l, i) => (
                <label key={l.id} className="join__option">
                  <input
                    type="radio"
                    name={id("location")}
                    id={i === 0 ? id("location") : undefined}
                    value={l.id}
                    checked={v.location === l.id}
                    onChange={() => set("location", l.id)}
                    onBlur={() => blur("location")}
                    aria-invalid={Boolean(errors.location)}
                    data-tour-id="join-location"
                  />
                  <span>
                    <span className="join__option-name">{l.name}</span>
                    {l.municipality ? (
                      <span className="join__option-sub">{l.municipality}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            {err("location")}
          </fieldset>

          <div className="join__fields">
            <div className="field">
              <label htmlFor={id("name")}>{t("form.name")}</label>
              <input
                id={id("name")}
                autoComplete="name"
                maxLength={120}
                value={v.name}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describe("name")}
                onChange={(e) => set("name", e.target.value)}
                onBlur={() => blur("name")}
              />
              {err("name")}
            </div>

            <div className="field">
              <label htmlFor={id("email")}>{t("form.email")}</label>
              <input
                id={id("email")}
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={v.email}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={describe("email", id("email-help"))}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => blur("email")}
              />
              <p className="help" id={id("email-help")}>
                {t("form.emailHelp")}
              </p>
              {err("email")}
            </div>

            <div className="field">
              <label htmlFor={id("phone")}>{t("form.phone")}</label>
              <input
                id={id("phone")}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={v.phone}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={describe("phone", id("phone-help"))}
                onChange={(e) => set("phone", e.target.value)}
                onBlur={() => {
                  set("phone", normalizePhone(v.phone));
                  blur("phone");
                }}
              />
              <p className="help" id={id("phone-help")}>
                {t("form.phoneHelp")}
              </p>
              {err("phone")}
            </div>

            <div className="field">
              <label htmlFor={id("birth")}>{t("form.birth")}</label>
              <input
                id={id("birth")}
                type="date"
                autoComplete="bday"
                max={todayInPR()}
                min="1900-01-01"
                value={v.birth}
                aria-invalid={Boolean(errors.birth)}
                aria-describedby={describe("birth", id("birth-help"))}
                onChange={(e) => set("birth", e.target.value)}
                onBlur={() => blur("birth")}
              />
              <p className="help" id={id("birth-help")}>
                {t("form.birthHelp")}
              </p>
              {err("birth")}
            </div>
          </div>

          <fieldset className="join__fieldset join__fieldset--rule">
            <legend className="join__legend">
              <Icon name="doc" size={22} />
              {t("form.agreements")}
            </legend>
            {(["terms", "waiver"] as const).map((k) => {
              const text = texts[k];
              return (
                <div key={k} className="join__agreement">
                  <div className="join__check">
                    <input
                      type="checkbox"
                      id={id(k)}
                      checked={v[k]}
                      aria-invalid={Boolean(errors[k])}
                      aria-describedby={describe(k)}
                      onChange={(e) => set(k, e.target.checked)}
                      onBlur={() => blur(k)}
                    />
                    <label htmlFor={id(k)}>
                      {t(k === "terms" ? "form.acceptTerms" : "form.acceptWaiver")}
                    </label>
                  </div>
                  {text ? (
                    <details className="join__text">
                      <summary>
                        {t("form.read", { title: text.title, version: text.version })}
                      </summary>
                      <p>{text.body}</p>
                    </details>
                  ) : null}
                  {err(k)}
                </div>
              );
            })}
          </fieldset>

          <fieldset className="join__fieldset join__fieldset--rule">
            <legend className="join__legend">
              <Icon name="chat" size={22} />
              {t("form.optional")}
            </legend>
            <p className="help">{t("form.optionalHelp")}</p>
            {(
              [
                ["smsReminders", "form.smsReminders", texts.reminder],
                ["smsMarketing", "form.smsMarketing", texts.marketing],
              ] as const
            ).map(([k, label, text]) => (
              <div key={k} className="join__agreement">
                <div className="join__check">
                  <input
                    type="checkbox"
                    id={id(k)}
                    checked={v[k]}
                    aria-describedby={text ? id(`${k}-text`) : undefined}
                    onChange={(e) => set(k, e.target.checked)}
                  />
                  <label htmlFor={id(k)}>{t(label)}</label>
                </div>
                {text ? (
                  <p className="help join__consent" id={id(`${k}-text`)}>
                    {text.body}
                  </p>
                ) : null}
              </div>
            ))}
          </fieldset>

          <button
            type="submit"
            className="btn btn--primary join__submit"
            data-tour-id="join-submit"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t("form.submitting") : t("form.submit")}
            {busy ? null : <Icon name="arrowRight" size={20} />}
          </button>
        </form>
        <aside className="section join__next" aria-labelledby={id("next")}>
          <h2 className="section__title" id={id("next")}>
            <Icon name="flame" size={24} />
            {t("join.next")}
          </h2>
          <ol className="join__steps">
            {NEXT.map(([key, icon]) => (
              <li key={key} className="join__step">
                <span className="join__step-icon" aria-hidden="true">
                  <Icon name={icon} size={24} />
                </span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
