import { useMemo, useState } from "react";
import { ErrorNote, Loading, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { count, reportsApi } from "./api";
import { Kpi, KpiGroup, LocationSelect, OverdueTable, QuickCheckIn } from "./components";
import { useReportsT } from "./dict";
import "./reports.css";

const time = (iso: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    timeStyle: "short",
    timeZone: "America/Puerto_Rico",
  }).format(new Date(iso));

/** "Hoy" — front desk mini-panel for their location(s). No revenue figures: only the balance owed at the desk. */
export function TodayScreen() {
  const { t, lang } = useReportsT();
  const { api } = useSession();
  const rpt = useMemo(() => reportsApi(api), [api]);
  const [loc, setLoc] = useState("");
  const locId = loc || undefined;
  const locations = useAsync(() => api.locations(), [api]);
  const today = useAsync(() => rpt.today(locId), [rpt, locId]);
  const overdue = useAsync(() => rpt.overdue(locId), [rpt, locId]);
  const locs = locations.data?.data ?? [];
  const d = today.data;

  return (
    <div className="page rpt">
      <h1 className="page__title">{t("today.title")}</h1>
      <p className="lede">{t("today.lede")}</p>
      {locs.length > 1 ? (
        <div className="toolbar">
          <LocationSelect
            locations={locs}
            value={loc}
            onChange={setLoc}
            tourId="rpt-today-location"
          />
        </div>
      ) : null}

      <QuickCheckIn locations={locs} locationId={loc} />

      {today.loading && !d ? <Loading /> : null}
      {today.error ? <ErrorNote code={today.error} onRetry={today.reload} /> : null}
      {d ? (
        <>
          <KpiGroup title={t("today.title")}>
            <Kpi label={t("today.checkIns")} value={count(d.check_ins_today, lang)} />
            <Kpi label={t("today.members")} value={count(d.check_ins_members_today, lang)} />
            <Kpi label={t("today.denied")} value={count(d.check_ins_denied_today, lang)} />
            <Kpi
              label={t("today.overdue")}
              value={count(d.overdue_members, lang)}
              to="#rpt-today-overdue"
              tone={d.overdue_members > 0 ? "warn" : undefined}
            />
          </KpiGroup>
          <Section title={t("today.classes")}>
            {d.classes_today.length === 0 ? (
              <p className="muted">{t("today.noClasses")}</p>
            ) : (
              <TableWrap label={t("today.classes")}>
                <table className="table" data-tour-id="rpt-today-classes">
                  <thead>
                    <tr>
                      <th scope="col">{t("today.col.time")}</th>
                      <th scope="col">{t("today.col.class")}</th>
                      <th scope="col">{t("today.col.room")}</th>
                      <th scope="col">{t("today.col.booked")}</th>
                      <th scope="col">{t("today.col.waitlist")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.classes_today.map((c) => (
                      <tr key={c.session_id}>
                        <td className="mono">{time(c.starts_at, lang)}</td>
                        <th scope="row">{c.class_name}</th>
                        <td>{c.room ?? "—"}</td>
                        <td className="mono">
                          {t("today.bookedOf", { booked: c.booked, capacity: c.capacity })}
                        </td>
                        <td className="mono">{c.waitlisted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
        </>
      ) : null}

      <Section title={t("today.overdueTitle")}>
        <div id="rpt-today-overdue" />
        {overdue.error ? <ErrorNote code={overdue.error} onRetry={overdue.reload} /> : null}
        {overdue.data && overdue.data.data.length === 0 ? (
          <p className="muted">{t("overdue.empty")}</p>
        ) : null}
        {overdue.data && overdue.data.data.length > 0 ? (
          <OverdueTable rows={overdue.data.data} showLocation={locs.length > 1} />
        ) : null}
      </Section>
    </div>
  );
}
