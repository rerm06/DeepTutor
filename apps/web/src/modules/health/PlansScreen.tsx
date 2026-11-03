import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, type Tone } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  APPROVERS,
  AUTHORS,
  type Assessment,
  type HealthWhoami,
  PLAN_KINDS,
  PUBLISHERS,
  type Plan,
  type PlanKind,
  type Triage,
  formatBody,
  healthApi,
  latestTriage,
  parseBody,
} from "./api";
import {
  Empty,
  HICON,
  IconSection,
  KIND_ICON,
  MemberPicker,
  PlanBodyView,
  Stat,
  TriagePanel,
  useHealthT,
} from "./components";
import { TEMPLATES } from "./templates";

export const statusTone = (s: Plan["status"]): Tone =>
  s === "published" ? "ok" : s === "approved" || s === "review" ? "warn" : "neutral";

/** Staff "Planes": drafts from templates, review, licensed sign-off, publish, new versions (spec §6.6–6.7). */
export function PlansScreen() {
  const { t } = useHealthT();
  const { api, role } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const members = useAsync(() => api.members(), [api]);
  const me = useAsync(() => h.whoami(), [h]);
  const [memberId, setMemberId] = useState("");
  const plans = useAsync(
    () => (memberId ? h.plans(memberId) : Promise.resolve({ data: [] as Plan[] })),
    [h, memberId],
  );
  const assessments = useAsync(
    () => (memberId ? h.assessments(memberId) : Promise.resolve({ data: [] as Assessment[] })),
    [h, memberId],
  );
  const [showNew, setShowNew] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const formId = useId();

  const authorable = PLAN_KINDS.filter((k) => AUTHORS[k].includes(String(role)));
  const triage = latestTriage(assessments.data?.data ?? []);
  const rows = plans.data?.data ?? [];
  const count = (st: Plan["status"]) => rows.filter((p) => p.status === st).length;

  return (
    <div className="page health">
      <div className="page__head">
        <div>
          <h1 className="page__title">{t("p.title")}</h1>
          <p className="lede">{t("notice.draftTool")}</p>
        </div>
        {memberId && authorable.length > 0 ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="health-plan-new"
            aria-expanded={showNew}
            aria-controls={formId}
            onClick={() => setShowNew((v) => !v)}
          >
            <Icon d={HICON.plus} size={20} />
            {t("p.new")}
          </button>
        ) : null}
      </div>

      {members.loading ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {members.data && members.data.data.length > 0 ? (
        <div className="health-picker">
          <Icon name="users" size={26} />
          <MemberPicker
            members={members.data.data}
            value={memberId}
            onChange={(id) => {
              setMemberId(id);
              setShowNew(false);
              setAnnounce(null);
            }}
          />
        </div>
      ) : null}
      {members.data && members.data.data.length === 0 ? (
        <Empty icon="users">{t("member.none")}</Empty>
      ) : null}
      {members.data && members.data.data.length > 0 && !memberId ? (
        <Empty icon="users">{t("member.pickFirst")}</Empty>
      ) : null}
      {memberId && plans.data ? (
        <div className="ds-stats">
          <Stat icon="layers" label={t("p.stat.total")} value={rows.length} />
          <Stat icon="checkCircle" label={t("p.stat.published")} value={count("published")} />
          <Stat
            d={HICON.shieldCheck}
            label={t("p.stat.review")}
            value={count("review") + count("approved")}
          />
          <Stat d={HICON.pen} label={t("p.stat.drafts")} value={count("draft")} />
        </div>
      ) : null}

      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {memberId && triage ? <TriagePanel triage={triage} /> : null}
      {memberId && assessments.data && !triage ? (
        <p className="note note--warn">
          <Icon d={HICON.info} size={20} />
          {t("p.noTriage")}
        </p>
      ) : null}

      {memberId && showNew ? (
        <div id={formId}>
          <NewPlanForm
            memberId={memberId}
            kinds={authorable}
            onCreated={(msg) => {
              setAnnounce(msg);
              setShowNew(false);
              plans.reload();
            }}
          />
        </div>
      ) : null}

      {memberId ? (
        <IconSection title={t("p.list")} icon="layers">
          {plans.loading ? <Loading /> : null}
          {plans.error ? <ErrorNote code={plans.error} onRetry={plans.reload} /> : null}
          {plans.data && rows.length === 0 ? <Empty icon="layers">{t("p.empty")}</Empty> : null}
          <div className="ds-grid health-plans">
            {rows.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                role={String(role)}
                me={me.data}
                triage={triage}
                hasOpenVersion={rows.some(
                  (o) =>
                    o.series_id === p.series_id && (o.status === "draft" || o.status === "review"),
                )}
                onChanged={(msg) => {
                  setAnnounce(msg);
                  plans.reload();
                }}
              />
            ))}
          </div>
        </IconSection>
      ) : null}
    </div>
  );
}

function NewPlanForm({
  memberId,
  kinds,
  onCreated,
}: {
  memberId: string;
  kinds: PlanKind[];
  onCreated: (message: string) => void;
}) {
  const { t, lang } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const [kind, setKind] = useState<PlanKind>(kinds[0] ?? "training");
  const templates = TEMPLATES.filter((x) => x.kind === kind);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const uid = useId();

  // Picking a kind or template refills the editable fields from the template.
  useEffect(() => {
    const tpl = TEMPLATES.find((x) => x.id === templateId && x.kind === kind);
    if (!tpl) return;
    setTitle(tpl.title[lang]);
    setBody(formatBody({ sections: tpl.sections[lang] }));
  }, [templateId, kind, lang]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await h.createPlan({
        member_id: memberId,
        kind,
        title: title.trim(),
        body: parseBody(body),
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      onCreated(t("p.created"));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form section health-form" onSubmit={submit}>
      <h2 className="section__title">
        <Icon d={HICON.pen} size={24} />
        <span>{t("p.formTitle")}</span>
      </h2>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={`${uid}-kind`}>{t("p.kind")}</label>
          <select
            id={`${uid}-kind`}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as PlanKind;
              setKind(k);
              setTemplateId(TEMPLATES.find((x) => x.kind === k)?.id ?? "");
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`p.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-tpl`}>{t("p.template")}</label>
          <select
            id={`${uid}-tpl`}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title[lang]}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={`${uid}-title`}>{t("p.titleField")}</label>
          <input
            id={`${uid}-title`}
            value={title}
            maxLength={120}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field field--wide">
          <label htmlFor={`${uid}-body`}>{t("p.bodyField")}</label>
          <textarea
            id={`${uid}-body`}
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="field field--wide">
          <label htmlFor={`${uid}-why`}>{t("p.rationale")}</label>
          <textarea
            id={`${uid}-why`}
            rows={2}
            maxLength={2000}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </div>
      </div>
      {error ? <ErrorNote code={error} /> : null}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !title.trim()}>
          {t("p.create")}
        </button>
      </div>
    </form>
  );
}

function PlanCard({
  plan,
  role,
  me,
  triage,
  hasOpenVersion,
  onChanged,
}: {
  plan: Plan;
  role: string;
  me: HealthWhoami | null;
  triage: Triage | null;
  hasOpenVersion: boolean;
  onChanged: (message: string) => void;
}) {
  const { t } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [ack, setAck] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(plan.title);
  const [body, setBody] = useState(formatBody(plan.body));
  const uid = useId();

  const isAuthor = AUTHORS[plan.kind].includes(role);
  const isApprover = APPROVERS[plan.kind].includes(role);
  const licensedKind = plan.kind !== "training";
  const licensed = Boolean(me?.staff?.license_verified);
  const redNutrition = plan.kind === "nutrition" && triage?.nutrition_level === "red";
  const redTraining = plan.kind === "training" && triage?.exercise_level === "red";
  const needsTriage = plan.kind !== "treatment" && !triage;
  const needsAck =
    plan.kind === "nutrition" &&
    !!triage &&
    (triage.nutrition_level === "amber" || triage.requires_medical_referral);
  const approveBlocked =
    (licensedKind && !licensed) || redNutrition || redTraining || needsTriage || (needsAck && !ack);

  async function run(
    fn: () => Promise<unknown>,
    statusKey: Plan["status"] | null,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(
        t("p.done", {
          title: plan.title,
          status: statusKey ? t(`p.status.${statusKey}`) : t("p.status.draft"),
        }),
      );
      return true;
    } catch (err) {
      setError(toErrorCode(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const headingId = `${uid}-h`;
  return (
    <article className="health-plan" aria-labelledby={headingId}>
      <div className="health-plan__head">
        <span className="health-plan__badge">
          <Icon name={KIND_ICON[plan.kind]} size={26} />
        </span>
        <div className="health-plan__heading">
          <h3 id={headingId} className="health-plan__title">
            {plan.title}
          </h3>
          <p className="health-plan__plates">
            <span className="ds-pill">{t(`p.kind.${plan.kind}`)}</span>
            <Plate tone="neutral">{t("p.version", { n: plan.version })}</Plate>
            <Plate tone={statusTone(plan.status)}>{t(`p.status.${plan.status}`)}</Plate>
          </p>
        </div>
      </div>
      {plan.approver_name ? (
        <p className="health-signoff">
          <Icon d={HICON.shieldCheck} size={20} />
          {plan.approver_license_no
            ? t("p.approvedByLic", { name: plan.approver_name, no: plan.approver_license_no })
            : t("p.approvedBy", { name: plan.approver_name })}
        </p>
      ) : null}
      {plan.kind === "nutrition" && triage?.no_calorie_counting ? (
        <p className="note note--warn">{t("p.noCalories")}</p>
      ) : null}

      {editing ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => h.updatePlan(plan.id, { title: title.trim(), body: parseBody(body) }),
              "draft",
            ).then((ok) => ok && setEditing(false));
          }}
        >
          <div className="field">
            <label htmlFor={`${uid}-t`}>{t("p.titleField")}</label>
            <input
              id={`${uid}-t`}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-b`}>{t("p.bodyField")}</label>
            <textarea
              id={`${uid}-b`}
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("p.saveEdit")}
            </button>
          </div>
        </form>
      ) : (
        <PlanBodyView sections={plan.body.sections} />
      )}

      {plan.status === "review" && isApprover ? (
        <div className="health-stack">
          {licensedKind && me?.staff ? (
            licensed ? (
              <p className="health-signoff">
                <Icon d={HICON.pen} size={20} />
                {t("p.signAs", { name: me.staff.display_name, no: me.staff.license_no ?? "" })}
              </p>
            ) : (
              <p className="note note--warn">{t("p.needLicense")}</p>
            )
          ) : me?.staff ? (
            <p className="health-signoff">
              <Icon d={HICON.pen} size={20} />
              {t("p.signAsTrainer", { name: me.staff.display_name })}
            </p>
          ) : null}
          {redNutrition ? <p className="note note--error">{t("p.redBlock")}</p> : null}
          {redTraining ? <p className="note note--error">{t("p.redTraining")}</p> : null}
          {needsTriage ? <p className="note note--warn">{t("p.noTriage")}</p> : null}
          {needsAck && !redNutrition ? (
            <>
              <p className="note note--warn">{t("p.ackNeeded")}</p>
              <label className="health-choice">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {t("p.ack")}
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorNote code={error} /> : null}
      <div className="row-actions health-plan__actions">
        {plan.status === "draft" && isAuthor ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setEditing((v) => !v)}
            >
              {t("p.edit")}
              <span className="sr-only">: {plan.title}</span>
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-tour-id="health-plan-submit"
              disabled={busy}
              onClick={() => run(() => h.transition(plan.id, "submit"), "review")}
            >
              {t("p.submit")}
              <span className="sr-only">: {plan.title}</span>
            </button>
          </>
        ) : null}
        {plan.status === "review" && (isApprover || isAuthor) ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => h.transition(plan.id, "return"), "draft")}
          >
            {t("p.return")}
            <span className="sr-only">: {plan.title}</span>
          </button>
        ) : null}
        {plan.status === "review" && isApprover ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="health-plan-approve"
            disabled={busy || approveBlocked}
            onClick={() => run(() => h.transition(plan.id, "approve", ack), "approved")}
          >
            {t("p.approve")}
            <span className="sr-only">: {plan.title}</span>
          </button>
        ) : null}
        {plan.status === "approved" && PUBLISHERS(plan.kind).includes(role) ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="health-plan-publish"
            disabled={busy}
            onClick={() => run(() => h.transition(plan.id, "publish"), "published")}
          >
            {t("p.publish")}
            <span className="sr-only">: {plan.title}</span>
          </button>
        ) : null}
        {(plan.status === "approved" || plan.status === "published") &&
        PUBLISHERS(plan.kind).includes(role) ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => h.transition(plan.id, "archive"), "archived")}
          >
            {t("p.archive")}
            <span className="sr-only">: {plan.title}</span>
          </button>
        ) : null}
        {plan.status !== "draft" && plan.status !== "review" && isAuthor && !hasOpenVersion ? (
          <button
            type="button"
            className="btn"
            data-tour-id="health-plan-new-version"
            disabled={busy}
            onClick={() => run(() => h.newVersion(plan.id), null)}
          >
            {t("p.newVersion")}
            <span className="sr-only">: {plan.title}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}
