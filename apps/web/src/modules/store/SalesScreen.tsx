import { type FormEvent, useId, useState } from "react";
import { ErrorNote, LiveResult, Loading, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  SALE_STATUSES,
  type SaleSummary,
  canManage,
  canSell,
  errorKey,
  money,
  useStoreApi,
} from "./api";
import { Receipt, SaleStatusPlate } from "./components";
import { type StoreKey, useStoreT } from "./dict";

/** Sales list (sellers: their locations; accountant: read-only, org-wide), receipts, refunds and pickups. */
export function SalesScreen() {
  const { t } = useStoreT();
  const { api } = useSession();
  const store = useStoreApi();
  const locations = useAsync(() => api.locations(), [api]);
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("");
  const [announce, setAnnounce] = useState<string | null>(null);
  const sales = useAsync(
    () => store.sales({ location_id: locationId || undefined, status: status || undefined }),
    [store, locationId, status],
  );
  const ids = { loc: useId(), st: useId() };
  const locs = locations.data?.data ?? [];
  const locName = new Map(locs.map((l) => [l.id, l.name]));

  return (
    <div className="page">
      <h1 className="page__title">{t("sales.title")}</h1>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      <div className="toolbar">
        <div className="field">
          <label htmlFor={ids.loc}>{t("location")}</label>
          <select id={ids.loc} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("sales.all")}</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.st}>{t("status")}</label>
          <select
            id={ids.st}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-tour-id="store-sales-status"
          >
            <option value="">{t("sales.all")}</option>
            {SALE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`st.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {sales.loading ? <Loading /> : null}
      {sales.error ? <ErrorNote code={sales.error} onRetry={sales.reload} /> : null}
      {sales.data && sales.data.data.length === 0 ? (
        <p className="muted">{t("sales.empty")}</p>
      ) : null}
      {sales.data && sales.data.data.length > 0 ? (
        <SalesTable
          rows={sales.data.data}
          locName={locName}
          onChanged={(msg) => {
            setAnnounce(msg);
            sales.reload();
          }}
        />
      ) : null}
    </div>
  );
}

export function SalesTable({
  rows,
  locName,
  onChanged,
}: {
  rows: SaleSummary[];
  locName: Map<string, string>;
  onChanged: (message: string) => void;
}) {
  const { t, lang } = useStoreT();
  return (
    <TableWrap label={t("sales.title")}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("sales.date")}</th>
            <th scope="col">{t("location")}</th>
            <th scope="col">{t("sales.channel")}</th>
            <th scope="col">{t("sales.member")}</th>
            <th scope="col">{t("sales.units")}</th>
            <th scope="col">{t("total")}</th>
            <th scope="col">{t("status")}</th>
            <th scope="col">{t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <SaleRow key={s.id} sale={s} locName={locName} onChanged={onChanged} lang={lang} />
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function SaleRow({
  sale,
  locName,
  onChanged,
  lang,
}: {
  sale: SaleSummary;
  locName: Map<string, string>;
  onChanged: (message: string) => void;
  lang: "es" | "en";
}) {
  const { t } = useStoreT();
  const { role } = useSession();
  const store = useStoreApi();
  const [open, setOpen] = useState(false);
  const detail = useAsync(
    () => (open ? store.sale(sale.id) : Promise.resolve(null)),
    [store, sale.id, open, sale.status],
  );
  const [reason, setReason] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  const ids = { reason: useId(), pay: useId(), age: useId(), detail: useId() };
  const restricted = detail.data?.lines.some((l) => l.age_restricted) ?? false;

  async function act(fn: () => Promise<unknown>, msg: StoreKey) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(t(msg));
    } catch (err) {
      setError(errorKey(err, "err.status"));
    } finally {
      setBusy(false);
    }
  }

  const refundable = sale.status === "completed" && canManage(role);
  const pending = sale.status === "pending_pickup" && canSell(role);

  return (
    <>
      <tr>
        <td>{formatDateTime(sale.created_at, lang)}</td>
        <td>{locName.get(sale.location_id) ?? ""}</td>
        <td>{t(`ch.${sale.channel}`)}</td>
        <td>{sale.member_name ?? t("none")}</td>
        <td className="mono">{sale.units ?? ""}</td>
        <td className="mono">{money(sale.total_cents, lang)}</td>
        <td>
          <SaleStatusPlate status={sale.status} />
        </td>
        <td>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn--ghost"
              aria-expanded={open}
              aria-controls={ids.detail}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? t("sales.hide") : t("sales.view")}
            </button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr id={ids.detail}>
          <td colSpan={8}>
            {detail.loading ? <Loading /> : null}
            {detail.error ? <ErrorNote code={detail.error} /> : null}
            {detail.data ? <Receipt sale={detail.data} /> : null}

            {refundable ? (
              <form
                className="inline-form store-inline"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void act(() => store.refund(sale.id, reason.trim()), "sales.refunded");
                }}
              >
                <label htmlFor={ids.reason}>{t("sales.refundReason")}</label>
                <input
                  id={ids.reason}
                  required
                  minLength={3}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn--danger-outline"
                  disabled={busy}
                  data-tour-id="store-sale-refund"
                >
                  {t("sales.refund")}
                </button>
              </form>
            ) : null}

            {pending && detail.data ? (
              <form
                className="form store-inline"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void act(
                    () => store.pickup(sale.id, payment, restricted && ageOk),
                    "sales.pickedUp",
                  );
                }}
              >
                <fieldset className="store-fieldset">
                  <legend>{t("pos.payment")}</legend>
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m} className="store-radio">
                      <input
                        type="radio"
                        name={`pay-${sale.id}`}
                        value={m}
                        checked={payment === m}
                        onChange={() => setPayment(m)}
                      />
                      {t(`pay.${m}`)}
                    </label>
                  ))}
                </fieldset>
                {restricted ? (
                  <div className="note note--warn store-check">
                    <input
                      id={ids.age}
                      type="checkbox"
                      checked={ageOk}
                      onChange={(e) => setAgeOk(e.target.checked)}
                      data-tour-id="store-pickup-age"
                    />
                    <label htmlFor={ids.age}>{t("pos.age")}</label>
                  </div>
                ) : null}
                <div className="form__actions">
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={busy || (restricted && !ageOk)}
                    data-tour-id="store-sale-pickup"
                  >
                    {t("sales.pickup")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-outline"
                    disabled={busy}
                    onClick={() => void act(() => store.cancel(sale.id), "sales.cancelled")}
                    data-tour-id="store-sale-cancel"
                  >
                    {t("sales.cancel")}
                  </button>
                </div>
              </form>
            ) : null}
            {error ? (
              <p className="note note--error" role="alert">
                {t(error)}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
