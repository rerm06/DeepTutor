import { type FormEvent, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Plate } from "../../components/ui";
import { useSession } from "../../session/SessionContext";
import { STATION_CODE, type StationCard, floorApi, normalizeCode } from "./api";
import { useFloorT } from "./dict";
import { assetTone } from "./shared";
import "./floor.css";
import { Card, Empty, FLOOR_ICON } from "./ui";

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
    <div className="page floor-page">
      <div className="floor-head">
        <h1 className="page__title">{t("station.title")}</h1>
        <p className="lede">{t("station.lede")}</p>
      </div>
      <Card title={t("station.find")} icon={{ name: "qr" }}>
        <form className="form" onSubmit={lookup} noValidate>
          <div className="toolbar floor-lookup">
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
              <Icon d={FLOOR_ICON.search} size={18} />
              {t("station.lookup")}
            </button>
          </div>
          {problem ? (
            <p id={ids.err} className="field-error" role="alert">
              {problem === "invalid" ? t("station.invalid") : t("station.notFound")}
            </p>
          ) : null}
        </form>
      </Card>
      {error ? <ErrorNote code={error} /> : null}
      <LiveResult tone={note ? "ok" : undefined}>{note}</LiveResult>

      {card ? (
        <Card
          title={`${card.asset.station_code} · ${label("eq", card.asset.equipment_type)}`}
          icon={{ name: "dumbbell" }}
        >
          <div className="floor-card__meta">
            <span className="floor-meta-item">
              <Icon name="pin" size={18} />
              {card.asset.location_name}
            </span>
            {card.asset.brand ? (
              <span>{[card.asset.brand, card.asset.model].filter(Boolean).join(" · ")}</span>
            ) : null}
            <Plate tone={assetTone(card.asset.status)}>{label("status", card.asset.status)}</Plate>
          </div>
          <h3 className="floor-h3">
            <Icon name="layers" size={20} />
            {t("station.exercises")}
          </h3>
          {card.exercises.length === 0 ? (
            <Empty icon={{ name: "dumbbell" }} text={t("station.noExercises")} />
          ) : null}
          <ul className="floor-cards ds-grid">
            {card.exercises.map((e) => (
              <li key={e.id} className="floor-card">
                <h4 className="floor-card__title">{e.name}</h4>
                <div className="floor-card__meta">
                  <span className="floor-chip">{label("pattern", e.movement_pattern)}</span>
                </div>
                {e.cues ? <p className="floor-cues">{e.cues}</p> : null}
              </li>
            ))}
          </ul>
          {card.circuit_steps.length > 0 ? (
            <>
              <h3 className="floor-h3">
                <Icon name="layers" size={20} />
                {t("station.inCircuits")}
              </h3>
              <ul className="floor-chips">
                {card.circuit_steps.map((s) => (
                  <li key={`${s.circuit_id}:${s.position}`} className="floor-chip">
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
                <Icon d={FLOOR_ICON.alert} size={18} />
                {t("my.oos")}
              </button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
