import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import { Icon, type IconName } from "../../components/icons";
import { ErrorNote, LiveResult, Plate, TableWrap, type Tone } from "../../components/ui";
import { useSession } from "../../session/SessionContext";
import {
  type BillingApi,
  type Catalog,
  type Credit,
  type Invoice,
  type InvoiceLine,
  ONE_OFF_KINDS,
  PAYMENT_METHODS,
  type Pass,
  type PaymentMethod,
  type Price,
  billingApi,
  newIdempotencyKey,
} from "./api";
import { type BillingKey, useBillingT } from "./dict";
import "./billing.css";

type T = ReturnType<typeof useBillingT>["t"];
type Lang = "es" | "en";

export const SELLERS = ["owner", "location_manager", "front_desk"];
export const CYCLE_RUNNERS = ["owner", "location_manager"];
export const FEE_READERS = ["owner", "accountant", "location_manager"];

/** Extra stroke icons for this module only (24-unit grid, same style as components/icons.tsx). */
export const BILLING_ICON = {
  ticket: "M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7ZM15 7v2M15 11v2M15 15v2",
  tag: "M3 12.5V4h8.5l9 9-8.5 8.5-9-9ZM7.5 8h.01",
  plus: "M12 5v14M5 12h14",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
} as const;
type IconSpec = IconName | { d: string };
function GoldIcon({ icon, size = 22 }: { icon: IconSpec; size?: number }) {
  return typeof icon === "string" ? (
    <Icon name={icon} size={size} />
  ) : (
    <Icon d={icon.d} size={size} />
  );
}

/** A design-system v2 card: `.section` whose title starts with a gold icon. */
export function Panel({
  title,
  icon,
  level = 2,
  actions,
  className,
  tourId,
  titleId,
  children,
}: {
  title: string;
  icon: IconSpec;
  level?: 2 | 3;
  actions?: ReactNode;
  className?: string;
  tourId?: string;
  titleId?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const id = titleId ?? autoId;
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      className={className ? `section ${className}` : "section"}
      aria-labelledby={id}
      data-tour-id={tourId}
    >
      <div className="section__head">
        <Heading id={id} className="section__title">
          <GoldIcon icon={icon} />
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` (gold icon · label · value · hint). Only for numbers the screen already loaded. */
export function Stat({
  icon,
  label,
  value,
  hint,
  children,
  as: Tag = "div",
}: {
  icon: IconSpec;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  as?: "div" | "li";
}) {
  return (
    <Tag className="ds-stat billing-stat">
      <GoldIcon icon={icon} size={32} />
      <span className="ds-stat__text">
        <span className="ds-stat__label">{label}</span>
        <span className="ds-stat__value">{value}</span>
        {hint ? <span className="ds-stat__hint">{hint}</span> : null}
        {children}
      </span>
    </Tag>
  );
}

/** Empty state: gold icon, one bold line, optional helpful action. */
export function Empty({
  icon,
  text,
  action,
}: { icon: IconSpec; text: string; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <GoldIcon icon={icon} size={34} />
      <strong>{text}</strong>
      {action}
    </div>
  );
}

/** Clock time of a timestamp in the gym's time zone (display only). */
export function timeOnly(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    timeStyle: "short",
    timeZone: "America/Puerto_Rico",
  }).format(d);
}

/** Calendar date of a timestamp in the gym's time zone (display only). */
export function dateOnly(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    dateStyle: "medium",
    timeZone: "America/Puerto_Rico",
  }).format(d);
}

export function useBillingApi(): BillingApi {
  const { api } = useSession();
  return useMemo(() => billingApi(api), [api]);
}

/** Display only: the amounts come from the server in integer cents. */
export function money(cents: number | null | undefined, lang: Lang): string {
  return new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}

/** "YYYY-MM-DD" → localized date, without shifting the day across time zones. */
export function day(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}

/** "16.73" → 1673. Input parsing only (no billing rule): null when the text is not a valid amount. */
export function parseCents(text: string): number | null {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "0").padEnd(2, "0"));
  return whole * 100 + frac;
}

export function invoiceTone(inv: Pick<Invoice, "status" | "overdue">): Tone {
  if (inv.status === "paid") return "ok";
  if (inv.status === "void") return "neutral";
  return inv.overdue ? "blocked" : "warn";
}
export function subscriptionTone(status: string): Tone {
  if (status === "active") return "ok";
  if (status === "cancelled") return "blocked";
  return "warn";
}

export function InvoiceStatus({ inv }: { inv: Pick<Invoice, "status" | "overdue"> }) {
  const { t } = useBillingT();
  const label =
    inv.status === "open" && inv.overdue ? t("inv.overdue") : t(`inv.${inv.status}` as BillingKey);
  return <Plate tone={invoiceTone(inv)}>{label}</Plate>;
}

/** Label for a price in selects: "Sesión de entrenamiento · $15.00 · Mensual". */
export function priceLabel(
  catalog: Catalog,
  price: Price,
  lang: Lang,
  t: T,
  locName?: (id: string) => string,
) {
  const p = catalog.products.find((x) => x.id === price.product_id);
  const parts = [p?.name ?? "", money(price.amount_cents, lang)];
  if (price.billing_interval !== "none")
    parts.push(t(`interval.${price.billing_interval}` as BillingKey));
  if (price.credits) parts.push(t("catalog.credits", { n: price.credits }));
  if (price.location_id && locName) parts.push(locName(price.location_id));
  return parts.join(" · ");
}

// ── Invoices with IVU breakdown and inline payment ──────────────────────────────────────────────────────────

export function InvoiceTable({
  invoices,
  lines,
  canPay,
  showMember,
  fees,
  onPaid,
  label,
}: {
  invoices: Invoice[];
  lines?: InvoiceLine[];
  canPay: boolean;
  showMember?: boolean;
  fees?: Map<string, number>;
  onPaid?: () => void;
  label: string;
}) {
  const { t, lang } = useBillingT();
  const [open, setOpen] = useState<string | null>(null);
  if (invoices.length === 0) return <Empty icon="receipt" text={t("inv.none")} />;
  // "Detalle" lives in the row; the payment form gets its own strip under the invoice so the row reads like a
  // document line (number · date · amounts · status) instead of a stack of inputs.
  const actionsCol = Boolean(lines);
  const cols = 9 + (showMember ? 1 : 0) + (fees ? 1 : 0) + (actionsCol ? 1 : 0);
  return (
    <TableWrap label={label}>
      <table className="table billing-table">
        <thead>
          <tr>
            <th scope="col">{t("inv.col.number")}</th>
            <th scope="col">{t("inv.col.date")}</th>
            {showMember ? <th scope="col">{t("inv.col.member")}</th> : null}
            <th scope="col" className="num">
              {t("inv.col.subtotal")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.ivuState")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.ivuMunicipal")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.total")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.balance")}
            </th>
            <th scope="col">{t("inv.col.due")}</th>
            <th scope="col">{t("inv.col.status")}</th>
            {fees ? (
              <th scope="col" className="num">
                {t("inv.col.fee")}
              </th>
            ) : null}
            {actionsCol ? <th scope="col">{t("inv.col.actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const mine = lines?.filter((l) => l.invoice_id === inv.id) ?? [];
            const expanded = open === inv.id;
            const detailId = `inv-detail-${inv.id}`;
            const payable = canPay && inv.status === "open" && inv.balance_cents > 0;
            return (
              <Fragment key={inv.id}>
                <tr className={payable ? "billing-row billing-row--pay" : "billing-row"}>
                  <th scope="row" className="mono billing-no">
                    {String(inv.number).padStart(6, "0")}
                  </th>
                  <td className="billing-when">
                    <time dateTime={inv.issued_at}>
                      <span>{dateOnly(inv.issued_at, lang)}</span>
                      <span className="billing-when__time">{timeOnly(inv.issued_at, lang)}</span>
                    </time>
                  </td>
                  {showMember ? <td className="billing-member">{inv.member_name ?? ""}</td> : null}
                  <td className="num">{money(inv.subtotal_cents, lang)}</td>
                  <td className="num">{money(inv.ivu_state_cents, lang)}</td>
                  <td className="num">{money(inv.ivu_municipal_cents, lang)}</td>
                  <td className="num">
                    <strong>{money(inv.total_cents, lang)}</strong>
                  </td>
                  <td className={inv.balance_cents > 0 ? "num billing-due" : "num"}>
                    {money(inv.balance_cents, lang)}
                  </td>
                  <td className="nowrap">{day(inv.due_date, lang)}</td>
                  <td>
                    <InvoiceStatus inv={inv} />
                  </td>
                  {fees ? <td className="num">{money(fees.get(inv.id) ?? null, lang)}</td> : null}
                  {actionsCol ? (
                    <td>
                      <div className="row-actions">
                        {mine.length > 0 ? (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            aria-expanded={expanded}
                            aria-controls={detailId}
                            onClick={() => setOpen(expanded ? null : inv.id)}
                          >
                            {t("inv.details")}
                            <span className="sr-only">
                              : {t("inv.detailsOf", { number: inv.number })}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
                {expanded ? (
                  <tr id={detailId} className="billing-subrow">
                    <td colSpan={cols}>
                      <InvoiceLines lines={mine} />
                    </td>
                  </tr>
                ) : null}
                {payable ? (
                  <tr className="billing-subrow billing-payrow">
                    <td colSpan={cols}>
                      <PayForm invoice={inv} onPaid={onPaid} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function InvoiceLines({ lines }: { lines: InvoiceLine[] }) {
  const { t, lang } = useBillingT();
  return (
    <div className="billing-lines">
      <table className="table billing-lines__table">
        <thead>
          <tr>
            <th scope="col">{t("inv.line")}</th>
            <th scope="col" className="num">
              {t("inv.qty")}
            </th>
            <th scope="col" className="num">
              {t("inv.amount")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.ivuState")}
            </th>
            <th scope="col" className="num">
              {t("inv.col.ivuMunicipal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <th scope="row">
                {l.description}
                {l.tax_category === "exempt" ? (
                  <span className="muted"> · {t("tax.exempt")}</span>
                ) : null}
              </th>
              <td className="num">{l.quantity}</td>
              <td className="num">{money(l.amount_cents, lang)}</td>
              <td className="num">{money(l.ivu_state_cents, lang)}</td>
              <td className="num">{money(l.ivu_municipal_cents, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="help">{t("inv.ivuNote")}</p>
    </div>
  );
}

function PayForm({ invoice, onPaid }: { invoice: Invoice; onPaid?: () => void }) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [amount, setAmount] = useState((invoice.balance_cents / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [bad, setBad] = useState(false);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const ids = { amount: useId(), method: useId(), ref: useId(), legend: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(amount);
    setBad(cents === null || cents < 1);
    if (cents === null || cents < 1) return;
    setBusy(true);
    setError(null);
    try {
      await bapi.pay(invoice.id, {
        method,
        amount_cents: cents,
        idempotency_key: idem,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      setIdem(newIdempotencyKey());
      onPaid?.();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="billing-pay" onSubmit={submit} aria-labelledby={ids.legend}>
      <span id={ids.legend} className="sr-only">
        {t("pay.forInvoice", { number: invoice.number })} ({money(invoice.balance_cents, lang)})
      </span>
      <Icon name="card" size={20} className="billing-pay__icon" />
      <div className="field">
        <label htmlFor={ids.amount}>{t("pay.amount")}</label>
        <input
          id={ids.amount}
          inputMode="decimal"
          value={amount}
          aria-invalid={bad}
          onChange={(e) => setAmount(e.target.value)}
          size={8}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.method}>{t("pay.method")}</label>
        <select
          id={ids.method}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`method.${m}` as BillingKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={ids.ref}>{t("pay.reference")}</label>
        <input
          id={ids.ref}
          value={reference}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <button type="submit" className="btn" disabled={busy} data-tour-id="billing-record-payment">
        {t("pay.submit")}
      </button>
      {bad ? <p className="field-error">{t("pay.badAmount")}</p> : null}
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

// ── "Cobrar sesión": one-off sale at the desk (pay per session first) ──────────────────────────────────────

export function SellForm({
  memberId,
  catalog,
  locations,
  defaultLocationId,
  onSold,
  tourId = "billing-charge-session",
}: {
  memberId: string;
  catalog: Catalog;
  locations: Location[];
  defaultLocationId?: string;
  onSold?: () => void;
  tourId?: string;
}) {
  const { t, lang } = useBillingT();
  const bapi = useBillingApi();
  const [locationId, setLocationId] = useState("");
  const [priceId, setPriceId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const ids = { loc: useId(), price: useId(), qty: useId(), method: useId(), help: useId() };

  const loc =
    locationId ||
    (defaultLocationId && locations.some((l) => l.id === defaultLocationId)
      ? defaultLocationId
      : "") ||
    locations[0]?.id ||
    "";
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "";
  // One-off prices for this location, single sessions first (pay per session is the default flow).
  const options = useMemo(() => {
    const kindOf = (p: Price) => catalog.products.find((x) => x.id === p.product_id);
    return catalog.prices
      .filter((p) => {
        const prod = kindOf(p);
        return (
          p.active &&
          prod?.active &&
          ONE_OFF_KINDS.includes(prod.kind) &&
          (p.location_id === null || p.location_id === loc)
        );
      })
      .sort((a, b) => {
        const rank = (p: Price) => ONE_OFF_KINDS.indexOf(kindOf(p)?.kind ?? "drop_in");
        // A location-specific price wins over the org-wide one for the same product.
        return rank(a) - rank(b) || (a.location_id ? -1 : 0) - (b.location_id ? -1 : 0);
      });
  }, [catalog, loc]);
  const chosen = options.find((p) => p.id === priceId) ?? options[0];
  const chosenKind = catalog.products.find((p) => p.id === chosen?.product_id)?.kind;
  const isPack = chosenKind === "class_pack" || chosenKind === "pt_package";

  useEffect(() => {
    if (!isPack) setQuantity(1);
  }, [isPack]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !loc) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await bapi.sell(memberId, {
        price_id: chosen.id,
        location_id: loc,
        quantity: isPack ? quantity : 1,
        method,
        idempotency_key: idem,
      });
      setIdem(newIdempotencyKey());
      setDone(t("sell.done", { number: res.number, total: money(res.total_cents, lang) }));
      onSold?.();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form billing-sell" onSubmit={submit} aria-describedby={ids.help}>
      <p id={ids.help} className="help">
        {t("sell.lede")} {t("sell.simulated")}
      </p>
      <div className="form__grid">
        {locations.length > 1 ? (
          <div className="field">
            <label htmlFor={ids.loc}>{t("sell.location")}</label>
            <select id={ids.loc} value={loc} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={ids.price}>{t("sell.product")}</label>
          <select
            id={ids.price}
            value={chosen?.id ?? ""}
            onChange={(e) => setPriceId(e.target.value)}
            disabled={options.length === 0}
          >
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {priceLabel(catalog, p, lang, t, locName)}
              </option>
            ))}
          </select>
        </div>
        {isPack ? (
          <div className="field">
            <label htmlFor={ids.qty}>{t("sell.quantity")}</label>
            <input
              id={ids.qty}
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={ids.method}>{t("sell.method")}</label>
          <select
            id={ids.method}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}` as BillingKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {options.length === 0 ? <p className="note note--warn">{t("sell.noProducts")}</p> : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary billing-cta"
          disabled={busy || !chosen}
          data-tour-id={tourId}
        >
          {chosenKind && chosenKind !== "drop_in" ? t("sell.submitOther") : t("sell.submit")}
        </button>
      </div>
      <LiveResult tone={done ? "ok" : undefined}>{done}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

// ── Credits and passes ("Mis sesiones y créditos") ──────────────────────────────────────────────────────────

export function CreditsSummary({ credits, passes }: { credits: Credit[]; passes: Pass[] }) {
  const { t, lang } = useBillingT();
  const live = credits.filter((c) => c.live && c.credits_remaining > 0);
  const livePasses = passes.filter((p) => p.live);
  if (live.length === 0 && livePasses.length === 0)
    return <Empty icon={{ d: BILLING_ICON.ticket }} text={t("credits.none")} />;
  return (
    <ul className="ds-stats billing-stats billing-credits">
      {live.map((c) => {
        const pct = c.credits_total
          ? Math.min(100, Math.round((c.credits_remaining / c.credits_total) * 100))
          : 0;
        return (
          <Stat
            key={c.id}
            as="li"
            icon={{ d: BILLING_ICON.ticket }}
            label={c.product_name ?? ""}
            value={
              <span aria-hidden="true">
                {c.credits_remaining}
                <span className="billing-stat__of"> / {c.credits_total}</span>
              </span>
            }
            hint={t("credits.remaining", { n: c.credits_remaining, total: c.credits_total })}
          >
            <span className="ds-bar billing-stat__bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="billing-stat__expiry">
              <Icon name="calendar" size={16} />
              {c.expires_at
                ? t("credits.expires", { date: dateOnly(c.expires_at, lang) })
                : t("credits.noExpiry")}
            </span>
          </Stat>
        );
      })}
      {livePasses.map((p) => (
        <Stat
          key={p.id}
          as="li"
          icon="calendar"
          label={t("pass.validLabel")}
          value={<span className="billing-stat__date">{dateOnly(p.valid_to, lang)}</span>}
          hint={p.product_name ?? ""}
        />
      ))}
    </ul>
  );
}
