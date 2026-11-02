import { ErrorNote, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { shortId } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";

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
        <dl className="facts">
          <div>
            <dt>{t("org.name")}</dt>
            <dd>{m.organization.name}</dd>
          </div>
          {staff ? (
            <div>
              <dt>{t("org.plan")}</dt>
              <dd className="mono">{m.organization.saas_plan}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("org.role")}</dt>
            <dd>{tv("role", m.role, t("role.unknown", { role: m.role }))}</dd>
          </div>
          <div>
            <dt>{t("org.email")}</dt>
            <dd className="mono">{m.person.email}</dd>
          </div>
          {staff ? (
            <div>
              <dt>{t("org.locations")}</dt>
              <dd>
                {m.location_ids.length === 0
                  ? t("org.allLocations")
                  : m.location_ids.map((id) => names.get(id) ?? shortId(id)).join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </>
  );
}

export function OrgScreen() {
  const { t } = useI18n();
  return (
    <div className="page">
      <h1 className="page__title">{t("org.title")}</h1>
      <MeSummary staff />
    </div>
  );
}
