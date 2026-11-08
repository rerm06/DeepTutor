import { type FormEvent, useEffect, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { StaffReferrals } from "./StaffReferrals";
import type { Rule } from "./api";
import { type EngKey, useEngT } from "./dict";
import { Card, Empty, PageHead, Stat, act, isConfig, isFront, useEng } from "./shared";

/** Staff "Puntos": liability (owner, accountant), rules (owner/manager edit), manual award, recent ledger. */
export function StaffPointsScreen() {
  const { t } = useEngT();
  const { role } = useSession();
  const [version, setVersion] = useState(0);
  return (
    <div className="page eng-page">
      <PageHead title={t("points.title")} lede={t("points.lede")} />
      {role === "owner" || role === "accountant" ? <Liability /> : null}
      {isFront(role) ? (
        <>
          <Rules canEdit={isConfig(role)} />
          <ManualAward onDone={() => setVersion((v) => v + 1)} />
          <Ledger version={version} />
          <StaffReferrals />
        </>
      ) : null}
    </div>
  );
}

function Liability() {
  const { t } = useEngT();
  const eng = useEng();
  const l = useAsync(() => eng.liability(), [eng]);
  return (
    <Card title={t("points.liability")} icon={{ name: "coin" }}>
      {l.loading ? <Loading /> : null}
      {l.error ? <ErrorNote code={l.error} onRetry={l.reload} /> : null}
      {l.data ? (
        <div className="ds-stats eng-stats">
          <Stat
            icon={{ name: "coin" }}
            label={t("points.outstanding")}
            value={l.data.outstanding_points}
          />
          <Stat
            icon={{ name: "users" }}
            label={t("points.membersWithBalance")}
            value={l.data.members_with_balance}
          />
        </div>
      ) : null}
      <p className="help">{t("points.liabilityHelp")}</p>
    </Card>
  );
}

function Rules({ canEdit }: { canEdit: boolean }) {
  const { t } = useEngT();
  const eng = useEng();
  const rules = useAsync(() => eng.rules(), [eng]);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  return (
    <Card title={t("points.rules")} icon={{ name: "gear" }}>
      {rules.loading ? <Loading /> : null}
      {rules.error ? <ErrorNote code={rules.error} onRetry={rules.reload} /> : null}
      {!canEdit ? <p className="muted">{t("points.rulesReadOnly")}</p> : null}
      {rules.data ? (
        <TableWrap label={t("points.rules")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("points.col.event")}</th>
                <th scope="col">{t("points.col.points")}</th>
                <th scope="col">{t("points.col.active")}</th>
                {canEdit ? <th scope="col">{t("points.col.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rules.data.data.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  canEdit={canEdit}
                  onSaved={(msg) => {
                    setError(null);
                    setAnnounce(msg);
                    rules.reload();
                  }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}

function RuleRow({
  rule,
  canEdit,
  onSaved,
  onError,
}: {
  rule: Rule;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  onError: (e: ErrorCode | null) => void;
}) {
  const { t } = useEngT();
  const eng = useEng();
  const [points, setPoints] = useState(String(rule.points));
  const [active, setActive] = useState(rule.active);
  const [busy, setBusy] = useState(false);
  const ids = { p: useId(), a: useId() };
  const event = t(`event.${rule.event}` as EngKey);
  if (!canEdit)
    return (
      <tr>
        <th scope="row">{event}</th>
        <td className="mono">{rule.points}</td>
        <td>
          {rule.active ? (
            <span className="eng-yes">
              <Icon name="check" size={18} />
              <span className="sr-only">✓</span>
            </span>
          ) : (
            "—"
          )}
        </td>
      </tr>
    );
  return (
    <tr>
      <th scope="row">{event}</th>
      <td>
        <label htmlFor={ids.p} className="sr-only">
          {t("points.col.points")}: {event}
        </label>
        <input
          id={ids.p}
          type="number"
          inputMode="numeric"
          min={1}
          max={10000}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="eng-num"
        />
      </td>
      <td>
        <input
          id={ids.a}
          type="checkbox"
          className="eng-box"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <label htmlFor={ids.a} className="sr-only">
          {t("points.col.active")}: {event}
        </label>
      </td>
      <td>
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-tour-id="eng-rule-save"
          onClick={() =>
            act({ busy: setBusy, error: onError, announce: (s) => s && onSaved(s) }, async () => {
              await eng.updateRule(rule.id, { points: Number(points), active });
              return t("points.ruleSaved", { event });
            })
          }
        >
          {t("points.saveRule")}
          <span className="sr-only">: {event}</span>
        </button>
      </td>
    </tr>
  );
}

function ManualAward({ onDone }: { onDone: () => void }) {
  const { t } = useEngT();
  const { api } = useSession();
  const eng = useEng();
  const members = useAsync(() => api.members(), [api]);
  const [memberId, setMemberId] = useState("");
  const [delta, setDelta] = useState("50");
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { m: useId(), d: useId(), n: useId(), help: useId(), err: useId() };
  const first = members.data?.data[0]?.id ?? "";
  useEffect(() => {
    if (!memberId && first) setMemberId(first);
  }, [memberId, first]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.manual(memberId, Number(delta), note.trim());
      return t("points.awarded");
    });
    if (ok) {
      setNote("");
      onDone();
    }
  }

  return (
    <Card title={t("points.manual")} icon={{ name: "star" }}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.m}>{t("points.member")}</label>
            <select
              id={ids.m}
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              required
            >
              {(members.data?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.d}>{t("points.delta")}</label>
            <input
              id={ids.d}
              type="number"
              inputMode="numeric"
              min={-10000}
              max={10000}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div className="field field--wide">
            <label htmlFor={ids.n}>{t("points.note")}</label>
            <input
              id={ids.n}
              type="text"
              maxLength={200}
              required
              aria-required="true"
              aria-invalid={missing}
              aria-describedby={missing ? `${ids.help} ${ids.err}` : ids.help}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p id={ids.help} className="help">
              {t("points.noteHelp")}
            </p>
            {missing ? (
              <p id={ids.err} className="field-error" role="alert">
                {t("points.noteMissing")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !memberId}
            data-tour-id="eng-manual-award"
          >
            {t("points.award")}
          </button>
        </div>
      </form>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}

function Ledger({ version }: { version: number }) {
  const { t, lang } = useEngT();
  const eng = useEng();
  const rows = useAsync(() => eng.ledger(), [eng, version]);
  return (
    <Card title={t("points.ledger")} icon={{ name: "receipt" }}>
      {rows.loading && !rows.data ? <Loading /> : null}
      {rows.error ? <ErrorNote code={rows.error} onRetry={rows.reload} /> : null}
      {rows.data && rows.data.data.length === 0 ? (
        <Empty icon={{ name: "receipt" }} text={t("points.none")} />
      ) : null}
      {rows.data && rows.data.data.length > 0 ? (
        <TableWrap label={t("points.ledger")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("points.col.when")}</th>
                <th scope="col">{t("points.col.member")}</th>
                <th scope="col">{t("points.col.reason")}</th>
                <th scope="col">{t("points.col.delta")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{formatDateTime(r.at, lang)}</td>
                  <th scope="row">{r.member_name ?? "—"}</th>
                  <td>
                    {t(`event.${r.reason}` as EngKey)}
                    {r.note ? <span className="muted"> · {r.note}</span> : null}
                  </td>
                  <td className={`mono eng-delta${r.delta > 0 ? " eng-delta--up" : ""}`}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </Card>
  );
}
