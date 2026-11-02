import { ErrorNote, Loading, Plate, Section } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { bookingTone } from "./AgendaScreen";
import { useST, useScheduleApi } from "./shared";
import { DEFAULT_TZ, formatDateTimeIn } from "./time";

/** Member record tab (front of house): recent bookings and check-ins of this member. */
export function MemberScheduleTab({ memberId }: { memberId: string }) {
  const { t, lang } = useST();
  const sched = useScheduleApi();
  const bookings = useAsync(() => sched.bookings(memberId), [sched, memberId]);
  const checkIns = useAsync(
    () => sched.checkIns({ member_id: memberId, limit: "10" }),
    [sched, memberId],
  );
  return (
    <Section title={t("tab.title")}>
      <h3 className="form__title">{t("tab.bookings")}</h3>
      {bookings.loading ? <Loading /> : null}
      {bookings.error ? <ErrorNote code={bookings.error} onRetry={bookings.reload} /> : null}
      {bookings.data && bookings.data.data.length === 0 ? (
        <p className="muted">{t("classes.historyEmpty")}</p>
      ) : null}
      <ul className="sched-history">
        {(bookings.data?.data ?? []).slice(0, 10).map((b) => (
          <li key={b.id}>
            <span className="nowrap">{formatDateTimeIn(b.starts_at, lang, DEFAULT_TZ)}</span>{" "}
            <strong>{b.class_name}</strong>{" "}
            <Plate tone={bookingTone(b.status)}>{t(`bstatus.${b.status}`)}</Plate>
            {b.late_cancel ? <span className="muted"> · {t("roster.late")}</span> : null}
          </li>
        ))}
      </ul>
      <h3 className="form__title">{t("tab.checkins")}</h3>
      {checkIns.error ? <ErrorNote code={checkIns.error} onRetry={checkIns.reload} /> : null}
      {checkIns.data && checkIns.data.data.length === 0 ? (
        <p className="muted">{t("checkin.none")}</p>
      ) : null}
      <ul className="sched-history">
        {(checkIns.data?.data ?? []).map((c) => (
          <li key={c.id}>
            <span className="nowrap">{formatDateTimeIn(c.at, lang, DEFAULT_TZ)}</span>{" "}
            <Plate tone={c.result === "allowed" ? "ok" : "blocked"}>
              {c.result === "allowed" ? t("checkin.allowed") : t("checkin.denied")}
            </Plate>{" "}
            {t(`reason.${c.reason}`)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
