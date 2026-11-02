import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Section, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { GOAL_MAX, GOAL_MIN, type ProgressWeek, localDay, parseGoal, usePortalApi } from "./api";
import { type PortalKey, usePortalT } from "./dict";
import "./portal.css";

/** Member portal "Progreso": 12 local weeks of trainings, recent activity and the weekly goal editor. */
export function ProgressScreen() {
  const { t } = usePortalT();
  const papi = usePortalApi();
  const { role } = useSession();
  const progress = useAsync(() => papi.progress(), [papi]);
  const p = progress.data;

  return (
    <div className="page">
      <h1 className="page__title">{t("progress.title")}</h1>
      <p className="lede">{t("progress.lede")}</p>
      {progress.loading && !p ? <Loading /> : null}
      {progress.error ? <ErrorNote code={progress.error} onRetry={progress.reload} /> : null}
      {p ? (
        <>
          <Section title={t("progress.chart")}>
            <WeekBars weeks={p.weeks} goal={p.goal} />
          </Section>
          <Section title={t("goal.title")}>
            {role === "member" ? (
              <GoalEditor current={p.goal} onSaved={progress.reload} />
            ) : (
              <p className="muted">
                {t("progress.goalLine", { goal: p.goal })}. {t("goal.guardian")}
              </p>
            )}
          </Section>
          <Section title={t("progress.recent")}>
            <RecentList events={p.recent} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function WeekBars({ weeks, goal }: { weeks: ProgressWeek[]; goal: number }) {
  const { t, lang } = usePortalT();
  const top = Math.max(goal, 1, ...weeks.map((w) => w.trainings));
  const current = weeks[weeks.length - 1];
  const summary = t("progress.chartSummary", { n: current?.trainings ?? 0, goal });
  return (
    <>
      <figure className="portal-chart" data-tour-id="portal-progress-chart">
        <figcaption className="help">{summary}</figcaption>
        <div className="portal-bars" aria-hidden="true">
          <span
            className="portal-bars__goal"
            style={{ bottom: `${(goal / top) * 100}%` }}
            title={t("progress.goalLine", { goal })}
          />
          {weeks.map((w) => (
            <span key={w.week_start} className="portal-bars__col">
              <span
                className={`portal-bars__bar${w.trainings >= goal ? " portal-bars__bar--met" : ""}`}
                style={{ height: `${(w.trainings / top) * 100}%` }}
              />
              <span className="portal-bars__n">{w.trainings}</span>
            </span>
          ))}
        </div>
        <p className="help">{t("progress.goalLine", { goal })}</p>
      </figure>
      <TableWrap label={t("progress.chart")}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("progress.col.week")}</th>
              <th scope="col">{t("progress.col.trainings")}</th>
              <th scope="col">{t("progress.col.classes")}</th>
              <th scope="col">{t("progress.col.minutes")}</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr key={w.week_start}>
                <th scope="row">{t("progress.weekOf", { date: localDay(w.week_start, lang) })}</th>
                <td>{w.trainings}</td>
                <td>{w.classes_attended}</td>
                <td>{w.active_minutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="help">{t("progress.minutesHelp")}</p>
    </>
  );
}

function RecentList({ events }: { events: Array<{ at: string; kind: string; label: string }> }) {
  const { t, lang } = usePortalT();
  if (events.length === 0) return <p className="muted">{t("progress.noRecent")}</p>;
  return (
    <ul className="portal-list">
      {events.map((e) => (
        <li key={`${e.kind}-${e.at}`} className="portal-list__item">
          <span className="portal-list__kind">{t(`progress.kind.${e.kind}` as PortalKey)}</span>
          <span>{e.label}</span>
          <time className="muted" dateTime={e.at}>
            {formatDateTime(e.at, lang)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** Weekly goal editor (members only; guardians read it). Validates 1–14 before calling the API. */
export function GoalEditor({ current, onSaved }: { current: number; onSaved: () => void }) {
  const { t } = usePortalT();
  const papi = usePortalApi();
  const ids = { input: useId(), help: useId(), err: useId() };
  const [value, setValue] = useState(String(current));
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = parseGoal(value);
    setSaved(null);
    setError(null);
    if (n === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      const r = await papi.setGoal(n);
      setSaved(r.weekly_trainings);
      onSaved();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form portal-goal" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={ids.input}>{t("goal.label")}</label>
        <input
          id={ids.input}
          type="number"
          inputMode="numeric"
          min={GOAL_MIN}
          max={GOAL_MAX}
          step={1}
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${ids.help}${invalid ? ` ${ids.err}` : ""}`}
          onChange={(e) => setValue(e.target.value)}
          data-tour-id="portal-goal-input"
        />
        <p id={ids.help} className="help">
          {t("goal.help")}
        </p>
        {invalid ? (
          <p id={ids.err} className="field-error" role="alert">
            {t("goal.invalid")}
          </p>
        ) : null}
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="portal-goal-save"
        >
          {busy ? t("goal.saving") : t("goal.save")}
        </button>
      </div>
      <LiveResult tone={saved !== null ? "ok" : undefined}>
        {saved !== null ? t("goal.saved", { n: saved }) : ""}
      </LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}
