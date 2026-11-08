import { type ReactNode, useId } from "react";
import { Icon, type IconName } from "../../components/icons";
import { Plate, TableWrap, type Tone } from "../../components/ui";
import { formatDateTime, shortId } from "../../lib/format";
import type { Category, Money, Sale, SaleStatus } from "./api";
import { money } from "./api";
import { useStoreT } from "./dict";

/** Module-only stroke icons (24-unit grid), passed to <Icon d=…>. */
export const STORE_ICON = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9",
  tag: "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  plus: "M12 5v14M5 12h14",
  truck:
    "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  swap: "M4 8h15l-4-4M20 16H5l4 4",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3ZM9 12l2 2 4-4",
  printer: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  jar: "M7 8h10v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8ZM6 3h12v5H6zM10 13h4M10 16h4",
  shirt: "M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c0 1.7-1.8 3-4 3S8 4.7 8 3Z",
  bottle: "M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3V2ZM8 12h8",
} as const;

const CATEGORY_ICON: Record<Category, { name?: IconName; d?: string }> = {
  supplement: { d: STORE_ICON.jar },
  apparel: { d: STORE_ICON.shirt },
  drink: { d: STORE_ICON.bottle },
  accessory: { name: "dumbbell" },
  other: { name: "bag" },
};

/** Decorative category glyph (gold); the category is always written next to it. */
export function CategoryIcon({ category, size = 28 }: { category: Category; size?: number }) {
  return <Icon {...CATEGORY_ICON[category]} size={size} />;
}

/** `.section` card whose title starts with a gold icon (design system v2). Same landmarks as ui.tsx Section. */
export function StoreSection({
  title,
  icon,
  iconD,
  actions,
  children,
  level = 2,
  className,
  tourId,
}: {
  title: string;
  icon?: IconName;
  iconD?: string;
  actions?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
  className?: string;
  tourId?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      className={className ? `section ${className}` : "section"}
      aria-labelledby={id}
      data-tour-id={tourId}
    >
      <div className="section__head">
        <Heading id={id} className="section__title">
          <Icon name={icon} d={iconD} size={24} />
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` tile: gold icon, label, value, optional hint. Only for numbers the screen already loaded. */
export function StoreStat({
  label,
  value,
  hint,
  icon,
  iconD,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  iconD?: string;
}) {
  return (
    <div className="ds-stat store-stat">
      <Icon name={icon} d={iconD} size={30} />
      <dl className="ds-stat__text">
        <dt className="ds-stat__label">{label}</dt>
        <dd className="ds-stat__value">{value}</dd>
        {hint ? <dd className="ds-stat__hint">{hint}</dd> : null}
      </dl>
    </div>
  );
}

/** `.ds-empty`: gold icon, one bold line, optional helper line or action. */
export function StoreEmpty({
  icon,
  iconD,
  title,
  children,
}: {
  icon?: IconName;
  iconD?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <Icon name={icon} d={iconD} size={36} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}

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
    <p className="store-disclaimer" data-tour-id="store-supplement-disclaimer">
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
        <div className="store-ivu__row">
          <dt>{t("subtotal")}</dt>
          <dd className="mono">{money(m.subtotal_cents, lang)}</dd>
        </div>
        <div className="store-ivu__row">
          <dt>{t("ivuState")}</dt>
          <dd className="mono">{money(m.ivu_state_cents, lang)}</dd>
        </div>
        <div className="store-ivu__row">
          <dt>{t("ivuMunicipal")}</dt>
          <dd className="mono">{money(m.ivu_municipal_cents, lang)}</dd>
        </div>
        <div className="store-ivu__row store-ivu__total">
          <dt>{t("total")}</dt>
          <dd className="mono">{money(m.total_cents, lang)}</dd>
        </div>
      </dl>
      <p className="help store-ivu__note">{t("ivuNote")}</p>
    </div>
  );
}

export function Receipt({ sale }: { sale: Sale }) {
  const { t, lang } = useStoreT();
  return (
    <article className="store-receipt" aria-label={t("receipt.title")}>
      <dl className="facts store-receipt__facts">
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
            <dd>
              <Icon d={STORE_ICON.shield} size={20} className="store-gold" />
              <span className="sr-only">{t("yes")}</span>
            </dd>
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
