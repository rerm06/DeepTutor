import { type FormEvent, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  CHALLENGE_KINDS,
  CHALLENGE_METRICS,
  type Challenge,
  type ChallengeKind,
  type ChallengeMetric,
} from "./api";
import { type EngKey, useEngT } from "./dict";
import { Card, ENG_ICON, Empty, PageHead, Stat, act, isConfig, isFront, useEng } from "./shared";

const today = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Staff "Retos": list, create (owner/manager), teams, participants (front of house), opt-in leaderboard. */
export function StaffChallengesScreen() {
  const { t, lang } = useEngT();
  const { role } = useSession();
  const eng = useEng();
  const list = useAsync(() => eng.challenges(), [eng]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = list.data?.data.find((c) => c.id === selected) ?? null;
  const all = list.data?.data ?? [];
  const now = today();
  const running = all.filter((c) => c.starts_on <= now && c.ends_on >= now).length;

  return (
    <div className="page eng-page">
      <PageHead title={t("challenges.title")} lede={t("challenges.lede")} />
      {list.data ? (
        <div className="ds-stats">
          <Stat icon={{ name: "trophy" }} label={t("challenges.statTotal")} value={all.length} />
          <Stat icon={{ name: "flame" }} label={t("challenges.statActive")} value={running} />
        </div>
      ) : null}
      <Card title={t("challenges.title")} icon={{ name: "trophy" }}>
        {list.loading && !list.data ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length === 0 ? (
          <Empty icon={{ name: "trophy" }} text={t("challenges.none")} />
        ) : null}
        {list.data && list.data.data.length > 0 ? (
          <ChallengeTable rows={list.data.data} onOpen={setSelected} lang={lang} />
        ) : null}
      </Card>
      {isConfig(role) ? <CreateChallenge onCreated={list.reload} /> : null}
      {current ? <ChallengeDetail challenge={current} /> : null}
    </div>
  );
}

export function ChallengeTable({
  rows,
  onOpen,
  lang,
}: {
  rows: Challenge[];
  onOpen: (id: string) => void;
  lang: string;
}) {
  const { t } = useEngT();
  return (
    <TableWrap label={t("challenges.title")}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("challenges.col.name")}</th>
            <th scope="col">{t("challenges.col.kind")}</th>
            <th scope="col">{t("challenges.col.metric")}</th>
            <th scope="col">{t("challenges.col.dates")}</th>
            <th scope="col">{t("challenges.col.goal")}</th>
            <th scope="col">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.name}</th>
              <td>
                <Plate tone="neutral">{t(`kind.${c.kind}` as EngKey)}</Plate>
              </td>
              <td>{t(`metric.${c.metric}` as EngKey)}</td>
              <td className="nowrap" lang={lang}>
                {c.starts_on} → {c.ends_on}
              </td>
              <td className="mono">{c.goal}</td>
              <td>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onOpen(c.id)}
                  data-tour-id="eng-challenge-open"
                >
                  {t("challenges.open")}
                  <span className="sr-only">: {c.name}</span>
                  <Icon name="arrowRight" size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function CreateChallenge({ onCreated }: { onCreated: () => void }) {
  const { t } = useEngT();
  const { api, role } = useSession();
  const eng = useEng();
  const locations = useAsync(() => api.locations(), [api]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChallengeKind>("individual");
  const [metric, setMetric] = useState<ChallengeMetric>("visits");
  const [location, setLocation] = useState("");
  const [starts, setStarts] = useState(today());
  const [ends, setEnds] = useState(today(28));
  const [goal, setGoal] = useState("8");
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = {
    n: useId(),
    k: useId(),
    m: useId(),
    l: useId(),
    s: useId(),
    e: useId(),
    g: useId(),
    o: useId(),
    oh: useId(),
  };
  // A location manager creates challenges for their own locations only; "between locations" is org-wide.
  const managerScoped = role === "location_manager";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.createChallenge({
        name: name.trim(),
        kind,
        metric,
        location_id:
          kind === "location"
            ? null
            : location || (managerScoped ? (locations.data?.data[0]?.id ?? null) : null),
        starts_on: starts,
        ends_on: ends,
        goal: Number(goal),
        leaderboard_opt_in_default: optIn,
      });
      return t("challenges.created");
    });
    if (ok) {
      setName("");
      onCreated();
    }
  }

  return (
    <Card title={t("challenges.create")} icon={{ name: "calendarPlus" }}>
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field field--wide">
            <label htmlFor={ids.n}>{t("challenges.name")}</label>
            <input
              id={ids.n}
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.k}>{t("challenges.kind")}</label>
            <select
              id={ids.k}
              value={kind}
              onChange={(e) => setKind(e.target.value as ChallengeKind)}
            >
              {CHALLENGE_KINDS.filter((k) => !(managerScoped && k === "location")).map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}` as EngKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.m}>{t("challenges.metric")}</label>
            <select
              id={ids.m}
              value={metric}
              onChange={(e) => setMetric(e.target.value as ChallengeMetric)}
            >
              {CHALLENGE_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`metric.${m}` as EngKey)}
                </option>
              ))}
            </select>
          </div>
          {kind !== "location" ? (
            <div className="field">
              <label htmlFor={ids.l}>{t("challenges.location")}</label>
              <select id={ids.l} value={location} onChange={(e) => setLocation(e.target.value)}>
                {!managerScoped ? <option value="">{t("challenges.allLocations")}</option> : null}
                {(locations.data?.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={ids.s}>{t("challenges.startsOn")}</label>
            <input
              id={ids.s}
              type="date"
              required
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.e}>{t("challenges.endsOn")}</label>
            <input
              id={ids.e}
              type="date"
              required
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.g}>{t("challenges.goal")}</label>
            <input
              id={ids.g}
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              required
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="field field--wide">
            <span className="eng-check">
              <input
                id={ids.o}
                type="checkbox"
                checked={optIn}
                aria-describedby={ids.oh}
                onChange={(e) => setOptIn(e.target.checked)}
              />
              <label htmlFor={ids.o}>{t("challenges.optInDefault")}</label>
            </span>
            <p id={ids.oh} className="help">
              {t("challenges.optInHelp")}
            </p>
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="eng-challenge-create"
          >
            {t("challenges.create")}
          </button>
        </div>
      </form>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}

function ChallengeDetail({ challenge }: { challenge: Challenge }) {
  const { t } = useEngT();
  const { role } = useSession();
  return (
    <>
      <h2 className="eng-subtitle">
        <Icon name="trophy" size={28} />
        {challenge.name}
        <span className="ds-pill">
          {t(`metric.${challenge.metric}` as EngKey)} · {challenge.goal}
        </span>
      </h2>
      {challenge.kind === "team" ? <Teams challenge={challenge} canEdit={isConfig(role)} /> : null}
      {isFront(role) ? <Participants challengeId={challenge.id} /> : null}
      <Leaderboard challengeId={challenge.id} title={t("challenges.leaderboard")} />
    </>
  );
}

function Teams({ challenge, canEdit }: { challenge: Challenge; canEdit: boolean }) {
  const { t } = useEngT();
  const eng = useEng();
  const teams = useAsync(() => eng.teams(challenge.id), [eng, challenge.id]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const id = useId();
  return (
    <Card title={t("challenges.teams")} icon={{ name: "users" }} level={3}>
      {teams.error ? <ErrorNote code={teams.error} onRetry={teams.reload} /> : null}
      {teams.data && teams.data.data.length === 0 ? (
        <Empty icon={{ name: "users" }} text={t("challenges.noTeams")} />
      ) : null}
      <ul className="eng-teams">
        {(teams.data?.data ?? []).map((tm) => (
          <li key={tm.id}>
            <Plate tone="neutral">{tm.name}</Plate>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="inline-form eng-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act(
              { busy: setBusy, error: setError, announce: setAnnounce },
              async () => {
                await eng.addTeam(challenge.id, name.trim());
                return t("challenges.addTeam");
              },
            );
            if (ok) {
              setName("");
              teams.reload();
            }
          }}
        >
          <label htmlFor={id}>{t("challenges.teamName")}</label>
          <input
            id={id}
            required
            minLength={2}
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy}>
            {t("challenges.addTeam")}
          </button>
        </form>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}

function Participants({ challengeId }: { challengeId: string }) {
  const { t } = useEngT();
  const eng = useEng();
  const rows = useAsync(() => eng.participants(challengeId), [eng, challengeId]);
  return (
    <Card title={t("challenges.participants")} icon={{ d: ENG_ICON.list }} level={3}>
      {rows.error ? <ErrorNote code={rows.error} onRetry={rows.reload} /> : null}
      {rows.data && rows.data.data.length === 0 ? (
        <Empty icon={{ name: "users" }} text={t("challenges.noParticipants")} />
      ) : null}
      {rows.data && rows.data.data.length > 0 ? (
        <TableWrap label={t("challenges.participants")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("common.member")}</th>
                <th scope="col">{t("challenges.col.progress")}</th>
                <th scope="col">{t("challenges.col.listed")}</th>
                <th scope="col">{t("challenges.col.mode")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.data.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.member_name ?? "—"}</th>
                  <td className="mono">{p.progress}</td>
                  <td>
                    {p.show_on_leaderboard ? (
                      <span className="eng-yes">
                        <Icon name="check" size={18} />
                        <span className="sr-only">✓</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{t(`mode.${p.compare_mode}` as EngKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </Card>
  );
}

/** Opt-in leaderboard as returned by the server (it already hides who did not opt in). */
export function Leaderboard({
  challengeId,
  title,
  version = 0,
  bare = false,
}: { challengeId: string; title: string; version?: number; bare?: boolean }) {
  const { t } = useEngT();
  const eng = useEng();
  const board = useAsync(() => eng.leaderboard(challengeId), [eng, challengeId, version]);
  const ranked = (board.data?.data ?? []).filter((r) => r.division !== "self");
  const body = (
    <>
      {board.error ? <ErrorNote code={board.error} onRetry={board.reload} /> : null}
      {board.data && ranked.length === 0 ? (
        <p className="muted eng-noboard">
          <Icon d={ENG_ICON.shield} size={20} />
          {t("challenges.noBoard")}
        </p>
      ) : null}
      {ranked.length > 0 ? (
        <TableWrap label={title}>
          <table className="table eng-board" data-testid="eng-leaderboard">
            <thead>
              <tr>
                <th scope="col">{t("challenges.col.rank")}</th>
                <th scope="col">{t("challenges.col.who")}</th>
                <th scope="col">{t("challenges.col.progress")}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr
                  key={`${r.division}-${r.label}-${r.rank}`}
                  aria-current={r.is_me ? "true" : undefined}
                >
                  <td>
                    <span className={`eng-rank${r.rank === 1 ? " eng-rank--top" : ""}`}>
                      {r.rank}
                    </span>
                  </td>
                  <th scope="row">
                    {r.label}
                    {r.is_me ? <span className="muted"> ({t("challenges.you")})</span> : null}
                  </th>
                  <td>
                    <span className="eng-board__progress">
                      <span className="ds-bar" aria-hidden="true">
                        <span
                          style={{
                            width: `${r.goal > 0 ? Math.min(100, (r.progress / r.goal) * 100) : 0}%`,
                          }}
                        />
                      </span>
                      <span className="mono">
                        {r.progress} / {r.goal}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </>
  );
  if (bare)
    return (
      <div className="eng-board-wrap">
        <h3 className="eng-h3">
          <Icon name="trophy" size={20} />
          {title}
        </h3>
        {body}
      </div>
    );
  return (
    <Card title={title} icon={{ name: "trophy" }} level={3}>
      {body}
    </Card>
  );
}
