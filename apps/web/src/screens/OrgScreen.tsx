import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/icons";
import { ErrorNote, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { shortId } from "../lib/format";
import { ROUTES, navFor } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { Card, Stat, useCoreCopy } from "./kit";

/** /me summary. Shared by the staff Organization screen and the member's account screen. */
export function MeSummary({ staff }: { staff: boolean }) {
  const { t, tv } = useI18n();
  const { api } = useSession();
  const me = useAsync(() => api.me(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const names = new Map((locations.data?.data ?? []).map((l) => [l.id, l.name]));
  const m = me.data;

  return (
    <>
      {me.loading ? <Loading /> : null}
      {me.error ? <ErrorNote code={me.error} onRetry={me.reload} /> : null}
      {m ? (
        <div className="ds-stats core-facts">
          <Stat icon="building" label={t("org.name")} value={m.organization.name} />
          {staff ? (
            <Stat icon="layers" label={t("org.plan")} value={m.organization.saas_plan} mono />
          ) : null}
          <Stat
            icon="users"
            label={t("org.role")}
            value={tv("role", m.role, t("role.unknown", { role: m.role }))}
          />
          <Stat icon="mail" label={t("org.email")} value={m.person.email} mono />
          {staff ? (
            <Stat
              icon="pin"
              label={t("org.locations")}
              value={
                m.location_ids.length === 0
                  ? t("org.allLocations")
                  : m.location_ids.map((id) => names.get(id) ?? shortId(id)).join(", ")
              }
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export const ICON_FOR: Record<string, IconName> = {
  [ROUTES.members]: "users",
  [ROUTES.inbox]: "chat",
  [ROUTES.audit]: "doc",
  [ROUTES.myAccount]: "home",
  [ROUTES.myConsents]: "checkCircle",
};

export function OrgScreen() {
  const { t } = useI18n();
  const c = useCoreCopy();
  const { role } = useSession();
  const shortcuts = navFor(role).filter((n) => n.to !== ROUTES.org);
  return (
    <div className="page core-page">
      <header className="core-head">
        <h1 className="page__title">{t("org.title")}</h1>
        <p className="lede">{c("org.lede")}</p>
      </header>
      <MeSummary staff />
      {shortcuts.length > 0 ? (
        <Card icon="grid" title={c("org.shortcuts")}>
          <div className="ds-tiles">
            {shortcuts.map((n) => (
              <Link key={n.to} className="ds-tile" to={n.to}>
                <Icon name={ICON_FOR[n.to] ?? "arrowRight"} size={40} />
                <span>{t(n.label)}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
