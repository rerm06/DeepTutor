import { useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import type { JournalExport } from "./api";
import { useFinT } from "./dict";
import { FinEmpty, FinSection, act, downloadCsv, money, thisMonth, useFin } from "./shared";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "Exportar": monthly summarised journal as CSV (QuickBooks Online layout), with its history. */
export function ExportTab() {
  const { t, lang } = useFinT();
  const fin = useFin();
  const [month, setMonth] = useState(thisMonth());
  const [version, setVersion] = useState(0);
  const list = useAsync(() => fin.exports(), [fin, version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [last, setLast] = useState<JournalExport | null>(null);
  const monthId = useId();
  const set = { busy: setBusy, error: setError, announce: setAnnounce };

  async function generate() {
    if (!MONTH_RE.test(month) || month > thisMonth()) return setError("invalid_input");
    const ok = await act(set, async () => {
      const ex = await fin.generateExport(month);
      setLast(ex);
      if (ex.csv) downloadCsv(ex.filename, ex.csv);
      return t("exp.generated", {
        file: ex.filename,
        lines: ex.line_count,
        total: money(ex.debit_total_cents, lang),
      });
    });
    if (ok) setVersion((v) => v + 1);
  }
  async function download(id: string) {
    await act(set, async () => {
      const ex = await fin.getExport(id);
      if (ex.csv) downloadCsv(ex.filename, ex.csv);
      return t("exp.downloaded", { file: ex.filename });
    });
  }

  return (
    <>
      <FinSection icon="download" title={t("exp.title")}>
        <p className="help">{t("exp.help")}</p>
        <div className="toolbar">
          <div className="field field--inline">
            <label htmlFor={monthId}>{t("pnl.month")}</label>
            <input
              id={monthId}
              type="month"
              value={month}
              max={thisMonth()}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={generate}
            disabled={busy}
            data-tour-id="fin-export-generate"
          >
            <Icon name="download" size={18} />
            {t("exp.generate")}
          </button>
        </div>
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error ? <ErrorNote code={error} /> : null}
        {last?.csv ? (
          <details className="fin-preview">
            <summary>{t("exp.preview")}</summary>
            <pre className="mono" data-testid="fin-csv-preview">
              {last.csv}
            </pre>
          </details>
        ) : null}
        <ul className="fin-notes">
          <li>{t("exp.noteQbo")}</li>
          <li>{t("exp.noteXero")}</li>
          <li>{t("exp.notePayroll")}</li>
          <li>{t("exp.noteCpa")}</li>
        </ul>
      </FinSection>
      <FinSection icon="folder" title={t("exp.history")} level={3}>
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length > 0 ? (
          <TableWrap label={t("exp.history")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("exp.period")}</th>
                  <th scope="col">{t("exp.generatedAt")}</th>
                  <th scope="col" className="fin-num">
                    {t("exp.lines")}
                  </th>
                  <th scope="col" className="fin-num">
                    {t("exp.debits")}
                  </th>
                  <th scope="col">{t("ap.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((x) => (
                  <tr key={x.id}>
                    <th scope="row" className="mono">
                      {x.period.slice(0, 7)}
                    </th>
                    <td>{formatDateTime(x.generated_at, lang)}</td>
                    <td className="fin-num">{x.line_count}</td>
                    <td className="fin-num fin-amount">{money(x.debit_total_cents, lang)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => download(x.id)}
                        aria-label={t("exp.downloadLabel", { file: x.filename })}
                      >
                        <Icon name="download" size={18} />
                        {t("exp.download")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        {list.data && list.data.data.length === 0 ? (
          <FinEmpty icon="folder" text={t("exp.empty")} />
        ) : null}
      </FinSection>
    </>
  );
}
