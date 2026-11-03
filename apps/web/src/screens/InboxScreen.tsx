import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorNote, Loading, Plate, TableWrap } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime } from "../lib/format";
import { ROUTES } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { Card, Empty, Stat, useCoreCopy } from "./kit";

export function InboxScreen() {
  const { t, tv, lang } = useI18n();
  const c = useCoreCopy();
  const { api } = useSession();
  const [locationId, setLocationId] = useState("");
  const locations = useAsync(() => api.locations(), [api]);
  const inbox = useAsync(() => api.inbox(locationId || undefined), [api, locationId]);
  const filterId = useId();
  const locs = locations.data?.data ?? [];
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const rows = inbox.data?.data ?? [];
  const pending = rows.filter((m) => !m.handled).length;

  return (
    <div className="page core-page">
      <header className="core-head">
        <h1 className="page__title">{t("inbox.title")}</h1>
        <p className="lede">{c("inbox.lede")}</p>
      </header>
      {inbox.data ? (
        <div className="ds-stats">
          <Stat icon="inbox" label={c("inbox.total")} value={rows.length} />
          <Stat icon="clock" label={t("inbox.pending")} value={pending} />
          <Stat icon="checkCircle" label={t("inbox.handled")} value={rows.length - pending} />
        </div>
      ) : null}
      <Card icon="inbox" title={c("inbox.messages")}>
        <div className="toolbar">
          <div className="field">
            <label htmlFor={filterId}>{t("members.filterLocation")}</label>
            <select
              id={filterId}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t("common.all")}</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {inbox.loading ? <Loading /> : null}
        {inbox.error ? <ErrorNote code={inbox.error} onRetry={inbox.reload} /> : null}
        {inbox.data && rows.length === 0 ? (
          <Empty
            icon="inbox"
            title={t("inbox.empty")}
            action={
              <Link className="btn" to={ROUTES.members}>
                {c("inbox.toMembers")}
              </Link>
            }
          />
        ) : null}
        {rows.length > 0 ? (
          <TableWrap label={t("inbox.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("inbox.col.received")}</th>
                  <th scope="col">{t("inbox.col.channel")}</th>
                  <th scope="col">{t("inbox.col.from")}</th>
                  <th scope="col">{t("inbox.col.body")}</th>
                  <th scope="col">{t("members.col.location")}</th>
                  <th scope="col">{t("inbox.col.member")}</th>
                  <th scope="col">{t("inbox.col.handled")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDateTime(m.received_at, lang)}</td>
                    <td>{tv("channel", m.channel)}</td>
                    <td className="mono">{m.from_address}</td>
                    <td className="cell-body">{m.body}</td>
                    <td>{locName.get(m.location_id) ?? ""}</td>
                    <td>
                      {m.member_id ? (
                        <Link to={ROUTES.member(m.member_id)}>{t("common.open")}</Link>
                      ) : (
                        t("common.none")
                      )}
                    </td>
                    <td>
                      <Plate tone={m.handled ? "ok" : "warn"}>
                        {m.handled ? t("inbox.handled") : t("inbox.pending")}
                      </Plate>
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
