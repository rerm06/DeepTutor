import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import type { Member } from "../../api/types";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { Leaderboard } from "./StaffChallengesScreen";
import { PostList } from "./StaffCommunityScreen";
import { type Challenge, POST_MAX_LENGTH } from "./api";
import { type EngKey, useEngT } from "./dict";
import {
  Card,
  ENG_ICON,
  Empty,
  PageHead,
  PointsSummary,
  Stat,
  act,
  statusTone,
  useEng,
  useMyMembers,
} from "./shared";

/** Shared frame: loads the caller's member rows (a member: their own; a guardian: their wards). */
function WithMembers({
  title,
  lede,
  children,
}: { title: string; lede?: string; children: (rows: Member[]) => ReactNode }) {
  const { t } = useEngT();
  const members = useMyMembers();
  const rows = members.data?.data ?? [];
  return (
    <div className="page eng-page">
      <PageHead title={title} lede={lede} />
      {members.loading && !members.data ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {members.data && rows.length === 0 ? (
        <p className="note note--warn">{t("common.noMember")}</p>
      ) : null}
      {rows.length > 0 ? children(rows) : null}
    </div>
  );
}

/** "Mis puntos": balance, weekly streak, achievements, history. Guardians see each ward. */
export function MyPointsScreen() {
  const { t } = useEngT();
  const { role } = useSession();
  return (
    <WithMembers title={t("nav.myPoints")} lede={t("points.memberLede")}>
      {(rows) =>
        rows.map((m) => (
          <PointsSummary
            key={m.id}
            memberId={m.id}
            nextReward
            title={
              role === "guardian" || rows.length > 1
                ? t("points.forMember", { name: m.full_name })
                : t("points.summary")
            }
          />
        ))
      }
    </WithMembers>
  );
}

/** "Retos": join (members), opt-in leaderboard and comparison mode, progress. Guardians: read-only progress. */
export function MyChallengesScreen() {
  const { t } = useEngT();
  const { role } = useSession();
  const eng = useEng();
  const list = useAsync(() => eng.challenges(), [eng]);
  return (
    <WithMembers title={t("challenges.title")} lede={t("challenges.memberLede")}>
      {(rows) => (
        <>
          {list.loading && !list.data ? <Loading /> : null}
          {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.data.length === 0 ? (
            <section className="section">
              <Empty icon={{ name: "trophy" }} text={t("challenges.none")} />
            </section>
          ) : null}
          {role === "guardian" ? <p className="muted">{t("challenges.readOnly")}</p> : null}
          {(list.data?.data ?? []).map((c) => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              member={rows[0] as Member}
              readOnly={role !== "member"}
            />
          ))}
        </>
      )}
    </WithMembers>
  );
}

function ChallengeCard({
  challenge,
  member,
  readOnly,
}: { challenge: Challenge; member: Member; readOnly: boolean }) {
  const { t, lang } = useEngT();
  const eng = useEng();
  const [version, setVersion] = useState(0);
  const board = useAsync(() => eng.leaderboard(challenge.id), [eng, challenge.id, version]);
  const mine = useAsync(() => eng.participants(challenge.id), [eng, challenge.id, version]);
  const own = (board.data?.data ?? []).filter((r) => r.division === "self");
  const participation = (mine.data?.data ?? []).find((p) => p.member_id === member.id) ?? null;
  const ranked = (board.data?.data ?? []).some((r) => r.division !== "self");
  const titleId = useId();
  const metric = t(`metric.${challenge.metric}` as EngKey);
  const perks = [
    t("challenges.perkGoal", { goal: challenge.goal, metric: metric.toLowerCase() }),
    t("challenges.perkKind", { kind: t(`kind.${challenge.kind}` as EngKey) }),
    t("challenges.perkDates", {
      start: dayLabel(challenge.starts_on, lang),
      end: dayLabel(challenge.ends_on, lang),
    }),
    t("challenges.perkPrivacy"),
  ];

  return (
    <section className="section eng-ch" aria-labelledby={titleId}>
      <div className="eng-ch__banner">
        <span className="eng-ch__badge" aria-hidden="true">
          <Icon name="dumbbell" size={36} />
        </span>
        <div className="eng-ch__title">
          <span className="eng-ch__kicker">
            {t(`kind.${challenge.kind}` as EngKey)} · {metric}
          </span>
          <h2 id={titleId}>{challenge.name}</h2>
          <small>{t("challenges.until", { date: dayLabel(challenge.ends_on, lang) })}</small>
        </div>
        <img
          className="eng-ch__img"
          src="/brand/challenge-transformation.jpg"
          alt=""
          width={146}
          height={141}
        />
        <ul className="eng-ch__perks">
          {perks.map((p) => (
            <li key={p}>
              <Icon name="checkCircle" size={18} /> {p}
            </li>
          ))}
        </ul>
        <div className="eng-ch__cta">
          {participation ? (
            <span className="ds-pill">
              <Icon name="check" size={16} /> {t("challenges.in")}
            </span>
          ) : null}
          {!readOnly && mine.data && !participation ? (
            <JoinForm
              challenge={challenge}
              memberId={member.id}
              onJoined={() => setVersion((v) => v + 1)}
            />
          ) : null}
        </div>
      </div>
      {board.error ? <ErrorNote code={board.error} onRetry={board.reload} /> : null}
      {own.map((r) => (
        <div key={r.label} className="eng-progress">
          <p className="eng-progress__label">
            <Icon name="chart" size={20} />
            {readOnly
              ? t("challenges.wardProgress", { name: r.label, progress: r.progress, goal: r.goal })
              : t("challenges.myProgress", { progress: r.progress, goal: r.goal })}
            <span className="eng-progress__pct">
              {r.goal > 0 ? Math.min(100, Math.round((r.progress / r.goal) * 100)) : 0}%
            </span>
          </p>
          <span className="ds-bar" aria-hidden="true">
            <span
              style={{
                width: `${r.goal > 0 ? Math.min(100, (r.progress / r.goal) * 100) : 0}%`,
              }}
            />
          </span>
        </div>
      ))}
      <div className="eng-ch__body">
        {!readOnly && participation ? (
          <div className="eng-ch__prefs">
            <Preferences
              challengeId={challenge.id}
              memberId={member.id}
              show={participation.show_on_leaderboard}
              mode={participation.compare_mode}
              onSaved={() => setVersion((v) => v + 1)}
            />
            {participation.compare_mode === "self" ? (
              <p className="help">{t("challenges.selfOnly")}</p>
            ) : null}
          </div>
        ) : participation?.compare_mode === "self" ? (
          <p className="help">{t("challenges.selfOnly")}</p>
        ) : null}
        {ranked || (!participation && !readOnly) ? (
          <Leaderboard
            challengeId={challenge.id}
            title={t("challenges.leaderboard")}
            version={version}
            bare
          />
        ) : null}
      </div>
    </section>
  );
}

function dayLabel(ymd: string, lang: "es" | "en"): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(".", "");
}

function JoinForm({
  challenge,
  memberId,
  onJoined,
}: { challenge: Challenge; memberId: string; onJoined: () => void }) {
  const { t } = useEngT();
  const eng = useEng();
  const teams = useAsync(
    () => (challenge.kind === "team" ? eng.teams(challenge.id) : Promise.resolve({ data: [] })),
    [eng, challenge.id, challenge.kind],
  );
  const [team, setTeam] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { team: useId(), show: useId(), help: useId() };
  const firstTeam = teams.data?.data[0]?.id ?? "";
  useEffect(() => {
    if (!team && firstTeam) setTeam(firstTeam);
  }, [team, firstTeam]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.join(challenge.id, memberId, challenge.kind === "team" ? team : null, show);
      return t("challenges.joined");
    });
    if (ok) onJoined();
  }

  return (
    <form className="form eng-join" onSubmit={submit}>
      {challenge.kind === "team" ? (
        <div className="field">
          <label htmlFor={ids.team}>{t("challenges.team")}</label>
          <select id={ids.team} value={team} required onChange={(e) => setTeam(e.target.value)}>
            {(teams.data?.data ?? []).map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <span className="eng-check">
          <input
            id={ids.show}
            type="checkbox"
            checked={show}
            aria-describedby={ids.help}
            onChange={(e) => setShow(e.target.checked)}
            data-tour-id="eng-leaderboard-optin"
          />
          <label htmlFor={ids.show}>{t("challenges.showMe")}</label>
        </span>
        <p id={ids.help} className="help">
          {t("challenges.showMeHelp")}
        </p>
      </div>
      <div className="form__actions">
        <button type="submit" className="ds-cta" disabled={busy} data-tour-id="eng-challenge-join">
          {t("challenges.join")}
          <span className="sr-only">: {challenge.name}</span>
          <Icon name="arrowRight" size={18} />
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function Preferences({
  challengeId,
  memberId,
  show,
  mode,
  onSaved,
}: {
  challengeId: string;
  memberId: string;
  show: boolean;
  mode: "self" | "ranked";
  onSaved: () => void;
}) {
  const { t } = useEngT();
  const eng = useEng();
  const [s, setS] = useState(show);
  const [ranked, setRanked] = useState(mode === "ranked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { s: useId(), r: useId() };
  return (
    <form
      className="form eng-prefs"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await act(
          { busy: setBusy, error: setError, announce: setAnnounce },
          async () => {
            await eng.preferences(challengeId, memberId, s, ranked ? "ranked" : "self");
            return t("challenges.prefsSaved");
          },
        );
        if (ok) onSaved();
      }}
    >
      <h3 className="eng-h3">
        <Icon d={ENG_ICON.shield} size={20} />
        {t("challenges.privacy")}
      </h3>
      <span className="eng-check">
        <input id={ids.s} type="checkbox" checked={s} onChange={(e) => setS(e.target.checked)} />
        <label htmlFor={ids.s}>{t("challenges.showMe")}</label>
      </span>
      <span className="eng-check">
        <input
          id={ids.r}
          type="checkbox"
          checked={ranked}
          onChange={(e) => setRanked(e.target.checked)}
        />
        <label htmlFor={ids.r}>{t("challenges.ranked")}</label>
      </span>
      <div className="form__actions">
        <button type="submit" className="btn" disabled={busy} data-tour-id="eng-challenge-prefs">
          {t("challenges.savePrefs")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

/** "Muro": post (pending until moderated) and read approved posts plus one's own. Members only. */
export function WallScreen() {
  const { t } = useEngT();
  return (
    <WithMembers title={t("wall.title")} lede={t("wall.lede")}>
      {(rows) => <Wall memberId={(rows[0] as Member).id} />}
    </WithMembers>
  );
}

function Wall({ memberId }: { memberId: string }) {
  const { t } = useEngT();
  const eng = useEng();
  const posts = useAsync(() => eng.posts(), [eng]);
  const [body, setBody] = useState("");
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { b: useId(), help: useId(), count: useId(), err: useId() };
  const mine = (posts.data?.data ?? []).filter(
    (p) => p.author_member_id === memberId && p.status !== "approved",
  );
  const feed = (posts.data?.data ?? []).filter((p) => p.status === "approved");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.post(memberId, body);
      return t("wall.sent");
    });
    if (ok) {
      setBody("");
      posts.reload();
    }
  }

  return (
    <>
      <Card title={t("wall.compose")} icon={{ name: "chat" }}>
        <form className="form" onSubmit={submit} noValidate>
          <div className="field field--wide">
            <label htmlFor={ids.b}>{t("wall.body")}</label>
            <textarea
              id={ids.b}
              rows={3}
              maxLength={POST_MAX_LENGTH}
              value={body}
              aria-invalid={empty}
              aria-describedby={`${ids.help} ${ids.count}${empty ? ` ${ids.err}` : ""}`}
              onChange={(e) => setBody(e.target.value)}
            />
            <p id={ids.help} className="help">
              {t("wall.help")}
            </p>
            <p id={ids.count} className="help">
              {t("wall.counter", { n: body.length })}
            </p>
            {empty ? (
              <p id={ids.err} className="field-error" role="alert">
                {t("wall.empty")}
              </p>
            ) : null}
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-tour-id="eng-wall-post"
            >
              <Icon d={ENG_ICON.send} size={18} />
              {t("wall.send")}
            </button>
          </div>
        </form>
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error === "forbidden" ? (
          <p className="note note--warn" role="alert">
            {t("wall.minor")}
          </p>
        ) : null}
        {error === "invalid_input" ? (
          <p className="note note--error" role="alert">
            {t("wall.refused")}
          </p>
        ) : null}
        {error && error !== "forbidden" && error !== "invalid_input" ? (
          <ErrorNote code={error} />
        ) : null}
        {mine.length > 0 ? (
          <ul className="eng-posts">
            {mine.map((p) => (
              <li key={p.id} className="eng-post eng-post--mine">
                <Plate tone={statusTone(p.status)}>{t(`status.${p.status}` as EngKey)}</Plate>
                <p className="eng-post__body">{p.body}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title={t("wall.feed")} icon={{ name: "users" }}>
        {posts.loading && !posts.data ? <Loading /> : null}
        {posts.error ? <ErrorNote code={posts.error} onRetry={posts.reload} /> : null}
        {posts.data && feed.length === 0 ? (
          <Empty icon={{ name: "chat" }} text={t("wall.none")} />
        ) : null}
        <PostList posts={feed} />
      </Card>
    </>
  );
}

/** "Referir": record a friend's email (no message is sent) and follow its status. Members only. */
export function ReferScreen() {
  const { t } = useEngT();
  return (
    <WithMembers title={t("refer.title")} lede={t("refer.lede")}>
      {(rows) => <Refer memberId={(rows[0] as Member).id} />}
    </WithMembers>
  );
}

function Refer({ memberId }: { memberId: string }) {
  const { t, lang } = useEngT();
  const eng = useEng();
  const list = useAsync(() => eng.referrals(memberId), [eng, memberId]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { e: useId(), help: useId() };
  return (
    <>
      <Card title={t("refer.title")} icon={{ name: "userPlus" }}>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act(
              { busy: setBusy, error: setError, announce: setAnnounce },
              async () => {
                await eng.refer(memberId, email.trim());
                return t("refer.done");
              },
            );
            if (ok) {
              setEmail("");
              list.reload();
            }
          }}
        >
          <div className="field field--wide">
            <label htmlFor={ids.e}>{t("refer.email")}</label>
            <input
              id={ids.e}
              type="email"
              autoComplete="off"
              required
              maxLength={254}
              aria-describedby={ids.help}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p id={ids.help} className="help">
              {t("refer.help")}
            </p>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-tour-id="eng-refer-send"
            >
              <Icon name="userPlus" size={18} />
              {t("refer.send")}
            </button>
          </div>
        </form>
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error === "invalid_input" ? (
          <p className="note note--error" role="alert">
            {t("refer.invalid")}
          </p>
        ) : null}
        {error && error !== "invalid_input" ? <ErrorNote code={error} /> : null}
      </Card>
      <Card title={t("refer.mine")} icon={{ name: "users" }}>
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length === 0 ? (
          <Empty icon={{ name: "userPlus" }} text={t("refer.none")} />
        ) : null}
        {list.data && list.data.data.length > 0 ? (
          <TableWrap label={t("refer.mine")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("refer.col.email")}</th>
                  <th scope="col">{t("refer.col.status")}</th>
                  <th scope="col">{t("refer.col.points")}</th>
                  <th scope="col">{t("common.date")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="mono">
                      {r.referred_email}
                    </th>
                    <td>
                      <Plate tone={statusTone(r.status)}>{t(`status.${r.status}` as EngKey)}</Plate>
                    </td>
                    <td className="mono">{r.credit_points}</td>
                    <td className="nowrap">{formatDateTime(r.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
    </>
  );
}

/** "Canjear": rewards the member can afford, and their redemptions (cancel while requested). Members only. */
export function RedeemScreen() {
  const { t } = useEngT();
  return (
    <WithMembers title={t("redeem.title")} lede={t("redeem.lede")}>
      {(rows) => <Redeem memberId={(rows[0] as Member).id} />}
    </WithMembers>
  );
}

function Redeem({ memberId }: { memberId: string }) {
  const { t, lang } = useEngT();
  const eng = useEng();
  const [version, setVersion] = useState(0);
  const pts = useAsync(() => eng.memberPoints(memberId), [eng, memberId, version]);
  const rewards = useAsync(() => eng.rewards(), [eng]);
  const mine = useAsync(() => eng.redemptions({ member_id: memberId }), [eng, memberId, version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = { busy: setBusy, error: setError, announce: setAnnounce };
  const balance = pts.data?.balance ?? 0;
  return (
    <>
      {pts.data ? (
        <div className="ds-stats">
          <Stat
            icon={{ name: "coin" }}
            label={t("points.balance")}
            value={balance}
            hint={t("redeem.balance", { n: balance })}
          />
        </div>
      ) : null}
      <Card title={t("rewards.title")} icon={{ d: ENG_ICON.gift }}>
        {rewards.error ? <ErrorNote code={rewards.error} onRetry={rewards.reload} /> : null}
        {rewards.data && rewards.data.data.length === 0 ? (
          <Empty icon={{ d: ENG_ICON.gift }} text={t("rewards.none")} />
        ) : null}
        <ul className="ds-grid eng-rewards">
          {(rewards.data?.data ?? []).map((r) => {
            const pct = r.points_cost > 0 ? Math.min(100, (balance / r.points_cost) * 100) : 100;
            return (
              <li key={r.id} className="eng-reward">
                <span className="eng-reward__icon" aria-hidden="true">
                  <Icon d={ENG_ICON.gift} size={28} />
                </span>
                <div className="eng-reward__text">
                  <strong>{r.name}</strong>
                  {r.description ? <span className="muted">{r.description}</span> : null}
                </div>
                <span className="ds-pill eng-reward__cost">
                  <Icon name="coin" size={16} /> <span className="mono">{r.points_cost}</span>
                </span>
                <span className="ds-bar eng-reward__bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <div className="eng-reward__foot">
                  <span className="muted">
                    {balance < r.points_cost
                      ? t("redeem.missing", { n: r.points_cost - balance })
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="ds-cta"
                    disabled={busy || balance < r.points_cost}
                    data-tour-id="eng-redeem"
                    onClick={() =>
                      act(set, async () => {
                        await eng.redeem(memberId, r.id);
                        setVersion((v) => v + 1);
                        return t("redeem.done");
                      })
                    }
                  >
                    {t("redeem.cta")}
                    <span className="sr-only">
                      : {t("redeem.ctaFor", { name: r.name, cost: r.points_cost })}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error === "conflict" ? (
          <p className="note note--warn" role="alert">
            {t("redeem.notEnough")}
          </p>
        ) : null}
        {error === "forbidden" ? (
          <p className="note note--warn" role="alert">
            {t("redeem.restricted")}
          </p>
        ) : null}
        {error && error !== "conflict" && error !== "forbidden" ? <ErrorNote code={error} /> : null}
      </Card>
      <Card title={t("redeem.mine")} icon={{ name: "receipt" }}>
        {mine.data && mine.data.data.length === 0 ? (
          <Empty icon={{ name: "receipt" }} text={t("redeem.noneMine")} />
        ) : null}
        {mine.data && mine.data.data.length > 0 ? (
          <TableWrap label={t("redeem.mine")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("rewards.col.name")}</th>
                  <th scope="col">{t("rewards.col.cost")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("common.date")}</th>
                  <th scope="col">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {mine.data.data.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.reward_name ?? "—"}</th>
                    <td className="mono">{r.points}</td>
                    <td>
                      <Plate tone={statusTone(r.status)}>{t(`status.${r.status}` as EngKey)}</Plate>
                    </td>
                    <td className="nowrap">{formatDateTime(r.created_at, lang)}</td>
                    <td>
                      {r.status === "requested" ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() =>
                            act(set, async () => {
                              await eng.setRedemption(r.id, "cancelled");
                              setVersion((v) => v + 1);
                              return t("rewards.done");
                            })
                          }
                        >
                          {t("redeem.cancelMine")}
                          <span className="sr-only">: {r.reward_name ?? ""}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </Card>
    </>
  );
}
