import { useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { bookingTone } from "./AgendaScreen";
import type { Booking, ClassSession } from "./api";
import { MemberPicker, useMyMembers } from "./members";
import {
  ClassThumb,
  IconSection,
  OccupancyBar,
  Stat,
  pillTime,
  useST,
  useScheduleApi,
} from "./shared";
import { DEFAULT_TZ, dayKey, formatDateTimeIn, formatDay } from "./time";

const LIVE = ["booked", "waitlisted"];

export function MyClassesScreen() {
  const { t, lang } = useST();
  const { api } = useSession();
  const sched = useScheduleApi();
  const { mine, list, memberId, setMemberId } = useMyMembers();
  const locations = useAsync(() => api.locations(), [api]);
  const policies = useAsync(() => sched.policies(), [sched]);
  const [from] = useState(() => new Date());
  const sessions = useAsync(
    () =>
      sched.sessions({
        from: from.toISOString(),
        to: new Date(from.getTime() + 14 * 86_400_000).toISOString(),
      }),
    [sched, from],
  );
  const bookings = useAsync(
    () => (memberId ? sched.bookings(memberId) : Promise.resolve({ data: [] as Booking[] })),
    [sched, memberId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);

  const locs = locations.data?.data ?? [];
  const locName = (id: string) => locs.find((l) => l.id === id)?.name ?? "";
  const tzOf = (id: string) => locs.find((l) => l.id === id)?.timezone || DEFAULT_TZ;
  const windowOf = (id: string) =>
    policies.data?.data.find((p) => p.location_id === id)?.cancel_window_hours ?? 12;
  const live = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const b of bookings.data?.data ?? [])
      if (LIVE.includes(b.status)) map.set(b.session_id, b);
    return map;
  }, [bookings.data]);
  const upcoming = (sessions.data?.data ?? []).filter(
    (s) => !s.cancelled && new Date(s.starts_at).getTime() > Date.now(),
  );
  const history = (bookings.data?.data ?? []).filter(
    (b) => !LIVE.includes(b.status) || new Date(b.starts_at).getTime() <= Date.now(),
  );
  const byDay = new Map<string, ClassSession[]>();
  for (const s of upcoming) {
    const k = dayKey(s.starts_at, tzOf(s.location_id));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const future = (bookings.data?.data ?? []).filter(
    (b) => new Date(b.starts_at).getTime() > Date.now(),
  );
  const count = (list: Booking[], status: string) => list.filter((b) => b.status === status).length;

  async function act(s: ClassSession, fn: () => Promise<string>) {
    setBusy(s.id);
    setError(null);
    try {
      setAnnounce(await fn());
      sessions.reload();
      bookings.reload();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">{t("classes.title")}</h1>
      <p className="lede">{t("classes.lede")}</p>
      <MemberPicker list={list} value={memberId} onChange={setMemberId} />
      {mine.error ? <ErrorNote code={mine.error} onRetry={mine.reload} /> : null}
      {bookings.data ? (
        <div className="ds-stats sched-stats">
          <Stat
            icon="calendarPlus"
            label={t("classes.stat.booked")}
            value={count(future, "booked")}
          />
          <Stat
            icon="refresh"
            label={t("classes.stat.waiting")}
            value={count(future, "waitlisted")}
          />
          <Stat
            icon="checkCircle"
            label={t("classes.stat.attended")}
            value={count(bookings.data.data, "attended")}
          />
        </div>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}

      <IconSection icon="calendar" title={t("classes.upcoming")}>
        {sessions.loading ? <Loading /> : null}
        {sessions.error ? <ErrorNote code={sessions.error} onRetry={sessions.reload} /> : null}
        {sessions.data && upcoming.length === 0 ? (
          <div className="ds-empty">
            <Icon name="calendar" size={40} />
            <strong>{t("classes.none")}</strong>
          </div>
        ) : null}
        {[...byDay].map(([day, items]) => (
          <div key={day} className="sched-group">
            <h3 className="sched-group__title">{formatDay(day, lang)}</h3>
            <ul className="ds-grid sched-classes">
              {items.map((s) => {
                const b = live.get(s.id);
                const full = s.booked >= s.capacity;
                const hoursLeft = (new Date(s.starts_at).getTime() - Date.now()) / 3_600_000;
                const late = b?.status === "booked" && hoursLeft < windowOf(s.location_id);
                return (
                  <li key={s.id} className={`sched-class${b ? " sched-class--mine" : ""}`}>
                    <div className="sched-class__top">
                      <ClassThumb name={s.class_name} />
                      <div className="sched-class__text">
                        <time className="sched-time sched-time--sm" dateTime={s.starts_at}>
                          {pillTime(s.starts_at, tzOf(s.location_id))}
                        </time>
                        <strong className="sched-class__name">{s.class_name}</strong>
                        <span className="sched-class__where">
                          {locName(s.location_id)}
                          {s.room ? ` · ${s.room}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="sched-class__cap">
                      {b ? (
                        <Plate tone={bookingTone(b.status)}>
                          {b.status === "waitlisted"
                            ? t("classes.youAreWaiting", { n: b.waitlist_position ?? 0 })
                            : t("classes.youAreBooked")}
                        </Plate>
                      ) : (
                        <Plate tone={full ? "warn" : "ok"}>
                          {full
                            ? t("classes.full", { n: s.waitlisted })
                            : t("classes.seatsLeft", { n: s.capacity - s.booked })}
                        </Plate>
                      )}
                      <OccupancyBar booked={s.booked} capacity={s.capacity} />
                    </div>
                    {late ? (
                      <p className="help">
                        {t("classes.lateWarning", { h: windowOf(s.location_id) })}
                      </p>
                    ) : null}
                    {b ? (
                      <button
                        type="button"
                        className="btn sched-class__act"
                        disabled={busy === s.id}
                        data-tour-id="classes-cancel"
                        onClick={() =>
                          act(s, async () => {
                            const r = await sched.cancelBooking(b.id);
                            return r.late_cancel
                              ? t("classes.cancelledLate")
                              : t("classes.cancelledOk");
                          })
                        }
                      >
                        {b.status === "waitlisted"
                          ? t("classes.leaveWaitlist")
                          : t("classes.cancel")}
                        <span className="sr-only">: {s.class_name}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ds-cta sched-class__act"
                        disabled={busy === s.id || !memberId}
                        data-tour-id="classes-book"
                        onClick={() =>
                          act(s, async () => {
                            const r = await sched.book(s.id, memberId);
                            return r.status === "waitlisted"
                              ? t("classes.waitlistedOk", {
                                  name: s.class_name,
                                  n: r.waitlist_position ?? 0,
                                })
                              : t("classes.bookedOk", { name: s.class_name });
                          })
                        }
                      >
                        {full ? t("classes.joinWaitlist") : t("classes.book")}
                        <span className="sr-only">: {s.class_name}</span>
                        <Icon name="arrowRight" size={18} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </IconSection>

      <IconSection icon="checkCircle" title={t("classes.history")}>
        {bookings.error ? <ErrorNote code={bookings.error} onRetry={bookings.reload} /> : null}
        {bookings.data && history.length === 0 ? (
          <div className="ds-empty">
            <Icon name="checkCircle" size={36} />
            <strong>{t("classes.historyEmpty")}</strong>
          </div>
        ) : null}
        <ul className="sched-history">
          {history.map((b) => (
            <li key={b.id} className="sched-hist">
              <span className="sched-hist__when">
                {formatDateTimeIn(b.starts_at, lang, tzOf(b.location_id))}
              </span>
              <strong className="sched-hist__name">{b.class_name}</strong>
              <span className="sched-hist__status">
                <Plate tone={bookingTone(b.status)}>{t(`bstatus.${b.status}`)}</Plate>
                {b.late_cancel ? <span className="muted"> · {t("roster.late")}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </IconSection>
    </div>
  );
}
