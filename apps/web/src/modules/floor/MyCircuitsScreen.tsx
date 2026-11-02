import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  type Circuit,
  type CircuitDetail,
  type CircuitStep,
  type Substitute,
  floorApi,
} from "./api";
import { useFloorT } from "./dict";
import { assetTone, formatWhen } from "./shared";
import "./floor.css";

/** Member "Mis circuitos": pick a circuit, run it step by step, log sets, report busy/out-of-service machines. */
export function MyCircuitsScreen() {
  const { t, lang } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const circuits = useAsync(() => floor.circuits(), [floor]);
  const locations = useAsync(() => api.locations(), [api]);
  const [version, setVersion] = useState(0);
  const sets = useAsync(() => floor.mySets(), [floor, version]);
  const [active, setActive] = useState<{ run: string; circuit: CircuitDetail } | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const locName = new Map((locations.data?.data ?? []).map((l) => [l.id, l.name]));
  const list = (circuits.data?.data ?? []).filter((c) => c.active && c.steps > 0);

  async function start(c: Circuit) {
    setError(null);
    try {
      const [run, detail] = await Promise.all([floor.startRun(c.id), floor.circuit(c.id)]);
      setActive({ run: run.id, circuit: detail });
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">{t("my.title")}</h1>
      <p className="lede">{t("my.lede")}</p>
      <LiveResult>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}

      {active ? (
        <Runner
          run={active.run}
          circuit={active.circuit}
          onLogged={(msg) => {
            setAnnounce(msg);
            setVersion((v) => v + 1);
          }}
          onFinished={() => {
            setActive(null);
            setAnnounce(t("my.finished"));
          }}
        />
      ) : (
        <Section title={t("nav.myCircuits")}>
          {circuits.loading ? <Loading /> : null}
          {circuits.error ? <ErrorNote code={circuits.error} onRetry={circuits.reload} /> : null}
          {circuits.data && list.length === 0 ? <p className="muted">{t("my.empty")}</p> : null}
          <ul className="floor-cards">
            {list.map((c) => (
              <li key={c.id} className="floor-card">
                <h3 className="floor-card__title">{c.name}</h3>
                <div className="floor-card__meta">
                  <span>{locName.get(c.location_id) ?? ""}</span>
                  <span>
                    {c.steps} {t("circuits.steps").toLowerCase()}
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-tour-id="floor-run-start"
                    onClick={() => start(c)}
                  >
                    {t("my.start")}
                    <span className="sr-only">: {c.name}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("my.history")}>
        {sets.error ? <ErrorNote code={sets.error} onRetry={sets.reload} /> : null}
        {sets.data && sets.data.data.length === 0 ? (
          <p className="muted">{t("my.historyEmpty")}</p>
        ) : null}
        <ul className="floor-cards">
          {(sets.data?.data ?? []).map((s) => (
            <li key={s.id} className="floor-card">
              <div className="floor-step-row">
                <strong>{s.exercise_name}</strong>
                <span className="mono">
                  {s.reps} × {s.weight_kg} kg
                </span>
              </div>
              <span className="muted">
                {formatWhen(s.at, lang)} · {locName.get(s.location_id) ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

interface Override {
  exercise_id: string;
  name: string;
  cues: string;
  asset_id: string | null;
  station_code: string | null;
}

function Runner({
  run,
  circuit,
  onLogged,
  onFinished,
}: {
  run: string;
  circuit: CircuitDetail;
  onLogged: (msg: string) => void;
  onFinished: () => void;
}) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<number, number>>({});
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [subs, setSubs] = useState<Substitute[] | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = circuit.steps[index] as CircuitStep;
  const ov = overrides[index];
  const exerciseId = ov?.exercise_id ?? step.exercise_id;
  const assetId = ov ? ov.asset_id : step.asset_id;
  const stationCode = ov ? ov.station_code : step.station_code;
  const total = circuit.steps.length;
  const doneHere = done[index] ?? 0;

  async function busyMachine() {
    setError(null);
    setNote(null);
    try {
      if (assetId) await floor.report(assetId, "busy");
      const r = await floor.substitutes(exerciseId, circuit.location_id, assetId);
      setSubs(r.data);
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  async function outOfService() {
    if (!assetId || !stationCode) return;
    setError(null);
    try {
      await floor.report(assetId, "out_of_service");
      setNote(t("my.oosSent", { code: stationCode }));
      const r = await floor.substitutes(exerciseId, circuit.location_id, assetId);
      setSubs(r.data);
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  function use(s: Substitute) {
    setOverrides((o) => ({
      ...o,
      [index]: {
        exercise_id: s.exercise_id,
        name: s.name,
        cues: s.cues,
        asset_id: s.asset_id,
        station_code: s.station_code,
      },
    }));
    setSubs(null);
  }
  function go(d: -1 | 1) {
    setIndex((i) => Math.max(0, Math.min(total - 1, i + d)));
    setSubs(null);
    setNote(null);
  }
  async function finish() {
    setBusy(true);
    try {
      await floor.finishRun(run);
      onFinished();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={circuit.name}>
      <p className="muted" aria-live="polite">
        {t("my.step", { n: index + 1, total })}
      </p>
      <article className="floor-card" aria-labelledby={`floor-step-${index}`}>
        <h3 id={`floor-step-${index}`} className="floor-card__title">
          {ov ? ov.name : step.exercise_name}
        </h3>
        {ov ? <p className="note note--warn">{t("my.usingSub", { name: ov.name })}</p> : null}
        <div className="floor-card__meta">
          <span>{t("my.target", { sets: step.sets, reps: step.reps })}</span>
          <span>
            {stationCode
              ? t("my.atStation", { code: stationCode })
              : t("my.anyStation", { type: label("eq", step.equipment_type) })}
          </span>
          {!ov && step.asset_status ? (
            <Plate tone={assetTone(step.asset_status)}>{label("status", step.asset_status)}</Plate>
          ) : null}
        </div>
        <p className="floor-cues">{ov ? ov.cues : step.cues}</p>
        <p>
          <strong>
            {t("my.setOf", { done: Math.min(doneHere + 1, step.sets), sets: step.sets })}
          </strong>
        </p>
        <LogSetForm
          key={`${index}:${exerciseId}`}
          defaultReps={step.reps}
          onLog={async (reps, kg) => {
            await floor.logSet({
              exercise_id: exerciseId,
              location_id: circuit.location_id,
              asset_id: assetId ?? undefined,
              circuit_run_id: run,
              reps,
              weight_kg: kg,
            });
            setDone((d) => ({ ...d, [index]: (d[index] ?? 0) + 1 }));
            onLogged(t("my.logged", { reps, kg }));
          }}
        />
        <div className="row-actions">
          <button type="button" className="btn" data-tour-id="floor-run-busy" onClick={busyMachine}>
            {t("my.busy")}
          </button>
          {assetId ? (
            <button
              type="button"
              className="btn btn--danger-outline"
              data-tour-id="floor-run-oos"
              onClick={outOfService}
            >
              {t("my.oos")}
            </button>
          ) : null}
        </div>
        <LiveResult tone={note ? "ok" : undefined}>{note}</LiveResult>
        {error ? <ErrorNote code={error} /> : null}
        {subs ? (
          <section aria-label={t("my.subsTitle")}>
            <h4>{t("my.subsTitle")}</h4>
            {subs.length === 0 ? <p className="muted">{t("my.subsEmpty")}</p> : null}
            <ul className="floor-cards">
              {subs.map((s) => (
                <li key={`${s.exercise_id}:${s.asset_id ?? "none"}`} className="floor-card">
                  <div className="floor-step-row">
                    <strong>{s.name}</strong>
                    <span className="mono">{s.station_code ?? t("my.noEquipment")}</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="btn"
                      data-tour-id="floor-run-substitute"
                      onClick={() => use(s)}
                    >
                      {t("my.use", { name: s.name })}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
      <div className="form__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={index === 0}
          onClick={() => go(-1)}
        >
          {t("my.prev")}
        </button>
        {index < total - 1 ? (
          <button type="button" className="btn" data-tour-id="floor-run-next" onClick={() => go(1)}>
            {t("my.next")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="floor-run-finish"
          onClick={finish}
        >
          {t("my.finish")}
        </button>
      </div>
    </Section>
  );
}

function LogSetForm({
  defaultReps,
  onLog,
}: {
  defaultReps: number;
  onLog: (reps: number, kg: number) => Promise<void>;
}) {
  const { t } = useFloorT();
  const [reps, setReps] = useState(String(defaultReps));
  const [kg, setKg] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { reps: useId(), kg: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = Number(reps);
    const w = Math.round(Number(kg.replace(",", ".")) * 100) / 100;
    if (!Number.isInteger(r) || r < 0 || r > 1000 || !Number.isFinite(w) || w < 0 || w > 1000) {
      setError("invalid_input");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onLog(r, w);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.reps}>{t("my.reps")}</label>
          <input
            id={ids.reps}
            className="floor-number"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.kg}>{t("my.kg")}</label>
          <input
            id={ids.kg}
            className="floor-number"
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
          />
        </div>
      </div>
      {error ? <ErrorNote code={error} /> : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="floor-run-log"
        >
          {t("my.log")}
        </button>
      </div>
    </form>
  );
}
