import { useMemo } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, Loading, Plate, Section, TableWrap, type Tone } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { engagementApi } from "./api";
import { type EngKey, useEngT } from "./dict";

/** Front of house: award points, redeem at the counter, moderate, credit referrals. */
export const FRONT_ROLES = ["owner", "location_manager", "front_desk"] as const;
/** Configure rules, rewards and challenges. */
export const CONFIG_ROLES = ["owner", "location_manager"] as const;

export const isFront = (role: string | null | undefined) =>
  (FRONT_ROLES as readonly string[]).includes(role ?? "");
export const isConfig = (role: string | null | undefined) =>
  (CONFIG_ROLES as readonly string[]).includes(role ?? "");

export function useEng() {
  const { api } = useSession();
  return useMemo(() => engagementApi(api), [api]);
}

/** The member rows the caller may act on: a member gets their own; a guardian gets their wards. */
export function useMyMembers() {
  const { api } = useSession();
  return useAsync(() => api.members(), [api]);
}

export function statusTone(status: string): Tone {
  if (status === "approved" || status === "fulfilled" || status === "credited") return "ok";
  if (status === "pending" || status === "requested" || status === "joined") return "warn";
  if (status === "rejected" || status === "cancelled") return "blocked";
  return "neutral";
}

/** Run an action with busy/announce/error state handled by the caller's setters. */
export async function act(
  set: {
    busy: (b: boolean) => void;
    error: (e: ErrorCode | null) => void;
    announce: (s: string | null) => void;
  },
  fn: () => Promise<string>,
): Promise<boolean> {
  set.busy(true);
  set.error(null);
  set.announce(null);
  try {
    set.announce(await fn());
    return true;
  } catch (err) {
    set.error(toErrorCode(err));
    return false;
  } finally {
    set.busy(false);
  }
}

/** Balance, weekly streak, achievements and history of one member. */
export function PointsSummary({
  memberId,
  title,
  version = 0,
}: { memberId: string; title: string; version?: number }) {
  const { t, lang } = useEngT();
  const eng = useEng();
  const pts = useAsync(() => eng.memberPoints(memberId), [eng, memberId, version]);
  const d = pts.data;
  return (
    <Section title={title}>
      {pts.loading && !d ? <Loading /> : null}
      {pts.error ? <ErrorNote code={pts.error} onRetry={pts.reload} /> : null}
      {d ? (
        <>
          <dl className="facts eng-stats">
            <div>
              <dt>{t("points.balance")}</dt>
              <dd className="eng-stats__value" data-testid="eng-balance">
                {d.balance}
              </dd>
            </div>
            <div>
              <dt>{t("points.streak")}</dt>
              <dd className="eng-stats__value">
                {t("points.streakValue", { n: d.weekly_streak })}
              </dd>
            </div>
          </dl>
          <p className="help">{t("points.streakHelp")}</p>
          <h3 className="form__title">{t("points.badges")}</h3>
          {d.achievements.length === 0 ? (
            <p className="muted">{t("points.noBadges")}</p>
          ) : (
            <ul className="eng-badges">
              {d.achievements.map((a) => (
                <li key={`${a.code}-${a.ref ?? ""}`}>
                  <Plate tone="ok">{t(`badge.${a.code}` as EngKey)}</Plate>
                </li>
              ))}
            </ul>
          )}
          <h3 className="form__title">{t("points.history")}</h3>
          {d.history.length === 0 ? (
            <p className="muted">{t("points.none")}</p>
          ) : (
            <TableWrap label={t("points.history")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("points.col.when")}</th>
                    <th scope="col">{t("points.col.reason")}</th>
                    <th scope="col">{t("points.col.delta")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.id}>
                      <td className="nowrap">{formatDateTime(h.at, lang)}</td>
                      <td>
                        {t(`event.${h.reason}` as EngKey)}
                        {h.note ? <span className="muted"> · {h.note}</span> : null}
                      </td>
                      <td className="mono">{h.delta > 0 ? `+${h.delta}` : h.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      ) : null}
    </Section>
  );
}
