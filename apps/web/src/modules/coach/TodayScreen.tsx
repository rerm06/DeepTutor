import { type FormEvent, useEffect, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section, type Tone } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { EmergencyBanner, PlanBodyView } from "../health/components";
import { BODY_AREAS, type Band, type BodyArea } from "./api";
import type { CoachKey } from "./dict";
import { EstimateNotice, MemberPick, useCoachApi, useCoachT, useMyMembers } from "./shared";

const PAIN_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const bandTone = (b: Band): Tone => (b === "above" ? "ok" : b === "below" ? "warn" : "neutral");

function Scale({
  name,
  legend,
  value,
  onChange,
  tour,
}: {
  name: string;
  legend: string;
  value: number | null;
  onChange: (n: number) => void;
  tour: string;
}) {
  return (
    <fieldset className="coach-scale" data-tour-id={tour}>
      <legend>{legend}</legend>
      <div className="coach-scale__options">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span>{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Member "Hoy": 3-question check-in + today's line from the APPROVED plan only. */
export function TodayScreen() {
  const { t } = useCoachT();
  const c = useCoachApi();
  const { list, locationName } = useMyMembers();
  const [memberId, setMemberId] = useState("");
  useEffect(() => {
    if (!memberId && list[0]) setMemberId(list[0].id);
  }, [list, memberId]);
  const today = useAsync(() => c.today(memberId || undefined), [c, memberId]);
  const member = list.find((m) => m.id === (memberId || today.data?.member_id));

  return (
    <div className="page">
      <h1 className="page__title">{t("today.title")}</h1>
      <p className="lede">{t("today.lede")}</p>
      <EstimateNotice />
      <MemberPick list={list} value={memberId} onChange={setMemberId} />
      {today.loading && !today.data ? <Loading /> : null}
      {today.error ? <ErrorNote code={today.error} onRetry={today.reload} /> : null}
      {today.data?.checkin?.emergency ? <EmergencyBanner location={locationName(member)} /> : null}
      {today.data ? (
        <div className="coach-stack">
          {today.data.checkin ? (
            <Readiness
              band={today.data.band ?? "baseline"}
              score={today.data.checkin.score}
              baselineDays={today.data.baseline_days}
              escalated={today.data.checkin.escalated}
            />
          ) : (
            <CheckinForm memberId={memberId || today.data.member_id} onDone={today.reload} />
          )}
          <p className="coach-card" data-tour-id="coach-today-suggestion">
            {t(`sugg.${today.data.suggestion}` as CoachKey)}
          </p>
          <Section title={t("today.plan")}>
            {today.data.plan ? (
              <>
                <h3 className="section__title">{today.data.plan.title}</h3>
                {today.data.plan.approver_name ? (
                  <p className="muted">
                    {t("today.planBy", { name: today.data.plan.approver_name })}
                  </p>
                ) : null}
                <PlanBodyView sections={today.data.plan.body.sections} />
              </>
            ) : (
              <p className="muted">{t("today.noPlan")}</p>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Readiness({
  band,
  score,
  baselineDays,
  escalated,
}: {
  band: Band;
  score: number | null;
  baselineDays: number;
  escalated: boolean;
}) {
  const { t } = useCoachT();
  return (
    <section className="coach-card" data-tour-id="coach-readiness" aria-label={t("today.form")}>
      <p>
        <Plate tone={bandTone(band)}>{t(`band.${band}` as CoachKey)}</Plate>
      </p>
      <p>
        {score === null
          ? t("today.baseline", { n: Math.min(baselineDays, 7) })
          : t("today.score", { score })}
      </p>
      {escalated ? <p className="note note--warn">{t("today.talk")}</p> : null}
    </section>
  );
}

function CheckinForm({ memberId, onDone }: { memberId: string; onDone: () => void }) {
  const { t } = useCoachT();
  const c = useCoachApi();
  const id = useId();
  const [sleep, setSleep] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [pain, setPain] = useState(0);
  const [area, setArea] = useState<BodyArea>("knee");
  const [acute, setAcute] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sleep === null || energy === null) return;
    setBusy(true);
    setMsg("");
    setError(null);
    try {
      await c.checkin({
        member_id: memberId || undefined,
        sleep,
        energy,
        pain,
        ...(pain > 0 ? { pain_area: area, pain_acute: acute } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMsg(t("today.done"));
      onDone();
    } catch (err) {
      const code = toErrorCode(err);
      if (code === "conflict") setMsg(t("today.already"));
      else setError(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form coach-card" onSubmit={submit} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="form__title">
        {t("today.form")}
      </h2>
      <Scale
        name="sleep"
        legend={t("today.sleep")}
        value={sleep}
        onChange={setSleep}
        tour="coach-checkin-sleep"
      />
      <Scale
        name="energy"
        legend={t("today.energy")}
        value={energy}
        onChange={setEnergy}
        tour="coach-checkin-energy"
      />
      <div className="field">
        <label htmlFor={`${id}-pain`}>{t("today.pain")}</label>
        <select
          id={`${id}-pain`}
          value={pain}
          onChange={(e) => setPain(Number(e.target.value))}
          data-tour-id="coach-checkin-pain"
        >
          {PAIN_LEVELS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {pain > 0 ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-area`}>{t("today.painArea")}</label>
            <select
              id={`${id}-area`}
              value={area}
              onChange={(e) => setArea(e.target.value as BodyArea)}
            >
              {BODY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {t(`area.${a}` as CoachKey)}
                </option>
              ))}
            </select>
          </div>
          <label className="field--inline">
            <input type="checkbox" checked={acute} onChange={(e) => setAcute(e.target.checked)} />{" "}
            {t("today.painAcute")}
          </label>
        </>
      ) : null}
      <div className="field">
        <label htmlFor={`${id}-note`}>{t("today.note")}</label>
        <input
          id={`${id}-note`}
          value={note}
          maxLength={280}
          onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, " "))}
          aria-describedby={`${id}-note-help`}
        />
        <p id={`${id}-note-help`} className="help">
          {t("today.noteHelp")}
        </p>
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || sleep === null || energy === null}
          data-tour-id="coach-checkin-submit"
        >
          {t("today.submit")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
      <LiveResult>{msg}</LiveResult>
    </form>
  );
}
