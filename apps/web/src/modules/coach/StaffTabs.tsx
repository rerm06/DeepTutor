import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import {
  ErrorNote,
  LiveResult,
  Loading,
  Plate,
  Section,
  TableWrap,
  type Tone,
} from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import type { Escalation } from "./api";
import type { CoachKey } from "./dict";
import { EstimateNotice, useCoachApi, useCoachT } from "./shared";

const escTone = (s: Escalation["status"]): Tone =>
  s === "open" ? "warn" : s === "acknowledged" ? "neutral" : "ok";

/** Staff member record → "Coach" (trainer / location manager): memory read-only, check-in trend, follow-ups. */
export function CoachMemberTab({ memberId }: { memberId: string }) {
  const { t, lang } = useCoachT();
  const c = useCoachApi();
  const s = useAsync(() => c.summary(memberId), [c, memberId]);
  const [error, setError] = useState<ErrorCode | null>(null);
  async function move(id: string, action: "acknowledge" | "close") {
    setError(null);
    try {
      await c.escalation(id, action);
      s.reload();
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorNote code={s.error} onRetry={s.reload} />;
  const d = s.data;
  if (!d) return null;
  return (
    <div className="coach-stack">
      <Section title={t("staff.escalations")}>
        {error ? <ErrorNote code={error} /> : null}
        {d.escalations.length === 0 ? <p className="muted">{t("staff.escalationsEmpty")}</p> : null}
        <ul className="coach-facts">
          {d.escalations.map((e) => (
            <li key={e.id} className="coach-card">
              <p>
                <Plate tone={escTone(e.status)}>{t(`escs.${e.status}` as CoachKey)}</Plate>{" "}
                <strong>{t(`esc.${e.reason}` as CoachKey)}</strong>
              </p>
              <p className="muted">
                {formatDateTime(e.created_at, lang)} ·{" "}
                {e.assigned_to
                  ? t("staff.assigned", { name: e.assigned_to })
                  : t("staff.unassigned")}
              </p>
              {e.status !== "closed" ? (
                <div className="row-actions">
                  {e.status === "open" ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void move(e.id, "acknowledge")}
                      data-tour-id="coach-esc-ack"
                    >
                      {t("staff.ack")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void move(e.id, "close")}
                    data-tour-id="coach-esc-close"
                  >
                    {t("staff.close")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("staff.trend")}>
        <EstimateNotice />
        {d.checkins.length === 0 ? (
          <p className="muted">{t("staff.trendEmpty")}</p>
        ) : (
          <TableWrap label={t("staff.trend")}>
            <table className="table" data-tour-id="coach-trend">
              <thead>
                <tr>
                  <th scope="col">{t("staff.col.date")}</th>
                  <th scope="col">{t("staff.col.sleep")}</th>
                  <th scope="col">{t("staff.col.energy")}</th>
                  <th scope="col">{t("staff.col.pain")}</th>
                  <th scope="col">{t("staff.col.score")}</th>
                  <th scope="col">{t("staff.col.flag")}</th>
                </tr>
              </thead>
              <tbody>
                {d.checkins.map((ci) => (
                  <tr key={ci.id}>
                    <td className="mono">{ci.local_date}</td>
                    <td>{ci.sleep}/5</td>
                    <td>{ci.energy}/5</td>
                    <td>
                      {ci.pain}/10
                      {ci.pain_area ? ` · ${t(`area.${ci.pain_area}` as CoachKey)}` : ""}
                    </td>
                    <td>{ci.score ?? "—"}</td>
                    <td>
                      {ci.emergency ? (
                        <Plate tone="blocked">{t("staff.flagEmergency")}</Plate>
                      ) : ci.escalated ? (
                        <Plate tone="warn">{t("staff.flagEscalated")}</Plate>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
      <Section title={t("staff.memory")}>
        {d.memory.length === 0 ? <p className="muted">{t("staff.memoryEmpty")}</p> : null}
        <ul className="coach-facts" data-tour-id="coach-staff-memory">
          {d.memory.map((f) => (
            <li key={f.id} className="coach-card">
              <Plate tone={f.category === "injury" ? "warn" : "neutral"}>
                {t(`cat.${f.category}` as CoachKey)}
              </Plate>
              <p className="coach-fact__text">{f.content}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** Staff member record → "Borrador de energía" (licensed-nutrition role only): creates a care_plan DRAFT. */
export function NutritionDraftTab({ memberId }: { memberId: string }) {
  const { t } = useCoachT();
  const c = useCoachApi();
  const id = useId();
  const [goal, setGoal] = useState<"maintenance" | "deficit" | "surplus">("maintenance");
  const [birth, setBirth] = useState("");
  const [sex, setSex] = useState<"female" | "male">("female");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!birth) return;
    setBusy(true);
    setMsg("");
    setError(null);
    try {
      const r = await c.nutritionDraft({ member_id: memberId, goal, birth_date: birth, sex });
      setMsg(
        t("nd.created", { min: r.draft.kcalMin, max: r.draft.kcalMax, age: r.draft.ageYears }),
      );
    } catch (err) {
      const code = toErrorCode(err);
      if (code === "forbidden") setMsg(t("nd.refused"));
      else setError(code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={t("nd.title")}>
      <p className="help">{t("nd.lede")}</p>
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={`${id}-g`}>{t("nd.goal")}</label>
            <select
              id={`${id}-g`}
              value={goal}
              onChange={(e) => setGoal(e.target.value as typeof goal)}
            >
              {(["maintenance", "deficit", "surplus"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`nd.goal.${g}` as CoachKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-b`}>{t("nd.birth")}</label>
            <input
              id={`${id}-b`}
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-s`}>{t("nd.sex")}</label>
            <select
              id={`${id}-s`}
              value={sex}
              onChange={(e) => setSex(e.target.value as typeof sex)}
            >
              <option value="female">{t("nd.sex.female")}</option>
              <option value="male">{t("nd.sex.male")}</option>
            </select>
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !birth}
            data-tour-id="coach-nutrition-draft"
          >
            {t("nd.submit")}
          </button>
        </div>
      </form>
      {error ? <ErrorNote code={error} /> : null}
      <LiveResult>{msg}</LiveResult>
    </Section>
  );
}
