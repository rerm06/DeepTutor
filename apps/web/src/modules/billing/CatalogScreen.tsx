import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Catalog, PRODUCT_KINDS, type Price, type Product, type ProductKind } from "./api";
import { money, parseCents, useBillingApi } from "./components";
import { type BillingKey, useBillingT } from "./dict";

/** Staff "Catálogo" (owner, location manager): products and prices per location. */
export function CatalogScreen() {
  const { t } = useBillingT();
  const { api } = useSession();
  const bapi = useBillingApi();
  const catalog = useAsync(() => bapi.catalog(), [bapi]);
  const locations = useAsync(() => api.locations(), [api]);
  const [announce, setAnnounce] = useState<string | null>(null);
  const reload = (msg: string) => {
    setAnnounce(msg);
    catalog.reload();
  };

  return (
    <div className="page">
      <h1 className="page__title">{t("catalog.title")}</h1>
      <p className="lede">{t("catalog.lede")}</p>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {catalog.loading ? <Loading /> : null}
      {catalog.error ? <ErrorNote code={catalog.error} onRetry={catalog.reload} /> : null}
      {catalog.data && locations.data ? (
        <>
          <Section title={t("catalog.products")}>
            <ProductTable
              catalog={catalog.data}
              locations={locations.data.data}
              onChanged={reload}
            />
          </Section>
          <Section title={t("catalog.newProduct")}>
            <NewProductForm onCreated={() => reload(t("catalog.created"))} />
          </Section>
          <Section title={t("catalog.newPrice")}>
            <NewPriceForm
              catalog={catalog.data}
              locations={locations.data.data}
              onCreated={() => reload(t("catalog.priceAdded"))}
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function ProductTable({
  catalog,
  locations,
  onChanged,
}: {
  catalog: Catalog;
  locations: Location[];
  onChanged: (msg: string) => void;
}) {
  const { t, lang } = useBillingT();
  if (catalog.products.length === 0) return <p className="muted">{t("catalog.none")}</p>;
  const locName = (id: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? id.slice(0, 8)) : t("catalog.allLocations");
  const describe = (p: Price) =>
    [
      money(p.amount_cents, lang),
      t(`interval.${p.billing_interval}` as BillingKey),
      p.credits ? t("catalog.credits", { n: p.credits }) : null,
      p.validity_days ? t("catalog.validity", { n: p.validity_days }) : null,
      p.commitment_months ? t("catalog.commitment", { n: p.commitment_months }) : null,
      locName(p.location_id),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <TableWrap label={t("catalog.products")}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("catalog.col.name")}</th>
            <th scope="col">{t("catalog.col.kind")}</th>
            <th scope="col">{t("catalog.col.tax")}</th>
            <th scope="col">{t("catalog.col.prices")}</th>
            <th scope="col">{t("catalog.col.active")}</th>
          </tr>
        </thead>
        <tbody>
          {catalog.products.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.name}</th>
              <td>{t(`kind.${p.kind}` as BillingKey)}</td>
              <td>{t(`tax.${p.tax_category}` as BillingKey)}</td>
              <td>
                <ul className="billing-price-list">
                  {catalog.prices
                    .filter((pr) => pr.product_id === p.id)
                    .map((pr) => (
                      <li key={pr.id}>
                        <span className={pr.active ? undefined : "muted"}>
                          {describe(pr)}
                          {pr.active ? "" : ` (${t("catalog.inactive")})`}
                        </span>{" "}
                        <ToggleButton
                          label={`${p.name}: ${describe(pr)}`}
                          active={pr.active}
                          toggle={(api) => api.setPriceActive(pr.id, !pr.active)}
                          onDone={() => onChanged(t("catalog.toggled"))}
                        />
                      </li>
                    ))}
                </ul>
              </td>
              <td>
                <div className="row-actions">
                  <Plate tone={p.active ? "ok" : "neutral"}>{p.active ? "✓" : "—"}</Plate>
                  <ToggleButton
                    label={p.name}
                    active={p.active}
                    toggle={(api) => api.setProductActive(p.id, !p.active)}
                    onDone={() => onChanged(t("catalog.toggled"))}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function ToggleButton({
  label,
  active,
  toggle,
  onDone,
}: {
  label: string;
  active: boolean;
  toggle: (api: ReturnType<typeof useBillingApi>) => Promise<unknown>;
  onDone: () => void;
}) {
  const { t } = useBillingT();
  const bapi = useBillingApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await toggle(bapi);
            onDone();
          } catch (err) {
            setError(toErrorCode(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {active ? t("catalog.deactivate") : t("catalog.activate")}
        <span className="sr-only">: {label}</span>
      </button>
      {error ? <ErrorNote code={error} /> : null}
    </>
  );
}

function NewProductForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useBillingT();
  const bapi = useBillingApi();
  const [kind, setKind] = useState<ProductKind>("drop_in");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tax, setTax] = useState<Product["tax_category"]>("taxable");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { kind: useId(), name: useId(), desc: useId(), tax: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bapi.createProduct({
        kind,
        name: name.trim(),
        tax_category: tax,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setName("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.kind}>{t("catalog.kind")}</label>
          <select
            id={ids.kind}
            value={kind}
            onChange={(e) => setKind(e.target.value as ProductKind)}
          >
            {PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}` as BillingKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.name}>{t("catalog.name")}</label>
          <input
            id={ids.name}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.tax}>{t("catalog.tax")}</label>
          <select
            id={ids.tax}
            value={tax}
            onChange={(e) => setTax(e.target.value as Product["tax_category"])}
          >
            <option value="taxable">{t("tax.taxable")}</option>
            <option value="exempt">{t("tax.exempt")}</option>
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={ids.desc}>{t("catalog.description")}</label>
          <input
            id={ids.desc}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="billing-product-create"
        >
          {t("catalog.create")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function NewPriceForm({
  catalog,
  locations,
  onCreated,
}: {
  catalog: Catalog;
  locations: Location[];
  onCreated: () => void;
}) {
  const { t } = useBillingT();
  const { role } = useSession();
  const bapi = useBillingApi();
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setBillingInterval] = useState<Price["billing_interval"]>("month");
  const [credits, setCredits] = useState("");
  const [validity, setValidity] = useState("");
  const [commitment, setCommitment] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [bad, setBad] = useState(false);
  const ids = {
    product: useId(),
    loc: useId(),
    amount: useId(),
    interval: useId(),
    credits: useId(),
    validity: useId(),
    commitment: useId(),
    commitmentHelp: useId(),
  };
  const product = catalog.products.find((p) => p.id === (productId || catalog.products[0]?.id));
  const recurring = product?.kind === "membership" || product?.kind === "addon";
  const pack = product?.kind === "class_pack" || product?.kind === "pt_package";
  // Location managers price only their own locations; the owner may also price every location at once.
  const loc = locationId || (role === "owner" ? "" : (locations[0]?.id ?? ""));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(amount);
    setBad(cents === null);
    if (cents === null || !product) return;
    setBusy(true);
    setError(null);
    try {
      await bapi.createPrice({
        product_id: product.id,
        location_id: loc || null,
        amount_cents: cents,
        billing_interval: recurring ? interval : "none",
        credits: pack ? Number(credits) || null : null,
        validity_days: Number(validity) || null,
        commitment_months: recurring ? Number(commitment) || 0 : 0,
      });
      setAmount("");
      onCreated();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  if (catalog.products.length === 0) return <p className="muted">{t("catalog.none")}</p>;
  return (
    <form className="form" onSubmit={submit}>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.product}>{t("catalog.product")}</label>
          <select
            id={ids.product}
            value={product?.id ?? ""}
            onChange={(e) => setProductId(e.target.value)}
          >
            {catalog.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {t(`kind.${p.kind}` as BillingKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.loc}>{t("sell.location")}</label>
          <select id={ids.loc} value={loc} onChange={(e) => setLocationId(e.target.value)}>
            {role === "owner" ? <option value="">{t("catalog.allLocations")}</option> : null}
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.amount}>{t("catalog.amount")}</label>
          <input
            id={ids.amount}
            inputMode="decimal"
            required
            value={amount}
            aria-invalid={bad}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {recurring ? (
          <>
            <div className="field">
              <label htmlFor={ids.interval}>{t("catalog.interval")}</label>
              <select
                id={ids.interval}
                value={interval}
                onChange={(e) => setBillingInterval(e.target.value as Price["billing_interval"])}
              >
                <option value="month">{t("interval.month")}</option>
                <option value="year">{t("interval.year")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.commitment}>{t("catalog.commitmentLabel")}</label>
              <input
                id={ids.commitment}
                type="number"
                min={0}
                max={36}
                value={commitment}
                aria-describedby={ids.commitmentHelp}
                onChange={(e) => setCommitment(e.target.value)}
              />
              <p id={ids.commitmentHelp} className="help">
                {t("catalog.commitmentHelp")}
              </p>
            </div>
          </>
        ) : null}
        {pack ? (
          <div className="field">
            <label htmlFor={ids.credits}>{t("catalog.creditsLabel")}</label>
            <input
              id={ids.credits}
              type="number"
              min={1}
              max={500}
              required
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
          </div>
        ) : null}
        {!recurring ? (
          <div className="field">
            <label htmlFor={ids.validity}>{t("catalog.validityLabel")}</label>
            <input
              id={ids.validity}
              type="number"
              min={1}
              max={730}
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {bad ? <p className="field-error">{t("pay.badAmount")}</p> : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="billing-price-create"
        >
          {t("catalog.addPrice")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}
