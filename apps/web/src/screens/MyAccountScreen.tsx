import { useMemo } from "react";
import { Link } from "react-router-dom";
import { MemberPhotoCard } from "../components/MemberPhotoCard";
import { Icon, type IconName } from "../components/icons";
import { ErrorNote, Loading, Plate, memberStatusTone } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { useNavTargets } from "../lib/navTargets";
import { ROUTES } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { MeSummary } from "./OrgScreen";
import { Card, type CoreKey, Empty, initialsOf, useCoreCopy } from "./kit";

/* Shortcuts shown only when the signed-in role can open the route (core routes always). */
const SHORTCUTS: ReadonlyArray<readonly [string, IconName, CoreKey | "nav.myConsents"]> = [
  ["/me/home", "grid", "account.home"],
  ["/me/classes", "calendar", "account.classes"],
  ["/me/credential", "qr", "account.credential"],
  [ROUTES.myConsents, "checkCircle", "nav.myConsents"],
];

export function MyAccountScreen() {
  const { t, tv } = useI18n();
  const c = useCoreCopy();
  const { api } = useSession();
  const targets = useNavTargets();
  // Members and guardians only get back their own (or their wards') records.
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const locName = useMemo(
    () => new Map((locations.data?.data ?? []).map((l) => [l.id, l.name])),
    [locations.data],
  );
  const rows = members.data?.data ?? [];
  const shortcuts = SHORTCUTS.filter(([to]) => to === ROUTES.myConsents || targets.has(to));

  return (
    <div className="page core-page">
      <header className="core-head">
        <h1 className="page__title">{t("account.title")}</h1>
        <p className="lede">{c("account.lede")}</p>
      </header>
      <MeSummary staff={false} />
      <Card icon="userPlus" title={c("account.photo")}>
        <MemberPhotoCard memberId={null} />
      </Card>
      <Card icon="idCard" title={t("account.memberships")}>
        {members.loading ? <Loading /> : null}
        {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
        {members.data && rows.length === 0 ? (
          <Empty icon="idCard" title={t("account.noMemberships")} />
        ) : null}
        {rows.length > 0 ? (
          <ul className="ds-grid core-cards" aria-label={t("account.memberships")}>
            {rows.map((m) => (
              <li key={m.id} className="core-card">
                <span className="avatar core-card__avatar" aria-hidden="true">
                  {initialsOf(m.full_name)}
                </span>
                <dl className="core-card__body">
                  <dt className="sr-only">{t("members.col.name")}</dt>
                  <dd className="core-card__name">{m.full_name}</dd>
                  <dt className="sr-only">{t("members.col.no")}</dt>
                  <dd className="mono">{m.member_no ?? t("common.none")}</dd>
                  <dt className="sr-only">{t("members.col.location")}</dt>
                  <dd className="muted">{locName.get(m.home_location_id) ?? t("common.none")}</dd>
                  <dt className="sr-only">{t("members.col.status")}</dt>
                  <dd>
                    <Plate tone={memberStatusTone(m.status)}>{tv("status", m.status)}</Plate>
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {shortcuts.length > 0 ? (
        <Card icon="grid" title={c("account.shortcuts")}>
          <div className="ds-tiles">
            {shortcuts.map(([to, icon, key]) => (
              <Link key={to} className="ds-tile" to={to}>
                <Icon name={icon} size={40} />
                <span>{key === "nav.myConsents" ? t(key) : c(key)}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
