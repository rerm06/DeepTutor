import { type FormEvent, useCallback, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import {
  ErrorNote,
  LiveResult,
  Loading,
  Plate,
  Section,
  TableWrap,
  type Tone,
} from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { BookingStatus, ClassSession, RosterEntry } from "./api";
import {
  FRONT_OF_HOUSE,
  LocationSelect,
  SESSION_MANAGERS,
  useLocations,
  useST,
  useScheduleApi,
} from "./shared";
import { addDays, dayKey, formatDay, formatTime, weekDays, weekStart, zonedToUtc } from "./time";

export function bookingTone(status: BookingStatus): Tone {
  if (status === "booked" || status === "attended") return "ok";
  if (status === "waitlisted") return "warn";
  if (status === "no_show") return "blocked";
  return "neutral";
}

export function AgendaScreen() {
  const { t, lang } = useST();
  const { role } = useSession();
  const sched = useScheduleApi();
  const [locationId, setLocationId] = useState("");
  const { locations, list, current, tz } = useLocations(locationId, setLocationId);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState<ClassSession | null>(null);
  const newFormId = useId();
  const monday = weekStart(new Date(), tz, weekOffset);
  const days = weekDays(monday);

  const sessions = useAsync(
    () =>
      locationId
        ? sched.sessions({
            location_id: locationId,
            from: zonedToUtc(monday, "00:00", tz).toISOString(),
            to: zonedToUtc(addDays(monday, 7), "00:00", tz).toISOString(),
          })
        : Promise.resolve({ data: [] as ClassSession[] }),
    [sched, locationId, monday, tz],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, ClassSession[]>();
    for (const s of sessions.data?.data ?? []) {
      const k = dayKey(s.starts_at, tz);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [sessions.data, tz]);
  const canCreate = SESSION_MANAGERS.includes(role ?? "");

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{t("agenda.title")}</h1>
        {canCreate ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="schedule-session-new"
            aria-expanded={showNew}
            aria-controls={newFormId}
            onClick={() => setShowNew((v) => !v)}
          >
            {t("agenda.new")}
          </button>
        ) : null}
      </div>
      <p className="lede">{t("agenda.lede")}</p>
      {canCreate && showNew && current ? (
        <div id={newFormId}>
          <NewSessionForm location={current} onCreated={sessions.reload} />
        </div>
      ) : null}

      <div className="toolbar">
        <LocationSelect
          list={list}
          value={locationId}
          onChange={(id) => {
            setLocationId(id);
            setOpen(null);
          }}
          tourId="schedule-location"
        />
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => setWeekOffset((w) => w - 1)}>
            {t("agenda.prev")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
          >
            {t("agenda.today")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setWeekOffset((w) => w + 1)}
            data-tour-id="schedule-week-next"
          >
            {t("agenda.next")}
          </button>
        </div>
      </div>
      <p className="muted" aria-live="polite">
        {t("agenda.weekOf", { day: formatDay(monday, lang) })}
      </p>
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
      {sessions.error ? <ErrorNote code={sessions.error} onRetry={sessions.reload} /> : null}
      {sessions.loading ? <Loading /> : null}

      <ol className="sched-week">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          return (
            <li key={day} className="sched-day">
              <h2 className="sched-day__title">{formatDay(day, lang)}</h2>
              {items.length === 0 ? (
                <p className="muted">{t("agenda.noSessions")}</p>
              ) : (
                <ul className="sched-list">
                  {items.map((s) => (
                    <li key={s.id} className="sched-card">
                      <p className="sched-card__time mono">
                        {formatTime(s.starts_at, lang, tz)}–{formatTime(s.ends_at, lang, tz)}
                      </p>
                      <p className="sched-card__name">{s.class_name}</p>
                      {s.room ? (
                        <p className="muted">{t("agenda.room", { room: s.room })}</p>
                      ) : null}
                      <p className="muted">
                        {t("agenda.instructor", {
                          name: s.instructor_name ?? t("agenda.new.unassigned"),
                        })}
                      </p>
                      <p>
                        {s.cancelled ? (
                          <Plate tone="blocked">{t("agenda.cancelled")}</Plate>
                        ) : (
                          <>
                            <Plate tone={s.booked >= s.capacity ? "warn" : "ok"}>
                              {t("agenda.occupancy", { booked: s.booked, capacity: s.capacity })}
                            </Plate>{" "}
                            {s.waitlisted > 0 ? (
                              <span className="muted">
                                {t("agenda.waiting", { n: s.waitlisted })}
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        data-tour-id="schedule-roster-open"
                        aria-pressed={open?.id === s.id}
                        onClick={() => setOpen(open?.id === s.id ? null : s)}
                      >
                        {t("agenda.openRoster")}
                        <span className="sr-only">
                          : {s.class_name}, {formatDay(day, lang)}{" "}
                          {formatTime(s.starts_at, lang, tz)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {open ? (
        <RosterPanel
          key={open.id}
          session={open}
          location={current}
          onChanged={sessions.reload}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function RosterPanel({
  session,
  location,
  onChanged,
  onClose,
}: {
  session: ClassSession;
  location: Location | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useST();
  const { api, role } = useSession();
  const sched = useScheduleApi();
  const roster = useAsync(() => sched.roster(session.id), [sched, session.id]);
  const foh = FRONT_OF_HOUSE.includes(role ?? "");
  const members = useAsync(
    () => (foh ? api.members(session.location_id) : Promise.resolve({ data: [] })),
    [api, foh, session.location_id],
  );
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [memberId, setMemberId] = useState("");
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const tz = location?.timezone;

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true);
      setError(null);
      try {
        setAnnounce(await fn());
        roster.reload();
        onChanged();
      } catch (err) {
        setError(toErrorCode(err));
      } finally {
        setBusy(false);
      }
    },
    [roster, onChanged],
  );

  async function bookMember(e: FormEvent) {
    e.preventDefault();
    const m = members.data?.data.find((x) => x.id === memberId);
    if (!m) return;
    await run(async () => {
      const r = await sched.book(session.id, m.id);
      return r.status === "waitlisted"
        ? t("roster.waitlisted", { name: m.full_name, n: r.waitlist_position ?? 0 })
        : t("roster.booked", { name: m.full_name });
    });
  }

  const rows: RosterEntry[] = roster.data?.data ?? [];
  return (
    <Section
      title={t("roster.title", { name: session.class_name })}
      actions={
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          {t("roster.close")}
        </button>
      }
    >
      <p className="muted">
        {formatDay(dayKey(session.starts_at, tz ?? "America/Puerto_Rico"), lang)}{" "}
        {formatTime(session.starts_at, lang, tz ?? "America/Puerto_Rico")}
      </p>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
      {roster.error ? <ErrorNote code={roster.error} onRetry={roster.reload} /> : null}
      {roster.loading ? <Loading /> : null}
      {roster.data && rows.length === 0 ? <p className="muted">{t("roster.empty")}</p> : null}
      {rows.length > 0 ? (
        <TableWrap label={t("roster.title", { name: session.class_name })}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("common.member")}</th>
                <th scope="col">{t("common.status")}</th>
                <th scope="col">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.booking_id}>
                  <th scope="row">
                    {r.full_name}
                    {r.member_no ? <span className="muted mono"> · {r.member_no}</span> : null}
                  </th>
                  <td>
                    <Plate tone={bookingTone(r.status)}>{t(`bstatus.${r.status}`)}</Plate>
                    {r.waitlist_position ? (
                      <span className="muted">
                        {" "}
                        {t("roster.position", { n: r.waitlist_position })}
                      </span>
                    ) : null}
                    {r.late_cancel ? <span className="muted"> · {t("roster.late")}</span> : null}
                  </td>
                  <td>
                    <div className="row-actions">
                      {["booked", "attended", "no_show"].includes(r.status) ? (
                        <>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy || r.status === "attended"}
                            data-tour-id="schedule-mark-attended"
                            onClick={() =>
                              run(async () => {
                                await sched.markAttendance(r.booking_id, "attended");
                                return t("roster.marked", {
                                  name: r.full_name,
                                  status: t("bstatus.attended"),
                                });
                              })
                            }
                          >
                            {t("roster.attended")}
                            <span className="sr-only">: {r.full_name}</span>
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy || r.status === "no_show"}
                            data-tour-id="schedule-mark-noshow"
                            onClick={() =>
                              run(async () => {
                                await sched.markAttendance(r.booking_id, "no_show");
                                return t("roster.marked", {
                                  name: r.full_name,
                                  status: t("bstatus.no_show"),
                                });
                              })
                            }
                          >
                            {t("roster.noShow")}
                            <span className="sr-only">: {r.full_name}</span>
                          </button>
                        </>
                      ) : null}
                      {foh && (r.status === "booked" || r.status === "waitlisted") ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const c = await sched.cancelBooking(r.booking_id);
                              return c.late_cancel
                                ? t("classes.cancelledLate")
                                : t("classes.cancelledOk");
                            })
                          }
                        >
                          {t("roster.cancelBooking")}
                          <span className="sr-only">: {r.full_name}</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {foh && !session.cancelled ? (
        <form className="form form--boxed" onSubmit={bookMember}>
          <div className="toolbar">
            <div className="field field--grow">
              <label htmlFor={selectId}>{t("roster.book")}</label>
              <select
                id={selectId}
                required
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                data-tour-id="schedule-book-member"
              >
                <option value="">{t("common.choose")}</option>
                {(members.data?.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy || !memberId}>
              {t("roster.bookSubmit")}
            </button>
          </div>
        </form>
      ) : null}

      {SESSION_MANAGERS.includes(role ?? "") && !session.cancelled ? (
        <div className="danger-zone">
          <button
            type="button"
            className="btn btn--danger-outline"
            disabled={busy}
            data-tour-id="schedule-session-cancel"
            onClick={() =>
              run(async () => {
                const r = await sched.cancelSession(session.id);
                return t("roster.sessionCancelled", { n: r.bookings_cancelled });
              })
            }
          >
            {t("roster.cancelSession")}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function NewSessionForm({ location, onCreated }: { location: Location; onCreated: () => void }) {
  const { t } = useST();
  const sched = useScheduleApi();
  const types = useAsync(() => sched.classTypes(), [sched]);
  const staff = useAsync(() => sched.staff(location.id), [sched, location.id]);
  const [typeId, setTypeId] = useState("");
  const [instructor, setInstructor] = useState("");
  const [room, setRoom] = useState("");
  const [date, setDate] = useState(() =>
    dayKey(new Date(Date.now() + 86_400_000), location.timezone),
  );
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState(false);
  const ids = {
    type: useId(),
    instructor: useId(),
    room: useId(),
    date: useId(),
    time: useId(),
    duration: useId(),
    capacity: useId(),
  };
  const activeTypes = (types.data?.data ?? []).filter((c) => c.active);
  const trainers = (staff.data?.data ?? []).filter((s) => s.role === "trainer");

  function pickType(id: string) {
    setTypeId(id);
    const c = activeTypes.find((x) => x.id === id);
    if (c) {
      setDuration(c.duration_min);
      setCapacity(c.default_capacity);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const start = zonedToUtc(date, time, location.timezone);
      await sched.createSession({
        location_id: location.id,
        class_type_id: typeId,
        instructor_id: instructor || null,
        ...(room.trim() ? { room: room.trim() } : {}),
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + duration * 60_000).toISOString(),
        capacity,
      });
      setDone(true);
      onCreated();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("agenda.new.title")}>
      {types.data && activeTypes.length === 0 ? (
        <p className="note note--warn">{t("agenda.new.noTypes")}</p>
      ) : null}
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.type}>{t("agenda.new.classType")}</label>
            <select
              id={ids.type}
              required
              value={typeId}
              onChange={(e) => pickType(e.target.value)}
            >
              <option value="">{t("common.choose")}</option>
              {activeTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.instructor}>{t("agenda.new.instructor")}</label>
            <select
              id={ids.instructor}
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
            >
              <option value="">{t("agenda.new.unassigned")}</option>
              {trainers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.room}>{t("agenda.new.room")}</label>
            <input
              id={ids.room}
              maxLength={60}
              value={room}
              autoComplete="off"
              onChange={(e) => setRoom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.date}>{t("common.date")}</label>
            <input
              id={ids.date}
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.time}>{t("common.time")}</label>
            <input
              id={ids.time}
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.duration}>{t("common.duration")}</label>
            <input
              id={ids.duration}
              type="number"
              min={5}
              max={480}
              required
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.capacity}>{t("agenda.new.capacity")}</label>
            <input
              id={ids.capacity}
              type="number"
              min={1}
              max={500}
              required
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !typeId}
            data-tour-id="schedule-session-submit"
          >
            {t("agenda.new.submit")}
          </button>
        </div>
        <LiveResult tone={done ? "ok" : undefined}>{done ? t("agenda.new.done") : null}</LiveResult>
        {error ? <ErrorNote code={error} /> : null}
      </form>
    </Section>
  );
}
