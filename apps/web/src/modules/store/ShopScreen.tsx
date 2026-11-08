import { useEffect, useId, useState } from "react";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { errorKey, money, useStoreApi } from "./api";
import { useCart } from "./cart";
import {
  CategoryIcon,
  IvuBreakdown,
  STORE_ICON,
  SaleStatusPlate,
  StoreEmpty,
  StoreSection,
  StoreStat,
  SupplementNotice,
} from "./components";
import { type StoreKey, useStoreT } from "./dict";

/**
 * Member shop: browse the active catalogue of a pickup location, order for pickup (paid at the desk), and
 * follow or cancel own orders. Neutral listing only: nothing is ever "recommended" (spec §11 supplements).
 */
export function ShopScreen() {
  const { t, lang } = useStoreT();
  const { api, role } = useSession();
  const store = useStoreApi();
  const canOrder = role === "member";
  const locations = useAsync(() => api.locations(), [api]);
  const locs = locations.data?.data ?? [];
  const [locationId, setLocationId] = useState("");
  useEffect(() => {
    if (!locationId && locs[0]) setLocationId(locs[0].id);
  }, [locationId, locs]);
  const catalogue = useAsync(
    () => (locationId ? store.catalogue(locationId) : Promise.resolve({ data: [] })),
    [store, locationId],
  );
  const orders = useAsync(() => store.sales(), [store]);
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const locId = useId();
  const catId = useId();
  const items = catalogue.data?.data ?? [];
  const byId = new Map(items.map((p) => [p.product_id, p]));

  async function run(fn: () => Promise<unknown>, msg: StoreKey) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAnnounce(t(msg));
      orders.reload();
      catalogue.reload();
      return true;
    } catch (err) {
      setError(errorKey(err, msg === "shop.ordered" ? "err.stock" : "err.status"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const orderRows = orders.data?.data ?? [];
  const pendingCount = orderRows.filter((o) => o.status === "pending_pickup").length;
  const availableCount = items.filter((p) => p.available > 0).length;

  return (
    <div className="page store-page">
      <div className="page__head">
        <div className="store-head">
          <h1 className="page__title">{t("shop.title")}</h1>
          <p className="lede">{t("shop.lede")}</p>
        </div>
        <div className="field field--inline store-shop-loc">
          <label htmlFor={locId}>
            <Icon name="pin" />
            {t("pickupLocation")}
          </label>
          <select
            id={locId}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              cart.clear();
            }}
            data-tour-id="store-shop-location"
          >
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? (
        <p className="note note--error" role="alert">
          {t(error)}
        </p>
      ) : null}

      {catalogue.data || orders.data ? (
        <div className="ds-stats">
          {catalogue.data ? (
            <StoreStat icon="bag" label={t("shop.statAvailable")} value={availableCount} />
          ) : null}
          {orders.data ? (
            <StoreStat icon="receipt" label={t("shop.statPending")} value={pendingCount} />
          ) : null}
        </div>
      ) : null}

      <div className={canOrder ? "store-split" : undefined}>
        <section className="store-block store-split__main" aria-labelledby={catId}>
          <h2 id={catId} className="section__title">
            <Icon name="bag" size={24} />
            {t("shop.catalogue")}
          </h2>
          {catalogue.loading ? <Loading /> : null}
          {catalogue.error ? <ErrorNote code={catalogue.error} onRetry={catalogue.reload} /> : null}
          {catalogue.data && items.length === 0 ? (
            <StoreEmpty icon="bag" title={t("shop.empty")} />
          ) : null}
          <ul className="ds-grid store-products">
            {items.map((p) => (
              <li key={p.product_id} className="store-product">
                <div className="store-product__art" aria-hidden="true">
                  <CategoryIcon category={p.category} size={44} />
                </div>
                <div className="store-product__body">
                  <p className="store-product__cat">{t(`cat.${p.category}`)}</p>
                  <h3 className="store-product__name">{p.name}</h3>
                  <p className="store-product__price">{money(p.price_cents, lang)}</p>
                  <p>
                    {p.available > 0 ? (
                      <Plate tone="ok">
                        {t("available")}: {p.available}
                      </Plate>
                    ) : (
                      <Plate tone="neutral">{t("soldOut")}</Plate>
                    )}
                  </p>
                  {p.age_restricted ? (
                    <p className="store-product__age">
                      <Icon d={STORE_ICON.shield} size={18} />
                      <span>{t("ageAtPickup")}</span>
                    </p>
                  ) : null}
                  <SupplementNotice categories={[p.category]} />
                  {canOrder ? (
                    <button
                      type="button"
                      className="ds-cta store-product__cta"
                      disabled={p.available <= (cart.qty[p.product_id] ?? 0)}
                      onClick={() => cart.add(p.product_id, p.available)}
                      data-tour-id="store-shop-add"
                    >
                      <Icon name="cart" />
                      {t("pos.add")}
                      <span className="sr-only">: {p.name}</span>
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {canOrder ? (
          <StoreSection title={t("pos.cart")} icon="cart" className="store-cart">
            {cart.lines.length === 0 ? (
              <StoreEmpty icon="cart" title={t("pos.cartEmpty")}>
                <p className="help">{t("shop.cartHint")}</p>
              </StoreEmpty>
            ) : (
              <>
                <ul className="store-lines">
                  {cart.lines.map((l) => {
                    const name = byId.get(l.product_id)?.name ?? l.product_id;
                    return (
                      <li key={l.product_id} className="store-line store-line--simple">
                        <span className="store-line__name">
                          <strong>{name}</strong>
                          <span className="muted">× {l.qty}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn--ghost store-line__remove"
                          onClick={() => cart.remove(l.product_id)}
                        >
                          {t("pos.remove")}
                          <span className="sr-only">: {name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {cart.quote.data ? <IvuBreakdown m={cart.quote.data} /> : null}
                <button
                  type="button"
                  className="ds-cta store-charge"
                  disabled={busy || !cart.quote.data}
                  onClick={async () => {
                    if (
                      await run(
                        () => store.order({ location_id: locationId, lines: cart.lines }),
                        "shop.ordered",
                      )
                    )
                      cart.clear();
                  }}
                  data-tour-id="store-shop-order"
                >
                  {t("shop.order")}
                </button>
              </>
            )}
          </StoreSection>
        ) : null}
      </div>

      <StoreSection title={t("shop.myOrders")} icon="receipt">
        {orders.loading ? <Loading /> : null}
        {orders.error ? <ErrorNote code={orders.error} onRetry={orders.reload} /> : null}
        {orders.data && orderRows.length === 0 ? (
          <StoreEmpty icon="receipt" title={t("shop.noOrders")} />
        ) : null}
        {orderRows.length > 0 ? (
          <TableWrap label={t("shop.myOrders")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("sales.date")}</th>
                  <th scope="col">{t("sales.units")}</th>
                  <th scope="col">{t("total")}</th>
                  <th scope="col">{t("status")}</th>
                  <th scope="col">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.map((o) => (
                  <tr key={o.id}>
                    <td>{formatDateTime(o.created_at, lang)}</td>
                    <td className="mono">{o.units ?? ""}</td>
                    <td className="mono">{money(o.total_cents, lang)}</td>
                    <td>
                      <SaleStatusPlate status={o.status} />
                    </td>
                    <td>
                      {canOrder && o.status === "pending_pickup" ? (
                        <button
                          type="button"
                          className="btn btn--danger-outline"
                          disabled={busy}
                          onClick={() => void run(() => store.cancel(o.id), "sales.cancelled")}
                          data-tour-id="store-shop-cancel"
                        >
                          {t("sales.cancel")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </StoreSection>
    </div>
  );
}
