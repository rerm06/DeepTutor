import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { Catalog, Freeze, Subscription } from "./api";
import {
  BILLING_ICON,
  CreditsSummary,
  Empty,
  InvoiceTable,
  Panel,
  SELLERS,
  SellForm,
  day,
  priceLabel,
  subscriptionTone,
  useBillingApi,
} from "./components";
import { type BillingKey, useBillingT } from "./dict";

/** Staff member record tab "Membresía y pagos". Charging a session is the first, most prominent action. */
export function MemberBillingTab({ memberId }: { memberId: string }) {
  const { t } = useBillingT();
  const { api, role } = useSession();
  const bapi = useBillingApi();
  const seller = SELLERS.includes(role ?? "");
  const billing = useAsync(() => bapi.memberBilling(memberId), [bapi, memberId]);
  const catalog = useAsync(() => bapi.catalog(), [bapi]);
  const locations = useAsync(() => api.locations(), [api]);
  const members = useAsync(() => api.members(), [api]);
  const home = members.data?.data.find((m) => m.id === memberId)?.home_location_id;
  const b = billing.data;

  // A chapter of the member record: a titled group of cards (no card inside a card).
  return (
    <section className="billing-tab" aria-labelledby={`billing-tab-${memberId}`}>
      <div className="billing-block__head">
        <h2 id={`billing-tab-${memberId}`} className="section__title billing-tab__title">
          <Icon name="card" size={24} />
          {t("tab.title")}
        </h2>
      </div>
      {billing.loading ? <Loading /> : null}
      {billing.error ? <ErrorNote code={billing.error} onRetry={billing.reload} /> : null}

      {seller && catalog.data && locations.data ? (
        <Panel
          title={t("sell.title")}
          icon="coin"
          level={3}
          titleId={`sell-${memberId}`}
          className="billing-quick"
          actions={<span className="ds-pill">{t("model.payPerSession")}</span>}
        >
          <SellForm
            memberId={memberId}
            catalog={catalog.data}
            locations={locations.data.data}
            defaultLocationId={home}
            onSold={billing.reload}
          />
        </Panel>
      ) : null}

      {b ? (
        <>
          <section className="billing-block" aria-labelledby={`credits-${memberId}`}>
            <h3 id={`credits-${memberId}`} className="section__title">
              <Icon d={BILLING_ICON.ticket} size={22} />
              {t("credits.title")}
            </h3>
            <CreditsSummary credits={b.credits} passes={b.passes} />
          </section>

          <Panel title={t("subs.title")} icon="star" level={3}>
            {b.subscriptions.length === 0 ? (
              <Empty icon="checkCircle" text={t("subs.none")} />
            ) : null}
            {b.subscriptions.map((s) => (
              <SubscriptionCard
                key={s.id}
                sub={s}
                freezes={b.freezes.filter((f) => f.subscription_id === s.id)}
                canAct={seller}
                onChanged={billing.reload}
              />
            ))}
            {seller && catalog.data ? (
              <SubscribeForm
                memberId={memberId}
                catalog={catalog.data}
                homeLocationId={home}
                onCreated={billing.reload}
              />
            ) : null}
          </Panel>

          <Panel title={t("inv.title")} icon="receipt" level={3}>
            <InvoiceTable
              invoices={b.invoices}
              lines={b.lines}
              canPay={seller}
              onPaid={billing.reload}
              label={t("inv.title")}
            />
          </Panel>
        </>
      ) : null}
    </section>
  );
}

export function SubscriptionFacts({ sub }: { sub: Subscription }) {
  const { t, lang } = useBillingT();
  return (
    <dl className="facts">
      <div>
        <dt>{t("subs.plan")}</dt>
        <dd>{sub.product_name}</dd>
      </div>
      <div>
        <dt>{t("subs.status")}</dt>
        <dd>
          <Plate tone={subscriptionTone(sub.status)}>{t(`sub.${sub.status}` as BillingKey)}</Plate>
        </dd>
      </div>
      <div>
        <dt>{t("subs.period")}</dt>
        <dd>
          {day(sub.current_period_start, lang)} – {day(sub.current_period_end, lang)}
        </dd>
      </div>
      <div>
        <dt>{t("subs.nextRenewal")}</dt>
        <dd>
          {sub.status === "cancelled"
            ? "—"
            : sub.cancel_at_period_end
              ? t("subs.cancelScheduled", { date: day(sub.ends_on, lang) })
              : day(sub.current_period_end, lang)}
        </dd>
      </div>
      {sub.commitment_end ? (
        <div>
          <dt>{t("subs.commitment")}</dt>
          <dd>{day(sub.commitment_end, lang)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function SubscriptionCard({
  sub,
  freezes,
  canAct,
  onChanged,
}: {
  sub: Subscription;
  freezes: Freeze[];
  canAct: boolean;
  onChanged: () => void;
}) {
  const { t, lang } = useBillingT();
  const live = sub.status !== "cancelled";
  return (
    <div className="billing-sub">
      <SubscriptionFacts sub={sub} />
      {freezes.length > 0 ? (
        <p className="muted">
          {t("freeze.history")}:{" "}
          {freezes
            .map((f) => `${day(f.start_date, lang)} – ${day(f.end_date, lang)} (${f.days})`)
            .join(" · ")}
        </p>
      ) : null}
      {canAct && live ? (
        <div className="row-actions">
          <FreezeForm sub={sub} onDone={onChanged} />
          {!sub.cancel_at_period_end ? <StaffCancel sub={sub} onDone={onChanged} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function todayLocal(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function FreezeForm({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(todayLocal(1));
  const [end, setEnd] = useState(todayLocal(8));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ids = { form: useId(), start: useId(), end: useId(), reason: useId(), help: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await bapi.freeze(sub.id, {
        start_date: start,
        end_date: end,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setDone(t("freeze.done", { date: day(r.subscription.current_period_end, lang) }));
      setOpen(false);
      onDone();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={ids.form}
        onClick={() => setOpen((v) => !v)}
        data-tour-id="billing-freeze"
      >
        {t("freeze.title")}
      </button>
      {open ? (
        <form
          id={ids.form}
          className="form form--boxed"
          onSubmit={submit}
          aria-describedby={ids.help}
        >
          <p id={ids.help} className="help">
            {t("freeze.help")}
          </p>
          <div className="form__grid">
            <div className="field">
              <label htmlFor={ids.start}>{t("freeze.start")}</label>
              <input
                id={ids.start}
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={ids.end}>{t("freeze.end")}</label>
              <input
                id={ids.end}
                type="date"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={ids.reason}>{t("freeze.reason")}</label>
              <input
                id={ids.reason}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-tour-id="billing-freeze-submit"
            >
              {t("freeze.submit")}
            </button>
          </div>
          {error ? <ErrorNote code={error} /> : null}
        </form>
      ) : null}
      <LiveResult tone={done ? "ok" : undefined}>{done}</LiveResult>
    </>
  );
}

function StaffCancel({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const titleId = useId();

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await bapi.cancel(sub.id);
      setDone(t("cancel.doneStaff", { date: day(r.effective_date, lang) }));
      setConfirming(false);
      onDone();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!confirming ? (
        <button
          type="button"
          className="btn btn--danger-outline"
          onClick={() => setConfirming(true)}
          data-tour-id="billing-cancel"
        >
          {t("cancel.button")}
        </button>
      ) : (
        <fieldset className="billing-steps">
          <legend id={titleId}>
            <strong>{t("cancel.confirmTitle")}</strong>
          </legend>
          <p>{t("cancel.confirmBody", { date: day(sub.ends_on, lang) })}</p>
          <div className="form__actions">
            <button type="button" className="btn btn--danger" disabled={busy} onClick={confirm}>
              {t("cancel.confirm")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t("cancel.keep")}
            </button>
          </div>
        </fieldset>
      )}
      <LiveResult tone={done ? "ok" : undefined}>{done}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </>
  );
}

function SubscribeForm({
  memberId,
  catalog,
  homeLocationId,
  onCreated,
}: {
  memberId: string;
  catalog: Catalog;
  homeLocationId?: string;
  onCreated: () => void;
}) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [open, setOpen] = useState(false);
  const [priceId, setPriceId] = useState("");
  const [start, setStart] = useState("");
  const [enrollment, setEnrollment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ids = { form: useId(), price: useId(), start: useId(), fee: useId() };

  const forLoc = (locationId: string | null) =>
    locationId === null || locationId === homeLocationId;
  const kind = (productId: string) => catalog.products.find((p) => p.id === productId);
  const recurring = catalog.prices.filter(
    (p) =>
      p.active &&
      p.billing_interval !== "none" &&
      kind(p.product_id)?.active &&
      forLoc(p.location_id),
  );
  const fees = catalog.prices.filter(
    (p) => p.active && kind(p.product_id)?.kind === "enrollment_fee" && forLoc(p.location_id),
  );
  if (recurring.length === 0) return <p className="help billing-center">{t("subs.noRecurring")}</p>;
  const chosen = priceId || recurring[0]?.id || "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bapi.subscribe(memberId, {
        price_id: chosen,
        ...(start ? { start_date: start } : {}),
        ...(enrollment ? { enrollment_price_id: enrollment } : {}),
      });
      setDone(t("subs.created"));
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={ids.form}
        onClick={() => setOpen((v) => !v)}
        data-tour-id="billing-subscribe"
      >
        {t("subs.subscribe")}
      </button>
      {open ? (
        <form id={ids.form} className="form form--boxed" onSubmit={submit}>
          <h4 className="form__title">{t("subs.subscribeTitle")}</h4>
          <div className="form__grid">
            <div className="field">
              <label htmlFor={ids.price}>{t("subs.price")}</label>
              <select id={ids.price} value={chosen} onChange={(e) => setPriceId(e.target.value)}>
                {recurring.map((p) => (
                  <option key={p.id} value={p.id}>
                    {priceLabel(catalog, p, lang, t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.start}>{t("subs.start")}</label>
              <input
                id={ids.start}
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            {fees.length > 0 ? (
              <div className="field">
                <label htmlFor={ids.fee}>{t("subs.enrollment")}</label>
                <select
                  id={ids.fee}
                  value={enrollment}
                  onChange={(e) => setEnrollment(e.target.value)}
                >
                  <option value="">{t("subs.noEnrollment")}</option>
                  {fees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {priceLabel(catalog, p, lang, t)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-tour-id="billing-subscribe-submit"
            >
              {t("subs.subscribe")}
            </button>
          </div>
          {error ? <ErrorNote code={error} /> : null}
        </form>
      ) : null}
      <LiveResult tone={done ? "ok" : undefined}>{done}</LiveResult>
    </div>
  );
}
