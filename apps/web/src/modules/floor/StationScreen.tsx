import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Plate, Section } from "../../components/ui";
import { useSession } from "../../session/SessionContext";
import { STATION_CODE, type StationCard, floorApi, normalizeCode } from "./api";
import { useFloorT } from "./dict";
import { assetTone } from "./shared";
import "./floor.css";

/** Member "Escanear estación": type or paste the code from a QR label → exercise card with technique cues. */
export function StationScreen() {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [code, setCode] = useState("");
  const [card, setCard] = useState<StationCard | null>(null);
  const [problem, setProblem] = useState<"invalid" | "notFound" | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { code: useId(), help: useId(), err: useId() };

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    setCard(null);
    setError(null);
    setNote(null);
    if (!STATION_CODE.test(c)) {
      setProblem("invalid");
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      setCard(await floor.station(c));
    } catch (err) {
      const codeErr = toErrorCode(err);
      if (codeErr === "not_found") setProblem("notFound");
      else setError(codeErr);
    } finally {
      setBusy(false);
    }
  }

  async function reportOos() {
    if (!card) return;
    setError(null);
    try {
      await floor.report(card.asset.id, "out_of_service");
      setNote(t("my.oosSent", { code: card.asset.station_code }));
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">{t("station.title")}</h1>
      <p className="lede">{t("station.lede")}</p>
      <form className="form" onSubmit={lookup} noValidate>
        <div className="toolbar">
          <div className="field field--grow">
            <label htmlFor={ids.code}>{t("station.code")}</label>
            <input
              id={ids.code}
              value={code}
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mono"
              aria-invalid={problem === "invalid"}
              aria-describedby={problem ? ids.err : undefined}
              data-tour-id="floor-station-code"
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="floor-station-lookup"
          >
            {t("station.lookup")}
          </button>
        </div>
        {problem ? (
          <p id={ids.err} className="field-error" role="alert">
            {problem === "invalid" ? t("station.invalid") : t("station.notFound")}
          </p>
        ) : null}
      </form>
      {error ? <ErrorNote code={error} /> : null}
      <LiveResult tone={note ? "ok" : undefined}>{note}</LiveResult>

      {card ? (
        <Section title={`${card.asset.station_code} · ${label("eq", card.asset.equipment_type)}`}>
          <div className="floor-card__meta">
            <span>{card.asset.location_name}</span>
            {card.asset.brand ? (
              <span>{[card.asset.brand, card.asset.model].filter(Boolean).join(" · ")}</span>
            ) : null}
            <Plate tone={assetTone(card.asset.status)}>{label("status", card.asset.status)}</Plate>
          </div>
          <h3>{t("station.exercises")}</h3>
          {card.exercises.length === 0 ? <p className="muted">{t("station.noExercises")}</p> : null}
          <ul className="floor-cards">
            {card.exercises.map((e) => (
              <li key={e.id} className="floor-card">
                <h4 className="floor-card__title">{e.name}</h4>
                <div className="floor-card__meta">
                  <span>{label("pattern", e.movement_pattern)}</span>
                </div>
                {e.cues ? <p className="floor-cues">{e.cues}</p> : null}
              </li>
            ))}
          </ul>
          {card.circuit_steps.length > 0 ? (
            <>
              <h3>{t("station.inCircuits")}</h3>
              <ul>
                {card.circuit_steps.map((s) => (
                  <li key={`${s.circuit_id}:${s.position}`}>
                    {s.circuit_name} · {s.position}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {card.asset.status === "ok" ? (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--danger-outline"
                data-tour-id="floor-station-oos"
                onClick={reportOos}
              >
                {t("my.oos")}
              </button>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
