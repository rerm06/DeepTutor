import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { EQUIPMENT_TYPES, FLOOR_MANAGERS, MOVEMENT_PATTERNS, SAFE_NAME, floorApi } from "./api";
import { useFloorT } from "./dict";
import "./floor.css";
import { Card, Empty, FLOOR_ICON, Stat } from "./ui";

/** Staff "Ejercicios": the organisation's exercise library. */
export function ExercisesScreen() {
  const { t, label } = useFloorT();
  const { api, role } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const manage = FLOOR_MANAGERS.includes(role ?? "");
  const [showNew, setShowNew] = useState(false);
  const [pattern, setPattern] = useState("");
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const list = useAsync(() => floor.exercises(), [floor]);
  const newId = useId();
  const filterId = useId();
  const all = list.data?.data ?? [];
  const rows = all.filter((e) => !pattern || e.movement_pattern === pattern);

  async function toggle(id: string, name: string, active: boolean) {
    setError(null);
    try {
      await floor.setExerciseActive(id, active);
      setAnnounce(`${name}: ${active ? t("common.active") : t("common.inactive")}`);
      list.reload();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <div className="page floor-page">
      <div className="page__head">
        <div className="floor-head">
          <h1 className="page__title">{t("exercises.title")}</h1>
          <p className="lede">{t("exercises.lede")}</p>
        </div>
        {manage ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="floor-exercise-new"
            aria-expanded={showNew}
            aria-controls={newId}
            onClick={() => setShowNew((v) => !v)}
          >
            <Icon d={FLOOR_ICON.plus} size={18} />
            {t("exercises.new")}
          </button>
        ) : null}
      </div>
      {list.data ? (
        <div className="ds-stats">
          <Stat icon={{ name: "layers" }} label={t("exercises.statTotal")} value={all.length} />
          <Stat
            icon={{ name: "checkCircle" }}
            label={t("exercises.statActive")}
            value={all.filter((e) => e.active).length}
          />
        </div>
      ) : null}
      {manage && showNew ? (
        <div id={newId}>
          <NewExerciseForm
            onCreated={(name) => {
              setAnnounce(t("exercises.created", { name }));
              list.reload();
            }}
          />
        </div>
      ) : null}
      <LiveResult>{announce}</LiveResult>
      <Card
        title={t("exercises.list")}
        icon={{ name: "dumbbell" }}
        actions={
          <div className="field field--inline">
            <label htmlFor={filterId}>{t("common.pattern")}</label>
            <select id={filterId} value={pattern} onChange={(e) => setPattern(e.target.value)}>
              <option value="">—</option>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {label("pattern", p)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {error ? <ErrorNote code={error} /> : null}
        {list.loading ? <Loading /> : null}
        {list.data ? (
          rows.length === 0 ? (
            <Empty icon={{ name: "dumbbell" }} text={t("common.empty")} />
          ) : (
            <TableWrap label={t("exercises.title")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("common.name")}</th>
                    <th scope="col">{t("common.pattern")}</th>
                    <th scope="col">{t("common.type")}</th>
                    <th scope="col">{t("common.cues")}</th>
                    <th scope="col">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <th scope="row">{e.name}</th>
                      <td>
                        <span className="floor-chip">{label("pattern", e.movement_pattern)}</span>
                      </td>
                      <td>{label("eq", e.equipment_type)}</td>
                      <td className="floor-cues">{e.cues || "—"}</td>
                      <td>
                        {manage ? (
                          <button
                            type="button"
                            className={`btn btn--ghost floor-toggle${e.active ? " is-on" : ""}`}
                            aria-pressed={e.active}
                            aria-label={t("exercises.toggle", { name: e.name })}
                            onClick={() => toggle(e.id, e.name, !e.active)}
                          >
                            {e.active ? t("common.active") : t("common.inactive")}
                          </button>
                        ) : (
                          <Plate tone={e.active ? "ok" : "neutral"}>
                            {e.active ? t("common.active") : t("common.inactive")}
                          </Plate>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )
        ) : null}
      </Card>
    </div>
  );
}

function NewExerciseForm({ onCreated }: { onCreated: (name: string) => void }) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState<string>(MOVEMENT_PATTERNS[0]);
  const [equipment, setEquipment] = useState<string>("none");
  const [cues, setCues] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { name: useId(), help: useId(), pattern: useId(), eq: useId(), cues: useId() };
  const nameOk = name === "" || SAFE_NAME.test(name.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!SAFE_NAME.test(name.trim()) || /[<>{}]/.test(cues)) {
      setError("invalid_input");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await floor.createExercise({
        name: name.trim(),
        movement_pattern: pattern,
        equipment_type: equipment,
        cues: cues.trim(),
        active: true,
      });
      onCreated(name.trim());
      setName("");
      setCues("");
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("exercises.new")} icon={{ d: FLOOR_ICON.plus }}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.name}>{t("common.name")}</label>
            <input
              id={ids.name}
              value={name}
              required
              maxLength={80}
              aria-invalid={!nameOk}
              aria-describedby={ids.help}
              onChange={(e) => setName(e.target.value)}
            />
            <p id={ids.help} className="help">
              {t("exercises.nameHelp")}
            </p>
          </div>
          <div className="field">
            <label htmlFor={ids.pattern}>{t("common.pattern")}</label>
            <select id={ids.pattern} value={pattern} onChange={(e) => setPattern(e.target.value)}>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {label("pattern", p)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.eq}>{t("common.type")}</label>
            <select id={ids.eq} value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              {EQUIPMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {label("eq", x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--wide">
            <label htmlFor={ids.cues}>
              {t("common.cues")} <span className="muted">{t("common.optional")}</span>
            </label>
            <textarea
              id={ids.cues}
              value={cues}
              maxLength={1000}
              rows={3}
              onChange={(e) => setCues(e.target.value)}
            />
          </div>
        </div>
        {error ? <ErrorNote code={error} /> : null}
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="floor-exercise-save"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Card>
  );
}
