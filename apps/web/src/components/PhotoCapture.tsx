import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCurrentBrand } from "../lib/brandTheme";
import { type Photo, compress, cropSquare, fromFile } from "../lib/photo";
import { useModuleT } from "../modules/i18n";
import { Icon } from "./icons";
import "./photo.css";

const dict = {
  es: {
    title: "Foto para identificarte",
    titleStaff: "Foto del socio",
    take: "Tomar foto",
    retake: "Repetir foto",
    upload: "Subir archivo",
    capture: "Capturar",
    cancel: "Cancelar",
    flip: "Cambiar cámara",
    remove: "Quitar foto",
    consentSelf:
      "Autorizo que {brand} guarde mi foto solo para identificarme en recepción. Puedo borrarla cuando quiera.",
    consentStaff:
      "El socio autorizó en persona que se tome y guarde su foto para identificarlo en recepción.",
    consentFirst: "Marca la autorización para activar la cámara.",
    denied: "No hay permiso para la cámara. Puedes subir una foto desde tus archivos.",
    noCamera: "No se encontró una cámara. Puedes subir una foto desde tus archivos.",
    failed: "No se pudo procesar la foto. Prueba con otra.",
    tooLarge: "La foto es demasiado grande. Prueba con otra.",
    type: "Usa una foto JPG, PNG, WebP o HEIC.",
    guide: "Centra tu cara en el óvalo, con buena luz y sin gafas de sol.",
    ready: "Foto lista ({kb} KB).",
    optional: "Opcional",
    preview: "Vista previa de la foto",
    live: "Cámara en vivo",
  },
  en: {
    title: "Photo to identify you",
    titleStaff: "Member photo",
    take: "Take photo",
    retake: "Retake photo",
    upload: "Upload file",
    capture: "Capture",
    cancel: "Cancel",
    flip: "Switch camera",
    remove: "Remove photo",
    consentSelf:
      "I allow {brand} to keep my photo only to identify me at the front desk. I can delete it anytime.",
    consentStaff:
      "The member agreed in person to have their photo taken and kept to identify them at the front desk.",
    consentFirst: "Tick the authorisation to turn on the camera.",
    denied: "No camera permission. You can upload a photo from your files.",
    noCamera: "No camera found. You can upload a photo from your files.",
    failed: "The photo couldn't be processed. Try another one.",
    tooLarge: "The photo is too large. Try another one.",
    type: "Use a JPG, PNG, WebP or HEIC photo.",
    guide: "Center your face in the oval, in good light, no sunglasses.",
    ready: "Photo ready ({kb} KB).",
    optional: "Optional",
    preview: "Photo preview",
    live: "Live camera",
  },
};
type K = keyof (typeof dict)["es"];

export interface PhotoCaptureProps {
  /** data: URL of the current photo, or null. */
  value: string | null;
  onChange(photo: Photo | null): void;
  mode: "self" | "staff";
  busy?: boolean;
  optional?: boolean;
  /** Consent already recorded for this photo (an existing stored photo): the box starts ticked. */
  consented?: boolean;
  /** Brand named in the consent (the public join page has no signed-in brand). */
  brandName?: string;
}

export function PhotoCapture({
  value,
  onChange,
  mode,
  busy,
  optional,
  consented,
  brandName,
}: PhotoCaptureProps) {
  const { t } = useModuleT(dict);
  const { lang } = useI18n();
  const brand = useCurrentBrand();
  const uid = useId();
  const [consent, setConsent] = useState(!!consented);
  const [camera, setCamera] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<K | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (consented) setConsent(true);
  }, [consented]);

  const stop = useCallback(() => {
    for (const tr of stream.current?.getTracks() ?? []) tr.stop();
    stream.current = null;
    setCamera(false);
  }, []);
  useEffect(() => stop, [stop]);

  const open = useCallback(
    async (face: "user" | "environment" = facing) => {
      setError(null);
      if (!consent) {
        setError("consentFirst");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("noCamera");
        return;
      }
      stop();
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        stream.current = s;
        setCamera(true);
        requestAnimationFrame(() => {
          if (video.current) {
            video.current.srcObject = s;
            void video.current.play().catch(() => {});
          }
        });
      } catch (e) {
        const n = (e as DOMException).name;
        setError(n === "NotAllowedError" || n === "SecurityError" ? "denied" : "noCamera");
      }
    },
    [consent, facing, stop],
  );

  const shoot = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    try {
      const p = await compress(cropSquare(v, v.videoWidth, v.videoHeight, facing === "user"));
      setBytes(p.bytes);
      onChange(p);
      stop();
    } catch (e) {
      setError((e as Error).message === "photo_too_large" ? "tooLarge" : "failed");
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!consent) {
      setError("consentFirst");
      return;
    }
    try {
      const p = await fromFile(f);
      setBytes(p.bytes);
      onChange(p);
    } catch (e) {
      const m = (e as Error).message;
      setError(m === "photo_type" ? "type" : m === "photo_too_large" ? "tooLarge" : "failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const consentText =
    mode === "staff"
      ? t("consentStaff")
      : t("consentSelf", {
          brand: brandName ?? brand?.name ?? (lang === "en" ? "the gym" : "el gimnasio"),
        });

  return (
    <fieldset
      className="photo"
      aria-describedby={error ? `${uid}-err` : undefined}
      data-agent-skip=""
    >
      <legend className="photo__legend">
        <Icon name="userPlus" size={22} />
        {mode === "staff" ? t("titleStaff") : t("title")}
        {optional ? <span className="photo__opt">{t("optional")}</span> : null}
      </legend>

      <div className="photo__body">
        <div className={`photo__frame${camera ? " is-live" : ""}${value ? " has-photo" : ""}`}>
          {camera ? (
            <>
              <video
                ref={video}
                className={`photo__video${facing === "user" ? " is-mirror" : ""}`}
                playsInline
                muted
                aria-label={t("live")}
              />
              <span className="photo__guide" aria-hidden="true" />
            </>
          ) : value ? (
            <img className="photo__img" src={value} alt={t("preview")} width={168} height={168} />
          ) : (
            <span className="photo__empty" aria-hidden="true">
              <Icon name="users" size={46} />
            </span>
          )}
        </div>

        <div className="photo__side">
          <label className="photo__consent" data-agent="manual">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (!e.target.checked) stop();
                setError(null);
              }}
            />
            <span>{consentText}</span>
          </label>

          {camera ? (
            <>
              <p className="photo__hint">{t("guide")}</p>
              <div className="photo__actions">
                <button
                  type="button"
                  className="btn btn--primary photo__shoot"
                  onClick={() => void shoot()}
                >
                  <span className="photo__shutter" aria-hidden="true" />
                  {t("capture")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const f = facing === "user" ? "environment" : "user";
                    setFacing(f);
                    void open(f);
                  }}
                >
                  <Icon name="refresh" size={18} />
                  {t("flip")}
                </button>
                <button type="button" className="btn btn--ghost" onClick={stop}>
                  {t("cancel")}
                </button>
              </div>
            </>
          ) : (
            <div className="photo__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void open()}
                disabled={busy}
              >
                <CameraIcon />
                {value ? t("retake") : t("take")}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon name="download" size={18} />
                {t("upload")}
              </button>
              {value ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setBytes(null);
                    onChange(null);
                  }}
                  disabled={busy}
                >
                  {t("remove")}
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="user"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </div>
          )}
          <output className="photo__status" aria-live="polite">
            {error ? (
              <span id={`${uid}-err`} className="photo__error">
                {t(error)}
              </span>
            ) : bytes ? (
              t("ready", { kb: Math.round(bytes / 1024) })
            ) : null}
          </output>
        </div>
      </div>
    </fieldset>
  );
}

function CameraIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.6" />
    </svg>
  );
}
