import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  type Assessment,
  type AssessmentInput,
  CONDITIONS,
  type Condition,
  PARQ_KEYS,
  type ParqKey,
  type Triage,
  healthApi,
} from "./api";
import {
  EmergencyBanner,
  Empty,
  HICON,
  IconSection,
  MemberPicker,
  Stat,
  TriagePanel,
  formatDay,
  levelTone,
  useHealthT,
} from "./components";

/** Staff "Evaluaciones": PAR-Q+ onboarding form, sign-off and the deterministic triage (spec §6.1–6.2). */
export function AssessmentsScreen() {
  const { t, lang } = useHealthT();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const [memberId, setMemberId] = useState("");
  const list = useAsync(
    () => (memberId ? h.assessments(memberId) : Promise.resolve({ data: [] as Assessment[] })),
    [h, memberId],
  );
  const [editing, setEditing] = useState<Assessment | "new" | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [lastTriage, setLastTriage] = useState<Triage | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();

  const member = members.data?.data.find((m) => m.id === memberId) ?? null;
  const locationName =
    locations.data?.data.find((l) => l.id === member?.home_location_id)?.name ?? "";
  const rows = list.data?.data ?? [];
  const signed = rows.filter((a) => a.status === "signed");
  const lastSigned = signed[0]?.signed_at ?? null;

  async function sign(a: Assessment) {
    setBusy(true);
    setError(null);
    setAnnounce(null);
    try {
      const r = await h.signAssessment(a.id);
      setLastTriage(r.triage);
      setAnnounce(t("a.signed"));
      list.reload();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page health">
      <div className="page__head">
        <div>
          <h1 className="page__title">{t("a.title")}</h1>
          <p className="lede">{t("notice.draftTool")}</p>
        </div>
        {memberId ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="health-assessment-new"
            aria-expanded={editing !== null}
            aria-controls={formId}
            onClick={() => {
              setEditing(editing ? null : "new");
              setLastTriage(null);
            }}
          >
            <Icon d={HICON.plus} size={20} />
            {t("a.new")}
          </button>
        ) : null}
      </div>

      {members.loading ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {members.data && members.data.data.length === 0 ? (
        <Empty icon="users">{t("member.none")}</Empty>
      ) : null}
      {members.data && members.data.data.length > 0 ? (
        <div className="health-picker">
          <Icon name="users" size={26} />
          <MemberPicker
            members={members.data.data}
            value={memberId}
            onChange={(id) => {
              setMemberId(id);
              setEditing(null);
              setLastTriage(null);
              setAnnounce(null);
            }}
          />
        </div>
      ) : null}
      {memberId && list.data ? (
        <div className="ds-stats">
          <Stat d={HICON.clipboard} label={t("a.stat.total")} value={rows.length} />
          <Stat icon="checkCircle" label={t("a.stat.signed")} value={signed.length} />
          <Stat d={HICON.pen} label={t("a.stat.drafts")} value={rows.length - signed.length} />
          <Stat
            icon="calendar"
            label={t("a.stat.last")}
            value={<span className="health-date">{formatDay(lastSigned, lang)}</span>}
          />
        </div>
      ) : null}
      {members.data && members.data.data.length > 0 && !memberId ? (
        <Empty icon="users">{t("member.pickFirst")}</Empty>
      ) : null}

      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
      {lastTriage?.emergency ? <EmergencyBanner location={locationName} /> : null}
      {lastTriage ? <TriagePanel triage={lastTriage} /> : null}

      {memberId && editing ? (
        <div id={formId}>
          <AssessmentForm
            key={editing === "new" ? "new" : editing.id}
            memberId={memberId}
            existing={editing === "new" ? null : editing}
            locationName={locationName}
            onSaved={(msg) => {
              setAnnounce(msg);
              setEditing(null);
              list.reload();
            }}
          />
        </div>
      ) : null}

      {memberId ? (
        <IconSection title={t("a.list")} d={HICON.clipboard}>
          {list.loading ? <Loading /> : null}
          {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
          {list.data && rows.length === 0 ? (
            <Empty d={HICON.clipboard}>{t("a.empty")}</Empty>
          ) : null}
          {rows.length > 0 ? (
            <TableWrap label={t("a.list")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("a.col.date")}</th>
                    <th scope="col">{t("a.col.status")}</th>
                    <th scope="col">{t("a.col.exercise")}</th>
                    <th scope="col">{t("a.col.nutrition")}</th>
                    <th scope="col">{t("a.col.evaluator")}</th>
                    <th scope="col">{t("a.col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const date = formatDateTime(a.signed_at ?? a.taken_at, lang);
                    return (
                      <tr key={a.id}>
                        <th scope="row" className="nowrap">
                          {date}
                        </th>
                        <td>
                          <Plate tone={a.status === "signed" ? "ok" : "neutral"}>
                            {t(`a.status.${a.status}`)}
                          </Plate>
                        </td>
                        <td>
                          {a.triage ? (
                            <Plate tone={levelTone(a.triage.exercise_level)}>
                              {t(`triage.${a.triage.exercise_level}`)}
                            </Plate>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {a.triage ? (
                            <Plate tone={levelTone(a.triage.nutrition_level)}>
                              {t(`triage.${a.triage.nutrition_level}`)}
                            </Plate>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{a.evaluator_name ?? "—"}</td>
                        <td>
                          <div className="row-actions">
                            {a.status === "draft" ? (
                              <>
                                <button type="button" className="btn" onClick={() => setEditing(a)}>
                                  {t("p.edit")}
                                  <span className="sr-only">: {t("a.signFor", { date })}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--primary"
                                  data-tour-id="health-assessment-sign"
                                  disabled={busy}
                                  onClick={() => sign(a)}
                                >
                                  {t("a.sign")}
                                  <span className="sr-only">: {t("a.signFor", { date })}</span>
                                </button>
                              </>
                            ) : a.triage ? (
                              <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => setLastTriage(a.triage)}
                              >
                                {t("triage.reasons")}
                                <span className="sr-only">: {t("a.signFor", { date })}</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </IconSection>
      ) : null}
    </div>
  );
}

type Answers = Record<ParqKey, boolean | null>;
const NUMERIC = [
  ["resting_hr", "a.hr", 25, 250, 1],
  ["bp_sys", "a.bpSys", 60, 260, 1],
  ["bp_dia", "a.bpDia", 30, 160, 1],
] as const;
const MEASURES = [
  ["height_cm", "a.height", 50, 250, 0.1],
  ["weight_kg", "a.weight", 20, 350, 0.1],
  ["waist_cm", "a.waist", 30, 250, 0.1],
] as const;
const TESTS = [
  ["pushups", "a.pushups"],
  ["plank_seconds", "a.plank"],
  ["chair_stand_30s", "a.chair"],
] as const;
type NumKey = (typeof NUMERIC)[number][0] | (typeof MEASURES)[number][0];

function AssessmentForm({
  memberId,
  existing,
  locationName,
  onSaved,
}: {
  memberId: string;
  existing: Assessment | null;
  locationName: string;
  onSaved: (message: string) => void;
}) {
  const { t } = useHealthT();
  const { t: tc } = useI18n();
  const { api } = useSession();
  const h = useMemo(() => healthApi(api), [api]);
  const [answers, setAnswers] = useState<Answers>(
    () =>
      Object.fromEntries(PARQ_KEYS.map((k) => [k, existing ? existing.parq[k] : null])) as Answers,
  );
  const [resolved, setResolved] = useState(existing?.parq_followup_resolved ?? false);
  const [conditions, setConditions] = useState<Condition[]>(existing?.declared_conditions ?? []);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => {
    const v = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
    return {
      resting_hr: v(existing?.resting_hr),
      bp_sys: v(existing?.bp_sys),
      bp_dia: v(existing?.bp_dia),
      height_cm: v(existing?.height_cm),
      weight_kg: v(existing?.weight_kg),
      waist_cm: v(existing?.waist_cm),
    };
  });
  const [tests, setTests] = useState<Record<string, string>>(() =>
    Object.fromEntries(TESTS.map(([k]) => [k, String(existing?.fitness_tests?.[k] ?? "")])),
  );
  const [acute, setAcute] = useState(existing?.acute_symptoms ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [preview, setPreview] = useState<Triage | null>(null);
  const uid = useId();

  const allAnswered = PARQ_KEYS.every((k) => answers[k] !== null);
  const anyYes = PARQ_KEYS.some((k) => answers[k] === true);

  function build(): AssessmentInput | null {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const out: Record<string, number | null> = {};
    for (const [k, , min, max] of [...NUMERIC, ...MEASURES]) {
      const n = num(nums[k]);
      if (n !== null && (!Number.isFinite(n) || n < min || n > max)) return null;
      out[k] = n;
    }
    if (out.bp_sys !== null && out.bp_dia !== null && (out.bp_sys ?? 0) <= (out.bp_dia ?? 0))
      return null;
    const ft: Record<string, number> = {};
    for (const [k] of TESTS) {
      const n = num(tests[k] ?? "");
      if (n === null) continue;
      if (!Number.isFinite(n) || n < 0 || n > 10000) return null;
      ft[k] = n;
    }
    return {
      parq: Object.fromEntries(PARQ_KEYS.map((k) => [k, answers[k] === true])) as Record<
        ParqKey,
        boolean
      >,
      parq_followup_resolved: anyYes && resolved,
      declared_conditions: conditions,
      resting_hr: out.resting_hr ?? null,
      bp_sys: out.bp_sys ?? null,
      bp_dia: out.bp_dia ?? null,
      height_cm: out.height_cm ?? null,
      weight_kg: out.weight_kg ?? null,
      waist_cm: out.waist_cm ?? null,
      fitness_tests: ft,
      acute_symptoms: acute,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = build();
    setInvalid(input === null);
    if (!input || !allAnswered) return;
    setBusy(true);
    setError(null);
    try {
      if (existing) await h.updateAssessment(existing.id, input);
      else await h.createAssessment(memberId, input);
      onSaved(t("a.saved"));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    const input = build();
    if (!input || !allAnswered) return;
    try {
      setPreview(
        await h.preview({
          member_id: memberId,
          parq: input.parq,
          parq_followup_resolved: input.parq_followup_resolved,
          declared_conditions: input.declared_conditions,
          acute_symptoms: input.acute_symptoms,
        }),
      );
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <form className="form section health-form" onSubmit={submit} noValidate>
      <h2 className="section__title">
        <Icon d={HICON.clipboard} size={24} />
        <span>{t("a.formTitle")}</span>
      </h2>
      {acute ? <EmergencyBanner location={locationName} preview /> : null}

      <fieldset className="health-parq">
        <legend>{t("a.parq")}</legend>
        <p className="help">{t("a.parqHelp")}</p>
        {PARQ_KEYS.map((k) => (
          <fieldset key={k} className="health-parq__q">
            <legend>
              {k.slice(1)}. {t(`a.${k}`)}
            </legend>
            <div className="health-choices">
              {([true, false] as const).map((v) => (
                <label key={String(v)} className="health-choice">
                  <input
                    type="radio"
                    name={`${uid}-${k}`}
                    checked={answers[k] === v}
                    onChange={() => setAnswers((a) => ({ ...a, [k]: v }))}
                    required
                  />
                  {v ? tc("common.yes") : tc("common.no")}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {anyYes ? (
          <label className="health-choice">
            <input
              type="checkbox"
              checked={resolved}
              onChange={(e) => setResolved(e.target.checked)}
            />
            {t("a.resolved")}
          </label>
        ) : null}
      </fieldset>

      <fieldset className="health-fieldset">
        <legend>{t("a.conditions")}</legend>
        <div className="health-choices">
          {CONDITIONS.map((c) => (
            <label key={c} className="health-choice">
              <input
                type="checkbox"
                checked={conditions.includes(c)}
                onChange={(e) =>
                  setConditions((cs) => (e.target.checked ? [...cs, c] : cs.filter((x) => x !== c)))
                }
              />
              {t(`cond.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {(
        [
          ["a.vitals", NUMERIC],
          ["a.measures", MEASURES],
        ] as const
      ).map(([legend, fields]) => (
        <fieldset key={legend} className="health-fieldset">
          <legend>{t(legend)}</legend>
          <div className="form__grid">
            {fields.map(([k, label, min, max, step]) => (
              <div key={k} className="field">
                <label htmlFor={`${uid}-${k}`}>{t(label)}</label>
                <input
                  id={`${uid}-${k}`}
                  type="number"
                  inputMode="decimal"
                  min={min}
                  max={max}
                  step={step}
                  value={nums[k]}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setNums((n) => ({ ...n, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="health-fieldset">
        <legend>{t("a.tests")}</legend>
        <div className="form__grid">
          {TESTS.map(([k, label]) => (
            <div key={k} className="field">
              <label htmlFor={`${uid}-${k}`}>{t(label)}</label>
              <input
                id={`${uid}-${k}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                value={tests[k] ?? ""}
                onChange={(e) => setTests((x) => ({ ...x, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <label className="health-choice">
        <input
          type="checkbox"
          checked={acute}
          onChange={(e) => setAcute(e.target.checked)}
          data-tour-id="health-acute"
        />
        {t("a.acute")}
      </label>

      {invalid ? (
        <p className="field-error" role="alert">
          {t("a.invalid")}
        </p>
      ) : null}
      {error ? <ErrorNote code={error} /> : null}
      {preview ? <TriagePanel triage={preview} title={t("triage.preview")} /> : null}

      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !allAnswered}
          data-tour-id="health-assessment-save"
        >
          {t("a.save")}
        </button>
        <button type="button" className="btn" disabled={!allAnswered} onClick={runPreview}>
          {t("triage.preview")}
        </button>
      </div>
    </form>
  );
}
