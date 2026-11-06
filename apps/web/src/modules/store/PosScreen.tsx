import { type FormEvent, type KeyboardEvent, useEffect, useId, useState } from "react";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  type CatalogueItem,
  PAYMENT_METHODS,
  type PaymentMethod,
  type Sale,
  errorKey,
  money,
  useStoreApi,
} from "./api";
import { useCart } from "./cart";
import {
  CategoryIcon,
  IvuBreakdown,
  Receipt,
  STORE_ICON,
  StoreEmpty,
  StoreSection,
  SupplementNotice,
} from "./components";
import { type StoreKey, useStoreT } from "./dict";

/** Filter the location catalogue by name or SKU (case-insensitive). */
export function searchCatalogue(items: CatalogueItem[], term: string): CatalogueItem[] {
  const q = term.trim().toLocaleLowerCase();
  if (!q) return items;
  return items.filter(
    (p) => p.sku.toLocaleLowerCase().includes(q) || p.name.toLocaleLowerCase().includes(q),
  );
}

/** Staff POS: search/scan by SKU, cart, server-computed IVU, age check only when needed, payment, receipt. */
export function PosScreen() {
  const { t, lang } = useStoreT();
  const { api } = useSession();
  const store = useStoreApi();
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
  const items = catalogue.data?.data ?? [];
  const cart = useCart();
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const ids = { loc: useId(), search: useId(), help: useId(), age: useId(), tile: useId() };

  const byId = new Map(items.map((p) => [p.product_id, p]));
  const quote = cart.quote.data;
  const restricted = cart.lines.some((l) => byId.get(l.product_id)?.age_restricted);
  useEffect(() => {
    if (!restricted) setAgeOk(false);
  }, [restricted]);

  function add(p: CatalogueItem) {
    cart.add(p.product_id, p.available);
    setAnnounce(t("pos.skuAdded", { name: p.name }));
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = items.find(
      (p) => p.sku.toLocaleLowerCase() === search.trim().toLocaleLowerCase(),
    );
    if (exact) {
      add(exact);
      setSearch("");
    }
  }

  async function charge(e: FormEvent) {
    e.preventDefault();
    if (!locationId || cart.lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const sale = await store.sell({
        location_id: locationId,
        lines: cart.lines,
        payment_method: payment,
        age_verified: restricted && ageOk,
      });
      setReceipt(sale);
      setAnnounce(t("pos.done"));
      cart.clear();
      setAgeOk(false);
      catalogue.reload();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const visible = search.trim() ? searchCatalogue(items, search) : items;
  const units = cart.lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="page store-page">
      <div className="page__head">
        <div className="store-head">
          <h1 className="page__title">{t("pos.title")}</h1>
          <p className="lede">{t("pos.lede")}</p>
        </div>
      </div>
      <LiveResult>{announce}</LiveResult>
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}

      {receipt ? (
        <StoreSection
          title={t("receipt.title")}
          icon="receipt"
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => window.print()}
                data-tour-id="store-receipt-print"
              >
                <Icon d={STORE_ICON.printer} />
                {t("receipt.print")}
              </button>
              <button
                type="button"
                className="ds-cta"
                onClick={() => setReceipt(null)}
                data-tour-id="store-pos-new"
              >
                <Icon d={STORE_ICON.plus} />
                {t("pos.newSale")}
              </button>
            </>
          }
        >
          <Receipt sale={receipt} />
        </StoreSection>
      ) : null}

      <div className="store-split">
        <div className="store-split__main">
          <div className="toolbar store-toolbar">
            <div className="field">
              <label htmlFor={ids.loc}>{t("location")}</label>
              <select
                id={ids.loc}
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  cart.clear();
                }}
                data-tour-id="store-pos-location"
              >
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field--grow store-search">
              <label htmlFor={ids.search}>{t("pos.search")}</label>
              <span className="store-search__box">
                <Icon d={STORE_ICON.search} size={22} />
                <input
                  id={ids.search}
                  type="search"
                  autoComplete="off"
                  value={search}
                  aria-describedby={ids.help}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onSearchKey}
                  data-tour-id="store-pos-search"
                />
              </span>
              <p id={ids.help} className="help">
                {t("pos.searchHelp")}
              </p>
            </div>
          </div>

          {catalogue.loading ? <Loading /> : null}
          {catalogue.error ? <ErrorNote code={catalogue.error} onRetry={catalogue.reload} /> : null}
          <section
            className="store-block"
            aria-label={search.trim() ? t("pos.results") : t("pos.catalogue")}
          >
            {search.trim() && visible.length === 0 ? (
              <StoreEmpty iconD={STORE_ICON.search} title={t("pos.noMatch")} />
            ) : null}
            <ul className="ds-grid store-tiles">
              {visible.map((p) => {
                const inCart = cart.qty[p.product_id] ?? 0;
                const metaId = `${ids.tile}-${p.product_id}`;
                return (
                  <li key={p.product_id}>
                    <button
                      type="button"
                      className="store-tile"
                      disabled={p.available <= inCart}
                      aria-label={`${t("pos.add")}: ${p.name}`}
                      aria-describedby={metaId}
                      onClick={() => add(p)}
                      data-tour-id="store-pos-add"
                    >
                      <span className="store-tile__top">
                        <span className="store-tile__art">
                          <CategoryIcon category={p.category} size={24} />
                        </span>
                        {inCart > 0 ? <span className="ds-pill">× {inCart}</span> : null}
                      </span>
                      <span className="store-tile__name">{p.name}</span>
                      <span className="store-tile__sku mono">{p.sku}</span>
                      <span id={metaId} className="store-tile__meta">
                        <span className="store-tile__price">{money(p.price_cents, lang)}</span>
                        <span className={p.available > 0 ? "store-tile__stock" : "store-tile__out"}>
                          {p.available > 0 ? `${t("available")}: ${p.available}` : t("soldOut")}
                        </span>
                        {p.age_restricted ? (
                          <span className="store-tile__age">
                            <Icon d={STORE_ICON.shield} size={16} />
                            {t("ageRestricted")}
                          </span>
                        ) : null}
                      </span>
                      <span className="store-tile__add" aria-hidden="true">
                        <Icon d={STORE_ICON.plus} size={18} />
                        {t("pos.add")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <StoreSection
          title={t("pos.cart")}
          icon="cart"
          className="store-cart"
          actions={
            units > 0 ? <span className="ds-pill">{t("pos.units", { n: units })}</span> : null
          }
        >
          {cart.lines.length === 0 ? (
            <StoreEmpty icon="cart" title={t("pos.cartEmpty")}>
              <p className="help">{t("pos.cartHint")}</p>
            </StoreEmpty>
          ) : (
            <form className="form store-cart__form" onSubmit={charge} data-tour-id="store-pos-cart">
              <ul className="store-lines">
                {cart.lines.map((l) => {
                  const p = byId.get(l.product_id);
                  const q = quote?.lines.find((x) => x.product_id === l.product_id);
                  const name = p?.name ?? l.product_id;
                  return (
                    <li key={l.product_id} className="store-line">
                      <span className="store-line__name">
                        <strong>{name}</strong>
                        <span className="muted mono">{p ? money(p.price_cents, lang) : ""}</span>
                        {p?.age_restricted ? (
                          <span className="store-line__age">{t("ageRestricted")}</span>
                        ) : null}
                      </span>
                      <input
                        type="number"
                        className="store-qty"
                        min={1}
                        max={p?.available ?? 999}
                        value={l.qty}
                        aria-label={t("pos.qtyFor", { name })}
                        onChange={(e) => cart.set(l.product_id, Number(e.target.value))}
                      />
                      <span className="store-line__total mono">
                        {q ? money(q.total_cents, lang) : ""}
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

              {cart.quote.error ? <ErrorNote code={cart.quote.error} /> : null}
              {quote ? <IvuBreakdown m={quote} /> : null}
              <SupplementNotice
                categories={cart.lines.map((l) => byId.get(l.product_id)?.category ?? null)}
              />

              {restricted ? (
                <div className="note note--warn store-check">
                  <p>
                    <Icon d={STORE_ICON.shield} size={20} />
                    {t("pos.ageNeeded")}
                  </p>
                  <input
                    id={ids.age}
                    type="checkbox"
                    checked={ageOk}
                    onChange={(e) => setAgeOk(e.target.checked)}
                    data-tour-id="store-pos-age"
                  />
                  <label htmlFor={ids.age}>{t("pos.age")}</label>
                </div>
              ) : null}

              <fieldset className="store-fieldset" data-tour-id="store-pos-payment">
                <legend>{t("pos.payment")}</legend>
                {PAYMENT_METHODS.map((m) => (
                  <label key={m} className="store-radio">
                    <input
                      type="radio"
                      name="payment"
                      value={m}
                      checked={payment === m}
                      onChange={() => setPayment(m)}
                    />
                    <Icon name={m === "cash" ? "coin" : "card"} size={22} />
                    {t(`pay.${m}`)}
                  </label>
                ))}
              </fieldset>

              <div className="store-charge-bar">
                <button
                  type="submit"
                  className="ds-cta store-charge"
                  disabled={busy || !quote || (restricted && !ageOk)}
                  data-tour-id="store-pos-submit"
                >
                  {t("pos.charge", { total: quote ? money(quote.total_cents, lang) : "" })}
                </button>
                {error ? (
                  <p className="note note--error" role="alert">
                    {t(error)}
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </StoreSection>
      </div>
    </div>
  );
}
