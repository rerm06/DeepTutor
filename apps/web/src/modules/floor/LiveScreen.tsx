import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { MemberAvatar } from "../../components/MemberPhotoCard";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type LiveBoard, floorApi } from "./api";
import { useFloorT } from "./dict";
import { assetTone, formatTime } from "./shared";
import "./floor.css";
import { Card, Empty, Progress, Stat } from "./ui";

const POLL_MS = 10_000;

/**
 * Owner / location manager / trainer: every station with who is using it now and today's totals, and the members
 * running a routine with their progress. Polls every 10 seconds while the tab is visible (no websockets on this
 * hosting); the time of the last update is always shown.
 */
export function LiveScreen() {
  const { t, lang, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const [locationId, setLocationId] = useState("");
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [hidden, setHidden] = useState(false);
  const busy = useRef(false);
  const filterId = useId();

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setBoard(await floor.live(locationId || undefined));
      setError(null);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      busy.current = false;
    }
  }, [floor, locationId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVis = () => {
      const h = document.visibilityState !== "visible";
      setHidden(h);
      if (!h) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const locs = locations.data?.data ?? [];
  const locName = new Map(locs.map((l) => [l.id, l.name]));

  return (
    <div className="page floor-page">
      <div className="page__head">
        <div className="floor-head">
          <h1 className="page__title">{t("live.title")}</h1>
          <p className="lede">{t("live.lede")}</p>
        </div>
        <div className="field field--inline">
          <label htmlFor={filterId}>{t("common.location")}</label>
          <select id={filterId} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("common.allLocations")}</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted floor-live__stamp" aria-live="off">
        <span
          className={hidden ? "floor-live__dot is-paused" : "floor-live__dot"}
          aria-hidden="true"
        />
        {hidden
          ? t("live.paused")
          : board
            ? t("live.updated", { time: formatTime(board.at, lang) })
            : null}
      </p>
      {error ? <ErrorNote code={error} onRetry={load} /> : null}
      {!board && !error ? <Loading /> : null}

      {board ? (
        <>
          <div className="ds-stats">
            <Stat
              icon={{ name: "dumbbell" }}
              label={t("live.statStations")}
              value={board.totals.stations}
            />
            <Stat
              icon={{ name: "checkCircle" }}
              label={t("live.statInUse")}
              value={board.totals.in_use}
            />
            <Stat
              icon={{ name: "users" }}
              label={t("live.statMembers")}
              value={board.totals.members_now}
            />
            <Stat
              icon={{ name: "layers" }}
              label={t("live.statToday")}
              value={board.totals.uses_today}
            />
          </div>

          <Card title={t("live.training")} icon={{ name: "layers" }}>
            {board.training.length === 0 ? (
              <Empty icon={{ name: "layers" }} text={t("live.noTraining")} />
            ) : (
              <ul className="floor-live__training">
                {board.training.map((r) => (
                  <li key={r.run_id} className="floor-live__person">
                    <MemberAvatar
                      memberId={r.member_id}
                      name={r.name ?? t("live.member")}
                      size={40}
                    />
                    <span className="floor-live__who">
                      <Link to={`/staff/members/${r.member_id}`}>
                        <strong>{r.name ?? t("live.member")}</strong>
                      </Link>
                      <span className="muted">
                        {r.circuit_name}
                        {r.station_code
                          ? ` · ${t("live.onStation", { code: r.station_code })}`
                          : ""}
                      </span>
                      <Progress pct={r.pct}>
                        {t("use.progress", {
                          done: r.sets_done,
                          planned: r.sets_planned,
                          pct: r.pct,
                        })}
                      </Progress>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {board.assets.length === 0 ? (
            <Empty
              icon={{ name: "dumbbell" }}
              text={t("live.empty")}
              action={
                <Link className="btn" to="/staff/floor/equipment">
                  {t("nav.equipment")}
                </Link>
              }
            />
          ) : (
            <ul className="floor-live__grid" aria-label={t("live.title")}>
              {board.assets.map((a) => {
                const busyNow = a.in_use.length > 0;
                return (
                  <li
                    key={a.id}
                    className={`floor-live__tile${busyNow ? " is-busy" : ""}${a.status !== "ok" ? " is-down" : ""}`}
                  >
                    <div className="floor-live__head">
                      <span className="mono floor-live__code">{a.station_code}</span>
                      {a.status !== "ok" ? (
                        <Plate tone={assetTone(a.status)}>{label("status", a.status)}</Plate>
                      ) : (
                        <Plate tone={busyNow ? "ok" : "neutral"}>
                          {busyNow ? t("live.statInUse") : t("live.free")}
                        </Plate>
                      )}
                    </div>
                    <span className="muted">
                      {label("eq", a.equipment_type)}
                      {locs.length > 1 ? ` · ${locName.get(a.location_id) ?? ""}` : ""}
                    </span>
                    {a.in_use.map((u) => (
                      <div key={u.use_id} className="floor-live__user">
                        <MemberAvatar
                          memberId={u.member_id}
                          name={u.name ?? t("live.member")}
                          size={32}
                        />
                        <span>
                          <strong>{u.name ?? t("live.member")}</strong>
                          <span className="muted">
                            {[u.exercise_name, t("live.since", { time: formatTime(u.since, lang) })]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </div>
                    ))}
                    <span className="floor-live__today">
                      <Icon name="layers" size={16} />
                      {t("live.today", {
                        uses: a.uses_today,
                        members: a.members_today,
                        minutes: a.minutes_today,
                        sets: a.sets_today,
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
