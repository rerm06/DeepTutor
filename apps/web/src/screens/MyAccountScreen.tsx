import { useMemo } from "react";
import { ErrorNote, Loading, Plate, Section, TableWrap, memberStatusTone } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { MeSummary } from "./OrgScreen";

export function MyAccountScreen() {
  const { t, tv } = useI18n();
  const { api } = useSession();
  // Members and guardians only get back their own (or their wards') records.
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const locName = useMemo(
    () => new Map((locations.data?.data ?? []).map((l) => [l.id, l.name])),
    [locations.data],
  );
  const rows = members.data?.data ?? [];

  return (
    <div className="page">
      <h1 className="page__title">{t("account.title")}</h1>
      <MeSummary staff={false} />
      <Section title={t("account.memberships")}>
        {members.loading ? <Loading /> : null}
        {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
        {members.data && rows.length === 0 ? (
          <p className="muted">{t("account.noMemberships")}</p>
        ) : null}
        {rows.length > 0 ? (
          <TableWrap label={t("account.memberships")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("members.col.name")}</th>
                  <th scope="col">{t("members.col.no")}</th>
                  <th scope="col">{t("members.col.location")}</th>
                  <th scope="col">{t("members.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.full_name}</th>
                    <td className="mono">{m.member_no ?? ""}</td>
                    <td>{locName.get(m.home_location_id) ?? ""}</td>
                    <td>
                      <Plate tone={memberStatusTone(m.status)}>{tv("status", m.status)}</Plate>
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
