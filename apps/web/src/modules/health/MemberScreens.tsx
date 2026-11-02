import { useMemo } from "react";
import { ErrorNote, Loading, Plate, Section } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Assessment, type Plan, healthApi } from "./api";
import { DeviceNotice, EmergencyBanner, PlanBodyView, TriagePanel, useHealthT } from "./components";

/** Group rows by member (a guardian may have several wards). */
function byMember<T extends { member_id: string; member_name: string }>(rows: T[]) {
  const groups = new Map<string, { name: string; rows: T[] }>();
  for (const r of rows) {
    const g = groups.get(r.member_id) ?? { name: r.member_name, rows: [] };
    g.rows.push(r);
    groups.set(r.member_id, g);
  }
  return [...groups.entries()];
}

function useHomeLocation(memberId: string | undefined): string {
  const { api } = useSession();
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const m = members.data?.data.find((x) => x.id === memberId);
  return locations.data?.data.find((l) => l.id === m?.home_location_id)?.name ?? "";
}

/** Member/guardian "Mi evaluación": signed reports only (RLS returns nothing else). */
export function MyAssessmentScreen() {
  const { t } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const list = useAsync(() => h.assessments(), [h]);
  const rows = (list.data?.data ?? []).filter((a) => a.status === "signed");
  const groups = byMember(rows);
  const multi = groups.length > 1;

  return (
    <div className="page">
      <h1 className="page__title">{t("me.assessmentTitle")}</h1>
      <DeviceNotice />
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && rows.length === 0 ? <p className="muted">{t("me.noAssessment")}</p> : null}
      {groups.map(([memberId, g]) => (
        <MemberReport
          key={memberId}
          memberId={memberId}
          name={multi ? g.name : null}
          rows={g.rows}
        />
      ))}
    </div>
  );
}

function MemberReport({
  memberId,
  name,
  rows,
}: {
  memberId: string;
  name: string | null;
  rows: Assessment[];
}) {
  const { t, lang } = useHealthT();
  const location = useHomeLocation(memberId);
  const latest = rows[0];
  return (
    <>
      {name ? <h2 className="section__title">{t("me.for", { name })}</h2> : null}
      {latest?.triage?.emergency ? <EmergencyBanner location={location} /> : null}
      {rows.map((a) => (
        <Section key={a.id} title={`${t("a.report")} · ${formatDateTime(a.signed_at, lang)}`}>
          {a.signed_by_name ? (
            <p className="muted">{t("a.takenBy", { name: a.signed_by_name })}</p>
          ) : null}
          {a.triage ? <TriagePanel triage={a.triage} /> : null}
          <dl className="facts">
            {(
              [
                ["a.hr", a.resting_hr],
                ["a.bpSys", a.bp_sys],
                ["a.bpDia", a.bp_dia],
                ["a.height", a.height_cm],
                ["a.weight", a.weight_kg],
                ["a.waist", a.waist_cm],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd className="mono">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {a.declared_conditions.length > 0 ? (
            <p>
              <strong>{t("a.conditions")}:</strong>{" "}
              {a.declared_conditions.map((c) => t(`cond.${c}`)).join(", ")}
            </p>
          ) : null}
        </Section>
      ))}
    </>
  );
}

/** Member/guardian "Mi plan": published plans only, with the professional who signed them. */
export function MyPlanScreen() {
  const { t, lang } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const list = useAsync(() => h.plans(), [h]);
  const rows = (list.data?.data ?? []).filter((p) => p.status === "published");
  const groups = byMember(rows);
  const multi = groups.length > 1;

  return (
    <div className="page">
      <h1 className="page__title">{t("me.planTitle")}</h1>
      <DeviceNotice />
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && rows.length === 0 ? <p className="muted">{t("me.noPlan")}</p> : null}
      {groups.map(([memberId, g]) => (
        <div key={memberId} className="health-stack">
          {multi ? <h2 className="section__title">{t("me.for", { name: g.name })}</h2> : null}
          {g.rows.map((p) => (
            <PublishedPlan key={p.id} plan={p} lang={lang} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PublishedPlan({ plan, lang }: { plan: Plan; lang: "es" | "en" }) {
  const { t } = useHealthT();
  return (
    <Section title={plan.title} level={3}>
      <p>
        <Plate tone="neutral">{t(`p.kind.${plan.kind}`)}</Plate>{" "}
        <span className="muted">
          {t("me.published", { date: formatDateTime(plan.published_at, lang) })}
        </span>
      </p>
      {plan.kind === "nutrition" && plan.approver_name && plan.approver_license_no ? (
        <p className="health-signoff" data-tour-id="health-plan-signoff">
          {t("p.nutritionSigned", { name: plan.approver_name, no: plan.approver_license_no })}
        </p>
      ) : plan.approver_name ? (
        <p className="health-signoff">
          {plan.approver_license_no
            ? t("p.approvedByLic", { name: plan.approver_name, no: plan.approver_license_no })
            : t("p.approvedBy", { name: plan.approver_name })}
        </p>
      ) : null}
      <PlanBodyView sections={plan.body.sections} />
    </Section>
  );
}
