import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import type { Member } from "../../api/types";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { Leaderboard } from "./StaffChallengesScreen";
import { PostList } from "./StaffCommunityScreen";
import { type Challenge, POST_MAX_LENGTH } from "./api";
import { type EngKey, useEngT } from "./dict";
import { PointsSummary, act, statusTone, useEng, useMyMembers } from "./shared";

/** Shared frame: loads the caller's member rows (a member: their own; a guardian: their wards). */
function WithMembers({
  title,
  children,
}: { title: string; children: (rows: Member[]) => ReactNode }) {
  const { t } = useEngT();
  const members = useMyMembers();
  const rows = members.data?.data ?? [];
  return (
    <div className="page">
      <h1 className="page__title">{title}</h1>
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
    <WithMembers title={t("nav.myPoints")}>
      {(rows) =>
        rows.map((m) => (
          <PointsSummary
            key={m.id}
            memberId={m.id}
            title={
              role === "guardian" || rows.length > 1
                ? t("points.forMember", { name: m.full_name })
                : t("points.balance")
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
    <WithMembers title={t("challenges.title")}>
      {(rows) => (
        <>
          {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
          {list.data && list.data.data.length === 0 ? (
            <p className="muted">{t("challenges.none")}</p>
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
  const { t } = useEngT();
  const eng = useEng();
  const [version, setVersion] = useState(0);
  const board = useAsync(() => eng.leaderboard(challenge.id), [eng, challenge.id, version]);
  const mine = useAsync(() => eng.participants(challenge.id), [eng, challenge.id, version]);
  const own = (board.data?.data ?? []).filter((r) => r.division === "self");
  const participation = (mine.data?.data ?? []).find((p) => p.member_id === member.id) ?? null;
  const ranked = (board.data?.data ?? []).some((r) => r.division !== "self");

  return (
    <Section title={challenge.name}>
      <p className="muted">
        {t(`kind.${challenge.kind}` as EngKey)} · {t(`metric.${challenge.metric}` as EngKey)} ·{" "}
        {challenge.starts_on} → {challenge.ends_on}
      </p>
      {board.error ? <ErrorNote code={board.error} onRetry={board.reload} /> : null}
      {own.map((r) => (
        <p key={r.label} className="eng-progress">
          {readOnly
            ? t("challenges.wardProgress", { name: r.label, progress: r.progress, goal: r.goal })
            : t("challenges.myProgress", { progress: r.progress, goal: r.goal })}
          <progress max={r.goal} value={Math.min(r.progress, r.goal)} aria-hidden="true" />
        </p>
      ))}
      {!readOnly && mine.data && !participation ? (
        <JoinForm
          challenge={challenge}
          memberId={member.id}
          onJoined={() => setVersion((v) => v + 1)}
        />
      ) : null}
      {!readOnly && participation ? (
        <Preferences
          challengeId={challenge.id}
          memberId={member.id}
          show={participation.show_on_leaderboard}
          mode={participation.compare_mode}
          onSaved={() => setVersion((v) => v + 1)}
        />
      ) : null}
      {participation?.compare_mode === "self" ? (
        <p className="help">{t("challenges.selfOnly")}</p>
      ) : null}
      {ranked || (!participation && !readOnly) ? (
        <Leaderboard
          challengeId={challenge.id}
          title={t("challenges.leaderboard")}
          version={version}
        />
      ) : null}
    </Section>
  );
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
    <form className="form form--boxed" onSubmit={submit}>
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
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="eng-challenge-join"
        >
          {t("challenges.join")}
          <span className="sr-only">: {challenge.name}</span>
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
      className="form form--boxed"
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
    <WithMembers title={t("wall.title")}>
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
      <Section title={t("wall.compose")}>
        <form className="form form--boxed" onSubmit={submit} noValidate>
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
              <li key={p.id} className="eng-post">
                <Plate tone={statusTone(p.status)}>{t(`status.${p.status}` as EngKey)}</Plate>
                <p className="eng-post__body">{p.body}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title={t("wall.feed")}>
        {posts.loading && !posts.data ? <Loading /> : null}
        {posts.error ? <ErrorNote code={posts.error} onRetry={posts.reload} /> : null}
        {posts.data && feed.length === 0 ? <p className="muted">{t("wall.none")}</p> : null}
        <PostList posts={feed} />
      </Section>
    </>
  );
}

/** "Referir": record a friend's email (no message is sent) and follow its status. Members only. */
export function ReferScreen() {
  const { t } = useEngT();
  return (
    <WithMembers title={t("refer.title")}>
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
      <Section title={t("refer.title")}>
        <form
          className="form form--boxed"
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
      </Section>
      <Section title={t("refer.mine")}>
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length === 0 ? (
          <p className="muted">{t("refer.none")}</p>
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
      </Section>
    </>
  );
}

/** "Canjear": rewards the member can afford, and their redemptions (cancel while requested). Members only. */
export function RedeemScreen() {
  const { t } = useEngT();
  return (
    <WithMembers title={t("redeem.title")}>
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
      <Section title={t("rewards.title")}>
        {pts.data ? <p className="lede">{t("redeem.balance", { n: balance })}</p> : null}
        {rewards.error ? <ErrorNote code={rewards.error} onRetry={rewards.reload} /> : null}
        {rewards.data && rewards.data.data.length === 0 ? (
          <p className="muted">{t("rewards.none")}</p>
        ) : null}
        <ul className="eng-posts">
          {(rewards.data?.data ?? []).map((r) => (
            <li key={r.id} className="eng-post">
              <p className="eng-post__meta">
                <strong>{r.name}</strong> · <span className="mono">{r.points_cost}</span>
              </p>
              {r.description ? <p className="eng-post__body">{r.description}</p> : null}
              <button
                type="button"
                className="btn btn--primary"
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
            </li>
          ))}
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
      </Section>
      <Section title={t("redeem.mine")}>
        {mine.data && mine.data.data.length === 0 ? (
          <p className="muted">{t("redeem.noneMine")}</p>
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
      </Section>
    </>
  );
}
