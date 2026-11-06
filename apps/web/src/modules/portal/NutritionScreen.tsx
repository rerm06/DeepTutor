import { ErrorNote, Loading, Section } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { usePortalApi } from "./api";
import { usePortalT } from "./dict";
import "./portal.css";

/**
 * Member portal "Nutrición": the member's PUBLISHED eating plan, written and approved by the licensed nutrition
 * specialist (name and licence from the approval snapshot). Read-only; nothing here is generated advice.
 */
export function NutritionScreen() {
  const { t, lang } = usePortalT();
  const papi = usePortalApi();
  const res = useAsync(() => papi.nutrition(), [papi]);
  const n = res.data;

  return (
    <div className="page">
      <h1 className="page__title">{t("nutrition.title")}</h1>
      <p className="lede">{t("nutrition.lede")}</p>
      {res.loading && !n ? <Loading /> : null}
      {res.error ? <ErrorNote code={res.error} onRetry={res.reload} /> : null}
      {n?.appointment ? (
        <p className="note">
          {t("nutrition.appointment", {
            date: formatDateTime(n.appointment.starts_at, lang),
            location: n.appointment.location_name,
          })}
        </p>
      ) : null}
      {n?.plan ? (
        <Section title={n.plan.title}>
          <p className="portal-signoff" data-tour-id="portal-nutrition-signoff">
            {t("nutrition.approvedBy", {
              name: n.plan.approver_name,
              license: n.plan.approver_license_no,
            })}
            <br />
            <span className="muted">
              {t("nutrition.approvedOn", { date: formatDateTime(n.plan.approved_at, lang) })}
            </span>
          </p>
          {n.plan.body.sections.map((s) => (
            <section key={s.heading} className="portal-plan__section">
              <h3 className="portal-plan__heading">{s.heading}</h3>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </Section>
      ) : null}
      {n && !n.plan ? (
        <Section title={t("nutrition.emptyTitle")}>
          <p data-tour-id="portal-nutrition-empty">{t("nutrition.emptyBody")}</p>
        </Section>
      ) : null}
      {n ? <p className="help">{t("nutrition.noAdvice")}</p> : null}
    </div>
  );
}
