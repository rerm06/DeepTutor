import { useEffect, useId, useRef, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { SubscriptionFacts } from "./MemberBillingTab";
import type { Subscription } from "./api";
import {
  BILLING_ICON,
  CreditsSummary,
  Empty,
  InvoiceTable,
  Panel,
  day,
  money,
  useBillingApi,
} from "./components";
import { useBillingT } from "./dict";

/**
 * Member portal "Pagos y facturas" (nav: Mi membresía): sessions and credits first (pay-per-session model), then the plan with online
 * cancellation in three steps or fewer (spec E4/E7), then invoices with the IVU breakdown.
 */
export function MyMembershipScreen() {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const billing = useAsync(() => bapi.myBilling(), [bapi]);
  const b = billing.data;
  const live = b?.subscriptions.filter((s) => s.status !== "cancelled") ?? [];
  const balance = (b?.invoices ?? []).reduce(
    (sum, i) => sum + (i.status === "open" ? i.balance_cents : 0),
    0,
  );

  return (
    <div className="page">
      <h1 className="page__title">{t("my.pageTitle")}</h1>
      <p className="lede">{t("my.pageLede")}</p>
      {billing.loading ? <Loading /> : null}
      {billing.error ? <ErrorNote code={billing.error} onRetry={billing.reload} /> : null}
      {b ? (
        <>
          {/* Stats sit on the page (not inside a card): no nested cards. */}
          <section className="billing-block" aria-labelledby="my-credits" data-tour-id="my-credits">
            <div className="billing-block__head">
              <h2 id="my-credits" className="section__title">
                <Icon d={BILLING_ICON.ticket} size={22} />
                {t("credits.myTitle")}
              </h2>
              {live.length === 0 ? (
                <span className="ds-pill">{t("model.payPerSession")}</span>
              ) : null}
            </div>
            <CreditsSummary credits={b.credits} passes={b.passes} />
          </section>
          <Panel title={t("my.plan")} icon="star">
            {live.length === 0 ? <Empty icon="checkCircle" text={t("my.noPlan")} /> : null}
            {live.map((s) => (
              <div key={s.id} className="billing-sub">
                <SubscriptionFacts sub={s} />
                {!s.cancel_at_period_end ? <CancelFlow sub={s} onDone={billing.reload} /> : null}
              </div>
            ))}
          </Panel>
          <Panel
            title={t("my.invoices")}
            icon="receipt"
            actions={
              b.invoices.length > 0 ? (
                <span className="billing-balance">
                  {t("billing.totalOpen", { amount: money(balance, lang) })}
                </span>
              ) : null
            }
          >
            <InvoiceTable
              invoices={b.invoices}
              lines={b.lines}
              canPay={false}
              label={t("my.invoices")}
            />
          </Panel>
        </>
      ) : null}
    </div>
  );
}

/** Step 1: ask. Step 2: confirm with the exact end date. Step 3: clear confirmation. */
export function CancelFlow({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [effective, setEffective] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    if (step === 2) confirmRef.current?.focus();
    if (step === 3) doneRef.current?.focus();
  }, [step]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await bapi.cancel(sub.id);
      setEffective(r.effective_date);
      setStep(3);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 3)
    return (
      <div className="billing-steps">
        <p className="muted">{t("cancel.step", { n: 3 })}</p>
        <output ref={doneRef} tabIndex={-1} className="note">
          {t("cancel.done", { date: day(effective, lang) })}
        </output>
        <button type="button" className="btn" onClick={onDone}>
          {t("my.plan")}
        </button>
      </div>
    );
  if (step === 2)
    return (
      <fieldset className="billing-steps">
        <legend id={titleId}>
          <strong>{t("cancel.confirmTitle")}</strong>
        </legend>
        <p className="muted">{t("cancel.step", { n: 2 })}</p>
        <p>{t("cancel.confirmBody", { date: day(sub.ends_on, lang) })}</p>
        <div className="form__actions">
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={confirm}
            data-tour-id="my-cancel-confirm"
          >
            {t("cancel.confirm")}
          </button>
          <button type="button" className="btn" onClick={() => setStep(1)}>
            {t("cancel.keep")}
          </button>
        </div>
        {error ? <ErrorNote code={error} /> : null}
      </fieldset>
    );
  return (
    <div className="billing-steps">
      <button
        type="button"
        className="btn btn--danger-outline"
        onClick={() => setStep(2)}
        data-tour-id="my-cancel"
      >
        {t("cancel.myButton")}
      </button>
    </div>
  );
}
