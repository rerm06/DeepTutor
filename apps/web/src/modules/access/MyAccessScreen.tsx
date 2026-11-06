import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading } from "../../components/ui";
import { useCurrentBrand } from "../../lib/brandTheme";
import { photoApi } from "../../lib/photo";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { IconSection } from "../schedule/shared";
import { DoorScanner } from "./SignIn";
import { useAccessApi } from "./api";
import { dict } from "./dict";

/** Member: the three ways in (door QR, credential, face) and their own face-recognition opt-in. */
export function MyAccessScreen() {
  const { t } = useModuleT(dict);
  const [params, setParams] = useSearchParams();
  const [scan, setScan] = useState(params.get("scan") === "1");
  useEffect(() => {
    if (params.get("scan") === "1") {
      const next = new URLSearchParams(params);
      next.delete("scan");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div className="page acc-me">
      <header className="core-head">
        <h1 className="page__title">{t("me.title")}</h1>
        <p className="lede">{t("me.lede")}</p>
      </header>
      <div className="acc-me__ways">
        <IconSection icon="qr" title={t("me.way1")}>
          <p>{t("me.way1Help")}</p>
          {scan ? (
            <DoorScanner onClose={() => setScan(false)} />
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setScan(true)}
              data-tour-id="me-scan"
            >
              <Icon name="qr" size={20} />
              {t("signin.scan")}
            </button>
          )}
        </IconSection>
        <IconSection icon="card" title={t("me.way2")}>
          <p>{t("me.way2Help")}</p>
          <Link className="btn" to="/me/credential">
            {t("me.credential")}
          </Link>
        </IconSection>
        <FaceConsentCard />
      </div>
    </div>
  );
}

function FaceConsentCard() {
  const { t } = useModuleT(dict);
  const acc = useAccessApi();
  const { api } = useSession();
  const brand = useCurrentBrand();
  const consent = useAsync(() => acc.consent(), [acc]);
  const photo = useAsync(
    () =>
      photoApi((m, p, b) => api.request(m, p, b))
        .get(null)
        .then(() => true)
        .catch(() => false),
    [api],
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const c = consent.data;

  return (
    <IconSection
      icon="sparkle"
      title={t("me.way3")}
      actions={
        c ? (
          <span className={`plate plate--${c.active ? "ok" : "neutral"}`}>
            {c.active ? t("me.faceOn") : t("me.faceOff")}
          </span>
        ) : null
      }
    >
      <p>{t("me.way3Help")}</p>
      {consent.loading ? <Loading /> : null}
      {consent.error ? <ErrorNote code={consent.error} onRetry={consent.reload} /> : null}
      {c ? (
        <>
          <p className="acc-consent">{t("me.faceConsent", { brand: brand?.name ?? "" })}</p>
          {!c.location_enabled ? <p className="note">{t("me.faceLocationOff")}</p> : null}
          {photo.data === false ? (
            <p className="note note--warn">
              {t("me.faceNeedsPhoto")} <Link to="/me/account">→</Link>
            </p>
          ) : null}
          <div className="form__actions">
            <button
              type="button"
              className={c.active ? "btn" : "btn btn--ai"}
              disabled={busy}
              data-agent="manual"
              onClick={async () => {
                setBusy(true);
                setSaved(false);
                try {
                  await acc.setConsent(!c.active);
                  setSaved(true);
                  consent.reload();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {c.active ? t("me.faceRevoke") : t("me.faceGrant")}
            </button>
          </div>
          <output aria-live="polite" className="muted">
            {saved ? t("me.faceSaved") : null}
          </output>
        </>
      ) : null}
    </IconSection>
  );
}
