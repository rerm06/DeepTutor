import QRCode from "qrcode";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { MemberAvatar } from "../../components/MemberPhotoCard";
import { Icon } from "../../components/icons";
import { ErrorNote } from "../../components/ui";
import { useLocationId } from "../../lib/location";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { IconSection, LocationSelect, useLocations } from "../schedule/shared";
import {
  type Activity,
  type Device,
  type FaceEvent,
  type Inside,
  type KioskCode,
  doorUrl,
  useAccessApi,
} from "./api";
import { type AccessKey, dict } from "./dict";

const clock = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-PR", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Puerto_Rico",
  }).format(new Date(iso));

function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: caller lists the dependencies
  useEffect(() => {
    fn();
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }, deps);
}

export function KioskScreen() {
  const { t } = useModuleT(dict);
  const top = useLocationId();
  const [loc, setLoc] = useState(top);
  useEffect(() => {
    if (top) setLoc(top);
  }, [top]);
  const { list } = useLocations(loc, setLoc);
  const { role } = useSession();
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  return (
    <div className="page acc-kiosk-page">
      <header className="page__head">
        <div>
          <h1 className="page__title">{t("kiosk.title")}</h1>
          <p className="lede">{t("kiosk.lede")}</p>
        </div>
        {list.length > 1 ? (
          <LocationSelect list={list} value={loc} onChange={setLoc} tourId="door-location" />
        ) : null}
      </header>
      {loc ? (
        <>
          <div ref={wrap} className={`acc-kiosk${full ? " is-full" : ""}`}>
            <DoorCodes location={loc} />
            <button
              type="button"
              className="btn acc-kiosk__full"
              onClick={() =>
                full ? void document.exitFullscreen() : void wrap.current?.requestFullscreen?.()
              }
            >
              <Icon name="grid" size={18} />
              {full ? t("kiosk.exitFullscreen") : t("kiosk.fullscreen")}
            </button>
          </div>
          <div className="acc-cols">
            <InsideNow location={loc} />
            <RecentActivity location={loc} />
          </div>
          <FacePanel
            location={loc}
            canManage={role === "owner" || role === "location_manager"}
            owner={role === "owner"}
          />
        </>
      ) : null}
    </div>
  );
}

function DoorCodes({ location }: { location: string }) {
  const { t } = useModuleT(dict);
  const acc = useAccessApi();
  const { me } = useSession();
  const [codes, setCodes] = useState<(KioskCode & { img: string })[]>([]);
  const [left, setLeft] = useState(30);
  const [error, setError] = useState(false);
  const expiry = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await acc.kiosk(location);
      const skew = Date.parse(r.server_time) - Date.now();
      const imgs = await Promise.all(
        r.data.map(async (c) => ({
          ...c,
          img: await QRCode.toDataURL(doorUrl(c.token, me?.organization.id), {
            margin: 1,
            width: 520,
            errorCorrectionLevel: "M",
            color: { dark: "#0b0d0d", light: "#ffffff" },
          }),
        })),
      );
      setCodes(imgs);
      expiry.current = Date.parse(r.data[0]?.expires_at ?? "") - skew;
      setError(false);
    } catch {
      setError(true);
      expiry.current = Date.now() + 5000;
    }
  }, [acc, location, me?.organization.id]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      const ms = expiry.current - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0) {
        expiry.current = Date.now() + 3000; // avoid a burst while loading
        void load();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="acc-codes">
      {error ? <p className="note note--warn">{t("kiosk.loadError")}</p> : null}
      {(["in", "out"] as const).map((dir) => {
        const c = codes.find((x) => x.direction === dir);
        return (
          <figure
            key={dir}
            className={`acc-code-card acc-code-card--${dir}`}
            data-tour-id={`door-${dir}`}
          >
            <figcaption className="acc-code-card__head">
              <span className="acc-code-card__dir">
                {t(dir === "in" ? "kiosk.in" : "kiosk.out")}
              </span>
              <span className="acc-code-card__help">
                {t(dir === "in" ? "kiosk.inHelp" : "kiosk.outHelp")}
              </span>
            </figcaption>
            <div className="acc-code-card__qr">
              {c ? (
                <img
                  src={c.img}
                  alt={t("kiosk.qrAlt", { dir: t(dir === "in" ? "kiosk.in" : "kiosk.out") })}
                  width={260}
                  height={260}
                />
              ) : (
                <span className="acc-code-card__wait" aria-hidden="true" />
              )}
            </div>
            <div className="acc-code-card__foot">
              <span
                className="ds-ring acc-ring"
                style={{ ["--pct" as string]: String((left / 30) * 100) }}
              >
                {left}
              </span>
              <span>{t("kiosk.refresh", { s: left })}</span>
            </div>
          </figure>
        );
      })}
    </div>
  );
}

function InsideNow({ location }: { location: string }) {
  const { t, lang } = useModuleT(dict);
  const acc = useAccessApi();
  const [rows, setRows] = useState<Inside[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    acc
      .inside(location)
      .then((r) => setRows(r.data))
      .catch(() => {});
  }, [acc, location]);
  usePoll(load, 10_000, [load]);
  return (
    <IconSection
      icon="users"
      title={`${t("kiosk.inside")}${rows ? ` · ${rows.length}` : ""}`}
      className="acc-inside"
    >
      {rows && rows.length === 0 ? <p className="muted">{t("kiosk.insideEmpty")}</p> : null}
      <ul className="acc-people">
        {(rows ?? []).map((p) => (
          <li key={p.member_id} className="acc-person">
            <MemberAvatar memberId={p.member_id} name={p.full_name} size={44} />
            <span className="acc-person__text">
              <strong>{p.full_name}</strong>
              <span className="muted">
                {t("kiosk.since", { time: clock(p.since, lang) })} ·{" "}
                {t(`src.${p.source}` as AccessKey)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy === p.member_id}
              onClick={async () => {
                setBusy(p.member_id);
                await acc.checkOut(location, p.member_id).catch(() => {});
                setBusy(null);
                load();
              }}
            >
              {t("kiosk.checkout")}
              <span className="sr-only">: {p.full_name}</span>
            </button>
          </li>
        ))}
      </ul>
    </IconSection>
  );
}

function RecentActivity({ location }: { location: string }) {
  const { t, lang } = useModuleT(dict);
  const acc = useAccessApi();
  const [rows, setRows] = useState<Activity[] | null>(null);
  usePoll(
    () => {
      acc
        .activity(location)
        .then((r) => setRows(r.data))
        .catch(() => {});
    },
    8000,
    [acc, location],
  );
  return (
    <IconSection icon="refresh" title={t("kiosk.activity")} className="acc-activity">
      {rows && rows.length === 0 ? <p className="muted">{t("kiosk.activityEmpty")}</p> : null}
      <ol className="acc-feed">
        {(rows ?? []).map((a) => (
          <li
            key={`${a.kind}:${a.id}`}
            className={`acc-feed__row acc-feed__row--${a.result === "denied" ? "denied" : a.kind}`}
          >
            {a.member_id ? (
              <MemberAvatar memberId={a.member_id} name={a.full_name ?? ""} size={36} />
            ) : null}
            <span className="acc-feed__text">
              <strong>{a.full_name ?? "—"}</strong>
              <span className="muted">
                {a.result === "denied"
                  ? t("kiosk.evDenied")
                  : t(a.kind === "in" ? "kiosk.evIn" : "kiosk.evOut")}{" "}
                · {t(`src.${a.source}` as AccessKey)}
              </span>
            </span>
            <time dateTime={a.at} className="acc-feed__time">
              {clock(a.at, lang)}
            </time>
          </li>
        ))}
      </ol>
    </IconSection>
  );
}

function FacePanel({
  location,
  canManage,
  owner,
}: { location: string; canManage: boolean; owner: boolean }) {
  const { t, lang } = useModuleT(dict);
  const acc = useAccessApi();
  const access = useAsync(() => acc.faceAccess(), [acc]);
  const on = access.data?.data.find((x) => x.location_id === location)?.face_access ?? false;
  const [events, setEvents] = useState<FaceEvent[] | null>(null);
  const loadEvents = useCallback(() => {
    acc
      .faceEvents(location)
      .then((r) => setEvents(r.data))
      .catch(() => {});
  }, [acc, location]);
  usePoll(loadEvents, 8000, [loadEvents]);
  const review = (events ?? []).filter((e) => e.outcome === "review");
  const recent = (events ?? []).filter((e) => e.outcome !== "review").slice(0, 8);

  return (
    <IconSection
      icon="sparkle"
      title={t("face.title")}
      className="acc-face"
      actions={
        <span className={`plate plate--${on ? "ok" : "neutral"}`}>
          {on ? t("face.on") : t("face.off")}
        </span>
      }
    >
      <p className="lede">{t("face.lede")}</p>
      <p className="note note--warn">{t("face.legal")}</p>
      {owner ? (
        <div>
          <button
            type="button"
            className={on ? "btn" : "btn btn--ai"}
            onClick={async () => {
              await acc.setFaceAccess(location, !on).catch(() => {});
              access.reload();
            }}
          >
            {on ? t("face.turnOff") : t("face.turnOn")}
          </button>
        </div>
      ) : (
        <p className="muted">{t("face.ownerOnly")}</p>
      )}

      {review.length ? (
        <div className="acc-review">
          <h3 className="acc-h3">{t("face.review")}</h3>
          <p className="help">{t("face.reviewHelp")}</p>
          <ul className="acc-people">
            {review.map((e) => (
              <li key={e.id} className="acc-person acc-person--review">
                <MemberAvatar memberId={e.member_id} name={e.full_name} size={56} />
                <span className="acc-person__text">
                  <strong>{e.full_name}</strong>
                  <span className="muted">
                    {t(e.direction === "in" ? "kiosk.evIn" : "kiosk.evOut")} · {e.device_name} ·{" "}
                    {t("face.score", { pct: Math.round(e.score * 100) })} · {clock(e.at, lang)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={async () => {
                    await acc.review(e.id, true).catch(() => {});
                    loadEvents();
                  }}
                >
                  {t("face.accept")}
                  <span className="sr-only">: {e.full_name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={async () => {
                    await acc.review(e.id, false).catch(() => {});
                    loadEvents();
                  }}
                >
                  {t("face.dismiss")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 className="acc-h3">{t("face.events")}</h3>
      {recent.length === 0 ? <p className="muted">{t("face.eventsEmpty")}</p> : null}
      <ol className="acc-feed">
        {recent.map((e) => (
          <li key={e.id} className="acc-feed__row">
            <MemberAvatar memberId={e.member_id} name={e.full_name} size={36} />
            <span className="acc-feed__text">
              <strong>{e.full_name}</strong>
              <span className="muted">
                {t(`out.${e.outcome}` as AccessKey)} ·{" "}
                {t("face.score", { pct: Math.round(e.score * 100) })}
              </span>
            </span>
            <time dateTime={e.at} className="acc-feed__time">
              {clock(e.at, lang)}
            </time>
          </li>
        ))}
      </ol>
      {canManage ? <Devices location={location} faceOn={on} /> : null}
    </IconSection>
  );
}

function Devices({ location, faceOn }: { location: string; faceOn: boolean }) {
  const { t, lang } = useModuleT(dict);
  const acc = useAccessApi();
  const { api } = useSession();
  const uid = useId();
  const devices = useAsync(() => acc.devices(location), [acc, location]);
  const [name, setName] = useState("");
  const [dir, setDir] = useState<Device["direction"]>("in");
  const [review, setReview] = useState(true);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [error, setError] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(false);
    try {
      setCreated(await acc.createDevice(location, name.trim(), dir, review));
      setName("");
      devices.reload();
    } catch {
      setError(true);
    }
  }
  const members = useAsync(() => api.members(location), [api, location]);

  return (
    <div className="acc-devices">
      <h3 className="acc-h3">{t("dev.title")}</h3>
      <p className="help">{t("dev.lede")}</p>
      {devices.error ? <ErrorNote code={devices.error} onRetry={devices.reload} /> : null}
      {devices.data && devices.data.data.length === 0 ? (
        <p className="muted">{t("dev.empty")}</p>
      ) : null}
      <ul className="acc-device-list">
        {(devices.data?.data ?? []).map((d) => (
          <li key={d.id} className={`acc-device${d.revoked_at ? " is-revoked" : ""}`}>
            <Icon name="qr" size={20} />
            <span className="acc-person__text">
              <strong>{d.name}</strong>
              <span className="muted">
                {t(`dev.dir.${d.direction}` as AccessKey)} ·{" "}
                {t(d.requires_review ? "dev.reviewOn" : "dev.reviewOff")} ·{" "}
                {d.revoked_at
                  ? t("dev.revoked")
                  : d.last_seen_at
                    ? t("dev.lastSeen", { time: clock(d.last_seen_at, lang) })
                    : t("dev.never")}
              </span>
            </span>
            {!d.revoked_at ? (
              <label className="acc-device__review">
                <input
                  type="checkbox"
                  checked={d.requires_review}
                  onChange={async (e) => {
                    await acc.setDeviceReview(d.id, e.target.checked).catch(() => {});
                    devices.reload();
                  }}
                />
                <span>{t("dev.review")}</span>
              </label>
            ) : null}
            {!d.revoked_at ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  await acc.revokeDevice(d.id).catch(() => {});
                  devices.reload();
                }}
              >
                {t("dev.revoke")}
                <span className="sr-only">: {d.name}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="form acc-device-form" onSubmit={add}>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={`${uid}-n`}>{t("dev.name")}</label>
            <input
              id={`${uid}-n`}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-d`}>{t("dev.direction")}</label>
            <select
              id={`${uid}-d`}
              value={dir}
              onChange={(e) => setDir(e.target.value as Device["direction"])}
            >
              <option value="in">{t("dev.dir.in")}</option>
              <option value="out">{t("dev.dir.out")}</option>
              <option value="both">{t("dev.dir.both")}</option>
            </select>
          </div>
        </div>
        <label className="acc-check">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          <span>
            <strong>{t("dev.review")}</strong>
            <span className="help">{t("dev.reviewHelp")}</span>
          </span>
        </label>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={name.trim().length < 2}>
            {t("dev.add")}
          </button>
        </div>
        {error ? <p className="acc-msg acc-msg--error">{t("signin.error")}</p> : null}
      </form>
      {created ? (
        <div className="acc-secret">
          <p>{t("dev.secret")}</p>
          <label className="acc-secret__label" htmlFor={`${uid}-s`}>
            {t("dev.secretLabel")}
          </label>
          <input
            id={`${uid}-s`}
            readOnly
            className="mono acc-secret__value"
            value={`${created.id}:${created.secret}`}
            data-assist="off"
            onFocus={(e) => e.currentTarget.select()}
          />
          <SimulateRecognition
            device={created}
            memberOptions={members.data?.data ?? []}
            faceOn={faceOn}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Demo helper: sends exactly what a gateway would send, with the key just created. */
function SimulateRecognition({
  device,
  memberOptions,
  faceOn,
}: {
  device: { id: string; secret: string };
  memberOptions: { id: string; full_name: string }[];
  faceOn: boolean;
}) {
  const { t } = useModuleT(dict);
  const uid = useId();
  const [enrolled, setEnrolled] = useState<{ member_id: string; full_name: string }[] | null>(null);
  const [member, setMember] = useState("");
  const [score, setScore] = useState(0.86);
  const [result, setResult] = useState<string | null>(null);
  const auth = `Device ${device.id}:${device.secret}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when face access flips
  useEffect(() => {
    fetch("/api/v1/public/device/enrolment", { headers: { authorization: auth } })
      .then((r) => r.json())
      .then((b: { members?: { member_id: string; full_name: string }[] }) => {
        setEnrolled(b.members ?? []);
        setMember(b.members?.[0]?.member_id ?? "");
      })
      .catch(() => setEnrolled([]));
  }, [auth, faceOn]);

  const names = new Map(memberOptions.map((m) => [m.id, m.full_name]));
  return (
    <details className="acc-sim">
      <summary>{t("dev.test")}</summary>
      <p className="help">{t("dev.testHelp")}</p>
      {enrolled && enrolled.length === 0 ? <p className="muted">{t("dev.noConsenting")}</p> : null}
      {enrolled && enrolled.length > 0 ? (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch("/api/v1/public/device/recognitions", {
              method: "POST",
              headers: { authorization: auth, "content-type": "application/json" },
              body: JSON.stringify({ member_id: member, score }),
            });
            const b = (await r.json().catch(() => ({}))) as { outcome?: string; error?: string };
            setResult(b.outcome ?? b.error ?? String(r.status));
          }}
        >
          <div className="form__grid">
            <div className="field">
              <label htmlFor={`${uid}-m`}>{t("dev.testMember")}</label>
              <select id={`${uid}-m`} value={member} onChange={(e) => setMember(e.target.value)}>
                {enrolled.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {names.get(m.member_id) ?? m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-s`}>
                {t("dev.testScore")} · {Math.round(score * 100)}%
              </label>
              <input
                id={`${uid}-s`}
                type="range"
                min={0.3}
                max={0.99}
                step={0.01}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--ai">
              {t("dev.testSend")}
            </button>
          </div>
          <output aria-live="polite">
            {result
              ? t("dev.testResult", {
                  r: (dict.es as Record<string, string>)[`out.${result}`]
                    ? t(`out.${result}` as AccessKey)
                    : result,
                })
              : null}
          </output>
        </form>
      ) : null}
    </details>
  );
}
