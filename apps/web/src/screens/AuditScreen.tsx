import { useMemo } from "react";
import { ErrorNote, Loading, TableWrap } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime, shortId } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { Card, Empty, Stat, useCoreCopy } from "./kit";

export function AuditScreen() {
  const { t, tv, lang } = useI18n();
  const c = useCoreCopy();
  const { api } = useSession();
  const audit = useAsync(() => api.auditLog(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const locName = useMemo(
    () => new Map((locations.data?.data ?? []).map((l) => [l.id, l.name])),
    [locations.data],
  );
  const rows = audit.data?.data ?? [];
  const latest = rows.reduce<string | null>(
    (max, a) => (!max || Date.parse(a.at) > Date.parse(max) ? a.at : max),
    null,
  );

  return (
    <div className="page core-page">
      <header className="core-head">
        <h1 className="page__title">{t("audit.title")}</h1>
        <p className="lede">{c("audit.lede")}</p>
      </header>
      {rows.length > 0 ? (
        <div className="ds-stats core-facts">
          <Stat icon="history" label={c("audit.entries")} value={rows.length} />
          {latest ? (
            <Stat icon="clock" label={c("audit.latest")} value={formatDateTime(latest, lang)} />
          ) : null}
        </div>
      ) : null}
      <Card icon="shield" title={c("audit.log")}>
        {audit.loading ? <Loading /> : null}
        {audit.error ? <ErrorNote code={audit.error} onRetry={audit.reload} /> : null}
        {audit.data && rows.length === 0 ? <Empty icon="history" title={t("audit.empty")} /> : null}
        {rows.length > 0 ? (
          <TableWrap label={t("audit.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("audit.col.at")}</th>
                  <th scope="col">{t("audit.col.actor")}</th>
                  <th scope="col">{t("audit.col.action")}</th>
                  <th scope="col">{t("audit.col.entity")}</th>
                  <th scope="col">{t("audit.col.entityId")}</th>
                  <th scope="col">{t("audit.col.location")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{formatDateTime(a.at, lang)}</td>
                    <td>{tv("role", a.actor_role)}</td>
                    <td className="mono">{a.action}</td>
                    <td className="mono">{a.entity}</td>
                    <td className="mono" title={a.entity_id}>
                      {shortId(a.entity_id)}
                    </td>
                    <td>
                      {a.location_id ? (locName.get(a.location_id) ?? shortId(a.location_id)) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
    </div>
  );
}
