import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  type Asset,
  type Circuit,
  type Exercise,
  FLOOR_MANAGERS,
  SAFE_NAME,
  type StepInput,
  floorApi,
} from "./api";
import { useFloorT } from "./dict";
import "./floor.css";
import { Card, Empty, FLOOR_ICON, Stat } from "./ui";

/** Staff "Circuitos": circuits per location and a builder for their ordered steps. */
export function CircuitsScreen() {
  const { t } = useFloorT();
  const { api, role } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const manage = FLOOR_MANAGERS.includes(role ?? "");
  const [announce, setAnnounce] = useState<string | null>(null);
  const [editing, setEditing] = useState<Circuit | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const locations = useAsync(() => api.locations(), [api]);
  const circuits = useAsync(() => floor.circuits(), [floor]);
  const locs = locations.data?.data ?? [];
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const rows = circuits.data?.data ?? [];

  async function setActive(c: Circuit, active: boolean) {
    setError(null);
    try {
      await floor.setCircuitActive(c.id, active);
      setAnnounce(`${c.name}: ${active ? t("common.active") : t("common.inactive")}`);
      circuits.reload();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <div className="page floor-page">
      <div className="floor-head">
        <h1 className="page__title">{t("circuits.title")}</h1>
        <p className="lede">{t("circuits.lede")}</p>
      </div>
      {circuits.data ? (
        <div className="ds-stats">
          <Stat icon={{ name: "layers" }} label={t("circuits.statTotal")} value={rows.length} />
          <Stat
            icon={{ name: "checkCircle" }}
            label={t("circuits.statActive")}
            value={rows.filter((c) => c.active).length}
          />
          <Stat
            icon={{ name: "dumbbell" }}
            label={t("circuits.statSteps")}
            value={rows.reduce((n, c) => n + c.steps, 0)}
          />
        </div>
      ) : null}
      {manage ? (
        <NewCircuitForm
          locations={locs}
          onCreated={(name) => {
            setAnnounce(t("circuits.created", { name }));
            circuits.reload();
          }}
        />
      ) : null}
      <LiveResult>{announce}</LiveResult>
      <Card title={t("circuits.list")} icon={{ name: "layers" }}>
        {circuits.error ? <ErrorNote code={circuits.error} onRetry={circuits.reload} /> : null}
        {error ? <ErrorNote code={error} /> : null}
        {circuits.loading ? <Loading /> : null}
        {circuits.data && rows.length === 0 ? (
          <Empty icon={{ name: "layers" }} text={t("common.empty")} />
        ) : null}
        {rows.length > 0 ? (
          <TableWrap label={t("circuits.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("common.name")}</th>
                  <th scope="col">{t("common.location")}</th>
                  <th scope="col">{t("circuits.steps")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td>{locName.get(c.location_id) ?? ""}</td>
                    <td>
                      <span className="floor-count">{c.steps}</span>
                    </td>
                    <td>
                      <Plate tone={c.active ? "ok" : "neutral"}>
                        {c.active ? t("common.active") : t("common.inactive")}
                      </Plate>
                    </td>
                    <td>
                      {manage ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn"
                            data-tour-id="floor-circuit-edit"
                            onClick={() => setEditing(c)}
                          >
                            <Icon name="dumbbell" size={18} />
                            {t("circuits.edit")}
                            <span className="sr-only">: {c.name}</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => setActive(c, !c.active)}
                          >
                            {c.active ? t("circuits.deactivate") : t("circuits.activate")}
                            <span className="sr-only">: {c.name}</span>
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
      {editing ? (
        <StepBuilder
          key={editing.id}
          circuit={editing}
          onSaved={(n) => {
            setAnnounce(t("circuits.saved", { n }));
            circuits.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function NewCircuitForm({
  locations,
  onCreated,
}: {
  locations: Array<{ id: string; name: string }>;
  onCreated: (name: string) => void;
}) {
  const { t } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { name: useId(), loc: useId() };
  const loc = locationId || locations[0]?.id || "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!SAFE_NAME.test(name.trim()) || !loc) {
      setError("invalid_input");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await floor.createCircuit({ location_id: loc, name: name.trim() });
      onCreated(name.trim());
      setName("");
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("circuits.new")} icon={{ name: "calendarPlus" }}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.name}>{t("common.name")}</label>
            <input
              id={ids.name}
              value={name}
              maxLength={80}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.loc}>{t("common.location")}</label>
            <select id={ids.loc} value={loc} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error ? <ErrorNote code={error} /> : null}
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="floor-circuit-new"
          >
            <Icon d={FLOOR_ICON.plus} size={18} />
            {busy ? t("common.saving") : t("circuits.new")}
          </button>
        </div>
      </form>
    </Card>
  );
}

interface DraftStep extends StepInput {
  key: number;
}

/** Ordered step editor. Saving replaces the circuit's steps in one transaction on the server. */
export function StepBuilder({
  circuit,
  onSaved,
}: { circuit: Circuit; onSaved: (n: number) => void }) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const detail = useAsync(() => floor.circuit(circuit.id), [floor, circuit.id]);
  const exercises = useAsync(() => floor.exercises(), [floor]);
  const assets = useAsync(() => floor.assets(circuit.location_id), [floor, circuit.location_id]);
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    if (!detail.data) return;
    setSteps(
      detail.data.steps.map((s, i) => ({
        key: -(i + 1),
        exercise_id: s.exercise_id,
        asset_id: s.asset_id,
        equipment_type: s.asset_id ? null : s.equipment_type,
        sets: s.sets,
        reps: s.reps,
        rest_seconds: s.rest_seconds,
      })),
    );
  }, [detail.data]);

  const exList = (exercises.data?.data ?? []).filter((e) => e.active);
  const exName = new Map(exList.map((e) => [e.id, e]));
  const assetList = assets.data?.data ?? [];
  const assetById = new Map(assetList.map((a) => [a.id, a]));

  function move(i: number, d: -1 | 1) {
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j] as DraftStep, c[i] as DraftStep];
      return c;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await floor.saveSteps(
        circuit.id,
        steps.map(({ key: _k, ...s }) => s),
      );
      onSaved(r.steps);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("circuits.editing", { name: circuit.name })} icon={{ name: "dumbbell" }}>
      {detail.loading || exercises.loading ? <Loading /> : null}
      {detail.error ? <ErrorNote code={detail.error} onRetry={detail.reload} /> : null}
      {steps.length === 0 && detail.data ? (
        <Empty icon={{ name: "dumbbell" }} text={t("circuits.noSteps")} />
      ) : null}
      <ol className="floor-steps" aria-label={t("circuits.steps")}>
        {steps.map((s, i) => {
          const ex = exName.get(s.exercise_id);
          const a = s.asset_id ? assetById.get(s.asset_id) : undefined;
          return (
            <li key={s.key} className="floor-step">
              <span className="floor-step__n" aria-hidden="true">
                {i + 1}
              </span>
              <div className="floor-step-row">
                <span className="floor-step__text">
                  <strong>{ex?.name ?? "—"}</strong>
                  <span className="floor-step__meta">
                    {a ? (
                      <span className="floor-chip mono">{a.station_code}</span>
                    ) : (
                      <span className="floor-chip">{label("eq", s.equipment_type ?? "")}</span>
                    )}
                    <span>
                      {t("circuits.stepSummary", {
                        sets: s.sets,
                        reps: s.reps,
                        rest: s.rest_seconds,
                      })}
                    </span>
                  </span>
                </span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={i === 0}
                    aria-label={t("circuits.up", { n: i + 1 })}
                    onClick={() => move(i, -1)}
                  >
                    <Icon d={FLOOR_ICON.up} size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={i === steps.length - 1}
                    aria-label={t("circuits.down", { n: i + 1 })}
                    onClick={() => move(i, 1)}
                  >
                    <Icon d={FLOOR_ICON.down} size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    aria-label={t("circuits.remove", { n: i + 1 })}
                    onClick={() => setSteps((x) => x.filter((_, k) => k !== i))}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <AddStepForm
        exercises={exList}
        assets={assetList}
        onAdd={(s) => {
          setSteps((x) => [...x, { ...s, key: nextKey }]);
          setNextKey((k) => k + 1);
        }}
      />
      {error ? <ErrorNote code={error} /> : null}
      <div className="form__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !detail.data}
          data-tour-id="floor-circuit-save"
          onClick={save}
        >
          {busy ? t("common.saving") : t("circuits.saveSteps")}
        </button>
      </div>
    </Card>
  );
}

function AddStepForm({
  exercises,
  assets,
  onAdd,
}: {
  exercises: Exercise[];
  assets: Asset[];
  onAdd: (s: StepInput) => void;
}) {
  const { t, label } = useFloorT();
  const [exerciseId, setExerciseId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [rest, setRest] = useState(60);
  const ids = { ex: useId(), asset: useId(), sets: useId(), reps: useId(), rest: useId() };
  const ex = exercises.find((e) => e.id === exerciseId) ?? exercises[0];
  const matching = assets.filter((a) => a.equipment_type === ex?.equipment_type);

  function add(e: FormEvent) {
    e.preventDefault();
    if (!ex) return;
    const asset = matching.find((a) => a.id === assetId);
    onAdd({
      exercise_id: ex.id,
      asset_id: asset ? asset.id : null,
      equipment_type: asset ? null : ex.equipment_type,
      sets,
      reps,
      rest_seconds: rest,
    });
  }

  return (
    <form className="form form--boxed" onSubmit={add}>
      <h3 className="form__title floor-h3">
        <Icon d={FLOOR_ICON.plus} size={20} />
        {t("circuits.addStep")}
      </h3>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.ex}>{t("circuits.exercise")}</label>
          <select
            id={ids.ex}
            value={ex?.id ?? ""}
            onChange={(e) => {
              setExerciseId(e.target.value);
              setAssetId("");
            }}
          >
            {exercises.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {label("pattern", x.movement_pattern)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.asset}>{t("circuits.station")}</label>
          <select id={ids.asset} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">{t("circuits.anyStation")}</option>
            {matching.map((a) => (
              <option key={a.id} value={a.id}>
                {a.station_code} · {label("status", a.status)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.sets}>{t("circuits.sets")}</label>
          <input
            id={ids.sets}
            className="floor-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={sets}
            onChange={(e) => setSets(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.reps}>{t("circuits.reps")}</label>
          <input
            id={ids.reps}
            className="floor-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={reps}
            onChange={(e) => setReps(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.rest}>{t("circuits.rest")}</label>
          <input
            id={ids.rest}
            className="floor-number"
            type="number"
            inputMode="numeric"
            min={0}
            max={900}
            step={15}
            value={rest}
            onChange={(e) => setRest(Math.max(0, Math.min(900, Number(e.target.value) || 0)))}
          />
        </div>
      </div>
      <div className="form__actions">
        <button type="submit" className="btn" disabled={!ex} data-tour-id="floor-step-add">
          {t("circuits.addStep")}
        </button>
      </div>
    </form>
  );
}
