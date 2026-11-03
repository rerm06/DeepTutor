import { type ReactNode, useId, useMemo } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon, type IconName } from "../../components/icons";
import { ErrorNote, Loading, TableWrap, type Tone } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Reward, engagementApi } from "./api";
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

/** Extra stroke icons for this module (24-unit grid, same style as components/icons.tsx). */
export const ENG_ICON = {
  gift: "M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7C10.5 4 7 3.5 7 5.5S10 7 12 7Zm0 0c1.5-3 5-3.5 5-1.5S14 7 12 7Z",
  medal:
    "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8.6 13.9 7 21l5-3 5 3-1.6-7.1M12 6.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3 1-2Z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z",
} as const;

type IconSpec = { name?: IconName; d?: string };

/** Design-system v2 card: `.section` whose title starts with a gold icon. */
export function Card({
  title,
  icon,
  children,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode;
  icon: IconSpec;
  children: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={className ? `section ${className}` : "section"} aria-labelledby={id}>
      <div className="section__head">
        <Heading id={id} className="section__title">
          <Icon {...icon} size={level === 2 ? 24 : 22} />
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` tile: gold icon, label, value, optional hint. */
export function Stat({
  icon,
  label,
  value,
  hint,
  testId,
  children,
}: {
  icon: IconSpec;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ds-stat">
      <Icon {...icon} size={34} />
      <dl className="ds-stat__text eng-stat">
        <dt className="ds-stat__label">{label}</dt>
        <dd className="ds-stat__value" data-testid={testId}>
          {value}
        </dd>
        {hint ? <dd className="ds-stat__hint">{hint}</dd> : null}
        {children ? <dd className="eng-stat__extra">{children}</dd> : null}
      </dl>
    </div>
  );
}

/** `.ds-empty`: gold icon, one bold line, optional action. */
export function Empty({
  icon,
  text,
  action,
}: { icon: IconSpec; text: string; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <Icon {...icon} size={36} />
      <strong>{text}</strong>
      {action}
    </div>
  );
}

/** Page header: one h1, optional lede and a primary action. */
export function PageHead({
  title,
  lede,
  action,
}: { title: string; lede?: string; action?: ReactNode }) {
  return (
    <div className="eng-head">
      <div className="eng-head__text">
        <h1 className="page__title">{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Balance, weekly streak, achievements and history of one member. */
export function PointsSummary({
  memberId,
  title,
  version = 0,
  nextReward = false,
}: { memberId: string; title: string; version?: number; nextReward?: boolean }) {
  const { t, lang } = useEngT();
  const { role } = useSession();
  const eng = useEng();
  const pts = useAsync(() => eng.memberPoints(memberId), [eng, memberId, version]);
  // Only to draw the bar to the next reward; a failure here simply hides the bar.
  const rewards = useAsync(
    () => (nextReward ? eng.rewards() : Promise.resolve({ data: [] as Reward[] })),
    [eng, nextReward],
  );
  const d = pts.data;
  const catalogue = (rewards.data?.data ?? [])
    .filter((r) => r.active)
    .sort((a, b) => a.points_cost - b.points_cost);
  const next = d ? catalogue.find((r) => r.points_cost > d.balance) : undefined;
  const best = d ? [...catalogue].reverse().find((r) => r.points_cost <= d.balance) : undefined;
  return (
    <Card title={title} icon={{ name: "coin" }}>
      {pts.loading && !d ? <Loading /> : null}
      {pts.error ? <ErrorNote code={pts.error} onRetry={pts.reload} /> : null}
      {d ? (
        <>
          <div className="ds-stats eng-stats">
            <Stat
              icon={{ name: "coin" }}
              label={t("points.balance")}
              value={d.balance}
              testId="eng-balance"
            >
              {next ? (
                <>
                  <span className="ds-bar" aria-hidden="true">
                    <span
                      style={{ width: `${Math.round((d.balance / next.points_cost) * 100)}%` }}
                    />
                  </span>
                  <span className="ds-stat__hint">
                    {t("points.next", { n: next.points_cost - d.balance, reward: next.name })}
                  </span>
                </>
              ) : best ? (
                <>
                  <span className="ds-bar" aria-hidden="true">
                    <span style={{ width: "100%" }} />
                  </span>
                  <span className="ds-stat__hint">
                    {t("points.nextReady", { reward: best.name })}
                  </span>
                </>
              ) : null}
            </Stat>
            <Stat
              icon={{ name: "flame" }}
              label={t("points.streak")}
              value={t("points.streakValue", { n: d.weekly_streak })}
              hint={t("points.streakHelp")}
            />
          </div>
          {nextReward && role === "member" && catalogue.length > 0 ? (
            <div>
              <Link className="ds-cta" to="/me/redeem">
                {t("points.redeemCta")} <Icon name="arrowRight" size={18} />
              </Link>
            </div>
          ) : null}
          <h3 className="eng-h3">
            <Icon name="trophy" size={20} />
            {t("points.badges")}
          </h3>
          {d.achievements.length === 0 ? (
            <Empty icon={{ d: ENG_ICON.medal }} text={t("points.noBadges")} />
          ) : (
            <ul className="eng-badges">
              {d.achievements.map((a) => (
                <li key={`${a.code}-${a.ref ?? ""}`} className="eng-badge">
                  <span className="eng-badge__icon" aria-hidden="true">
                    <Icon d={ENG_ICON.medal} size={30} />
                  </span>
                  <span className="eng-badge__name">{t(`badge.${a.code}` as EngKey)}</span>
                  <span className="eng-badge__date">{formatDate(a.earned_at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="eng-h3">
            <Icon d={ENG_ICON.clock} size={20} />
            {t("points.history")}
          </h3>
          {d.history.length === 0 ? (
            <Empty icon={{ d: ENG_ICON.clock }} text={t("points.none")} />
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
                      <td className={`mono eng-delta${h.delta > 0 ? " eng-delta--up" : ""}`}>
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      ) : null}
    </Card>
  );
}

function formatDate(iso: string, lang: "es" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Puerto_Rico",
  });
}
