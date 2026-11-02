import { Icon } from "../../components/icons";
import { ErrorNote, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { bookingTone } from "./AgendaScreen";
import { IconSection, useST, useScheduleApi } from "./shared";
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
    <IconSection icon="calendar" title={t("tab.title")}>
      <h3 className="sched-sub">
        <Icon name="calendarPlus" size={20} />
        {t("tab.bookings")}
      </h3>
      {bookings.loading ? <Loading /> : null}
      {bookings.error ? <ErrorNote code={bookings.error} onRetry={bookings.reload} /> : null}
      {bookings.data && bookings.data.data.length === 0 ? (
        <p className="muted">{t("classes.historyEmpty")}</p>
      ) : null}
      <ul className="sched-history">
        {(bookings.data?.data ?? []).slice(0, 10).map((b) => (
          <li key={b.id} className="sched-hist">
            <span className="sched-hist__when">
              {formatDateTimeIn(b.starts_at, lang, DEFAULT_TZ)}
            </span>
            <strong className="sched-hist__name">{b.class_name}</strong>
            <span className="sched-hist__status">
              <Plate tone={bookingTone(b.status)}>{t(`bstatus.${b.status}`)}</Plate>
              {b.late_cancel ? <span className="muted"> · {t("roster.late")}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="sched-sub">
        <Icon name="checkCircle" size={20} />
        {t("tab.checkins")}
      </h3>
      {checkIns.error ? <ErrorNote code={checkIns.error} onRetry={checkIns.reload} /> : null}
      {checkIns.data && checkIns.data.data.length === 0 ? (
        <p className="muted">{t("checkin.none")}</p>
      ) : null}
      <ul className="sched-history">
        {(checkIns.data?.data ?? []).map((c) => (
          <li key={c.id} className="sched-hist">
            <span className="sched-hist__when">{formatDateTimeIn(c.at, lang, DEFAULT_TZ)}</span>
            <span className="sched-hist__status">
              <Plate tone={c.result === "allowed" ? "ok" : "blocked"}>
                {c.result === "allowed" ? t("checkin.allowed") : t("checkin.denied")}
              </Plate>
            </span>
            <span className="sched-hist__name">{t(`reason.${c.reason}`)}</span>
          </li>
        ))}
      </ul>
    </IconSection>
  );
}
