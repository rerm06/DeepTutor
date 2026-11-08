import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
import { useSession } from "../../session/SessionContext";
import { useGyms } from "../access";
import { CodeSignIn } from "../access/SignIn";
import { STATION_CODE, type StationCard, type UseView, floorApi, normalizeCode } from "./api";
import { useFloorT } from "./dict";
import { FLOOR_MANAGERS_SET, isMemberRole } from "./roles";
import { assetTone, formatTime } from "./shared";
import "./floor.css";
import { Card, Empty, FLOOR_ICON, Progress } from "./ui";

/**
 * /s/:code — what a phone opens when it scans an equipment label. A member's use is logged on arrival and mapped
 * to their open routine; the page then shows the routine progress, lets them log sets and end the use. Visitors
 * sign in first and come back here; staff are pointed to the live board.
 */
export function StationUseScreen() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const { persona, role } = useSession();
  const { t } = useFloorT();
  const norm = normalizeCode(code);

  return (
    <div className="page floor-page floor-use">
      {!STATION_CODE.test(norm) ? (
        <p className="field-error" role="alert">
          {t("station.invalid")}
        </p>
      ) : !persona ? (
        <SignInFirst code={norm} />
      ) : role === "member" ? (
        <MemberUse code={norm} source={params.get("via") === "code" ? "code" : "scan"} />
      ) : (
        <StaffView code={norm} coach={!isMemberRole(role) && FLOOR_MANAGERS_SET.has(role ?? "")} />
      )}
    </div>
  );
}

function SignInFirst({ code }: { code: string }) {
  const { t } = useFloorT();
  const gyms = useGyms();
  return (
    <section className="section floor-use__card" aria-labelledby="use-signin">
      <Icon name="qr" size={40} />
      <h1 id="use-signin" className="page__title">
        {t("use.signin")}
      </h1>
      <p className="lede">
        {t("use.title", { code })} · {t("use.signinSub")}
      </p>
      <CodeSignIn gyms={gyms} next={`/s/${encodeURIComponent(code)}`} />
    </section>
  );
}

function MemberUse({ code, source }: { code: string; source: "scan" | "code" }) {
  const { t, lang, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [view, setView] = useState<UseView | null>(null);
  const [card, setCard] = useState<StationCard | null>(null);
  const [problem, setProblem] = useState<"notFound" | "down" | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [ended, setEnded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sent = useRef<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent.current === code) return; // StrictMode runs effects twice: one use per scan
    sent.current = code;
    setView(null);
    setProblem(null);
    setError(null);
    setEnded(false);
    floor
      .startUse(code, source)
      .then((v) => {
        setView(v);
        headRef.current?.focus();
      })
      .catch((err) => {
        const c = toErrorCode(err);
        if (c === "not_found") setProblem("notFound");
        else if (c === "conflict") setProblem("down");
        else setError(c);
      });
    floor
      .station(code)
      .then(setCard)
      .catch(() => undefined);
  }, [floor, code, source]);

  async function end() {
    if (!view?.use) return;
    try {
      await floor.endUse(view.use.id);
      setEnded(true);
      setNote(t("use.ended", { code }));
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  async function refresh() {
    try {
      setView(await floor.myUse());
    } catch {
      /* the last view stays on screen */
    }
  }

  if (problem || error) {
    return (
      <section className="section floor-use__card" aria-labelledby="use-problem">
        <Icon d={FLOOR_ICON.alert} size={40} />
        <h1 id="use-problem" className="page__title">
          {t("use.title", { code })}
        </h1>
        {problem ? (
          <p className="lede" role="alert">
            {problem === "notFound" ? t("station.notFound") : t("use.down")}
          </p>
        ) : null}
        {error ? <ErrorNote code={error} /> : null}
        <Link className="btn btn--primary" to="/me/station">
          <Icon name="qr" size={18} />
          {t("use.scanNext")}
        </Link>
      </section>
    );
  }
  if (!view?.use) return <Loading />;
  const use = view.use;
  const routine = view.routine;
  const here = (s: { station_code: string | null; equipment_type: string | null }) =>
    s.station_code === use.station_code ||
    (!s.station_code && s.equipment_type === use.equipment_type);

  return (
    <>
      <section className="section floor-use__card" aria-labelledby="use-head">
        <div className="floor-use__badge" aria-hidden="true">
          <Icon name="checkCircle" size={34} />
        </div>
        <h1 id="use-head" ref={headRef} tabIndex={-1} className="page__title floor-use__title">
          {t("use.title", { code: use.station_code })}
        </h1>
        <p className="lede">
          {label("eq", use.equipment_type)} · {use.location_name}
        </p>
        <LiveResult tone={ended ? "ok" : undefined}>
          {ended ? note : t("use.registered", { time: formatTime(use.started_at, lang) })}
        </LiveResult>
        {card ? (
          <Plate tone={assetTone(card.asset.status)}>{label("status", card.asset.status)}</Plate>
        ) : null}
        <p className="muted floor-use__privacy">{t("use.privacy")}</p>
        <div className="row-actions floor-use__actions">
          {!ended ? (
            <button type="button" className="btn" onClick={end} data-tour-id="floor-use-end">
              <Icon name="checkCircle" size={18} />
              {t("use.end")}
            </button>
          ) : null}
          <Link className="btn btn--primary" to="/me/station">
            <Icon name="qr" size={18} />
            {t("use.scanNext")}
          </Link>
        </div>
      </section>

      {routine ? (
        <Card title={t("use.routine", { name: routine.circuit_name })} icon={{ name: "layers" }}>
          <Progress pct={routine.pct}>
            {t("use.progress", {
              done: routine.sets_done,
              planned: routine.sets_planned,
              pct: routine.pct,
            })}
          </Progress>
          <ol className="floor-steps">
            {routine.steps.map((s) => (
              <li key={s.position} className={here(s) ? "floor-step is-here" : "floor-step"}>
                <span className="floor-step__n">{s.position}</span>
                <span className="floor-step__text">
                  <strong>{s.exercise_name}</strong>
                  <span className="muted">
                    {s.station_code ?? label("eq", s.equipment_type ?? "other")} ·{" "}
                    {t("use.stepDone", { done: s.done, sets: s.sets, reps: s.reps })}
                  </span>
                </span>
                {here(s) ? <span className="floor-chip">{t("use.here")}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Card title={t("me.title")} icon={{ name: "layers" }}>
          <Empty
            icon={{ name: "layers" }}
            text={t("use.noRoutine")}
            action={
              <Link className="btn" to="/me/circuits">
                {t("use.myCircuits")}
              </Link>
            }
          />
        </Card>
      )}

      {!ended ? (
        <LogSet
          view={{ use, routine }}
          exercises={card?.exercises ?? []}
          onLogged={(msg) => {
            setNote(msg);
            void refresh();
          }}
        />
      ) : null}
      {note && !ended ? <LiveResult tone="ok">{note}</LiveResult> : null}
    </>
  );
}

function LogSet({
  view,
  exercises,
  onLogged,
}: {
  view: { use: NonNullable<UseView["use"]>; routine: UseView["routine"] };
  exercises: StationCard["exercises"];
  onLogged: (msg: string) => void;
}) {
  const { t } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const { use, routine } = view;
  // Choices: the routine's exercises on this station first, then the library's for this equipment.
  const options = useMemo(() => {
    const out: Array<{ id: string; name: string; inRoutine: boolean }> = [];
    for (const s of routine?.steps ?? []) {
      if (
        s.station_code === use.station_code ||
        (!s.station_code && s.equipment_type === use.equipment_type)
      )
        if (!out.some((o) => o.id === s.exercise_id))
          out.push({ id: s.exercise_id, name: s.exercise_name, inRoutine: true });
    }
    for (const e of exercises)
      if (!out.some((o) => o.id === e.id)) out.push({ id: e.id, name: e.name, inRoutine: false });
    return out;
  }, [routine, exercises, use]);
  const [exercise, setExercise] = useState("");
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { ex: useId(), reps: useId(), kg: useId() };
  const chosen = exercise || use.exercise_id || options[0]?.id || "";
  const inRoutine = options.find((o) => o.id === chosen)?.inRoutine ?? false;
  const repsN = Number.parseInt(reps, 10);
  const kgN = Number.parseFloat(weight.replace(",", "."));
  const valid = chosen !== "" && repsN >= 1 && repsN <= 1000 && kgN >= 0 && kgN <= 1000;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("invalid_input");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await floor.logSet({
        exercise_id: chosen,
        location_id: use.location_id,
        asset_id: use.asset_id,
        circuit_run_id: inRoutine && routine ? routine.run_id : undefined,
        reps: repsN,
        weight_kg: Math.round(kgN * 100) / 100,
      });
      onLogged(t("use.setSaved", { reps: repsN, weight: kgN }));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) return null;
  return (
    <Card title={t("use.logSet")} icon={{ name: "dumbbell" }}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.ex}>{t("use.exercise")}</label>
            <select id={ids.ex} value={chosen} onChange={(e) => setExercise(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.reps}>{t("use.reps")}</label>
            <input
              id={ids.reps}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={reps}
              aria-invalid={!(repsN >= 1 && repsN <= 1000)}
              onChange={(e) => setReps(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.kg}>{t("use.weight")}</label>
            <input
              id={ids.kg}
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step={0.5}
              value={weight}
              aria-invalid={!(kgN >= 0 && kgN <= 1000)}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>
        {error ? <ErrorNote code={error} /> : null}
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="floor-use-log"
          >
            <Icon d={FLOOR_ICON.plus} size={18} />
            {t("use.logSet")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function StaffView({ code, coach }: { code: string; coach: boolean }) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [card, setCard] = useState<StationCard | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  useEffect(() => {
    floor
      .station(code)
      .then(setCard)
      .catch((err) => setError(toErrorCode(err)));
  }, [floor, code]);
  return (
    <section className="section floor-use__card" aria-labelledby="use-staff">
      <Icon name="qr" size={40} />
      <h1 id="use-staff" className="page__title">
        {t("use.title", { code })}
      </h1>
      {card ? (
        <p className="lede">
          {label("eq", card.asset.equipment_type)} · {card.asset.location_name} ·{" "}
          {label("status", card.asset.status)}
        </p>
      ) : null}
      {error ? <ErrorNote code={error} /> : null}
      <p className="muted">{t("use.staff")}</p>
      {coach ? (
        <Link className="btn btn--primary" to="/staff/floor/live">
          {t("use.toLive")}
        </Link>
      ) : null}
    </section>
  );
}
