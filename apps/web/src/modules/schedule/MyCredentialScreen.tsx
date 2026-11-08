import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading } from "../../components/ui";
import { useCurrentBrand } from "../../lib/brandTheme";
import { MemberPicker, useMyMembers } from "./members";
import { useST, useScheduleApi } from "./shared";

/** Refresh before the 30 s window rolls over; the server also accepts the previous window. */
export const QR_REFRESH_MS = 25_000;

export function MyCredentialScreen() {
  const { t, lang } = useST();
  const sched = useScheduleApi();
  const { mine, list, memberId, setMemberId, current } = useMyMembers();
  const brand = useCurrentBrand();
  const mark = brand?.theme.icon_url;
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
      <section className="section sched-pass" aria-label={t("credential.title")}>
        <header className="sched-pass__head">
          {mark ? (
            <img className="sched-pass__mark" src={mark} alt="" width={44} height={44} />
          ) : (
            <Icon name="qr" size={28} />
          )}
          <span className="sched-pass__brand">{brand?.name ?? ""}</span>
          <span className="ds-pill sched-pass__live">
            <Icon name="refresh" size={14} />
            {t("credential.live")}
          </span>
        </header>
        {error ? <ErrorNote code={error} /> : null}
        {!svg && !error ? (
          <>
            <div className="sched-qr__frame sched-qr__frame--loading" aria-hidden="true" />
            <Loading />
          </>
        ) : null}
        {svg ? (
          <figure className="sched-qr" data-tour-id="credential-qr">
            <div className="sched-qr__frame">
              <img
                className="sched-qr__img"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                alt={t("credential.alt", { name: current?.full_name ?? "" })}
                width={240}
                height={240}
              />
            </div>
            <figcaption className="sched-qr__who">
              <strong>{current?.full_name}</strong>
              {current?.member_no ? <span className="mono"> · {current.member_no}</span> : null}
            </figcaption>
          </figure>
        ) : null}
        <div className="sched-pass__meta">
          <Icon name="refresh" size={18} />
          <span>
            <span className="sched-pass__updated" aria-live="polite">
              {updatedAt
                ? t("credential.updated", {
                    time: updatedAt.toLocaleTimeString(lang === "es" ? "es-PR" : "en-US"),
                  })
                : null}
            </span>{" "}
            {t("credential.refresh")}
          </span>
        </div>
      </section>
      <p className="note note--warn sched-pass__warn">{t("credential.screenshot")}</p>
    </div>
  );
}
