import { useId } from "react";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useApi } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { memberAgreements } from "./api";
import { type SignupKey, dict } from "./dict";

/** Member record tab: accepted terms and liability release (not health data; front desk may read it). */
export function AgreementsTab({ memberId }: { memberId: string }) {
  const api = useApi();
  const { t, lang } = useModuleT(dict);
  const list = useAsync(() => memberAgreements(api, memberId), [api, memberId]);
  const rows = list.data?.data ?? [];
  const titleId = useId();
  const label = (prefix: string, v: string) => {
    const k = `${prefix}.${v}` as SignupKey;
    return k in dict.es ? t(k) : v;
  };
  return (
    <section className="section" aria-labelledby={titleId}>
      <h3 className="section__title" id={titleId}>
        <Icon name="doc" size={24} />
        {t("ag.title")}
      </h3>
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && rows.length === 0 ? (
        <div className="ds-empty">
          <Icon name="doc" size={36} />
          <strong>{t("ag.none")}</strong>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <TableWrap label={t("ag.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("ag.col.kind")}</th>
                <th scope="col">{t("ag.col.version")}</th>
                <th scope="col">{t("ag.col.source")}</th>
                <th scope="col">{t("ag.col.date")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{label("ag.kind", a.kind)}</th>
                  <td className="mono">{a.version}</td>
                  <td>{label("ag.source", a.source)}</td>
                  <td className="nowrap">{formatDateTime(a.accepted_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </section>
  );
}
