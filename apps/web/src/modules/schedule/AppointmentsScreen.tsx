import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { AppointmentKind } from "./api";
import { FRONT_OF_HOUSE, LocationSelect, useLocations, useST, useScheduleApi } from "./shared";
import { addDays, dayKey, formatDateTimeIn, zonedToUtc } from "./time";

/** Kinds each role may schedule (the database re-checks; health-related kinds only for oneself). */
export function kindsFor(role: string | null): AppointmentKind[] {
  if (role && FRONT_OF_HOUSE.includes(role)) return ["personal_training"];
  if (role === "trainer") return ["personal_training", "assessment"];
  if (role === "nutritionist") return ["nutrition"];
  if (role === "clinician") return ["clinical", "assessment"];
  return [];
}
/** Staff role that delivers each kind. */
const DELIVERS: Record<AppointmentKind, string[]> = {
  personal_training: ["trainer"],
  assessment: ["trainer", "clinician"],
  nutrition: ["nutritionist"],
  clinical: ["clinician"],
};

export function AppointmentsScreen() {
  const { t, lang } = useST();
  const { role } = useSession();
  const sched = useScheduleApi();
  const [locationId, setLocationId] = useState("");
  const { list, current, tz } = useLocations(locationId, setLocationId);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const from = new Date(Date.now() - 86_400_000);
  const fromKey = dayKey(from, tz);
  const appts = useAsync(
    () =>
      locationId
        ? sched.appointments({
            location_id: locationId,
            from: zonedToUtc(fromKey, "00:00", tz).toISOString(),
            to: zonedToUtc(addDays(fromKey, 15), "00:00", tz).toISOString(),
          })
        : Promise.resolve({ data: [] }),
    [sched, locationId, fromKey, tz],
  );
  const kinds = kindsFor(role);

  async function cancel(id: string) {
    setError(null);
    try {
      await sched.cancelAppointment(id);
      setAnnounce(t("appt.cancelled"));
      appts.reload();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">{t("appt.title")}</h1>
      <p className="lede">{t("appt.lede")}</p>
      <div className="toolbar">
        <LocationSelect
          list={list}
          value={locationId}
          onChange={setLocationId}
          tourId="appt-location"
        />
      </div>
      {kinds.length > 0 && current ? (
        <NewAppointmentForm
          location={current}
          kinds={kinds}
          onCreated={() => {
            setAnnounce(t("appt.done"));
            appts.reload();
          }}
        />
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
      {appts.loading ? <Loading /> : null}
      {appts.error ? <ErrorNote code={appts.error} onRetry={appts.reload} /> : null}
      {appts.data && appts.data.data.length === 0 ? (
        <p className="muted">{t("appt.empty")}</p>
      ) : null}
      {appts.data && appts.data.data.length > 0 ? (
        <TableWrap label={t("appt.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("appt.col.when")}</th>
                <th scope="col">{t("appt.col.kind")}</th>
                <th scope="col">{t("appt.col.staff")}</th>
                <th scope="col">{t("appt.col.member")}</th>
                <th scope="col">{t("common.status")}</th>
                <th scope="col">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {appts.data.data.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="nowrap">
                    {formatDateTimeIn(a.starts_at, lang, tz)}
                  </th>
                  <td>{t(`kind.${a.kind}`)}</td>
                  <td>{a.staff_name ?? "—"}</td>
                  <td>{a.member_name ?? "—"}</td>
                  <td>
                    <Plate tone={a.status === "scheduled" ? "ok" : "neutral"}>
                      {t(`appt.status.${a.status}`)}
                    </Plate>
                  </td>
                  <td>
                    {a.status === "scheduled" ? (
                      <button type="button" className="btn btn--ghost" onClick={() => cancel(a.id)}>
                        {t("appt.cancel")}
                        <span className="sr-only">
                          : {a.member_name ?? ""} {formatDateTimeIn(a.starts_at, lang, tz)}
                        </span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </div>
  );
}

function NewAppointmentForm({
  location,
  kinds,
  onCreated,
}: {
  location: Location;
  kinds: AppointmentKind[];
  onCreated: () => void;
}) {
  const { t } = useST();
  const { api } = useSession();
  const sched = useScheduleApi();
  const staff = useAsync(() => sched.staff(location.id), [sched, location.id]);
  const members = useAsync(() => api.members(location.id), [api, location.id]);
  const [kind, setKind] = useState<AppointmentKind>(kinds[0] ?? "personal_training");
  const [staffId, setStaffId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [date, setDate] = useState(() =>
    dayKey(new Date(Date.now() + 86_400_000), location.timezone),
  );
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = {
    kind: useId(),
    staff: useId(),
    member: useId(),
    date: useId(),
    time: useId(),
    duration: useId(),
  };
  const staffOptions = (staff.data?.data ?? []).filter((s) => DELIVERS[kind].includes(s.role));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const start = zonedToUtc(date, time, location.timezone);
      await sched.createAppointment({
        kind,
        staff_member_id: staffId,
        member_id: memberId,
        location_id: location.id,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + duration * 60_000).toISOString(),
      });
      onCreated();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("appt.new")}>
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.kind}>{t("appt.kind")}</label>
            <select
              id={ids.kind}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AppointmentKind);
                setStaffId("");
              }}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.staff}>{t("appt.staff")}</label>
            <select
              id={ids.staff}
              required
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">{t("common.choose")}</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.member}>{t("common.member")}</label>
            <select
              id={ids.member}
              required
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
            >
              <option value="">{t("common.choose")}</option>
              {(members.data?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
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
              min={15}
              max={480}
              required
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !staffId || !memberId}
            data-tour-id="appt-submit"
          >
            {t("appt.submit")}
          </button>
        </div>
        {error ? <ErrorNote code={error} /> : null}
      </form>
    </Section>
  );
}
