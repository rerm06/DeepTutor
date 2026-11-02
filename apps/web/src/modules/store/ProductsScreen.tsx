import { type FormEvent, useId, useState } from "react";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import {
  CATEGORIES,
  type Category,
  type Product,
  errorKey,
  money,
  parsePriceCents,
  useStoreApi,
} from "./api";
import { type StoreKey, useStoreT } from "./dict";

/** Product catalogue maintenance (owner, location manager). Prices are typed in dollars, stored in cents. */
export function ProductsScreen() {
  const { t } = useStoreT();
  const store = useStoreApi();
  const products = useAsync(() => store.products(true), [store]);
  const [showNew, setShowNew] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const formId = useId();
  const changed = (msg: string) => {
    setAnnounce(msg);
    products.reload();
  };

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{t("prod.title")}</h1>
        <button
          type="button"
          className="btn btn--primary"
          aria-expanded={showNew}
          aria-controls={formId}
          onClick={() => setShowNew((v) => !v)}
          data-tour-id="store-product-new"
        >
          {t("prod.new")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {showNew ? (
        <div id={formId}>
          <NewProduct onCreated={() => changed(t("prod.created"))} />
        </div>
      ) : null}
      {products.loading ? <Loading /> : null}
      {products.error ? <ErrorNote code={products.error} onRetry={products.reload} /> : null}
      {products.data ? (
        <TableWrap label={t("prod.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("sku")}</th>
                <th scope="col">{t("prod.name")}</th>
                <th scope="col">{t("category")}</th>
                <th scope="col">{t("price")}</th>
                <th scope="col">{t("taxable")}</th>
                <th scope="col">{t("ageRestricted")}</th>
                <th scope="col">{t("status")}</th>
                <th scope="col">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {products.data.data.map((p) => (
                <ProductRow key={p.id} product={p} onChanged={() => changed(t("prod.saved"))} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </div>
  );
}

function ProductRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const { t, lang } = useStoreT();
  const store = useStoreApi();
  const [price, setPrice] = useState((product.price_cents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  const priceId = useId();

  async function save(patch: Partial<Product>) {
    setBusy(true);
    setError(null);
    try {
      await store.updateProduct(product.id, patch);
      onChanged();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="mono">{product.sku}</td>
      <th scope="row">{product.name}</th>
      <td>{t(`cat.${product.category}`)}</td>
      <td className="mono">{money(product.price_cents, lang)}</td>
      <td>{product.taxable ? t("taxable") : t("notTaxable")}</td>
      <td>{product.age_restricted ? "✓" : t("none")}</td>
      <td>
        <Plate tone={product.active ? "ok" : "neutral"}>
          {product.active ? t("prod.active") : t("prod.inactive")}
        </Plate>
      </td>
      <td>
        <div className="row-actions">
          <form
            className="inline-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const cents = parsePriceCents(price);
              if (cents === null) setError("err.input");
              else void save({ price_cents: cents });
            }}
          >
            <label htmlFor={priceId} className="sr-only">
              {t("prod.newPrice", { name: product.name })}
            </label>
            <input
              id={priceId}
              className="store-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <button type="submit" className="btn" disabled={busy}>
              {t("inv.submit")}
            </button>
          </form>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void save({ active: !product.active })}
          >
            {product.active ? t("prod.deactivate") : t("prod.activate")}
            <span className="sr-only">: {product.name}</span>
          </button>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {t(error)}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

function NewProduct({ onCreated }: { onCreated: () => void }) {
  const { t } = useStoreT();
  const store = useStoreApi();
  const [f, setF] = useState({
    sku: "",
    name: "",
    category: "supplement" as Category,
    price: "",
    taxable: true,
    age_restricted: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  const [priceInvalid, setPriceInvalid] = useState(false);
  const ids = {
    sku: useId(),
    skuHelp: useId(),
    name: useId(),
    cat: useId(),
    price: useId(),
    priceErr: useId(),
    tax: useId(),
    age: useId(),
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parsePriceCents(f.price);
    setPriceInvalid(cents === null);
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await store.createProduct({
        sku: f.sku.trim().toUpperCase(),
        name: f.name.trim(),
        category: f.category,
        price_cents: cents,
        taxable: f.taxable,
        age_restricted: f.age_restricted,
        active: true,
      });
      setF({ ...f, sku: "", name: "", price: "" });
      onCreated();
    } catch (err) {
      setError(errorKey(err, "err.input"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("prod.new")}>
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.sku}>{t("sku")}</label>
            <input
              id={ids.sku}
              required
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,31}"
              aria-describedby={ids.skuHelp}
              value={f.sku}
              onChange={(e) => setF({ ...f, sku: e.target.value })}
            />
            <p id={ids.skuHelp} className="help">
              {t("prod.skuHelp")}
            </p>
          </div>
          <div className="field">
            <label htmlFor={ids.name}>{t("prod.name")}</label>
            <input
              id={ids.name}
              required
              maxLength={120}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.cat}>{t("category")}</label>
            <select
              id={ids.cat}
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`cat.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.price}>{t("prod.priceUsd")}</label>
            <input
              id={ids.price}
              required
              inputMode="decimal"
              aria-invalid={priceInvalid}
              aria-describedby={priceInvalid ? ids.priceErr : undefined}
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })}
            />
            {priceInvalid ? (
              <p id={ids.priceErr} className="field-error">
                {t("prod.badPrice")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="store-check">
          <input
            id={ids.tax}
            type="checkbox"
            checked={f.taxable}
            onChange={(e) => setF({ ...f, taxable: e.target.checked })}
          />
          <label htmlFor={ids.tax}>{t("taxable")}</label>
        </div>
        <div className="store-check">
          <input
            id={ids.age}
            type="checkbox"
            checked={f.age_restricted}
            onChange={(e) => setF({ ...f, age_restricted: e.target.checked })}
          />
          <label htmlFor={ids.age}>{t("ageRestricted")}</label>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="store-product-create"
          >
            {t("prod.create")}
          </button>
        </div>
        {error ? (
          <p className="note note--error" role="alert">
            {t(error)}
          </p>
        ) : null}
      </form>
    </Section>
  );
}
