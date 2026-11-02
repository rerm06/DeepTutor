import { useEffect, useId, useRef, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, Loading, Section } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { SubscriptionFacts } from "./MemberBillingTab";
import type { Subscription } from "./api";
import { CreditsSummary, InvoiceTable, day, useBillingApi } from "./components";
import { useBillingT } from "./dict";

/**
 * Member portal "Mi membresía": sessions and credits first (pay-per-session model), then the plan with online
 * cancellation in three steps or fewer (spec E4/E7), then invoices with the IVU breakdown.
 */
export function MyMembershipScreen() {
  const { t } = useBillingT();
  const bapi = useBillingApi();
  const billing = useAsync(() => bapi.myBilling(), [bapi]);
  const b = billing.data;
  const live = b?.subscriptions.filter((s) => s.status !== "cancelled") ?? [];

  return (
    <div className="page">
      <h1 className="page__title">{t("my.title")}</h1>
      <p className="lede">{t("my.lede")}</p>
      {billing.loading ? <Loading /> : null}
      {billing.error ? <ErrorNote code={billing.error} onRetry={billing.reload} /> : null}
      {b ? (
        <>
          <section
            className="section billing-quick"
            aria-labelledby="my-credits"
            data-tour-id="my-credits"
          >
            <h2 id="my-credits" className="section__title">
              {t("credits.myTitle")}
            </h2>
            <CreditsSummary credits={b.credits} passes={b.passes} />
          </section>
          <Section title={t("my.plan")}>
            {live.length === 0 ? <p className="muted">{t("my.noPlan")}</p> : null}
            {live.map((s) => (
              <div key={s.id} className="billing-sub">
                <SubscriptionFacts sub={s} />
                {!s.cancel_at_period_end ? <CancelFlow sub={s} onDone={billing.reload} /> : null}
              </div>
            ))}
          </Section>
          <Section title={t("my.invoices")}>
            <InvoiceTable
              invoices={b.invoices}
              lines={b.lines}
              canPay={false}
              label={t("my.invoices")}
            />
          </Section>
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
