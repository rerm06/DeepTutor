import { type FormEvent, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading, TableWrap } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { CRM_ROUTES, Stat } from "./LeadsBoard";
import { type FunnelRow, LEAD_STAGES, crmApi, isoDay } from "./api";
import { useCrmT } from "./dict";
import { CRM_D, CrmSection } from "./parts";
import "./crm.css";

const COUNT_STAGES = LEAD_STAGES;

/** "Embudo": cohort of leads created in a date range, by location and source. Table + plain CSS bars. */
export function FunnelScreen() {
  const { t } = useCrmT();
  const common = useI18n();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const now = useMemo(() => new Date(), []);
  const [draft, setDraft] = useState({ from: isoDay(now, -30), to: isoDay(now), locationId: "" });
  const [range, setRange] = useState(draft);
  const locations = useAsync(() => api.locations(), [api]);
  const funnel = useAsync(
    () => crm.funnel(range.from, range.to, range.locationId || undefined),
    [crm, range],
  );
  const ids = { from: useId(), to: useId(), loc: useId(), bars: useId() };
  const locName = new Map((locations.data?.data ?? []).map((l) => [l.id, l.name]));
  const rows = funnel.data?.data ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      for (const s of COUNT_STAGES) acc[s] += r[s];
      acc.total += r.total;
      return acc;
    },
    { total: 0, new: 0, contacted: 0, tour_booked: 0, trial: 0, won: 0, lost: 0 },
  );
  const pct = (won: number, total: number) => (total ? Math.round((1000 * won) / total) / 10 : 0);

  function apply(e: FormEvent) {
    e.preventDefault();
    setRange(draft);
  }

  return (
    <div className="page crm">
      <div className="crm-head">
        <h1 className="page__title">{t("funnel.title")}</h1>
        <p className="lede">{t("funnel.lede")}</p>
      </div>
      <form className="toolbar crm-toolbar" onSubmit={apply}>
        <div className="field">
          <label htmlFor={ids.from}>{t("funnel.from")}</label>
          <input
            id={ids.from}
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.to}>{t("funnel.to")}</label>
          <input
            id={ids.to}
            type="date"
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.loc}>{t("funnel.location")}</label>
          <select
            id={ids.loc}
            value={draft.locationId}
            onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
          >
            <option value="">{common.t("common.all")}</option>
            {(locations.data?.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" data-tour-id="crm-funnel-apply">
            <Icon d={CRM_D.funnel} size={20} />
            {t("funnel.apply")}
          </button>
        </div>
      </form>

      {funnel.loading ? <Loading /> : null}
      {funnel.error ? <ErrorNote code={funnel.error} onRetry={funnel.reload} /> : null}
      {funnel.data && rows.length === 0 ? (
        <div className="section">
          <div className="ds-empty">
            <Icon d={CRM_D.funnel} size={36} />
            <strong>{t("funnel.empty")}</strong>
            <Link className="btn" to={CRM_ROUTES.leads}>
              {t("funnel.toLeads")}
            </Link>
          </div>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <>
          <div className="ds-stats">
            <Stat
              icon={<Icon name="crm" size={34} />}
              label={t("funnel.stat.total")}
              value={totals.total}
            />
            <Stat
              icon={<Icon name="checkCircle" size={34} />}
              label={t("funnel.stat.won")}
              value={totals.won}
            />
            <Stat
              icon={<Icon d={CRM_D.xCircle} size={34} />}
              label={t("funnel.stat.lost")}
              value={totals.lost}
            />
            <Stat
              icon={<Icon d={CRM_D.percent} size={34} />}
              label={t("funnel.col.conversion")}
              value={`${pct(totals.won, totals.total).toFixed(1)} %`}
            />
          </div>
          <div className="crm-funnel">
            <CrmSection title={t("funnel.stages")} d={CRM_D.funnel}>
              <ul className="crm-bars">
                {COUNT_STAGES.map((s) => {
                  const n = totals[s];
                  const w = totals.total ? (100 * n) / totals.total : 0;
                  return (
                    <li key={s} className={`crm-bar crm-bar--${s}`}>
                      <span className="sr-only">
                        {t("funnel.stageLabel", { stage: t(`stage.${s}`), n, total: totals.total })}
                      </span>
                      <span className="crm-bar__row" aria-hidden="true">
                        <span className="crm-bar__name">{t(`stage.${s}`)}</span>
                        <span className="crm-bar__num">{n}</span>
                      </span>
                      <span className="crm-bar__track" aria-hidden="true">
                        <span className="crm-bar__fill" style={{ width: `${w}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CrmSection>
            <CrmSection title={t("funnel.bars")} icon="chart">
              <ul className="crm-bars">
                {rows.map((r) => {
                  const label = `${locName.get(r.location_id) ?? "—"} · ${t(`source.${r.source}`)}`;
                  return (
                    <li key={`${r.location_id}:${r.source}`} className="crm-bar">
                      <span className="crm-bar__label sr-only">
                        {t("funnel.barLabel", {
                          label,
                          pct: r.conversion_pct.toFixed(1),
                          won: r.won,
                          total: r.total,
                        })}
                      </span>
                      <span className="crm-bar__row" aria-hidden="true">
                        <span className="crm-bar__name">{label}</span>
                        <span className="crm-bar__num">
                          {r.conversion_pct.toFixed(1)} %
                          <small>{t("funnel.ofTotal", { won: r.won, total: r.total })}</small>
                        </span>
                      </span>
                      <span className="crm-bar__track" aria-hidden="true">
                        <span
                          className="crm-bar__fill"
                          style={{ width: `${Math.min(100, Math.max(0, r.conversion_pct))}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CrmSection>
          </div>
          <TableWrap label={t("funnel.title")}>
            <table className="table" data-tour-id="crm-funnel-table">
              <thead>
                <tr>
                  <th scope="col">{t("funnel.col.location")}</th>
                  <th scope="col">{t("funnel.col.source")}</th>
                  <th scope="col">{t("funnel.col.total")}</th>
                  {COUNT_STAGES.map((s) => (
                    <th key={s} scope="col">
                      {t(`stage.${s}`)}
                    </th>
                  ))}
                  <th scope="col">{t("funnel.col.conversion")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: FunnelRow) => (
                  <tr key={`${r.location_id}:${r.source}`}>
                    <td>{locName.get(r.location_id) ?? "—"}</td>
                    <td>{t(`source.${r.source}`)}</td>
                    <td className="mono">{r.total}</td>
                    {COUNT_STAGES.map((s) => (
                      <td key={s} className="mono">
                        {r[s]}
                      </td>
                    ))}
                    <td className="mono">{r.conversion_pct.toFixed(1)} %</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    {t("funnel.total")}
                  </th>
                  <td className="mono">{totals.total}</td>
                  {COUNT_STAGES.map((s) => (
                    <td key={s} className="mono">
                      {totals[s]}
                    </td>
                  ))}
                  <td className="mono">{pct(totals.won, totals.total).toFixed(1)} %</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        </>
      ) : null}
    </div>
  );
}
