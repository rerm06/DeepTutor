import { type FormEvent, type KeyboardEvent, useEffect, useId, useState } from "react";
import { ErrorNote, LiveResult, Loading, Section, TableWrap } from "../../components/ui";
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
import { IvuBreakdown, Receipt, SupplementNotice } from "./components";
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
  const ids = { loc: useId(), search: useId(), help: useId(), age: useId() };

  const byId = new Map(items.map((p) => [p.product_id, p]));
  const results = search.trim() ? searchCatalogue(items, search).slice(0, 8) : [];
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

  return (
    <div className="page">
      <h1 className="page__title">{t("pos.title")}</h1>
      <LiveResult>{announce}</LiveResult>
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}

      {receipt ? (
        <Section
          title={t("receipt.title")}
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => window.print()}
                data-tour-id="store-receipt-print"
              >
                {t("receipt.print")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setReceipt(null)}
                data-tour-id="store-pos-new"
              >
                {t("pos.newSale")}
              </button>
            </>
          }
        >
          <Receipt sale={receipt} />
        </Section>
      ) : null}

      <div className="toolbar">
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
        <div className="field field--grow">
          <label htmlFor={ids.search}>{t("pos.search")}</label>
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
          <p id={ids.help} className="help">
            {t("pos.searchHelp")}
          </p>
        </div>
      </div>

      {catalogue.loading ? <Loading /> : null}
      {catalogue.error ? <ErrorNote code={catalogue.error} onRetry={catalogue.reload} /> : null}
      {search.trim() ? (
        <section aria-label={t("pos.results")}>
          {results.length === 0 ? <p className="muted">{t("pos.noMatch")}</p> : null}
          <ul className="store-results">
            {results.map((p) => (
              <li key={p.product_id} className="store-results__item">
                <span>
                  <strong>{p.name}</strong> <span className="mono muted">{p.sku}</span>
                  <br />
                  <span className="mono">{money(p.price_cents, lang)}</span> ·{" "}
                  {p.available > 0 ? `${t("available")}: ${p.available}` : t("soldOut")}
                  {p.age_restricted ? ` · ${t("ageRestricted")}` : ""}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={p.available <= (cart.qty[p.product_id] ?? 0)}
                  onClick={() => add(p)}
                  data-tour-id="store-pos-add"
                >
                  {t("pos.add")}
                  <span className="sr-only">: {p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title={t("pos.cart")}>
        {cart.lines.length === 0 ? (
          <p className="muted">{t("pos.cartEmpty")}</p>
        ) : (
          <form className="form" onSubmit={charge} data-tour-id="store-pos-cart">
            <TableWrap label={t("pos.cart")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("product")}</th>
                    <th scope="col">{t("qty")}</th>
                    <th scope="col">{t("price")}</th>
                    <th scope="col">{t("total")}</th>
                    <th scope="col">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.lines.map((l) => {
                    const p = byId.get(l.product_id);
                    const q = quote?.lines.find((x) => x.product_id === l.product_id);
                    const name = p?.name ?? l.product_id;
                    return (
                      <tr key={l.product_id}>
                        <th scope="row">
                          {name}
                          {p?.age_restricted ? (
                            <span className="muted"> · {t("ageRestricted")}</span>
                          ) : null}
                        </th>
                        <td>
                          <input
                            type="number"
                            className="store-qty"
                            min={1}
                            max={p?.available ?? 999}
                            value={l.qty}
                            aria-label={t("pos.qtyFor", { name })}
                            onChange={(e) => cart.set(l.product_id, Number(e.target.value))}
                          />
                        </td>
                        <td className="mono">{p ? money(p.price_cents, lang) : ""}</td>
                        <td className="mono">{q ? money(q.total_cents, lang) : ""}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => cart.remove(l.product_id)}
                          >
                            {t("pos.remove")}
                            <span className="sr-only">: {name}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>

            {cart.quote.error ? <ErrorNote code={cart.quote.error} /> : null}
            {quote ? <IvuBreakdown m={quote} /> : null}
            <SupplementNotice
              categories={cart.lines.map((l) => byId.get(l.product_id)?.category ?? null)}
            />

            {restricted ? (
              <div className="note note--warn store-check">
                <p>{t("pos.ageNeeded")}</p>
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
                  {t(`pay.${m}`)}
                </label>
              ))}
            </fieldset>

            <div className="form__actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || !quote || (restricted && !ageOk)}
                data-tour-id="store-pos-submit"
              >
                {t("pos.charge", { total: quote ? money(quote.total_cents, lang) : "" })}
              </button>
            </div>
            {error ? (
              <p className="note note--error" role="alert">
                {t(error)}
              </p>
            ) : null}
          </form>
        )}
      </Section>
    </div>
  );
}
