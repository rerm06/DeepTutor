import { useId, useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading, Plate } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Assessment, type Plan, healthApi } from "./api";
import {
  DeviceNotice,
  EmergencyBanner,
  Empty,
  HICON,
  IconSection,
  KIND_ICON,
  PlanBodyView,
  Stat,
  TriagePanel,
  formatDay,
  levelTone,
  useHealthT,
} from "./components";

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
  const { t, lang } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const list = useAsync(() => h.assessments(), [h]);
  const rows = (list.data?.data ?? []).filter((a) => a.status === "signed");
  const groups = byMember(rows);
  const multi = groups.length > 1;
  const latest = rows[0];

  return (
    <div className="page health">
      <div>
        <h1 className="page__title">{t("me.assessmentTitle")}</h1>
        <p className="lede">{t("me.assessmentLede")}</p>
      </div>
      <DeviceNotice />
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && rows.length === 0 ? (
        <Empty d={HICON.clipboard}>{t("me.noAssessment")}</Empty>
      ) : null}
      {latest && !multi ? (
        <div className="ds-stats">
          <Stat d={HICON.clipboard} label={t("me.stat.reports")} value={rows.length} />
          <Stat
            icon="calendar"
            label={t("me.stat.latest")}
            value={<span className="health-date">{formatDay(latest.signed_at, lang)}</span>}
          />
          {latest.triage ? (
            <>
              <Stat
                icon="dumbbell"
                label={t("me.stat.exercise")}
                value={
                  <Plate tone={levelTone(latest.triage.exercise_level)}>
                    {t(`triage.${latest.triage.exercise_level}`)}
                  </Plate>
                }
              />
              <Stat
                icon="apple"
                label={t("me.stat.nutrition")}
                value={
                  <Plate tone={levelTone(latest.triage.nutrition_level)}>
                    {t(`triage.${latest.triage.nutrition_level}`)}
                  </Plate>
                }
              />
            </>
          ) : null}
        </div>
      ) : null}
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
      {name ? (
        <h2 className="section__title health-for">
          <Icon name="users" size={24} />
          <span>{t("me.for", { name })}</span>
        </h2>
      ) : null}
      {latest?.triage?.emergency ? <EmergencyBanner location={location} /> : null}
      {rows.map((a) => (
        <IconSection
          key={a.id}
          d={HICON.clipboard}
          title={`${t("a.report")} · ${formatDateTime(a.signed_at, lang)}`}
        >
          {a.signed_by_name ? (
            <p className="health-signoff health-signoff--muted">
              <Icon d={HICON.shieldCheck} size={20} />
              {t("a.takenBy", { name: a.signed_by_name })}
            </p>
          ) : null}
          {a.triage ? <TriagePanel triage={a.triage} /> : null}
          <dl className="facts health-facts">
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
        </IconSection>
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
    <div className="page health">
      <div>
        <h1 className="page__title">{t("me.planTitle")}</h1>
        <p className="lede">{t("me.planLede")}</p>
      </div>
      <DeviceNotice />
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && rows.length === 0 ? (
        <Empty
          icon="dumbbell"
          action={
            <Link className="ds-cta" to="/me/health/assessment">
              {t("me.seeAssessment")} <Icon name="arrowRight" size={18} />
            </Link>
          }
        >
          {t("me.noPlan")}
        </Empty>
      ) : null}
      {groups.map(([memberId, g]) => (
        <div key={memberId} className="health-stack">
          {multi ? (
            <h2 className="section__title health-for">
              <Icon name="users" size={24} />
              <span>{t("me.for", { name: g.name })}</span>
            </h2>
          ) : null}
          {g.rows.map((p) => (
            <PublishedPlan key={p.id} plan={p} lang={lang} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Week count the professional wrote in the plan ("4 semanas", "Semanas 3 y 4", "Weeks 3 and 4"), if any. */
export function planWeeks(plan: Pick<Plan, "title" | "body">): number | null {
  const texts = [plan.title, ...plan.body.sections.map((s) => s.heading)];
  let max = 0;
  for (const text of texts) {
    const m = /(\d+)\s*(?:semanas|weeks)\b|\b(?:semanas?|weeks?)\s+([\d\s,y&and–-]+)/i.exec(text);
    if (!m) continue;
    for (const n of (m[1] ?? m[2] ?? "").match(/\d+/g) ?? []) max = Math.max(max, Number(n));
  }
  return max > 0 && max <= 104 ? max : null;
}

/** Weeks since publication, 1-based and capped at the plan length. */
function currentWeek(publishedAt: string | null, weeks: number, now = Date.now()): number | null {
  if (!publishedAt) return null;
  const start = new Date(publishedAt).getTime();
  if (Number.isNaN(start) || start > now) return null;
  return Math.min(weeks, Math.floor((now - start) / (7 * 86_400_000)) + 1);
}

function PublishedPlan({ plan, lang }: { plan: Plan; lang: "es" | "en" }) {
  const { t } = useHealthT();
  const weeks = planWeeks(plan);
  const week = weeks ? currentWeek(plan.published_at, weeks) : null;
  const pct = weeks && week ? Math.round((week / weeks) * 100) : null;
  const items = plan.body.sections.reduce((n, s) => n + s.items.length, 0);
  const id = useId();
  return (
    <section className="section health-myplan" aria-labelledby={id}>
      <div className="health-myplan__head">
        {plan.kind === "training" ? (
          <img
            className="ds-media health-myplan__img"
            src="/brand/program-strength.jpg"
            alt=""
            width={120}
            height={150}
          />
        ) : (
          <span className="health-myplan__badge">
            <Icon name={KIND_ICON[plan.kind]} size={40} />
          </span>
        )}
        <div className="health-myplan__text">
          <span className="ds-pill">{t(`p.kind.${plan.kind}`)}</span>
          <h3 id={id} className="health-myplan__title">
            {plan.title}
          </h3>
          {weeks ? (
            <p className="health-myplan__weeks">
              {week
                ? t("me.weekOf", { w: String(week), n: String(weeks) })
                : t("me.weeks", { n: String(weeks) })}
            </p>
          ) : null}
          {pct !== null ? (
            <span className="health-myplan__bar">
              <span className="ds-bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span>{pct}%</span>
            </span>
          ) : null}
          <p className="muted">
            {t("me.published", { date: formatDateTime(plan.published_at, lang) })}
            {" · "}
            {t("me.blocks", { n: String(plan.body.sections.length), m: String(items) })}
          </p>
        </div>
      </div>
      {plan.kind === "nutrition" && plan.approver_name && plan.approver_license_no ? (
        <p className="health-signoff" data-tour-id="health-plan-signoff">
          <Icon d={HICON.shieldCheck} size={20} />
          {t("p.nutritionSigned", { name: plan.approver_name, no: plan.approver_license_no })}
        </p>
      ) : plan.approver_name ? (
        <p className="health-signoff">
          <Icon d={HICON.shieldCheck} size={20} />
          {plan.approver_license_no
            ? t("p.approvedByLic", { name: plan.approver_name, no: plan.approver_license_no })
            : t("p.approvedBy", { name: plan.approver_name })}
        </p>
      ) : null}
      <PlanBodyView sections={plan.body.sections} />
    </section>
  );
}
