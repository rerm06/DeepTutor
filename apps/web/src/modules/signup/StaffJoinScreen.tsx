import { useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useApi, useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { type JoinLocation, joinLocations, setJoinLocation } from "./api";
import { dict } from "./dict";

const LINK_ICON =
  "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1";

/** Owner and location managers: which locations accept online sign-ups (audited in SQL). */
export function StaffJoinScreen() {
  const api = useApi();
  const { me } = useSession();
  const { t } = useModuleT(dict);
  const publicLink = me ? `${window.location.origin}/join/${me.organization.id}` : null;
  const list = useAsync(() => joinLocations(api), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rows = list.data?.data ?? [];
  const open = rows.filter((l) => l.enabled).length;

  async function toggle(l: JoinLocation) {
    setBusy(l.id);
    setError(null);
    setSaved(null);
    try {
      await setJoinLocation(api, l.id, !l.enabled);
      setSaved(
        t("staff.saved", {
          name: l.name,
          state: t(l.enabled ? "staff.off" : "staff.on").toLowerCase(),
        }),
      );
      list.reload();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="page__head">
        <div className="join-staff__head">
          <h1 className="page__title">{t("staff.title")}</h1>
          <p className="lede">{t("staff.lede")}</p>
        </div>
        {me ? (
          <Link className="ds-cta" to={`/join/${me.organization.id}`}>
            {t("staff.preview")}
            <Icon name="arrowRight" size={18} />
          </Link>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <div className="ds-stats">
          <div className="ds-stat">
            <Icon name="checkCircle" size={32} />
            <span className="ds-stat__text">
              <span className="ds-stat__label">{t("staff.stat.open")}</span>
              <span className="ds-stat__value">{open}</span>
              <span className="ds-stat__hint">{t("staff.stat.of", { n: rows.length })}</span>
            </span>
          </div>
          <div className="ds-stat">
            <Icon name="building" size={32} />
            <span className="ds-stat__text">
              <span className="ds-stat__label">{t("staff.stat.closed")}</span>
              <span className="ds-stat__value">{rows.length - open}</span>
              <span className="ds-stat__hint">{t("staff.stat.of", { n: rows.length })}</span>
            </span>
          </div>
        </div>
      ) : null}
      {publicLink ? (
        <section className="section" aria-labelledby="join-staff-link">
          <h2 className="section__title" id="join-staff-link">
            <Icon d={LINK_ICON} size={24} />
            {t("staff.link")}
          </h2>
          <p className="mono join-staff__url">{publicLink}</p>
        </section>
      ) : null}
      <LiveResult tone={saved ? "ok" : undefined}>
        {saved}
        {error ? <ErrorNote code={error} /> : null}
      </LiveResult>
      <section className="section" aria-labelledby="join-staff-list">
        <h2 className="section__title" id="join-staff-list">
          <Icon name="pin" size={24} />
          {t("staff.col.status")}
        </h2>
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && rows.length === 0 ? (
          <div className="ds-empty">
            <Icon name="building" size={36} />
            <strong>{t("staff.none")}</strong>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <TableWrap label={t("staff.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("staff.col.location")}</th>
                  <th scope="col">{t("staff.col.status")}</th>
                  <th scope="col">{t("staff.col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      {l.name}
                      {l.municipality ? <span className="muted"> · {l.municipality}</span> : null}
                    </th>
                    <td>
                      <Plate tone={l.enabled ? "ok" : "neutral"}>
                        {t(l.enabled ? "staff.on" : "staff.off")}
                      </Plate>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        data-tour-id="join-location-toggle"
                        disabled={busy !== null}
                        aria-busy={busy === l.id}
                        onClick={() => toggle(l)}
                      >
                        {t(l.enabled ? "staff.close" : "staff.open", { name: l.name })}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </section>
    </div>
  );
}
