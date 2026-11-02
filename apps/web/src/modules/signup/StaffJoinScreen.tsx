import { useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useApi, useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { type JoinLocation, joinLocations, setJoinLocation } from "./api";
import { dict } from "./dict";

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
      <h1 className="page__title">{t("staff.title")}</h1>
      <p className="lede">{t("staff.lede")}</p>
      {publicLink ? (
        <p>
          {t("staff.link")}: <span className="mono">{publicLink}</span>
        </p>
      ) : null}
      <LiveResult tone={saved ? "ok" : undefined}>
        {saved}
        {error ? <ErrorNote code={error} /> : null}
      </LiveResult>
      <Section title={t("staff.col.status")}>
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && rows.length === 0 ? <p className="muted">{t("staff.none")}</p> : null}
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
      </Section>
    </div>
  );
}
