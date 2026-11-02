import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { toErrorCode } from "../../api/client";
import {
  ErrorNote,
  LiveResult,
  Loading,
  Plate,
  Section,
  TableWrap,
  type Tone,
} from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  type IvuRow,
  MEMBERS_REPORT_ROLES,
  REPORTS_ROUTES,
  type SalesRow,
  type SuriStatus,
  count,
  isoDay,
  money,
  previousMonth,
  reportsApi,
} from "./api";
import { CsvButton, LocationSelect, PrintButton } from "./components";
import { type ReportsKey, useReportsT } from "./dict";
import "./reports.css";

function ReportsNav() {
  const { t } = useReportsT();
  const { role } = useSession();
  const items = [
    { to: REPORTS_ROUTES.ivu, label: t("reports.ivu") },
    { to: REPORTS_ROUTES.sales, label: t("reports.sales") },
    ...((MEMBERS_REPORT_ROLES as readonly string[]).includes(role ?? "")
      ? [{ to: REPORTS_ROUTES.members, label: t("reports.members") }]
      : []),
  ];
  return (
    <nav className="rpt-subnav rpt-noprint" aria-label={t("reports.nav")}>
      <ul>
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} className="rpt-subnav__link">
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Shell({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  const { t } = useReportsT();
  return (
    <div className="page rpt rpt-print">
      <div className="page__head">
        <h1 className="page__title">
          <span className="rpt-print-only">{t("reports.title")} · </span>
          {title}
        </h1>
        <PrintButton />
      </div>
      <ReportsNav />
      <p className="lede">{lede}</p>
      {children}
    </div>
  );
}

const SURI_TONE: Record<SuriStatus, Tone> = {
  participant: "ok",
  non_participant: "warn",
  unverified: "warn",
};

/** IVU por municipio — owner, location manager (their locations), accountant (org-wide, read-only). */
export function IvuReportScreen() {
  const { t, lang } = useReportsT();
  const { api, role } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const now = useMemo(() => new Date(), []);
  const [draft, setDraft] = useState({ month: previousMonth(now), loc: "" });
  const [applied, setApplied] = useState(draft);
  const locations = useAsync(() => api.locations(), [api]);
  const ivu = useAsync(
    () => rpt.ivu(applied.month, applied.loc || undefined),
    [rpt, applied.month, applied.loc],
  );
  const monthId = useId();
  const rows = ivu.data?.data ?? [];
  const tot = rows.reduce(
    (a, r) => ({
      documents: a.documents + r.documents,
      taxable: a.taxable + r.taxable_base_cents,
      exempt: a.exempt + r.exempt_base_cents,
      st: a.st + r.ivu_state_cents,
      mu: a.mu + r.ivu_municipal_cents,
    }),
    { documents: 0, taxable: 0, exempt: 0, st: 0, mu: 0 },
  );

  function apply(e: FormEvent) {
    e.preventDefault();
    setApplied(draft);
  }

  return (
    <Shell title={t("ivu.title")} lede={t("ivu.lede")}>
      <form className="toolbar rpt-noprint" onSubmit={apply}>
        <div className="field">
          <label htmlFor={monthId}>{t("ivu.month")}</label>
          <input
            id={monthId}
            type="month"
            required
            value={draft.month}
            onChange={(e) => setDraft({ ...draft, month: e.target.value })}
          />
        </div>
        <LocationSelect
          locations={locations.data?.data ?? []}
          value={draft.loc}
          onChange={(v) => setDraft({ ...draft, loc: v })}
        />
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" data-tour-id="rpt-ivu-apply">
            {t("common.apply")}
          </button>
        </div>
        <CsvButton
          report="ivu"
          params={{ month: applied.month, location_id: applied.loc || undefined }}
          tourId="rpt-ivu-csv"
        />
      </form>
      <p className="note note--warn" role="note">
        {t("ivu.verify")}
      </p>
      {ivu.loading && !ivu.data ? <Loading /> : null}
      {ivu.error ? <ErrorNote code={ivu.error} onRetry={ivu.reload} /> : null}
      {ivu.data && rows.length === 0 ? <p className="muted">{t("ivu.empty")}</p> : null}
      {rows.length > 0 ? (
        <TableWrap label={t("ivu.title")}>
          <table className="table" data-tour-id="rpt-ivu-table">
            <caption className="sr-only">
              {t("ivu.title")} · {applied.month}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("ivu.col.municipality")}</th>
                <th scope="col">{t("ivu.col.suri")}</th>
                <th scope="col">{t("ivu.col.source")}</th>
                <th scope="col" className="rpt-num">
                  {t("ivu.col.documents")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("ivu.col.taxable")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("ivu.col.exempt")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("ivu.col.state")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("ivu.col.municipal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: IvuRow) => (
                <tr key={`${r.municipality}:${r.source}`}>
                  <th scope="row">{r.municipality || "—"}</th>
                  <td>
                    <Plate tone={SURI_TONE[r.suri_status]}>
                      {t(`ivu.suri.${r.suri_status}` as ReportsKey)}
                    </Plate>
                  </td>
                  <td>{t(`ivu.source.${r.source}` as ReportsKey)}</td>
                  <td className="mono rpt-num">{count(r.documents, lang)}</td>
                  <td className="mono rpt-num">{money(r.taxable_base_cents, lang)}</td>
                  <td className="mono rpt-num">{money(r.exempt_base_cents, lang)}</td>
                  <td className="mono rpt-num">{money(r.ivu_state_cents, lang)}</td>
                  <td className="mono rpt-num">{money(r.ivu_municipal_cents, lang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  {t("ivu.total")}
                </th>
                <td className="mono rpt-num">{count(tot.documents, lang)}</td>
                <td className="mono rpt-num">{money(tot.taxable, lang)}</td>
                <td className="mono rpt-num">{money(tot.exempt, lang)}</td>
                <td className="mono rpt-num">{money(tot.st, lang)}</td>
                <td className="mono rpt-num">{money(tot.mu, lang)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      ) : null}
      {role === "owner" ? (
        <MunicipalityConfig
          names={[
            ...new Set([
              ...rows.map((r) => r.municipality).filter(Boolean),
              ...(locations.data?.data ?? []).map((l) => l.municipality).filter(Boolean),
            ]),
          ]}
          onSaved={ivu.reload}
        />
      ) : null}
    </Shell>
  );
}

function MunicipalityConfig({ names, onSaved }: { names: string[]; onSaved: () => void }) {
  const { t } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const saved = useAsync(() => rpt.municipalities(), [rpt]);
  const ids = { name: useId(), status: useId(), note: useId() };
  const [form, setForm] = useState<{
    name: string;
    status: "participant" | "non_participant";
    note: string;
  }>({
    name: "",
    status: "participant",
    note: "",
  });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<ReturnType<typeof toErrorCode> | null>(null);
  const all = [
    ...new Set([...names, ...(saved.data?.data ?? []).map((m) => m.municipality)]),
  ].sort();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg("");
    try {
      const r = await rpt.setMunicipality({
        municipality: form.name,
        suri_status: form.status,
        note: form.note.trim() || undefined,
      });
      setMsg(
        t("ivu.configSaved", {
          name: r.municipality,
          status: t(`ivu.suri.${r.suri_status}` as ReportsKey),
        }),
      );
      saved.reload();
      onSaved();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <Section title={t("ivu.config")}>
      <p className="help">{t("ivu.configLede")}</p>
      {(saved.data?.data ?? []).length > 0 ? (
        <ul className="rpt-list">
          {(saved.data?.data ?? []).map((m) => (
            <li key={m.id}>
              <strong>{m.municipality}</strong>:{" "}
              <Plate tone={SURI_TONE[m.suri_status]}>
                {t(`ivu.suri.${m.suri_status}` as ReportsKey)}
              </Plate>
              {m.note ? <span className="muted"> — {m.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form className="toolbar rpt-noprint" onSubmit={submit}>
        <div className="field">
          <label htmlFor={ids.name}>{t("ivu.configMunicipality")}</label>
          <input
            id={ids.name}
            list={`${ids.name}-list`}
            required
            maxLength={60}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <datalist id={`${ids.name}-list`}>
            {all.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor={ids.status}>{t("ivu.configStatus")}</label>
          <select
            id={ids.status}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}
          >
            <option value="participant">{t("ivu.suri.participant")}</option>
            <option value="non_participant">{t("ivu.suri.non_participant")}</option>
          </select>
        </div>
        <div className="field field--grow">
          <label htmlFor={ids.note}>{t("ivu.configNote")}</label>
          <input
            id={ids.note}
            maxLength={300}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            data-tour-id="rpt-ivu-municipality-save"
          >
            {t("ivu.configSave")}
          </button>
        </div>
      </form>
      <LiveResult tone={msg ? "ok" : undefined}>{msg}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Section>
  );
}

type GroupBy = "product" | "location" | "seller";

/** Ventas — by product/plan, location or seller (owner, location manager, accountant). */
export function SalesReportScreen() {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const now = useMemo(() => new Date(), []);
  const [draft, setDraft] = useState({
    from: `${isoDay(now).slice(0, 8)}01`,
    to: isoDay(now),
    loc: "",
  });
  const [applied, setApplied] = useState(draft);
  const [by, setBy] = useState<GroupBy>("product");
  const locations = useAsync(() => api.locations(), [api]);
  const sales = useAsync(
    () => rpt.sales(applied.from, applied.to, applied.loc || undefined),
    [rpt, applied.from, applied.to, applied.loc],
  );
  const ids = { from: useId(), to: useId(), by: useId() };

  const groups = useMemo(() => {
    const m = new Map<
      string,
      {
        label: string;
        source: string;
        documents: number;
        units: number;
        sub: number;
        ivu: number;
        total: number;
      }
    >();
    for (const r of sales.data?.data ?? ([] as SalesRow[])) {
      const label =
        by === "product"
          ? r.product_name
          : by === "location"
            ? (r.location_name ?? "—")
            : (r.seller_name ?? t("sales.unknownSeller"));
      const key = by === "product" ? `${r.source}:${r.product_id}` : `${r.source}:${label}`;
      const g = m.get(key) ?? {
        label,
        source: r.source,
        documents: 0,
        units: 0,
        sub: 0,
        ivu: 0,
        total: 0,
      };
      g.documents += r.documents;
      g.units += r.units;
      g.sub += r.subtotal_cents;
      g.ivu += r.ivu_cents;
      g.total += r.total_cents;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [sales.data, by, t]);
  const tot = groups.reduce(
    (a, g) => ({ sub: a.sub + g.sub, ivu: a.ivu + g.ivu, total: a.total + g.total }),
    {
      sub: 0,
      ivu: 0,
      total: 0,
    },
  );

  return (
    <Shell title={t("sales.title")} lede={t("sales.lede")}>
      <form
        className="toolbar rpt-noprint"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(draft);
        }}
      >
        <div className="field">
          <label htmlFor={ids.from}>{t("sales.from")}</label>
          <input
            id={ids.from}
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.to}>{t("sales.to")}</label>
          <input
            id={ids.to}
            type="date"
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <LocationSelect
          locations={locations.data?.data ?? []}
          value={draft.loc}
          onChange={(v) => setDraft({ ...draft, loc: v })}
        />
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" data-tour-id="rpt-sales-apply">
            {t("common.apply")}
          </button>
        </div>
        <CsvButton
          report="sales"
          params={{ from: applied.from, to: applied.to, location_id: applied.loc || undefined }}
          tourId="rpt-sales-csv"
        />
      </form>
      <div className="field field--inline rpt-noprint">
        <label htmlFor={ids.by}>{t("sales.groupBy")}</label>
        <select
          id={ids.by}
          value={by}
          onChange={(e) => setBy(e.target.value as GroupBy)}
          data-tour-id="rpt-sales-group"
        >
          <option value="product">{t("sales.by.product")}</option>
          <option value="location">{t("sales.by.location")}</option>
          <option value="seller">{t("sales.by.seller")}</option>
        </select>
      </div>
      <p className="help">{t("sales.note")}</p>
      {sales.loading && !sales.data ? <Loading /> : null}
      {sales.error ? <ErrorNote code={sales.error} onRetry={sales.reload} /> : null}
      {sales.data && groups.length === 0 ? <p className="muted">{t("common.empty")}</p> : null}
      {groups.length > 0 ? (
        <TableWrap label={t("sales.title")}>
          <table className="table" data-tour-id="rpt-sales-table">
            <thead>
              <tr>
                <th scope="col">{t(`sales.by.${by}` as ReportsKey)}</th>
                <th scope="col">{t("sales.col.source")}</th>
                <th scope="col" className="rpt-num">
                  {t("sales.col.documents")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("sales.col.units")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("sales.col.subtotal")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("sales.col.ivu")}
                </th>
                <th scope="col" className="rpt-num">
                  {t("sales.col.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.source}:${g.label}`}>
                  <th scope="row">{g.label}</th>
                  <td>{t(`sales.source.${g.source}` as ReportsKey)}</td>
                  <td className="mono rpt-num">{count(g.documents, lang)}</td>
                  <td className="mono rpt-num">{count(g.units, lang)}</td>
                  <td className="mono rpt-num">{money(g.sub, lang)}</td>
                  <td className="mono rpt-num">{money(g.ivu, lang)}</td>
                  <td className="mono rpt-num">{money(g.total, lang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  {t("sales.total")}
                </th>
                <td className="mono rpt-num">{money(tot.sub, lang)}</td>
                <td className="mono rpt-num">{money(tot.ivu, lang)}</td>
                <td className="mono rpt-num">{money(tot.total, lang)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      ) : null}
    </Shell>
  );
}

/** Socios — status counts and joins/cancellations by month (owner, location manager). */
export function MembersReportScreen() {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const [loc, setLoc] = useState("");
  const [months, setMonths] = useState(12);
  const locations = useAsync(() => api.locations(), [api]);
  const data = useAsync(() => rpt.members(loc || undefined, months), [rpt, loc, months]);
  const monthsId = useId();
  const maxFlow = Math.max(
    1,
    ...(data.data?.flow ?? []).flatMap((f) => [f.joins, f.cancellations]),
  );

  return (
    <Shell title={t("members.title")} lede={t("members.lede")}>
      <div className="toolbar rpt-noprint">
        <LocationSelect locations={locations.data?.data ?? []} value={loc} onChange={setLoc} />
        <div className="field">
          <label htmlFor={monthsId}>{t("members.months")}</label>
          <select id={monthsId} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[3, 6, 12, 24].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <CsvButton
          report="members"
          params={{ location_id: loc || undefined, months }}
          tourId="rpt-members-csv"
        />
      </div>
      {data.loading && !data.data ? <Loading /> : null}
      {data.error ? <ErrorNote code={data.error} onRetry={data.reload} /> : null}
      {data.data ? (
        <>
          <Section title={t("members.status")}>
            <TableWrap label={t("members.status")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("members.col.status")}</th>
                    <th scope="col" className="rpt-num">
                      {t("members.col.members")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.status.map((s) => (
                    <tr key={s.status}>
                      <th scope="row">{t(`status.${s.status}` as ReportsKey)}</th>
                      <td className="mono rpt-num">{count(s.members, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
          <Section title={t("members.flow")}>
            <TableWrap label={t("members.flow")}>
              <table className="table" data-tour-id="rpt-members-flow">
                <thead>
                  <tr>
                    <th scope="col">{t("members.col.month")}</th>
                    <th scope="col">{t("members.col.joins")}</th>
                    <th scope="col">{t("members.col.cancellations")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.flow.map((f) => (
                    <tr key={f.month}>
                      <th scope="row" className="mono">
                        {f.month}
                      </th>
                      <td>
                        <span className="rpt-bar">
                          <span className="mono rpt-bar__n">{count(f.joins, lang)}</span>
                          <span className="rpt-bar__track" aria-hidden="true">
                            <span
                              className="rpt-bar__fill"
                              style={{ width: `${(100 * f.joins) / maxFlow}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="rpt-bar">
                          <span className="mono rpt-bar__n">{count(f.cancellations, lang)}</span>
                          <span className="rpt-bar__track" aria-hidden="true">
                            <span
                              className="rpt-bar__fill rpt-bar__fill--out"
                              style={{ width: `${(100 * f.cancellations) / maxFlow}%` }}
                            />
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        </>
      ) : null}
    </Shell>
  );
}
