import { Plate, TableWrap, type Tone } from "../../components/ui";
import { formatDateTime, shortId } from "../../lib/format";
import type { Category, Money, Sale, SaleStatus } from "./api";
import { money } from "./api";
import { useStoreT } from "./dict";

export function saleTone(status: SaleStatus): Tone {
  if (status === "completed") return "ok";
  if (status === "pending_pickup") return "warn";
  if (status === "refunded" || status === "cancelled") return "blocked";
  return "neutral";
}

export function SaleStatusPlate({ status }: { status: SaleStatus }) {
  const { t } = useStoreT();
  return <Plate tone={saleTone(status)}>{t(`st.${status}`)}</Plate>;
}

/** Structure/function disclaimer placeholder for supplements. The platform never recommends products. */
export function SupplementNotice({ categories }: { categories: Array<Category | null> }) {
  const { t } = useStoreT();
  if (!categories.includes("supplement")) return null;
  return (
    <p className="help store-disclaimer" data-tour-id="store-supplement-disclaimer">
      {t("supplementDisclaimer")}
    </p>
  );
}

/** Subtotal, state and municipal IVU and total, all as computed by the server. */
export function IvuBreakdown({ m, label }: { m: Money; label?: string }) {
  const { t, lang } = useStoreT();
  return (
    <div className="store-ivu" data-tour-id="store-ivu">
      <dl className="store-ivu__list" aria-label={label}>
        <div>
          <dt>{t("subtotal")}</dt>
          <dd className="mono">{money(m.subtotal_cents, lang)}</dd>
        </div>
        <div>
          <dt>{t("ivuState")}</dt>
          <dd className="mono">{money(m.ivu_state_cents, lang)}</dd>
        </div>
        <div>
          <dt>{t("ivuMunicipal")}</dt>
          <dd className="mono">{money(m.ivu_municipal_cents, lang)}</dd>
        </div>
        <div className="store-ivu__total">
          <dt>{t("total")}</dt>
          <dd className="mono">{money(m.total_cents, lang)}</dd>
        </div>
      </dl>
      <p className="help">{t("ivuNote")}</p>
    </div>
  );
}

export function Receipt({ sale }: { sale: Sale }) {
  const { t, lang } = useStoreT();
  return (
    <article className="store-receipt" aria-label={t("receipt.title")}>
      <dl className="facts">
        <div>
          <dt>{t("receipt.no")}</dt>
          <dd className="mono">{shortId(sale.id).toUpperCase()}</dd>
        </div>
        <div>
          <dt>{t("location")}</dt>
          <dd>{sale.location_name ?? t("none")}</dd>
        </div>
        <div>
          <dt>{t("sales.date")}</dt>
          <dd>{formatDateTime(sale.created_at, lang)}</dd>
        </div>
        <div>
          <dt>{t("status")}</dt>
          <dd>
            <SaleStatusPlate status={sale.status} />
          </dd>
        </div>
        <div>
          <dt>{t("pos.payment")}</dt>
          <dd>{sale.payment_method ? t(`pay.${sale.payment_method}`) : t("none")}</dd>
        </div>
        {sale.age_verified ? (
          <div>
            <dt>{t("receipt.ageVerified")}</dt>
            <dd>✓</dd>
          </div>
        ) : null}
      </dl>
      <TableWrap label={t("receipt.title")}>
        <table className="table">
          <caption className="sr-only">{t("receipt.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("product")}</th>
              <th scope="col">{t("qty")}</th>
              <th scope="col">{t("price")}</th>
              <th scope="col">{t("ivuState")}</th>
              <th scope="col">{t("ivuMunicipal")}</th>
              <th scope="col">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={l.product_id}>
                <th scope="row">
                  {l.name ?? shortId(l.product_id)}
                  {l.taxable ? null : <span className="muted"> · {t("notTaxable")}</span>}
                </th>
                <td className="mono">{l.qty}</td>
                <td className="mono">{money(l.unit_price_cents, lang)}</td>
                <td className="mono">{money(l.ivu_state_cents, lang)}</td>
                <td className="mono">{money(l.ivu_municipal_cents, lang)}</td>
                <td className="mono">{money(l.total_cents, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <IvuBreakdown m={sale} />
      <SupplementNotice categories={sale.lines.map((l) => l.category)} />
    </article>
  );
}
