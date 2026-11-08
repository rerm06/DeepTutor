import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { DoorScanner } from "../access/SignIn";
import { MemberTraining } from "./MemberTraining";
import { STATION_CODE, normalizeCode } from "./api";
import { useFloorT } from "./dict";
import "./floor.css";
import { Card, FLOOR_ICON } from "./ui";

/**
 * Member "Escanear equipo": the camera reads the QR on a machine and opens its station page, where the use is
 * logged and mapped to the member's routine. Typing the code is the fallback for phones without a QR reader.
 * Below: the member's own routine progress and recent equipment use.
 */
export function StationScreen() {
  const { t } = useFloorT();
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const ids = { code: useId(), err: useId() };

  function open(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!STATION_CODE.test(c)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    navigate(`/s/${encodeURIComponent(c)}?via=code`);
  }

  return (
    <div className="page floor-page">
      <div className="floor-head">
        <h1 className="page__title">{t("station.title")}</h1>
        <p className="lede">{t("station.lede")}</p>
      </div>
      <Card title={t("station.find")} icon={{ name: "qr" }}>
        {scanning ? (
          <DoorScanner help={t("station.scanHelp")} onClose={() => setScanning(false)} />
        ) : (
          <button
            type="button"
            className="btn btn--primary floor-scan-btn"
            data-tour-id="floor-station-scan"
            onClick={() => setScanning(true)}
          >
            <Icon name="qr" size={22} />
            {t("station.scan")}
          </button>
        )}
        <form className="form" onSubmit={open} noValidate>
          <div className="toolbar floor-lookup">
            <div className="field field--grow">
              <label htmlFor={ids.code}>{t("station.orType")}</label>
              <input
                id={ids.code}
                value={code}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="mono"
                aria-invalid={invalid}
                aria-describedby={invalid ? ids.err : undefined}
                data-tour-id="floor-station-code"
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <button type="submit" className="btn" data-tour-id="floor-station-lookup">
              <Icon d={FLOOR_ICON.search} size={18} />
              {t("station.register")}
            </button>
          </div>
          {invalid ? (
            <p id={ids.err} className="field-error" role="alert">
              {t("station.invalid")}
            </p>
          ) : null}
        </form>
      </Card>
      <MemberTraining />
    </div>
  );
}
