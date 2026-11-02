import { useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { bookingTone } from "./AgendaScreen";
import type { Booking, ClassSession } from "./api";
import { MemberPicker, useMyMembers } from "./members";
import { useST, useScheduleApi } from "./shared";
import { DEFAULT_TZ, formatDateTimeIn } from "./time";

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
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}

      <Section title={t("classes.upcoming")}>
        {sessions.loading ? <Loading /> : null}
        {sessions.error ? <ErrorNote code={sessions.error} onRetry={sessions.reload} /> : null}
        {sessions.data && upcoming.length === 0 ? (
          <p className="muted">{t("classes.none")}</p>
        ) : null}
        <ul className="sched-list">
          {upcoming.map((s) => {
            const b = live.get(s.id);
            const full = s.booked >= s.capacity;
            const hoursLeft = (new Date(s.starts_at).getTime() - Date.now()) / 3_600_000;
            const late = b?.status === "booked" && hoursLeft < windowOf(s.location_id);
            return (
              <li key={s.id} className="sched-card">
                <p className="sched-card__time">
                  {formatDateTimeIn(s.starts_at, lang, tzOf(s.location_id))}
                </p>
                <p className="sched-card__name">{s.class_name}</p>
                <p className="muted">
                  {locName(s.location_id)}
                  {s.room ? ` · ${s.room}` : ""}
                </p>
                <p>
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
                </p>
                {late ? (
                  <p className="help">{t("classes.lateWarning", { h: windowOf(s.location_id) })}</p>
                ) : null}
                {b ? (
                  <button
                    type="button"
                    className="btn"
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
                    {b.status === "waitlisted" ? t("classes.leaveWaitlist") : t("classes.cancel")}
                    <span className="sr-only">: {s.class_name}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
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
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("classes.history")}>
        {bookings.error ? <ErrorNote code={bookings.error} onRetry={bookings.reload} /> : null}
        {bookings.data && history.length === 0 ? (
          <p className="muted">{t("classes.historyEmpty")}</p>
        ) : null}
        <ul className="sched-history">
          {history.map((b) => (
            <li key={b.id}>
              <span className="nowrap">
                {formatDateTimeIn(b.starts_at, lang, tzOf(b.location_id))}
              </span>{" "}
              <strong>{b.class_name}</strong>{" "}
              <Plate tone={bookingTone(b.status)}>{t(`bstatus.${b.status}`)}</Plate>
              {b.late_cancel ? <span className="muted"> · {t("roster.late")}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
