import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, Loading } from "../../components/ui";
import { MemberPicker, useMyMembers } from "./members";
import { useST, useScheduleApi } from "./shared";

/** Refresh before the 30 s window rolls over; the server also accepts the previous window. */
export const QR_REFRESH_MS = 25_000;

export function MyCredentialScreen() {
  const { t, lang } = useST();
  const sched = useScheduleApi();
  const { mine, list, memberId, setMemberId, current } = useMyMembers();
  const [svg, setSvg] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);

  useEffect(() => {
    if (!memberId) return;
    let alive = true;
    const load = async () => {
      try {
        const { token } = await sched.qrToken(memberId);
        const markup = await QRCode.toString(token, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!alive) return;
        setSvg(markup);
        setUpdatedAt(new Date());
        setError(null);
      } catch (err) {
        if (alive) setError(toErrorCode(err));
      }
    };
    load();
    const timer = setInterval(load, QR_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sched, memberId]);

  return (
    <div className="page">
      <h1 className="page__title">{t("credential.title")}</h1>
      <p className="lede">{t("credential.lede")}</p>
      <MemberPicker list={list} value={memberId} onChange={setMemberId} />
      {mine.error ? <ErrorNote code={mine.error} onRetry={mine.reload} /> : null}
      {error ? <ErrorNote code={error} /> : null}
      {!svg && !error ? <Loading /> : null}
      {svg ? (
        <figure className="sched-qr" data-tour-id="credential-qr">
          <img
            className="sched-qr__img"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt={t("credential.alt", { name: current?.full_name ?? "" })}
            width={240}
            height={240}
          />
          <figcaption>
            <strong>{current?.full_name}</strong>
            {current?.member_no ? <span className="mono"> · {current.member_no}</span> : null}
          </figcaption>
        </figure>
      ) : null}
      <p className="muted" aria-live="polite">
        {updatedAt
          ? t("credential.updated", {
              time: updatedAt.toLocaleTimeString(lang === "es" ? "es-PR" : "en-US"),
            })
          : null}
      </p>
      <p>{t("credential.refresh")}</p>
      <p className="note note--warn">{t("credential.screenshot")}</p>
    </div>
  );
}
