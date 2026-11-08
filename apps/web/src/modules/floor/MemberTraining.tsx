import { useMemo } from "react";
import { ErrorNote, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { floorApi } from "./api";
import { useFloorT } from "./dict";
import { formatWhen } from "./shared";
import "./floor.css";
import { Card, Empty, Progress } from "./ui";

/**
 * Routine progress and equipment use of one member. Without `memberId` it is the member's own ("Mi
 * entrenamiento"); with it, a coach's view on the member profile (owner, location manager, trainer).
 */
export function MemberTraining({ memberId }: { memberId?: string }) {
  const { t, lang, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const data = useAsync(() => floor.training(memberId), [floor, memberId]);
  const d = data.data;

  return (
    <Card title={memberId ? t("training.title") : t("me.title")} icon={{ name: "layers" }}>
      {data.loading ? <Loading /> : null}
      {data.error ? <ErrorNote code={data.error} onRetry={data.reload} /> : null}
      {d ? (
        <div className="floor-training">
          {d.open ? (
            <div className="floor-training__open">
              <h3 className="floor-h3">
                {t("training.open")}: {d.open.circuit_name}
              </h3>
              <Progress pct={d.open.pct}>
                {t("use.progress", {
                  done: d.open.sets_done,
                  planned: d.open.sets_planned,
                  pct: d.open.pct,
                })}
              </Progress>
              <ol className="floor-steps">
                {d.open.steps.map((s) => (
                  <li key={s.position} className="floor-step">
                    <span className="floor-step__n">{s.position}</span>
                    <span className="floor-step__text">
                      <strong>{s.exercise_name}</strong>
                      <span className="muted">
                        {s.station_code ?? label("eq", s.equipment_type ?? "other")} ·{" "}
                        {t("use.stepDone", { done: s.done, sets: s.sets, reps: s.reps })}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <h3 className="floor-h3">{t("training.history")}</h3>
          {d.routines.length === 0 ? (
            <p className="muted">{t("training.none")}</p>
          ) : (
            <ul className="floor-list">
              {d.routines.map((r) => (
                <li key={r.run_id} className="floor-list__row">
                  <span className="floor-list__main">
                    <strong>{r.circuit_name}</strong>
                    <span className="muted">{formatWhen(r.started_at, lang)}</span>
                  </span>
                  <span className="floor-list__side">
                    <Plate tone={r.finished_at ? "neutral" : "ok"}>
                      {r.finished_at ? t("training.done") : t("training.inProgress")}
                    </Plate>
                    <span className="mono">{r.pct} %</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="floor-h3">{memberId ? t("training.uses") : t("me.recent")}</h3>
          {d.uses.length === 0 ? (
            <Empty icon={{ name: "qr" }} text={memberId ? t("training.noUses") : t("me.none")} />
          ) : (
            <ul className="floor-list">
              {d.uses.map((u) => (
                <li key={u.id} className="floor-list__row">
                  <span className="floor-list__main">
                    <strong>
                      <span className="mono">{u.station_code}</span> ·{" "}
                      {label("eq", u.equipment_type)}
                    </strong>
                    <span className="muted">
                      {[u.exercise_name, u.circuit_name, formatWhen(u.started_at, lang)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="floor-list__side">
                    {u.active ? <Plate tone="ok">{t("training.now")}</Plate> : null}
                    <span className="mono">{t("me.minutes", { n: u.minutes })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {d.by_equipment.length > 0 ? (
            <>
              <h3 className="floor-h3">{t("training.top")}</h3>
              <ul className="floor-chips">
                {d.by_equipment.map((b) => (
                  <li key={b.equipment_type} className="floor-chip">
                    {label("eq", b.equipment_type)} · {t("training.usesN", { n: b.uses })}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
