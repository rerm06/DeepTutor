import { useId, useMemo, useState } from "react";
import { ConsentPanel } from "../components/ConsentPanel";
import { ErrorNote, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { brandsFor } from "../lib/brands";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";

export function MyConsentsScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const members = useAsync(() => api.members(), [api]);
  // Members may not be allowed to list locations; the panel then falls back to brands on file.
  const locations = useAsync(() => api.locations(), [api]);
  const [chosen, setChosen] = useState("");
  const selectId = useId();

  const rows = members.data?.data ?? [];
  const member = rows.find((m) => m.id === chosen) ?? rows[0] ?? null;
  const locs = locations.data?.data ?? [];
  const brands = useMemo(
    () =>
      member
        ? brandsFor(locs, [member.home_location_id], (names) =>
            t("member.brandOf", { locations: names }),
          )
        : [],
    [locs, member, t],
  );

  return (
    <div className="page">
      <h1 className="page__title">{t("myConsents.title")}</h1>
      <p className="lede">{t("myConsents.intro")}</p>
      {members.loading ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {members.data && rows.length === 0 ? (
        <p className="muted">{t("account.noMemberships")}</p>
      ) : null}
      {rows.length > 1 ? (
        <div className="field field--inline">
          <label htmlFor={selectId}>{t("account.chooseMember")}</label>
          <select
            id={selectId}
            value={member?.id ?? ""}
            onChange={(e) => setChosen(e.target.value)}
          >
            {rows.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {member ? (
        <ConsentPanel key={member.id} memberId={member.id} brands={brands} mode="member" canEdit />
      ) : null}
    </div>
  );
}
