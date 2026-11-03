import { useId, useState } from "react";
import { ErrorNote, Loading, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { PnlRow } from "./api";
import { type FinKey, useFinT } from "./dict";
import { FinSection, FinStat, money, thisMonth, useFin } from "./shared";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type Metric = keyof Omit<PnlRow, "location_id" | "location_name">;
/** Statement layout: detail lines indented, subtotals ruled above, the net result double-ruled. */
const ROWS: { key: Metric; kind: "line" | "subtotal" | "total" }[] = [
  { key: "membership_revenue_cents", kind: "line" },
  { key: "other_billing_revenue_cents", kind: "line" },
  { key: "store_revenue_cents", kind: "line" },
  { key: "revenue_cents", kind: "subtotal" },
  { key: "expenses_cents", kind: "line" },
  { key: "bills_cents", kind: "line" },
  { key: "commissions_cents", kind: "line" },
  { key: "platform_fees_cents", kind: "line" },
  { key: "costs_cents", kind: "subtotal" },
  { key: "net_cents", kind: "total" },
];
const ROW_CLASS = {
  line: "fin-line",
  subtotal: "fin-strong fin-subtotal",
  total: "fin-strong fin-total",
};
const CASH: Metric[] = ["cash_in_cents", "cash_out_cents"];

/** P&L by location and consolidated for one month (accrual), plus the cash view and liabilities. */
export function PnlTab() {
  const { t, lang } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const monthId = useId();
  const valid = MONTH_RE.test(month);
  const pnl = useAsync(() => (valid ? fin.pnl(month) : Promise.resolve(null)), [fin, month, valid]);
  const liab = useAsync(() => fin.liabilities(), [fin]);
  const cols: { id: string; name: string; row: PnlRow }[] = [];
  if (pnl.data) {
    for (const l of pnl.data.locations)
      cols.push({ id: l.location_id ?? "", name: l.location_name ?? "", row: l });
    if (pnl.data.locations.length > 1)
      cols.push({ id: "all", name: t("pnl.consolidated"), row: pnl.data.consolidated });
  }

  const sum = pnl.data?.consolidated;
  const sumHint =
    pnl.data && pnl.data.locations.length > 1
      ? t("pnl.consolidated")
      : (pnl.data?.locations[0]?.location_name ?? undefined);

  return (
    <>
      {sum ? (
        <div className="ds-stats fin-stats-row">
          <FinStat
            icon="coin"
            label={t("pnl.revenue_cents")}
            value={money(sum.revenue_cents, lang)}
            hint={sumHint}
          />
          <FinStat
            icon="receipt"
            label={t("pnl.costs_cents")}
            value={money(sum.costs_cents, lang)}
            hint={sumHint}
          />
          <FinStat
            icon="chart"
            label={t("pnl.net_cents")}
            value={money(sum.net_cents, lang)}
            hint={sumHint}
          />
        </div>
      ) : null}
      <FinSection icon="doc" title={t("pnl.title")}>
        <div className="toolbar">
          <div className="field field--inline">
            <label htmlFor={monthId}>{t("pnl.month")}</label>
            <input
              id={monthId}
              type="month"
              value={month}
              max="2100-12"
              onChange={(e) => setMonth(e.target.value)}
              data-tour-id="fin-pnl-month"
            />
          </div>
        </div>
        {!valid ? <p className="field-error">{t("pnl.badMonth")}</p> : null}
        {pnl.loading ? <Loading /> : null}
        {pnl.error ? <ErrorNote code={pnl.error} onRetry={pnl.reload} /> : null}
        {pnl.data ? (
          <TableWrap label={t("pnl.title")}>
            <table className="table fin-statement fin-pnl" data-testid="fin-pnl">
              <caption className="sr-only">{t("pnl.caption", { month })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("pnl.line")}</th>
                  {cols.map((c) => (
                    <th scope="col" key={c.id} className="fin-num">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key} className={ROW_CLASS[r.kind]}>
                    <th scope="row">{t(`pnl.${r.key}` as FinKey)}</th>
                    {cols.map((c) => (
                      <td key={c.id} className="fin-num">
                        {money(c.row[r.key], lang)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        <p className="help">{t("pnl.basisNote")}</p>
      </FinSection>

      {pnl.data ? (
        <FinSection icon="card" title={t("pnl.cashTitle")} level={3}>
          <TableWrap label={t("pnl.cashTitle")}>
            <table className="table fin-statement">
              <thead>
                <tr>
                  <th scope="col">{t("pnl.line")}</th>
                  {cols.map((c) => (
                    <th scope="col" key={c.id} className="fin-num">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CASH.map((k) => (
                  <tr key={k}>
                    <th scope="row">{t(`pnl.${k}` as FinKey)}</th>
                    {cols.map((c) => (
                      <td key={c.id} className="fin-num">
                        {money(c.row[k], lang)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="help">{t("pnl.cashNote")}</p>
        </FinSection>
      ) : null}

      <FinSection icon="layers" title={t("liab.title")} level={3}>
        {liab.loading ? <Loading /> : null}
        {liab.error ? <ErrorNote code={liab.error} onRetry={liab.reload} /> : null}
        {liab.data ? (
          <dl className="fin-figures">
            <div>
              <dt>{t("liab.prepaid")}</dt>
              <dd>{money(liab.data.totals.prepaid_periods_cents, lang)}</dd>
            </div>
            <div>
              <dt>{t("liab.credits")}</dt>
              <dd>{money(liab.data.totals.unused_credits_cents, lang)}</dd>
            </div>
            {liab.data.points ? (
              <div>
                <dt>{t("liab.points")}</dt>
                <dd>
                  {t("liab.pointsValue", {
                    points: liab.data.points.outstanding_points,
                    members: liab.data.points.members_with_balance,
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <p className="help">
          {t("liab.note")}
          {role === "location_manager" ? ` ${t("liab.managerNote")}` : ""}
        </p>
      </FinSection>
    </>
  );
}
