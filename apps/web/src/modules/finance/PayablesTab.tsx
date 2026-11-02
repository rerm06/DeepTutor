import { type FormEvent, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  BILL_STATUSES,
  type Bill,
  type BillStatus,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  REF_PATTERN,
} from "./api";
import { type FinKey, useFinT } from "./dict";
import {
  act,
  billTone,
  day,
  isWriter,
  money,
  parseCents,
  todayPR,
  useFin,
  useLocations,
} from "./shared";

/** "Cuentas por pagar": the approvals queue, the bill register (pay / void) and bill entry. */
export function PayablesTab() {
  const { t } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<BillStatus | "">("");
  const filterId = useId();
  const policy = useAsync(() => fin.policy(), [fin]);
  const pending = useAsync(() => fin.bills({ status: "pending_approval" }), [fin, version]);
  const all = useAsync(() => fin.bills(filter ? { status: filter } : {}), [fin, version, filter]);
  const limit = policy.data?.manager_approval_max_cents ?? null;
  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
      <Section title={t("ap.queue")}>
        <p className="help">
          {limit !== null ? t("ap.policy", { limit: (limit / 100).toFixed(2) }) : null}
        </p>
        {pending.loading ? <Loading /> : null}
        {pending.error ? <ErrorNote code={pending.error} onRetry={pending.reload} /> : null}
        {pending.data && pending.data.data.length === 0 ? (
          <p className="muted">{t("ap.queueEmpty")}</p>
        ) : null}
        {pending.data && pending.data.data.length > 0 ? (
          <BillTable bills={pending.data.data} limit={limit} onChanged={refresh} queue />
        ) : null}
      </Section>

      <Section
        title={t("ap.register")}
        actions={
          <div className="field field--inline">
            <label htmlFor={filterId}>{t("ap.filter")}</label>
            <select
              id={filterId}
              value={filter}
              onChange={(e) => setFilter(e.target.value as BillStatus | "")}
            >
              <option value="">{t("ap.filterAll")}</option>
              {BILL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`bill.status.${s}` as FinKey)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {all.loading ? <Loading /> : null}
        {all.error ? <ErrorNote code={all.error} onRetry={all.reload} /> : null}
        {all.data ? <BillTable bills={all.data.data} limit={limit} onChanged={refresh} /> : null}
      </Section>

      {isWriter(role) ? <NewBill onCreated={refresh} /> : null}
    </>
  );
}

/** Why the caller cannot decide / pay / void this bill, or null when they can. Mirrors app.fin_can_decide. */
function blocker(bill: Bill, role: string | null, limit: number | null): FinKey | null {
  if (!isWriter(role)) return "ap.readOnly";
  if (role === "location_manager" && limit !== null && bill.amount_cents > limit)
    return "ap.aboveLimit";
  return null;
}

function BillTable({
  bills,
  limit,
  onChanged,
  queue = false,
}: {
  bills: Bill[];
  limit: number | null;
  onChanged: () => void;
  queue?: boolean;
}) {
  const { t, lang } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [voiding, setVoiding] = useState<Bill | null>(null);
  const set = { busy: setBusy, error: setError, announce: setAnnounce };

  async function decide(b: Bill, decision: "approve" | "reject") {
    const ok = await act(set, async () => {
      await fin.decide(b.id, decision);
      return t(decision === "approve" ? "ap.approved" : "ap.rejected", { number: b.number });
    });
    if (ok) onChanged();
  }

  return (
    <>
      <TableWrap label={queue ? t("ap.queue") : t("ap.register")}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("ap.col.bill")}</th>
              <th scope="col">{t("ap.col.location")}</th>
              <th scope="col" className="fin-num">
                {t("ap.col.amount")}
              </th>
              <th scope="col">{t("ap.col.due")}</th>
              <th scope="col">{t("ap.col.status")}</th>
              <th scope="col">{t("ap.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const why = blocker(b, role, limit);
              const mine = b.created_by_me && b.status === "pending_approval";
              return (
                <tr key={b.id}>
                  <th scope="row">
                    <span className="fin-cell-title">{b.vendor_name}</span>
                    <span className="muted"> · {b.number}</span>
                    <span className="cell-note">{t(`cat.${b.category}` as FinKey)}</span>
                  </th>
                  <td>{b.location_name}</td>
                  <td className="fin-num mono">{money(b.amount_cents, lang)}</td>
                  <td className="nowrap">{day(b.due_on, lang)}</td>
                  <td>
                    <Plate tone={billTone(b.status)}>
                      {t(`bill.status.${b.status}` as FinKey)}
                    </Plate>
                    {b.status === "paid" ? (
                      <span className="cell-note">
                        {day(b.paid_on, lang)} · {b.payment_ref}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {why ? <span className="cell-note">{t(why)}</span> : null}
                    {!why && b.status === "pending_approval" && mine ? (
                      <span className="cell-note">{t("ap.ownBill")}</span>
                    ) : null}
                    {!why && b.status === "pending_approval" && !mine ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={busy}
                          onClick={() => decide(b, "approve")}
                          aria-label={t("ap.approveLabel", { number: b.number })}
                          data-tour-id="fin-bill-approve"
                        >
                          {t("ap.approve")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger-outline"
                          disabled={busy}
                          onClick={() => decide(b, "reject")}
                          aria-label={t("ap.rejectLabel", { number: b.number })}
                        >
                          {t("ap.reject")}
                        </button>
                      </div>
                    ) : null}
                    {!why &&
                    !queue &&
                    (b.status === "approved" || b.status === "pending_approval") ? (
                      <div className="row-actions">
                        {b.status === "approved" ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setVoiding(null);
                              setPaying(b);
                            }}
                            aria-label={t("ap.payLabel", { number: b.number })}
                            data-tour-id="fin-bill-pay"
                          >
                            {t("ap.pay")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            setPaying(null);
                            setVoiding(b);
                          }}
                          aria-label={t("ap.voidLabel", { number: b.number })}
                        >
                          {t("ap.void")}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      {paying ? (
        <PayForm
          bill={paying}
          onDone={(msg) => {
            setPaying(null);
            setAnnounce(msg);
            onChanged();
          }}
          onCancel={() => setPaying(null)}
        />
      ) : null}
      {voiding ? (
        <VoidForm
          bill={voiding}
          onDone={(msg) => {
            setVoiding(null);
            setAnnounce(msg);
            onChanged();
          }}
          onCancel={() => setVoiding(null)}
        />
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </>
  );
}

function PayForm({
  bill,
  onDone,
  onCancel,
}: { bill: Bill; onDone: (msg: string) => void; onCancel: () => void }) {
  const { t, lang } = useFinT();
  const fin = useFin();
  const [paidOn, setPaidOn] = useState(todayPR());
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const ids = { date: useId(), ref: useId(), title: useId(), err: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!REF_PATTERN.test(ref.trim())) return setInvalid(t("ap.badRef"));
    setInvalid(null);
    await act({ busy: setBusy, error: setError, announce: () => undefined }, async () => {
      await fin.pay(bill.id, paidOn, ref.trim());
      const msg = t("ap.paid", { number: bill.number });
      onDone(msg);
      return msg;
    });
  }
  return (
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h3 id={ids.title} className="form__title">
        {t("ap.payTitle", { number: bill.number, amount: money(bill.amount_cents, lang) })}
      </h3>
      <p className="help">{t("ap.payHelp")}</p>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.date}>{t("ap.paidOn")}</label>
          <input
            id={ids.date}
            type="date"
            value={paidOn}
            max={todayPR()}
            min={bill.issued_on}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={ids.ref}>{t("ap.paymentRef")}</label>
          <input
            id={ids.ref}
            value={ref}
            maxLength={40}
            onChange={(e) => setRef(e.target.value)}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? ids.err : undefined}
            required
          />
          {invalid ? (
            <p id={ids.err} className="field-error" role="alert">
              {invalid}
            </p>
          ) : null}
        </div>
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="fin-bill-pay-save"
        >
          {t("ap.paySave")}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function VoidForm({
  bill,
  onDone,
  onCancel,
}: { bill: Bill; onDone: (msg: string) => void; onCancel: () => void }) {
  const { t } = useFinT();
  const fin = useFin();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { reason: useId(), title: useId() };
  async function submit(e: FormEvent) {
    e.preventDefault();
    await act({ busy: setBusy, error: setError, announce: () => undefined }, async () => {
      await fin.voidBill(bill.id, reason.trim());
      const msg = t("ap.voided", { number: bill.number });
      onDone(msg);
      return msg;
    });
  }
  return (
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title}>
      <h3 id={ids.title} className="form__title">
        {t("ap.voidTitle", { number: bill.number })}
      </h3>
      <div className="field">
        <label htmlFor={ids.reason}>{t("common.reason")}</label>
        <input
          id={ids.reason}
          value={reason}
          minLength={3}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--danger"
          disabled={busy || reason.trim().length < 3}
        >
          {t("ap.voidSave")}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function NewBill({ onCreated }: { onCreated: () => void }) {
  const { t } = useFinT();
  const fin = useFin();
  const [vVersion, setVVersion] = useState(0);
  const vendors = useAsync(() => fin.vendors(), [fin, vVersion]);
  const locations = useLocations();
  const [f, setF] = useState({
    vendor_id: "",
    location_id: "",
    number: "",
    category: "other" as ExpenseCategory,
    memo: "",
    issued_on: todayPR(),
    due_on: todayPR(),
    amount: "",
  });
  const [vendorName, setVendorName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const ids = {
    title: useId(),
    vendor: useId(),
    newVendor: useId(),
    loc: useId(),
    no: useId(),
    cat: useId(),
    memo: useId(),
    issued: useId(),
    due: useId(),
    amount: useId(),
    err: useId(),
  };
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const set = { busy: setBusy, error: setError, announce: setAnnounce };

  async function addVendor() {
    const name = vendorName.trim();
    if (!name) return;
    const ok = await act(set, async () => {
      const { id } = await fin.createVendor({ name });
      setF((s) => ({ ...s, vendor_id: id }));
      setVendorName("");
      return t("ap.vendorCreated", { name });
    });
    if (ok) setVVersion((v) => v + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(f.amount);
    if (!f.vendor_id || !f.location_id || cents === null || !REF_PATTERN.test(f.number.trim()))
      return setInvalid(t("ap.formInvalid"));
    if (f.due_on < f.issued_on) return setInvalid(t("ap.dueBeforeIssue"));
    setInvalid(null);
    const ok = await act(set, async () => {
      await fin.createBill({
        vendor_id: f.vendor_id,
        location_id: f.location_id,
        number: f.number.trim(),
        category: f.category,
        memo: f.memo.trim() || undefined,
        issued_on: f.issued_on,
        due_on: f.due_on,
        amount_cents: cents,
      });
      return t("ap.created", { number: f.number.trim() });
    });
    if (ok) {
      setF((s) => ({ ...s, number: "", memo: "", amount: "" }));
      onCreated();
    }
  }

  return (
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h2 id={ids.title} className="form__title">
        {t("ap.new")}
      </h2>
      <p className="help">{t("ap.newHelp")}</p>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.vendor}>{t("ap.vendor")}</label>
          <select id={ids.vendor} value={f.vendor_id} onChange={up("vendor_id")} required>
            <option value="">{t("ap.pickVendor")}</option>
            {(vendors.data?.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.newVendor}>{t("ap.newVendor")}</label>
          <div className="inline-form">
            <input
              id={ids.newVendor}
              value={vendorName}
              maxLength={120}
              onChange={(e) => setVendorName(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={addVendor}
              disabled={busy || !vendorName.trim()}
            >
              {t("ap.addVendor")}
            </button>
          </div>
        </div>
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
          <label htmlFor={ids.no}>{t("ap.number")}</label>
          <input id={ids.no} value={f.number} maxLength={40} onChange={up("number")} required />
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
          <label htmlFor={ids.issued}>{t("ap.issuedOn")}</label>
          <input
            id={ids.issued}
            type="date"
            value={f.issued_on}
            onChange={up("issued_on")}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={ids.due}>{t("ap.dueOn")}</label>
          <input id={ids.due} type="date" value={f.due_on} onChange={up("due_on")} required />
        </div>
        <div className="field field--wide">
          <label htmlFor={ids.memo}>
            {t("ap.memo")} <span className="muted">{t("common.optional")}</span>
          </label>
          <input id={ids.memo} value={f.memo} maxLength={300} onChange={up("memo")} />
        </div>
      </div>
      {invalid ? (
        <p id={ids.err} className="field-error" role="alert">
          {invalid}
        </p>
      ) : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="fin-bill-create"
        >
          {t("ap.create")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}
