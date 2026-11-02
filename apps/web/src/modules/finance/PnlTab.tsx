import { useId, useState } from "react";
import { ErrorNote, Loading, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { PnlRow } from "./api";
import { type FinKey, useFinT } from "./dict";
import { money, thisMonth, useFin } from "./shared";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type Metric = keyof Omit<PnlRow, "location_id" | "location_name">;
const ROWS: { key: Metric; strong?: boolean }[] = [
  { key: "membership_revenue_cents" },
  { key: "other_billing_revenue_cents" },
  { key: "store_revenue_cents" },
  { key: "revenue_cents", strong: true },
  { key: "expenses_cents" },
  { key: "bills_cents" },
  { key: "commissions_cents" },
  { key: "platform_fees_cents" },
  { key: "costs_cents", strong: true },
  { key: "net_cents", strong: true },
];
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

  return (
    <>
      <Section title={t("pnl.title")}>
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
            <table className="table fin-pnl" data-testid="fin-pnl">
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
                  <tr key={r.key} className={r.strong ? "fin-strong" : undefined}>
                    <th scope="row">{t(`pnl.${r.key}` as FinKey)}</th>
                    {cols.map((c) => (
                      <td key={c.id} className="fin-num mono">
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
      </Section>

      {pnl.data ? (
        <Section title={t("pnl.cashTitle")} level={3}>
          <TableWrap label={t("pnl.cashTitle")}>
            <table className="table">
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
                      <td key={c.id} className="fin-num mono">
                        {money(c.row[k], lang)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="help">{t("pnl.cashNote")}</p>
        </Section>
      ) : null}

      <Section title={t("liab.title")} level={3}>
        {liab.loading ? <Loading /> : null}
        {liab.error ? <ErrorNote code={liab.error} onRetry={liab.reload} /> : null}
        {liab.data ? (
          <dl className="facts fin-stats">
            <div>
              <dt>{t("liab.prepaid")}</dt>
              <dd className="mono">{money(liab.data.totals.prepaid_periods_cents, lang)}</dd>
            </div>
            <div>
              <dt>{t("liab.credits")}</dt>
              <dd className="mono">{money(liab.data.totals.unused_credits_cents, lang)}</dd>
            </div>
            {liab.data.points ? (
              <div>
                <dt>{t("liab.points")}</dt>
                <dd className="mono">
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
      </Section>
    </>
  );
}
