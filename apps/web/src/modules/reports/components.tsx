import { type ReactNode, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toErrorCode } from "../../api/client";
import type { Location, Member } from "../../api/types";
import { ErrorNote, LiveResult, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../../session/SessionContext";
import {
  type CsvReport,
  type HeatCell,
  type OverdueRow,
  count,
  heatLevel,
  money,
  reportsApi,
  saveFile,
} from "./api";
import { type ReportsKey, useReportsT } from "./dict";

/** Location picker; "" = every location the caller can see (RLS decides). */
export function LocationSelect({
  locations,
  value,
  onChange,
  tourId,
}: {
  locations: Location[];
  value: string;
  onChange: (v: string) => void;
  tourId?: string;
}) {
  const { t } = useReportsT();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{t("common.location")}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-tour-id={tourId}
      >
        <option value="">{t("common.allLocations")}</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One KPI: label, big value, optional hint and link. Plain HTML (no chart library). */
export function Kpi({
  label,
  value,
  hint,
  to,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: string;
  tone?: "warn" | "ok";
}) {
  const { t } = useReportsT();
  return (
    <div className={`rpt-kpi${tone ? ` rpt-kpi--${tone}` : ""}`}>
      <dt className="rpt-kpi__label">{label}</dt>
      <dd className="rpt-kpi__value">{value}</dd>
      {hint ? <dd className="rpt-kpi__hint">{hint}</dd> : null}
      {to ? (
        <dd className="rpt-kpi__link rpt-noprint">
          {to.startsWith("#") ? (
            <a href={to}>
              {t("kpi.see")}
              <span className="sr-only">: {label}</span>
            </a>
          ) : (
            <Link to={to}>
              {t("kpi.see")}
              <span className="sr-only">: {label}</span>
            </Link>
          )}
        </dd>
      ) : null}
    </div>
  );
}

export function KpiGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="rpt-kpi-group" aria-labelledby={id}>
      <h2 id={id} className="rpt-kpi-group__title">
        {title}
      </h2>
      <dl className="rpt-kpis">{children}</dl>
    </section>
  );
}

/** Download an audited CSV export. The live region confirms the file name. */
export function CsvButton({
  report,
  params,
  tourId,
}: {
  report: CsvReport;
  params: Record<string, string | number | undefined>;
  tourId: string;
}) {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const [state, setState] = useState<{ msg?: string; error?: ReturnType<typeof toErrorCode> }>({});
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setState({});
    try {
      const { filename, csv } = await rpt.csv(report, params, lang);
      const saved = saveFile(filename, csv);
      setState({ msg: t(saved ? "common.csvDone" : "common.csvReady", { file: filename }) });
    } catch (err) {
      setState({ error: toErrorCode(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="rpt-csv rpt-noprint">
      <button type="button" className="btn" onClick={run} disabled={busy} data-tour-id={tourId}>
        {t("common.csv")}
      </button>
      <LiveResult>{state.msg ?? ""}</LiveResult>
      {state.error ? <ErrorNote code={state.error} /> : null}
    </span>
  );
}

export function PrintButton() {
  const { t } = useReportsT();
  return (
    <button
      type="button"
      className="btn btn--ghost rpt-noprint"
      onClick={() => window.print()}
      data-tour-id="rpt-print"
    >
      {t("common.print")}
    </button>
  );
}

/**
 * Quick check-in bar (spec E6/v0.5): find a member, then one tap on "Check in". The schedule module's
 * app.check_in() decides and records every attempt; this bar only calls it.
 */
export function QuickCheckIn({
  locations,
  locationId,
}: { locations: Location[]; locationId: string }) {
  const { t } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const ids = { q: useId(), loc: useId(), help: useId() };
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loc, setLoc] = useState("");
  const [verdict, setVerdict] = useState<{ tone: "ok" | "blocked"; text: string } | null>(null);
  const [error, setError] = useState<ReturnType<typeof toErrorCode> | null>(null);
  const [busy, setBusy] = useState(false);
  // The panel's location filter wins; otherwise the picker; a single visible location needs no choice.
  const effectiveLoc =
    locationId || loc || (locations.length === 1 ? (locations[0]?.id ?? "") : "");

  async function ensureMembers() {
    if (members) return;
    try {
      setMembers((await api.members()).data);
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  const needle = query.trim().toLowerCase();
  const matches =
    needle.length >= 2 && members
      ? members
          .filter(
            (m) =>
              m.full_name.toLowerCase().includes(needle) ||
              (m.email ?? "").toLowerCase().includes(needle) ||
              String(m.member_no ?? "").toLowerCase() === needle,
          )
          .slice(0, 8)
      : [];

  async function enter(m: Member) {
    if (!effectiveLoc) return;
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const r = await rpt.checkIn(effectiveLoc, m.id);
      const name = r.full_name ?? m.full_name;
      setVerdict(
        r.result === "allowed"
          ? { tone: "ok", text: t("quick.allowed", { name }) }
          : {
              tone: "blocked",
              text: t("quick.denied", { name, reason: t(`reason.${r.reason}` as ReportsKey) }),
            },
      );
      setQuery("");
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section rpt-quick rpt-noprint" aria-labelledby={`${ids.q}-h`}>
      <div className="section__head">
        <h2 id={`${ids.q}-h`} className="section__title">
          {t("quick.title")}
        </h2>
        <div className="section__actions rpt-quick__links">
          <Link className="btn" to="/staff/members" data-tour-id="rpt-quick-new-member">
            {t("quick.newMember")}
          </Link>
          <Link className="btn" to="/staff/billing" data-tour-id="rpt-quick-day-pass">
            {t("quick.dayPass")}
          </Link>
        </div>
      </div>
      <div className="toolbar">
        {!locationId && locations.length > 1 ? (
          <div className="field">
            <label htmlFor={ids.loc}>{t("quick.location")}</label>
            <select id={ids.loc} value={loc} onChange={(e) => setLoc(e.target.value)} required>
              <option value="">{t("quick.pickLocation")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field field--grow">
          <label htmlFor={ids.q}>{t("quick.search")}</label>
          <input
            id={ids.q}
            type="search"
            autoComplete="off"
            value={query}
            aria-describedby={ids.help}
            onFocus={ensureMembers}
            onChange={(e) => {
              setQuery(e.target.value);
              void ensureMembers();
            }}
            data-tour-id="rpt-quick-checkin"
          />
          <p id={ids.help} className="help">
            {t("quick.searchHelp")}
          </p>
        </div>
      </div>
      {needle.length >= 2 && members && matches.length === 0 ? (
        <p className="muted">{t("quick.noMatch")}</p>
      ) : null}
      {matches.length > 0 ? (
        <ul className="rpt-quick__results">
          {matches.map((m) => (
            <li key={m.id} className="rpt-quick__row">
              <span>
                <strong>{m.full_name}</strong>
                {m.member_no ? <span className="muted mono"> · #{m.member_no}</span> : null}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !effectiveLoc}
                aria-label={t("quick.enterLabel", { name: m.full_name })}
                onClick={() => enter(m)}
                data-tour-id="rpt-quick-enter"
              >
                {t("quick.enter")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <LiveResult tone={verdict?.tone}>{verdict?.text ?? ""}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </section>
  );
}

export function OverdueTable({
  rows,
  showLocation,
}: { rows: OverdueRow[]; showLocation: boolean }) {
  const { t, lang } = useReportsT();
  return (
    <TableWrap label={t("overdue.title")}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("overdue.col.member")}</th>
            <th scope="col">{t("overdue.col.invoice")}</th>
            {showLocation ? <th scope="col">{t("overdue.col.location")}</th> : null}
            <th scope="col">{t("overdue.col.due")}</th>
            <th scope="col">{t("overdue.col.days")}</th>
            <th scope="col" className="rpt-num">
              {t("overdue.col.balance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoice_id}>
              <th scope="row">
                {r.full_name ? (
                  <Link to={`/staff/members/${encodeURIComponent(r.member_id)}`}>
                    {r.full_name}
                  </Link>
                ) : (
                  <span className="muted">{t("common.memberElsewhere")}</span>
                )}
              </th>
              <td className="mono">#{r.number}</td>
              {showLocation ? <td>{r.location_name ?? "—"}</td> : null}
              <td className="mono">{r.due_date}</td>
              <td>{t("overdue.days", { n: count(r.days_overdue, lang) })}</td>
              <td className="mono rpt-num">{money(r.balance_cents, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Peak-hours heatmap as an accessible data table: day rows × hour columns. Every cell shows its number;
 * the colour scale (5 levels, legend below) only reinforces it — never colour alone (WCAG 1.4.1).
 */
export function Heatmap({ cells, weeks }: { cells: HeatCell[]; weeks: number }) {
  const { t, lang } = useReportsT();
  const max = cells.reduce((a, c) => Math.max(a, c.check_ins), 0);
  const withData = cells.filter((c) => c.check_ins > 0).map((c) => c.hour);
  const from = Math.min(5, ...withData);
  const to = Math.max(22, ...withData);
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const at = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.check_ins]));
  const peak = cells.reduce<HeatCell | null>(
    (best, c) => (c.check_ins > 0 && (!best || c.check_ins > best.check_ins) ? c : best),
    null,
  );
  return (
    <div className="rpt-heat">
      <p className="rpt-heat__summary">
        {peak
          ? t("heat.peak", {
              day: t(`dow.${peak.dow}` as ReportsKey),
              from: hh(peak.hour),
              to: hh((peak.hour + 1) % 24),
              n: count(peak.check_ins, lang),
            })
          : t("heat.none")}
      </p>
      <TableWrap label={t("heat.title")}>
        <table className="table rpt-heat__table" data-tour-id="rpt-heatmap">
          <caption className="rpt-heat__caption">{t("heat.caption", { weeks })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("heat.day")}</th>
              {hours.map((h) => (
                <th key={h} scope="col" className="rpt-heat__hour">
                  {t("heat.hour", { h: String(h).padStart(2, "0") })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => (
              <tr key={d}>
                <th scope="row">{t(`dow.${d}` as ReportsKey)}</th>
                {hours.map((h) => {
                  const n = at.get(`${d}:${h}`) ?? 0;
                  return (
                    <td key={h} className={`rpt-heat__cell rpt-heat--${heatLevel(n, max)} mono`}>
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="rpt-heat__legend">
        <span className="rpt-heat__legend-title">{t("heat.legend")}:</span>
        <ul>
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <li key={l}>
              <span className={`rpt-heat__swatch rpt-heat--${l}`} aria-hidden="true" />
              {t(`heat.level${l}` as ReportsKey)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function GeneratedAt({ iso }: { iso: string | undefined }) {
  const { t, lang } = useReportsT();
  if (!iso) return null;
  return <p className="help">{t("common.generated", { when: formatDateTime(iso, lang) })}</p>;
}
