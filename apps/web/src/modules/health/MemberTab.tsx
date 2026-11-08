import { useMemo } from "react";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { healthApi, latestTriage } from "./api";
import { Empty, HICON, IconSection, TriagePanel, useHealthT } from "./components";

/** Compact health summary inside the staff member record (health roles only). */
export function HealthMemberTab({ memberId }: { memberId: string }) {
  const { t } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const assessments = useAsync(() => h.assessments(memberId), [h, memberId]);
  const plans = useAsync(() => h.plans(memberId), [h, memberId]);
  const triage = latestTriage(assessments.data?.data ?? []);
  const published = (plans.data?.data ?? []).filter((p) => p.status === "published").length;
  return (
    <IconSection title={t("tab.title")} d={HICON.pulse}>
      {assessments.loading ? <Loading /> : null}
      {assessments.error ? (
        <ErrorNote code={assessments.error} onRetry={assessments.reload} />
      ) : null}
      {assessments.data && !triage ? <Empty d={HICON.clipboard}>{t("tab.none")}</Empty> : null}
      {triage ? <TriagePanel triage={triage} title={t("tab.latest")} /> : null}
      {plans.data ? (
        <p className="health-signoff">
          <Icon name="layers" size={20} />
          {t("tab.plans", { n: published })}
        </p>
      ) : null}
    </IconSection>
  );
}
