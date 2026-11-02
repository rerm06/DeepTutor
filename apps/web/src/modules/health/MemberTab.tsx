import { useMemo } from "react";
import { ErrorNote, Loading, Section } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { healthApi, latestTriage } from "./api";
import { TriagePanel, useHealthT } from "./components";

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
    <Section title={t("tab.title")}>
      {assessments.loading ? <Loading /> : null}
      {assessments.error ? (
        <ErrorNote code={assessments.error} onRetry={assessments.reload} />
      ) : null}
      {assessments.data && !triage ? <p className="muted">{t("tab.none")}</p> : null}
      {triage ? <TriagePanel triage={triage} title={t("tab.latest")} /> : null}
      {plans.data ? <p>{t("tab.plans", { n: published })}</p> : null}
    </Section>
  );
}
