import { useId, useMemo, useState } from "react";
import { ErrorNote, Loading, Section, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Dashboard, count, money, pct, reportsApi } from "./api";
import {
  CsvButton,
  GeneratedAt,
  Heatmap,
  Kpi,
  KpiGroup,
  LocationSelect,
  OverdueTable,
  PrintButton,
  QuickCheckIn,
} from "./components";
import { type ReportsKey, useReportsT } from "./dict";
import "./reports.css";

/**
 * "Panel" — owner and location manager landing view. KPI rows in plain HTML/CSS, overdue balances and what
 * expires in 7 days (retention), the peak-hours heatmap, and the quick check-in bar.
 */
export function PanelScreen() {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const [loc, setLoc] = useState("");
  const [weeks, setWeeks] = useState<4 | 8>(4);
  const locId = loc || undefined;
  const locations = useAsync(() => api.locations(), [api]);
  const dash = useAsync(() => rpt.dashboard(locId), [rpt, locId]);
  const overdue = useAsync(() => rpt.overdue(locId), [rpt, locId]);
  const expiring = useAsync(() => rpt.expiring(locId, 7), [rpt, locId]);
  const heat = useAsync(() => rpt.heatmap(locId, weeks), [rpt, locId, weeks]);
  const locs = locations.data?.data ?? [];
  const weeksName = useId();

  return (
    <div className="page rpt rpt-print">
      <div className="page__head">
        <h1 className="page__title">{t("panel.title")}</h1>
        <PrintButton />
      </div>
      <p className="lede">{t("panel.lede")}</p>
      <div className="toolbar rpt-noprint">
        <LocationSelect locations={locs} value={loc} onChange={setLoc} tourId="rpt-location" />
      </div>

      <QuickCheckIn locations={locs} locationId={loc} />

      {dash.loading && !dash.data ? <Loading /> : null}
      {dash.error ? <ErrorNote code={dash.error} onRetry={dash.reload} /> : null}
      {dash.data ? <Kpis d={dash.data} /> : null}
      <GeneratedAt iso={dash.data?.generated_at} />

      <Section
        title={t("overdue.title")}
        actions={
          <CsvButton report="overdue" params={{ location_id: locId }} tourId="rpt-overdue-csv" />
        }
      >
        <div id="rpt-overdue" />
        {overdue.error ? <ErrorNote code={overdue.error} onRetry={overdue.reload} /> : null}
        {overdue.data && overdue.data.data.length === 0 ? (
          <p className="muted">{t("overdue.empty")}</p>
        ) : null}
        {overdue.data && overdue.data.data.length > 0 ? (
          <OverdueTable rows={overdue.data.data} showLocation={!loc && locs.length > 1} />
        ) : null}
      </Section>

      <Section
        title={t("expiring.title")}
        actions={
          <CsvButton
            report="expiring"
            params={{ location_id: locId, days: 7 }}
            tourId="rpt-expiring-csv"
          />
        }
      >
        <div id="rpt-expiring" />
        <p className="help">{t("expiring.lede")}</p>
        {expiring.error ? <ErrorNote code={expiring.error} onRetry={expiring.reload} /> : null}
        {expiring.data && expiring.data.data.length === 0 ? (
          <p className="muted">{t("expiring.empty")}</p>
        ) : null}
        {expiring.data && expiring.data.data.length > 0 ? (
          <TableWrap label={t("expiring.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("expiring.col.member")}</th>
                  <th scope="col">{t("expiring.col.kind")}</th>
                  <th scope="col">{t("expiring.col.location")}</th>
                  <th scope="col">{t("expiring.col.expires")}</th>
                  <th scope="col" className="rpt-num">
                    {t("expiring.col.credits")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {expiring.data.data.map((r) => (
                  <tr key={`${r.kind}:${r.ref_id}`}>
                    <th scope="row">{r.full_name ?? t("common.memberElsewhere")}</th>
                    <td>{t(`kind.${r.kind}` as ReportsKey)}</td>
                    <td>{r.location_name ?? "—"}</td>
                    <td>{formatDateTime(r.expires_at, lang)}</td>
                    <td className="mono rpt-num">
                      {r.credits_remaining === null ? "—" : count(r.credits_remaining, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Section>

      <Section
        title={t("heat.title")}
        actions={
          <CsvButton
            report="heatmap"
            params={{ location_id: locId, weeks }}
            tourId="rpt-heatmap-csv"
          />
        }
      >
        <p className="help">{t("heat.lede")}</p>
        <fieldset className="rpt-segmented rpt-noprint">
          <legend>{t("heat.weeks")}</legend>
          {([4, 8] as const).map((w) => (
            <label key={w} className="rpt-segmented__opt">
              <input
                type="radio"
                name={weeksName}
                value={w}
                checked={weeks === w}
                onChange={() => setWeeks(w)}
                data-tour-id={`rpt-heatmap-weeks-${w}`}
              />
              {t(w === 4 ? "heat.weeks4" : "heat.weeks8")}
            </label>
          ))}
        </fieldset>
        {heat.loading && !heat.data ? <Loading /> : null}
        {heat.error ? <ErrorNote code={heat.error} onRetry={heat.reload} /> : null}
        {heat.data ? <Heatmap cells={heat.data.data} weeks={heat.data.weeks} /> : null}
      </Section>
    </div>
  );
}

function Kpis({ d }: { d: Dashboard }) {
  const { t, lang } = useReportsT();
  const n = (v: number | null | undefined) => count(v, lang);
  return (
    <div className="rpt-kpi-groups" data-tour-id="rpt-kpis">
      <KpiGroup title={t("panel.group.members")}>
        <Kpi label={t("kpi.membersActive")} value={n(d.members_active)} />
        <Kpi label={t("kpi.membersNew")} value={n(d.members_new_month)} />
        <Kpi
          label={t("kpi.membersCancelled")}
          value={n(d.members_cancelled_month)}
          hint={t("kpi.membersCancelledHint")}
        />
      </KpiGroup>
      <KpiGroup title={t("panel.group.attendance")}>
        <Kpi
          label={t("kpi.checkInsToday")}
          value={n(d.check_ins_today)}
          hint={t("kpi.checkInsTodayHint", { n: n(d.check_ins_members_today) })}
        />
        <Kpi label={t("kpi.checkInsWeek")} value={n(d.check_ins_week)} />
        <Kpi
          label={t("kpi.occupancy")}
          value={pct(d.class_occupancy_pct, lang)}
          hint={t("kpi.occupancyHint", {
            booked: n(d.class_booked_week),
            seats: n(d.class_seats_week),
            classes: n(d.classes_week),
          })}
        />
      </KpiGroup>
      <KpiGroup title={t("panel.group.sales")}>
        <Kpi
          label={t("kpi.sessionsSold")}
          value={n(d.sessions_sold_today)}
          hint={t("kpi.sessionsSoldHint")}
        />
        <Kpi
          label={t("kpi.invoiced")}
          value={money(d.invoiced_today_cents, lang)}
          hint={t("kpi.invoicedHint", { n: n(d.invoices_today) })}
        />
        <Kpi label={t("kpi.collected")} value={money(d.collected_today_cents, lang)} />
        <Kpi
          label={t("kpi.store")}
          value={money(d.store_sales_today_cents, lang)}
          hint={t("kpi.storeHint", { n: n(d.store_sales_today) })}
        />
      </KpiGroup>
      <KpiGroup title={t("panel.group.collections")}>
        <Kpi
          label={t("kpi.overdue")}
          value={money(d.overdue_balance_cents, lang)}
          hint={t("kpi.overdueHint", {
            members: n(d.overdue_members),
            invoices: n(d.overdue_invoices),
          })}
          to="#rpt-overdue"
          tone={d.overdue_balance_cents > 0 ? "warn" : undefined}
        />
        <Kpi
          label={t("kpi.expiringCredits")}
          value={n(d.expiring_credits_7d)}
          to="#rpt-expiring"
          tone={d.expiring_credits_7d > 0 ? "warn" : undefined}
        />
        <Kpi label={t("kpi.expiringPasses")} value={n(d.expiring_passes_7d)} to="#rpt-expiring" />
        <Kpi
          label={t("kpi.expiringMemberships")}
          value={n(d.expiring_memberships_7d)}
          to="#rpt-expiring"
          tone={d.expiring_memberships_7d > 0 ? "warn" : undefined}
        />
      </KpiGroup>
      <KpiGroup title={t("panel.group.growth")}>
        <Kpi label={t("kpi.leadsOpen")} value={n(d.leads_open)} to="/staff/crm/leads" />
        <Kpi
          label={t("kpi.conversion")}
          value={pct(d.lead_conversion_pct_month, lang)}
          hint={t("kpi.conversionHint", { won: n(d.leads_won_month), total: n(d.leads_new_month) })}
        />
        <Kpi
          label={t("kpi.lowStock")}
          value={n(d.low_stock_products)}
          to="/staff/store/inventory"
          tone={d.low_stock_products > 0 ? "warn" : undefined}
        />
      </KpiGroup>
      {d.points_liability !== undefined ? (
        <KpiGroup title={t("panel.group.points")}>
          <Kpi
            label={t("kpi.points")}
            value={n(d.points_liability)}
            hint={t("kpi.pointsHint", { n: n(d.points_members_with_balance) })}
          />
        </KpiGroup>
      ) : null}
    </div>
  );
}
