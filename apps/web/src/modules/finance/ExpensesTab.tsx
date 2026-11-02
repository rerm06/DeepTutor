import { type FormEvent, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from "./api";
import { type FinKey, useFinT } from "./dict";
import {
  act,
  day,
  isWriter,
  money,
  parseCents,
  thisMonth,
  todayPR,
  useFin,
  useLocations,
} from "./shared";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "Gastos": expenses of a month (record, void) and recurring templates (rent, utilities). */
export function ExpensesTab() {
  const { t, lang } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const writer = isWriter(role);
  const [month, setMonth] = useState(thisMonth());
  const [version, setVersion] = useState(0);
  const monthId = useId();
  const valid = MONTH_RE.test(month);
  const list = useAsync(
    () => (valid ? fin.expenses({ month }) : Promise.resolve(null)),
    [fin, month, valid, version],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const set = { busy: setBusy, error: setError, announce: setAnnounce };
  const refresh = () => setVersion((v) => v + 1);
  const total = (list.data?.data ?? []).reduce((s, e) => s + e.amount_cents, 0);

  async function voidIt(e: FormEvent) {
    e.preventDefault();
    if (!voiding) return;
    const target = voiding;
    const ok = await act(set, async () => {
      await fin.voidExpense(target.id, reason.trim());
      return t("ex.voided");
    });
    if (ok) {
      setVoiding(null);
      setReason("");
      refresh();
    }
  }

  return (
    <>
      <Section title={t("ex.title")}>
        <div className="toolbar">
          <div className="field field--inline">
            <label htmlFor={monthId}>{t("pnl.month")}</label>
            <input
              id={monthId}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          {list.data ? (
            <p className="muted">{t("ex.total", { total: money(total, lang) })}</p>
          ) : null}
        </div>
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length === 0 ? <p className="muted">{t("ex.empty")}</p> : null}
        {list.data && list.data.data.length > 0 ? (
          <TableWrap label={t("ex.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("common.date")}</th>
                  <th scope="col">{t("common.category")}</th>
                  <th scope="col">{t("common.location")}</th>
                  <th scope="col" className="fin-num">
                    {t("common.amount")}
                  </th>
                  <th scope="col">{t("ex.note")}</th>
                  {writer ? <th scope="col">{t("ap.col.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((x) => (
                  <tr key={x.id}>
                    <th scope="row" className="nowrap">
                      {day(x.spent_on, lang)}
                    </th>
                    <td>
                      {t(`cat.${x.category}` as FinKey)}
                      {x.recurring_id ? (
                        <span className="cell-note">{t("ex.fromTemplate")}</span>
                      ) : null}
                    </td>
                    <td>{x.location_name}</td>
                    <td className="fin-num mono">{money(x.amount_cents, lang)}</td>
                    <td className="cell-body">{x.receipt_note}</td>
                    {writer ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => setVoiding(x)}
                          aria-label={t("ex.voidLabel", { date: day(x.spent_on, lang) })}
                        >
                          {t("ap.void")}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        {voiding ? (
          <form className="inline-form" onSubmit={voidIt}>
            <label htmlFor={reasonId}>{t("common.reason")}</label>
            <input
              id={reasonId}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <button
              type="submit"
              className="btn btn--danger"
              disabled={busy || reason.trim().length < 3}
            >
              {t("ap.voidSave")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setVoiding(null)}>
              {t("common.cancel")}
            </button>
          </form>
        ) : null}
        <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
        {error ? <ErrorNote code={error} /> : null}
        <p className="help">{t("ex.receiptNote")}</p>
      </Section>
      {writer ? <NewExpense onCreated={refresh} /> : null}
      <RecurringSection onRun={refresh} />
    </>
  );
}

function NewExpense({ onCreated }: { onCreated: () => void }) {
  const { t } = useFinT();
  const fin = useFin();
  const locations = useLocations();
  const [f, setF] = useState({
    location_id: "",
    category: "supplies" as ExpenseCategory,
    amount: "",
    spent_on: todayPR(),
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const ids = {
    title: useId(),
    loc: useId(),
    cat: useId(),
    amount: useId(),
    date: useId(),
    note: useId(),
  };
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(f.amount);
    if (!f.location_id || cents === null) return setInvalid(t("ap.formInvalid"));
    if (f.spent_on > todayPR()) return setInvalid(t("ex.future"));
    setInvalid(null);
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await fin.createExpense({
        location_id: f.location_id,
        category: f.category,
        amount_cents: cents,
        spent_on: f.spent_on,
        receipt_note: f.note.trim() || undefined,
      });
      return t("ex.created");
    });
    if (ok) {
      setF((s) => ({ ...s, amount: "", note: "" }));
      onCreated();
    }
  }
  return (
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h2 id={ids.title} className="form__title">
        {t("ex.new")}
      </h2>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.loc}>{t("common.location")}</label>
          <select id={ids.loc} value={f.location_id} onChange={up("location_id")} required>
            <option value="">{t("common.pickLocation")}</option>
            {(locations.data?.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.cat}>{t("common.category")}</label>
          <select id={ids.cat} value={f.category} onChange={up("category")}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`cat.${c}` as FinKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.amount}>{t("common.amount")}</label>
          <input
            id={ids.amount}
            inputMode="decimal"
            value={f.amount}
            onChange={up("amount")}
            placeholder="0.00"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={ids.date}>{t("common.date")}</label>
          <input
            id={ids.date}
            type="date"
            value={f.spent_on}
            max={todayPR()}
            onChange={up("spent_on")}
            required
          />
        </div>
        <div className="field field--wide">
          <label htmlFor={ids.note}>
            {t("ex.note")} <span className="muted">{t("common.optional")}</span>
          </label>
          <input id={ids.note} value={f.note} maxLength={300} onChange={up("note")} />
        </div>
      </div>
      {invalid ? (
        <p className="field-error" role="alert">
          {invalid}
        </p>
      ) : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="fin-expense-create"
        >
          {t("ex.create")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function RecurringSection({ onRun }: { onRun: () => void }) {
  const { t, lang } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const writer = isWriter(role);
  const [version, setVersion] = useState(0);
  const list = useAsync(() => fin.recurring(), [fin, version]);
  const locations = useLocations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = { busy: setBusy, error: setError, announce: setAnnounce };
  const [f, setF] = useState({
    location_id: "",
    category: "rent" as ExpenseCategory,
    description: "",
    amount: "",
    interval: "1",
    next_on: todayPR(),
  });
  const ids = {
    title: useId(),
    loc: useId(),
    cat: useId(),
    desc: useId(),
    amount: useId(),
    every: useId(),
    next: useId(),
  };
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function run() {
    const ok = await act(set, async () => {
      const r = await fin.runRecurring();
      return t("rec.ran", { n: r.created });
    });
    if (ok) {
      setVersion((v) => v + 1);
      onRun();
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(f.amount);
    if (!f.location_id || cents === null || !f.description.trim()) return setError("invalid_input");
    const ok = await act(set, async () => {
      await fin.createRecurring({
        location_id: f.location_id,
        category: f.category,
        description: f.description.trim(),
        amount_cents: cents,
        interval_months: Number(f.interval),
        next_on: f.next_on,
      });
      return t("rec.created");
    });
    if (ok) {
      setF((s) => ({ ...s, description: "", amount: "" }));
      setVersion((v) => v + 1);
    }
  }
  async function toggle(id: string, active: boolean) {
    const ok = await act(set, async () => {
      await fin.setRecurringActive(id, active);
      return t(active ? "rec.activated" : "rec.paused");
    });
    if (ok) setVersion((v) => v + 1);
  }

  return (
    <Section
      title={t("rec.title")}
      level={2}
      actions={
        writer ? (
          <button
            type="button"
            className="btn"
            onClick={run}
            disabled={busy}
            data-tour-id="fin-recurring-run"
          >
            {t("rec.run")}
          </button>
        ) : null
      }
    >
      {list.loading ? <Loading /> : null}
      {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.data.length > 0 ? (
        <TableWrap label={t("rec.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("rec.description")}</th>
                <th scope="col">{t("common.location")}</th>
                <th scope="col" className="fin-num">
                  {t("common.amount")}
                </th>
                <th scope="col">{t("rec.next")}</th>
                <th scope="col">{t("ap.col.status")}</th>
                {writer ? <th scope="col">{t("ap.col.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {r.description}
                    <span className="cell-note">
                      {t(`cat.${r.category}` as FinKey)} ·{" "}
                      {t("rec.every", { n: r.interval_months })}
                    </span>
                  </th>
                  <td>{r.location_name}</td>
                  <td className="fin-num mono">{money(r.amount_cents, lang)}</td>
                  <td className="nowrap">{day(r.next_on, lang)}</td>
                  <td>
                    <Plate tone={r.active ? "ok" : "neutral"}>
                      {t(r.active ? "rec.active" : "rec.inactive")}
                    </Plate>
                  </td>
                  {writer ? (
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={busy}
                        onClick={() => toggle(r.id, !r.active)}
                        aria-label={t(r.active ? "rec.pauseLabel" : "rec.activateLabel", {
                          name: r.description,
                        })}
                      >
                        {t(r.active ? "rec.pause" : "rec.activate")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      {list.data && list.data.data.length === 0 ? <p className="muted">{t("rec.empty")}</p> : null}
      {writer ? (
        <form className="form form--boxed" onSubmit={create} aria-labelledby={ids.title} noValidate>
          <h3 id={ids.title} className="form__title">
            {t("rec.new")}
          </h3>
          <div className="form__grid">
            <div className="field">
              <label htmlFor={ids.loc}>{t("common.location")}</label>
              <select id={ids.loc} value={f.location_id} onChange={up("location_id")} required>
                <option value="">{t("common.pickLocation")}</option>
                {(locations.data?.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.cat}>{t("common.category")}</label>
              <select id={ids.cat} value={f.category} onChange={up("category")}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`cat.${c}` as FinKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.desc}>{t("rec.description")}</label>
              <input
                id={ids.desc}
                value={f.description}
                maxLength={120}
                onChange={up("description")}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={ids.amount}>{t("common.amount")}</label>
              <input
                id={ids.amount}
                inputMode="decimal"
                value={f.amount}
                onChange={up("amount")}
                placeholder="0.00"
                required
              />
            </div>
            <div className="field">
              <label htmlFor={ids.every}>{t("rec.interval")}</label>
              <select id={ids.every} value={f.interval} onChange={up("interval")}>
                {[1, 2, 3, 6, 12].map((n) => (
                  <option key={n} value={String(n)}>
                    {t("rec.every", { n })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.next}>{t("rec.next")}</label>
              <input
                id={ids.next}
                type="date"
                value={f.next_on}
                onChange={up("next_on")}
                required
              />
            </div>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {t("rec.create")}
            </button>
          </div>
        </form>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Section>
  );
}
