import { type FormEvent, useId, useState } from "react";
import type { ErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  COMMISSION_SOURCES,
  type Commission,
  type CommissionSource,
  SOURCE_REF_PATTERN,
} from "./api";
import { type FinKey, useFinT } from "./dict";
import {
  act,
  commissionTone,
  day,
  isWriter,
  money,
  parseCents,
  todayPR,
  useFin,
  useLocations,
} from "./shared";

/** "Comisiones": managers propose, the owner approves, marks paid (via the payroll export) or voids. */
export function CommissionsTab() {
  const { t, lang } = useFinT();
  const fin = useFin();
  const { role } = useSession();
  const owner = role === "owner";
  const [version, setVersion] = useState(0);
  const list = useAsync(() => fin.commissions(), [fin, version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const set = { busy: setBusy, error: setError, announce: setAnnounce };

  async function move(c: Commission, status: "approved" | "paid" | "void") {
    const ok = await act(set, async () => {
      await fin.setCommission(c.id, status, status === "paid" ? todayPR() : undefined);
      return t(`com.moved.${status}` as FinKey, { name: c.staff_name ?? "" });
    });
    if (ok) setVersion((v) => v + 1);
  }

  return (
    <>
      <Section title={t("com.title")}>
        <p className="help">{t("com.help")}</p>
        {list.loading ? <Loading /> : null}
        {list.error ? <ErrorNote code={list.error} onRetry={list.reload} /> : null}
        {list.data && list.data.data.length === 0 ? (
          <p className="muted">{t("com.empty")}</p>
        ) : null}
        {list.data && list.data.data.length > 0 ? (
          <TableWrap label={t("com.title")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("com.staff")}</th>
                  <th scope="col">{t("com.source")}</th>
                  <th scope="col" className="fin-num">
                    {t("common.amount")}
                  </th>
                  <th scope="col">{t("common.date")}</th>
                  <th scope="col">{t("ap.col.status")}</th>
                  {owner ? <th scope="col">{t("ap.col.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      {c.staff_name}
                      <span className="cell-note">{c.location_name}</span>
                    </th>
                    <td>
                      {t(`com.src.${c.source}` as FinKey)}
                      <span className="cell-note mono">{c.source_ref}</span>
                    </td>
                    <td className="fin-num mono">{money(c.amount_cents, lang)}</td>
                    <td className="nowrap">{day(c.earned_on, lang)}</td>
                    <td>
                      <Plate tone={commissionTone(c.status)}>
                        {t(`com.status.${c.status}` as FinKey)}
                      </Plate>
                    </td>
                    {owner ? (
                      <td>
                        <div className="row-actions">
                          {c.status === "pending" ? (
                            <button
                              type="button"
                              className="btn btn--primary"
                              disabled={busy}
                              onClick={() => move(c, "approved")}
                              aria-label={t("com.approveLabel", { name: c.staff_name ?? "" })}
                              data-tour-id="fin-commission-approve"
                            >
                              {t("ap.approve")}
                            </button>
                          ) : null}
                          {c.status === "approved" ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() => move(c, "paid")}
                              aria-label={t("com.paidLabel", { name: c.staff_name ?? "" })}
                            >
                              {t("com.markPaid")}
                            </button>
                          ) : null}
                          {c.status === "pending" || c.status === "approved" ? (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              disabled={busy}
                              onClick={() => move(c, "void")}
                              aria-label={t("com.voidLabel", { name: c.staff_name ?? "" })}
                            >
                              {t("ap.void")}
                            </button>
                          ) : null}
                        </div>
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
      </Section>
      {isWriter(role) ? <NewCommission onCreated={() => setVersion((v) => v + 1)} /> : null}
    </>
  );
}

function NewCommission({ onCreated }: { onCreated: () => void }) {
  const { t } = useFinT();
  const fin = useFin();
  const locations = useLocations();
  const [loc, setLoc] = useState("");
  const staff = useAsync(() => (loc ? fin.staff(loc) : Promise.resolve(null)), [fin, loc]);
  const [f, setF] = useState({
    staff: "",
    source: "session" as CommissionSource,
    ref: "",
    amount: "",
    earned_on: todayPR(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const ids = {
    title: useId(),
    loc: useId(),
    staff: useId(),
    src: useId(),
    ref: useId(),
    amount: useId(),
    date: useId(),
  };
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(f.amount);
    if (!loc || !f.staff || cents === null || !SOURCE_REF_PATTERN.test(f.ref.trim()))
      return setInvalid(t("ap.formInvalid"));
    setInvalid(null);
    const ok = await act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      await fin.createCommission({
        staff_member_id: f.staff,
        location_id: loc,
        source: f.source,
        source_ref: f.ref.trim(),
        amount_cents: cents,
        earned_on: f.earned_on,
      });
      return t("com.created");
    });
    if (ok) {
      setF((s) => ({ ...s, ref: "", amount: "" }));
      onCreated();
    }
  }
  return (
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h2 id={ids.title} className="form__title">
        {t("com.new")}
      </h2>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.loc}>{t("common.location")}</label>
          <select id={ids.loc} value={loc} onChange={(e) => setLoc(e.target.value)} required>
            <option value="">{t("common.pickLocation")}</option>
            {(locations.data?.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.staff}>{t("com.staff")}</label>
          <select id={ids.staff} value={f.staff} onChange={up("staff")} required disabled={!loc}>
            <option value="">{t("com.pickStaff")}</option>
            {(staff.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.src}>{t("com.source")}</label>
          <select id={ids.src} value={f.source} onChange={up("source")}>
            {COMMISSION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`com.src.${s}` as FinKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.ref}>{t("com.ref")}</label>
          <input id={ids.ref} value={f.ref} maxLength={64} onChange={up("ref")} required />
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
            value={f.earned_on}
            onChange={up("earned_on")}
            required
          />
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
          data-tour-id="fin-commission-create"
        >
          {t("com.create")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}
