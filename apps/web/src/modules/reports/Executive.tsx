import { useMemo } from "react";
import { ErrorNote } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Executive as Exec, type ExecKpi, reportsApi } from "./api";
import { BarList, ChartFrame, ColumnChart, Donut, LineChart, Sparkline } from "./charts";
import { useReportsT } from "./dict";

type Lang = "es" | "en";
const locale = (lang: Lang) => (lang === "es" ? "es-PR" : "en-US");

export function moneyWhole(cents: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}
export function moneyCompact(cents: number, lang: Lang): string {
  const v = cents / 100;
  if (Math.abs(v) < 10_000) return moneyWhole(cents, lang);
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(v);
}
const int = (n: number, lang: Lang) => new Intl.NumberFormat(locale(lang)).format(n);

/** "2026-03" → "mar" / "Mar"; January also carries the year so the axis reads across a year boundary. */
export function monthLabel(ym: string, lang: Lang, withYear = false): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  const short = new Intl.DateTimeFormat(locale(lang), { month: "short", timeZone: "UTC" })
    .format(d)
    .replace(".", "");
  return withYear || m === 1 ? `${short} ${String(y).slice(2)}` : short;
}

/** Signed change vs the previous period; null when there is no baseline. */
export function delta(k: ExecKpi): number | null {
  if (!k.prev) return null;
  return (k.value - k.prev) / Math.abs(k.prev);
}

function Delta({ k, vs }: { k: ExecKpi; vs: string }) {
  const { t, lang } = useReportsT();
  const d = delta(k);
  if (d === null) return <span className="exec-delta exec-delta--flat">{t("exec.deltaNew")}</span>;
  const dir = Math.abs(d) < 0.0005 ? "flat" : d > 0 ? "up" : "down";
  const pct = new Intl.NumberFormat(locale(lang), {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(d);
  // Every KPI here is "up is good": direction and meaning travel together, and the arrow + sign carry it too.
  return (
    <span className={`exec-delta exec-delta--${dir}`}>
      <span aria-hidden="true">{dir === "up" ? "▲" : dir === "down" ? "▼" : "■"}</span>
      <span className="sr-only">{t(`exec.${dir}`)} </span>
      {pct} <span className="exec-delta__vs">{vs}</span>
    </span>
  );
}

function KpiTile({
  label,
  k,
  value,
  vs,
  tourId,
}: {
  label: string;
  k: ExecKpi;
  value: string;
  vs: string;
  tourId: string;
}) {
  return (
    <div className="exec-kpi" data-tour-id={tourId}>
      <dt className="exec-kpi__label">{label}</dt>
      <dd className="exec-kpi__value">{value}</dd>
      <dd className="exec-kpi__foot">
        <Delta k={k} vs={vs} />
        <Sparkline values={k.series} />
      </dd>
    </div>
  );
}

export function ExecutiveOverview({ locationId }: { locationId?: string }) {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const ex = useAsync(() => rpt.executive(locationId), [rpt, locationId]);
  return (
    <section className="exec" aria-labelledby="exec-title" data-tour-id="exec-overview">
      <div className="exec__head">
        <h2 id="exec-title" className="exec__title">
          {t("exec.title")}
        </h2>
        <span className="exec__sub">{t("exec.sub")}</span>
      </div>
      {ex.error ? <ErrorNote code={ex.error} onRetry={ex.reload} /> : null}
      {ex.loading && !ex.data ? <ExecSkeleton /> : null}
      {ex.data ? <ExecBody d={ex.data} lang={lang} /> : null}
    </section>
  );
}

function ExecSkeleton() {
  return (
    <div className="exec-kpis" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="exec-kpi exec-kpi--skeleton" />
      ))}
    </div>
  );
}

function ExecBody({ d, lang }: { d: Exec; lang: Lang }) {
  const { t } = useReportsT();
  const months = d.months.map((m, i) => monthLabel(m, lang, i === 0));
  const money = (c: number) => moneyWhole(c, lang);
  const axisMoney = (c: number) => moneyCompact(c, lang);
  const n = (v: number) => int(v, lang);
  const rev = d.revenue_vs_expenses.map((r) => r.revenue_cents);
  const exp = d.revenue_vs_expenses.map((r) => r.expenses_cents);
  const joins = d.new_members.map((r) => r.joins);
  const cancels = d.new_members.map((r) => r.cancellations);
  const st = d.member_status;
  const statusSlices = [
    { key: "active", label: t("exec.status.active"), value: st.active, color: "var(--viz-good)" },
    { key: "frozen", label: t("exec.status.frozen"), value: st.frozen, color: "var(--viz-info)" },
    { key: "expired", label: t("exec.status.expired"), value: st.expired, color: "var(--viz-bad)" },
    { key: "other", label: t("exec.status.other"), value: st.other, color: "var(--viz-other)" },
  ];
  const statusTotal = st.active + st.frozen + st.expired + st.other;
  const hasHistory = rev.some((v) => v > 0) || joins.some((v) => v > 0);
  const k = d.kpis;

  const monthTable = (cols: Array<{ h: string; v: (i: number) => string }>) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("exec.col.month")}</th>
            {cols.map((c) => (
              <th key={c.h} scope="col" className="rpt-num">
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.months.map((m, i) => (
            <tr key={m}>
              <th scope="row">{monthLabel(m, lang, true)}</th>
              {cols.map((c) => (
                <td key={c.h} className="rpt-num">
                  {c.v(i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <dl className="exec-kpis">
        <KpiTile
          label={t("exec.kpi.revenue")}
          k={k.revenue_month_cents}
          value={money(k.revenue_month_cents.value)}
          vs={t("exec.vsMonth")}
          tourId="exec-kpi-revenue"
        />
        <KpiTile
          label={t("exec.kpi.active")}
          k={k.active_members}
          value={n(k.active_members.value)}
          vs={t("exec.vsMonth")}
          tourId="exec-kpi-active"
        />
        <KpiTile
          label={t("exec.kpi.profit")}
          k={k.net_profit_month_cents}
          value={money(k.net_profit_month_cents.value)}
          vs={t("exec.vsMonth")}
          tourId="exec-kpi-profit"
        />
        <KpiTile
          label={t("exec.kpi.checkins")}
          k={k.checkins_today}
          value={n(k.checkins_today.value)}
          vs={t("exec.vsWeek")}
          tourId="exec-kpi-checkins"
        />
      </dl>

      {!hasHistory ? <p className="muted">{t("exec.empty")}</p> : null}

      <div className="exec-grid exec-grid--wide">
        <ChartFrame
          title={t("exec.chart.revenue")}
          subtitle={t("exec.chart.revenueSub")}
          tableLabel={t("exec.table")}
          table={monthTable([{ h: t("exec.series.revenue"), v: (i) => money(rev[i] ?? 0) }])}
        >
          <LineChart
            label={t("exec.chart.revenue")}
            categories={months}
            series={[
              { key: "rev", label: t("exec.series.revenue"), color: "var(--viz-1)", values: rev },
            ]}
            format={money}
            formatAxis={axisMoney}
            area
            height={240}
          />
        </ChartFrame>
        <ChartFrame
          title={t("exec.chart.status")}
          subtitle={t("exec.chart.statusSub")}
          tableLabel={t("exec.table")}
          table={
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("exec.col.status")}</th>
                    <th scope="col" className="rpt-num">
                      {t("exec.col.members")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statusSlices.map((s) => (
                    <tr key={s.key}>
                      <th scope="row">{s.label}</th>
                      <td className="rpt-num">{n(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        >
          <Donut
            label={t("exec.chart.status")}
            slices={statusSlices}
            total={statusTotal}
            centerLabel={t("exec.chart.statusCenter")}
            format={n}
          />
        </ChartFrame>
      </div>

      <div className="exec-grid exec-grid--three">
        <ChartFrame
          title={t("exec.chart.growth")}
          subtitle={t("exec.chart.growthSub")}
          legend={[
            { label: t("exec.series.joins"), color: "var(--viz-1)", shape: "box" },
            { label: t("exec.series.cancellations"), color: "var(--viz-2)", shape: "box" },
          ]}
          tableLabel={t("exec.table")}
          table={monthTable([
            { h: t("exec.series.joins"), v: (i) => n(joins[i] ?? 0) },
            { h: t("exec.series.cancellations"), v: (i) => n(cancels[i] ?? 0) },
          ])}
        >
          <ColumnChart
            label={t("exec.chart.growth")}
            categories={months}
            series={[
              { key: "j", label: t("exec.series.joins"), color: "var(--viz-1)", values: joins },
              {
                key: "c",
                label: t("exec.series.cancellations"),
                color: "var(--viz-2)",
                values: cancels,
              },
            ]}
            format={n}
          />
        </ChartFrame>
        <ChartFrame
          title={t("exec.chart.rve")}
          subtitle={t("exec.chart.rveSub")}
          legend={[
            { label: t("exec.series.revenue"), color: "var(--viz-1)" },
            { label: t("exec.series.expenses"), color: "var(--viz-2)" },
          ]}
          tableLabel={t("exec.table")}
          table={monthTable([
            { h: t("exec.series.revenue"), v: (i) => money(rev[i] ?? 0) },
            { h: t("exec.series.expenses"), v: (i) => money(exp[i] ?? 0) },
          ])}
        >
          <LineChart
            label={t("exec.chart.rve")}
            categories={months}
            series={[
              { key: "rev", label: t("exec.series.revenue"), color: "var(--viz-1)", values: rev },
              { key: "exp", label: t("exec.series.expenses"), color: "var(--viz-2)", values: exp },
            ]}
            format={money}
            formatAxis={axisMoney}
            height={200}
          />
        </ChartFrame>
        <ChartFrame
          title={t("exec.chart.mix")}
          subtitle={t("exec.chart.mixSub")}
          tableLabel={t("exec.table")}
          table={
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("exec.col.product")}</th>
                    <th scope="col" className="rpt-num">
                      {t("exec.col.units")}
                    </th>
                    <th scope="col" className="rpt-num">
                      {t("exec.series.revenue")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.sales_mix.map((r) => (
                    <tr key={r.kind}>
                      <th scope="row">{lang === "es" ? r.label_es : r.label_en}</th>
                      <td className="rpt-num">{n(r.units)}</td>
                      <td className="rpt-num">{money(r.revenue_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        >
          <BarList
            rows={d.sales_mix.map((r) => ({
              key: r.kind,
              label: lang === "es" ? r.label_es : r.label_en,
              value: r.revenue_cents,
              note: t("exec.units", { n: n(r.units) }),
            }))}
            format={money}
          />
        </ChartFrame>
      </div>
    </>
  );
}
