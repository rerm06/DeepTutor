import { useEffect, useId, useState } from "react";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { errorKey, money, useStoreApi } from "./api";
import { useCart } from "./cart";
import { IvuBreakdown, SaleStatusPlate, SupplementNotice } from "./components";
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

  return (
    <div className="page">
      <h1 className="page__title">{t("shop.title")}</h1>
      <p className="lede">{t("shop.lede")}</p>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? (
        <p className="note note--error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="field field--inline">
        <label htmlFor={locId}>{t("pickupLocation")}</label>
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

      <Section title={t("shop.catalogue")}>
        {catalogue.loading ? <Loading /> : null}
        {catalogue.error ? <ErrorNote code={catalogue.error} onRetry={catalogue.reload} /> : null}
        {catalogue.data && items.length === 0 ? <p className="muted">{t("shop.empty")}</p> : null}
        <ul className="store-grid">
          {items.map((p) => (
            <li key={p.product_id} className="store-card">
              <h3 className="store-card__name">{p.name}</h3>
              <p className="muted">
                {t(`cat.${p.category}`)} ·{" "}
                <span className="mono">{money(p.price_cents, lang)}</span>
              </p>
              <p>
                {p.available > 0 ? (
                  <Plate tone="ok">
                    {t("available")}: {p.available}
                  </Plate>
                ) : (
                  <Plate tone="neutral">{t("soldOut")}</Plate>
                )}
              </p>
              {p.age_restricted ? <p className="help">{t("ageAtPickup")}</p> : null}
              <SupplementNotice categories={[p.category]} />
              {canOrder ? (
                <button
                  type="button"
                  className="btn"
                  disabled={p.available <= (cart.qty[p.product_id] ?? 0)}
                  onClick={() => cart.add(p.product_id, p.available)}
                  data-tour-id="store-shop-add"
                >
                  {t("pos.add")}
                  <span className="sr-only">: {p.name}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {canOrder && cart.lines.length > 0 ? (
        <Section title={t("pos.cart")}>
          <ul className="store-lines">
            {cart.lines.map((l) => {
              const name = byId.get(l.product_id)?.name ?? l.product_id;
              return (
                <li key={l.product_id}>
                  <span>
                    {name} × {l.qty}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost"
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
          <div className="form__actions">
            <button
              type="button"
              className="btn btn--primary"
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
          </div>
        </Section>
      ) : null}

      <Section title={t("shop.myOrders")}>
        {orders.loading ? <Loading /> : null}
        {orders.error ? <ErrorNote code={orders.error} onRetry={orders.reload} /> : null}
        {orders.data && orders.data.data.length === 0 ? (
          <p className="muted">{t("shop.noOrders")}</p>
        ) : null}
        {orders.data && orders.data.data.length > 0 ? (
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
                {orders.data.data.map((o) => (
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
      </Section>
    </div>
  );
}
