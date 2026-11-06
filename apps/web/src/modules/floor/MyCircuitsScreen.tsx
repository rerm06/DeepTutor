import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
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
import { Card, Empty, FLOOR_ICON } from "./ui";

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
    <div className="page floor-page">
      <div className="floor-head">
        <h1 className="page__title">{t("my.title")}</h1>
        <p className="lede">{t("my.lede")}</p>
      </div>
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
        <Card title={t("nav.myCircuits")} icon={{ name: "layers" }}>
          {circuits.loading ? <Loading /> : null}
          {circuits.error ? <ErrorNote code={circuits.error} onRetry={circuits.reload} /> : null}
          {circuits.data && list.length === 0 ? (
            <Empty icon={{ name: "layers" }} text={t("my.empty")} />
          ) : null}
          <ul className="ds-grid floor-programs">
            {list.map((c) => (
              <li key={c.id} className="floor-program">
                <img
                  className="ds-media floor-program__img"
                  src="/brand/program-strength.jpg"
                  alt=""
                  width={104}
                  height={140}
                />
                <div className="floor-program__text">
                  <h3 className="floor-card__title">{c.name}</h3>
                  <span className="floor-meta-item">
                    <Icon name="pin" size={16} />
                    {locName.get(c.location_id) ?? ""}
                  </span>
                  <span className="floor-meta-item">
                    <Icon name="dumbbell" size={16} />
                    {c.steps} {t("circuits.steps").toLowerCase()}
                  </span>
                  <button
                    type="button"
                    className="ds-cta"
                    data-tour-id="floor-run-start"
                    onClick={() => start(c)}
                  >
                    {t("my.start")}
                    <span className="sr-only">: {c.name}</span>
                    <Icon name="arrowRight" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t("my.history")} icon={{ d: FLOOR_ICON.clock }}>
        {sets.error ? <ErrorNote code={sets.error} onRetry={sets.reload} /> : null}
        {sets.data && sets.data.data.length === 0 ? (
          <Empty icon={{ name: "dumbbell" }} text={t("my.historyEmpty")} />
        ) : null}
        <ul className="floor-history">
          {(sets.data?.data ?? []).map((s) => (
            <li key={s.id} className="floor-history__row">
              <span className="floor-history__icon" aria-hidden="true">
                <Icon name="dumbbell" size={22} />
              </span>
              <span className="floor-history__text">
                <strong>{s.exercise_name}</strong>
                <span className="muted">
                  {formatWhen(s.at, lang)} · {locName.get(s.location_id) ?? ""}
                </span>
              </span>
              <span className="floor-history__pills">
                <span className="floor-pill floor-pill--sm">{s.weight_kg} kg</span>
                <span className="floor-pill floor-pill--sm">{s.reps}×</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
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
  const [logged, setLogged] = useState<Record<number, Array<{ reps: number; kg: number }>>>({});
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
  const loggedHere = logged[index] ?? [];
  const doneHere = loggedHere.length;

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

  const stepPct = Math.round(((index + 1) / total) * 100);

  return (
    <Card title={circuit.name} icon={{ name: "dumbbell" }} className="floor-run">
      <div className="floor-run__progress">
        <p className="floor-run__step" aria-live="polite">
          {t("my.step", { n: index + 1, total })}
        </p>
        <ol className="floor-run__dots" aria-hidden="true">
          {circuit.steps.map((s, i) => (
            <li
              key={s.id}
              className={i === index ? "is-current" : done_(logged, i) ? "is-done" : undefined}
            >
              {i + 1}
            </li>
          ))}
        </ol>
        <span className="ds-bar" aria-hidden="true">
          <span style={{ width: `${stepPct}%` }} />
        </span>
      </div>
      <article className="floor-step-card" aria-labelledby={`floor-step-${index}`}>
        <div className="floor-step-card__media">
          <div className="floor-step-card__photo">
            <img src="/brand/fitnessrus-hero.jpg" alt="" width={592} height={265} />
            <div className="floor-step-card__over">
              <h3 id={`floor-step-${index}`} className="floor-step-card__title">
                {ov ? ov.name : step.exercise_name}
              </h3>
              <div className="floor-card__meta">
                <span className="floor-chip floor-chip--solid">
                  {t("my.target", { sets: step.sets, reps: step.reps })}
                </span>
                <span className="floor-chip floor-chip--solid">
                  {stationCode
                    ? t("my.atStation", { code: stationCode })
                    : t("my.anyStation", { type: label("eq", step.equipment_type) })}
                </span>
                {!ov && step.asset_status ? (
                  <Plate tone={assetTone(step.asset_status)}>
                    {label("status", step.asset_status)}
                  </Plate>
                ) : null}
              </div>
            </div>
          </div>
          {ov ? (
            <p className="note note--warn">
              <Icon d={FLOOR_ICON.swap} size={18} />
              {t("my.usingSub", { name: ov.name })}
            </p>
          ) : null}
          <p className="floor-cues">{ov ? ov.cues : step.cues}</p>
        </div>
        <div className="floor-step-card__log">
          <p className="floor-run__setof">
            <strong>
              {t("my.setOf", { done: Math.min(doneHere + 1, step.sets), sets: step.sets })}
            </strong>
          </p>
          <LogSetForm
            key={`${index}:${exerciseId}`}
            defaultReps={step.reps}
            planned={step.sets}
            logged={loggedHere}
            onLog={async (reps, kg) => {
              await floor.logSet({
                exercise_id: exerciseId,
                location_id: circuit.location_id,
                asset_id: assetId ?? undefined,
                circuit_run_id: run,
                reps,
                weight_kg: kg,
              });
              setLogged((d) => ({ ...d, [index]: [...(d[index] ?? []), { reps, kg }] }));
              onLogged(t("my.logged", { reps, kg }));
            }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn"
              data-tour-id="floor-run-busy"
              onClick={busyMachine}
            >
              <Icon name="users" size={18} />
              {t("my.busy")}
            </button>
            {assetId ? (
              <button
                type="button"
                className="btn btn--danger-outline"
                data-tour-id="floor-run-oos"
                onClick={outOfService}
              >
                <Icon d={FLOOR_ICON.alert} size={18} />
                {t("my.oos")}
              </button>
            ) : null}
          </div>
          <LiveResult tone={note ? "ok" : undefined}>{note}</LiveResult>
          {error ? <ErrorNote code={error} /> : null}
          {subs ? (
            <section className="floor-subs" aria-label={t("my.subsTitle")}>
              <h4 className="floor-h3">
                <Icon d={FLOOR_ICON.swap} size={20} />
                {t("my.subsTitle")}
              </h4>
              {subs.length === 0 ? <p className="muted">{t("my.subsEmpty")}</p> : null}
              <ul className="floor-cards">
                {subs.map((s) => (
                  <li key={`${s.exercise_id}:${s.asset_id ?? "none"}`} className="floor-card">
                    <div className="floor-step-row">
                      <strong>{s.name}</strong>
                      <span className="floor-chip mono">
                        {s.station_code ?? t("my.noEquipment")}
                      </span>
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
        </div>
      </article>
      <div className="form__actions floor-run__nav">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={index === 0}
          onClick={() => go(-1)}
        >
          <Icon d="M15 6l-6 6 6 6" size={18} />
          {t("my.prev")}
        </button>
        {index < total - 1 ? (
          <button type="button" className="btn" data-tour-id="floor-run-next" onClick={() => go(1)}>
            {t("my.next")}
            <Icon name="chevronRight" size={18} />
          </button>
        ) : null}
        <button
          type="button"
          className="ds-cta"
          disabled={busy}
          data-tour-id="floor-run-finish"
          onClick={finish}
        >
          <Icon name="checkCircle" size={18} />
          {t("my.finish")}
        </button>
      </div>
    </Card>
  );
}

function done_(logged: Record<number, unknown[]>, i: number): boolean {
  return (logged[i]?.length ?? 0) > 0;
}

/**
 * Set logging like the client's reference: one row per set (set number · weight pill · reps pill · check).
 * Logged sets are read-only rows; the next set is the editable row whose check button logs it.
 */
function LogSetForm({
  defaultReps,
  planned,
  logged,
  onLog,
}: {
  defaultReps: number;
  planned: number;
  logged: Array<{ reps: number; kg: number }>;
  onLog: (reps: number, kg: number) => Promise<void>;
}) {
  const { t } = useFloorT();
  const [reps, setReps] = useState(String(defaultReps));
  const [kg, setKg] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { reps: useId(), kg: useId() };
  const current = logged.length + 1;
  const upcoming = Array.from(
    { length: Math.max(0, planned - current) },
    (_, i) => current + 1 + i,
  );

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
    <div className="floor-sets">
      <div className="floor-set floor-set--head" aria-hidden="true">
        <span>{t("my.setCol")}</span>
        <span>{t("my.kg")}</span>
        <span>{t("my.repsCol")}</span>
        <span />
      </div>
      <ol className="floor-sets__list">
        {logged.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: sets are append-only; the position is the set number
          <li key={i} className="floor-set is-done">
            <span className="floor-set__n">{i + 1}</span>
            <span className="floor-pill">{s.kg} kg</span>
            <span className="floor-pill">{s.reps}×</span>
            <span className="floor-set__check is-done">
              <Icon name="check" size={22} />
              <span className="sr-only">{t("my.setDone", { n: i + 1 })}</span>
            </span>
          </li>
        ))}
        <li className="floor-set is-current">
          <form className="floor-set__form" onSubmit={submit} noValidate>
            <span className="floor-set__n">
              <span className="floor-set__dot" aria-hidden="true" />
              <span className="sr-only">{current}</span>
            </span>
            <span className="floor-pill floor-pill--input">
              <label htmlFor={ids.kg} className="sr-only">
                {t("my.kg")}
              </label>
              <input
                id={ids.kg}
                className="floor-number"
                inputMode="decimal"
                value={kg}
                onChange={(e) => setKg(e.target.value)}
              />
              <span aria-hidden="true">kg</span>
            </span>
            <span className="floor-pill floor-pill--input">
              <label htmlFor={ids.reps} className="sr-only">
                {t("my.reps")}
              </label>
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
              <span aria-hidden="true">×</span>
            </span>
            <button
              type="submit"
              className="floor-set__check floor-set__check--go"
              disabled={busy}
              data-tour-id="floor-run-log"
            >
              <Icon name="check" size={24} />
              <span className="sr-only">{t("my.log")}</span>
            </button>
          </form>
        </li>
        {upcoming.map((n) => (
          <li key={n} className="floor-set is-planned">
            <span className="floor-set__n">{n}</span>
            <span className="floor-pill">— kg</span>
            <span className="floor-pill">{defaultReps}×</span>
            <span className="floor-set__check">
              <Icon name="check" size={22} />
              <span className="sr-only">{t("my.setPlanned", { n })}</span>
            </span>
          </li>
        ))}
      </ol>
      {error ? <ErrorNote code={error} /> : null}
    </div>
  );
}
