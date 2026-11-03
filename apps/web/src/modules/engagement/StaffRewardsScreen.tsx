import { type FormEvent, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useEngT } from "./dict";
import { Card, ENG_ICON, Empty, PageHead, Stat, act, isConfig, useEng } from "./shared";

/** Staff "Recompensas": catalogue (owner/manager edit) and redemptions to hand over (front of house). */
export function StaffRewardsScreen() {
  const { t } = useEngT();
  const { role } = useSession();
  const eng = useEng();
  const rewards = useAsync(() => eng.rewards(), [eng]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const canEdit = isConfig(role);
  const all = rewards.data?.data ?? [];

  return (
    <div className="page eng-page">
      <PageHead title={t("rewards.title")} lede={t("rewards.lede")} />
      {rewards.data ? (
        <div className="ds-stats">
          <Stat
            icon={{ d: ENG_ICON.gift }}
            label={t("rewards.statActive")}
            value={all.filter((r) => r.active).length}
          />
          <Stat icon={{ name: "layers" }} label={t("rewards.statTotal")} value={all.length} />
        </div>
      ) : null}
      <Card title={t("rewards.title")} icon={{ d: ENG_ICON.gift }}>
        {rewards.loading && !rewards.data ? <Loading /> : null}
        {rewards.error ? <ErrorNote code={rewards.error} onRetry={rewards.reload} /> : null}
        {rewards.data && rewards.data.data.length === 0 ? (
          <Empty icon={{ d: ENG_ICON.gift }} text={t("rewards.none")} />
        ) : null}
        {rewards.data && rewards.data.data.length > 0 ? (
          <TableWrap label={t("rewards.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("rewards.col.name")}</th>
                  <th scope="col">{t("rewards.col.cost")}</th>
                  <th scope="col">{t("rewards.col.minors")}</th>
                  <th scope="col">{t("rewards.col.active")}</th>
                  {canEdit ? <th scope="col">{t("common.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rewards.data.data.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      {r.name}
                      {r.description ? <span className="muted"> · {r.description}</span> : null}
                    </th>
                    <td>
                      <span className="ds-pill">
                        <Icon name="coin" size={14} />
                        <span className="mono">{r.points_cost}</span>
                      </span>
                    </td>
                    <td>
                      {r.restricted_for_minors ? (
                        <span className="eng-yes">
                          <Icon name="check" size={18} />
                          <span className="sr-only">✓</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Plate tone={r.active ? "ok" : "neutral"}>{r.active ? "✓" : "—"}</Plate>
                    </td>
                    {canEdit ? (
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            act(
                              { busy: setBusy, error: setError, announce: setAnnounce },
                              async () => {
                                await eng.updateReward(r.id, { active: !r.active });
                                rewards.reload();
                                return t("rewards.done");
                              },
                            )
                          }
                        >
                          {r.active ? t("rewards.deactivate") : t("rewards.activate")}
                          <span className="sr-only">: {r.name}</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error ? <ErrorNote code={error} /> : null}
      </Card>
      {canEdit ? <CreateReward onCreated={rewards.reload} /> : null}
      <Redemptions />
    </div>
  );
}

function CreateReward({ onCreated }: { onCreated: () => void }) {
  const { t } = useEngT();
  const eng = useEng();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("100");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ids = { n: useId(), d: useId(), c: useId(), r: useId(), help: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await eng.createReward({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        points_cost: Number(cost),
        restricted_for_minors: restricted,
      });
      return t("rewards.created");
    });
    if (ok) {
      setName("");
      setDescription("");
      onCreated();
    }
  }

  return (
    <Card title={t("rewards.create")} icon={{ name: "calendarPlus" }}>
      <form className="form" onSubmit={submit} aria-describedby={ids.help}>
        <p id={ids.help} className="help">
          {t("rewards.noCash")}
        </p>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.n}>{t("rewards.name")}</label>
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
            <label htmlFor={ids.c}>{t("rewards.cost")}</label>
            <input
              id={ids.c}
              type="number"
              inputMode="numeric"
              min={1}
              required
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="field field--wide">
            <label htmlFor={ids.d}>
              {t("rewards.description")} <span className="muted">{t("common.optional")}</span>
            </label>
            <input
              id={ids.d}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field field--wide">
            <span className="eng-check">
              <input
                id={ids.r}
                type="checkbox"
                checked={restricted}
                onChange={(e) => setRestricted(e.target.checked)}
              />
              <label htmlFor={ids.r}>{t("rewards.restricted")}</label>
            </span>
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="eng-reward-create"
          >
            {t("rewards.create")}
          </button>
        </div>
      </form>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}

function Redemptions() {
  const { t, lang } = useEngT();
  const eng = useEng();
  const rows = useAsync(() => eng.redemptions({ status: "requested" }), [eng]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = { busy: setBusy, error: setError, announce: setAnnounce };
  return (
    <Card title={t("rewards.redemptions")} icon={{ name: "bag" }}>
      {rows.error ? <ErrorNote code={rows.error} onRetry={rows.reload} /> : null}
      {rows.data && rows.data.data.length === 0 ? (
        <Empty icon={{ name: "checkCircle" }} text={t("rewards.noRedemptions")} />
      ) : null}
      {rows.data && rows.data.data.length > 0 ? (
        <TableWrap label={t("rewards.redemptions")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("common.member")}</th>
                <th scope="col">{t("rewards.col.name")}</th>
                <th scope="col">{t("rewards.col.cost")}</th>
                <th scope="col">{t("common.date")}</th>
                <th scope="col">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.data.map((r) => {
                const ctx = t("rewards.fulfilFor", {
                  reward: r.reward_name ?? "—",
                  member: r.member_name ?? "—",
                });
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.member_name ?? "—"}</th>
                    <td>{r.reward_name ?? "—"}</td>
                    <td className="mono">{r.points}</td>
                    <td className="nowrap">{formatDateTime(r.created_at, lang)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={busy}
                          aria-label={ctx}
                          data-tour-id="eng-redemption-fulfil"
                          onClick={() =>
                            act(set, async () => {
                              await eng.setRedemption(r.id, "fulfilled");
                              rows.reload();
                              return t("rewards.done");
                            })
                          }
                        >
                          {t("rewards.fulfil")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() =>
                            act(set, async () => {
                              await eng.setRedemption(r.id, "cancelled");
                              rows.reload();
                              return t("rewards.done");
                            })
                          }
                        >
                          {t("rewards.cancel")}
                          <span className="sr-only">: {ctx}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}
