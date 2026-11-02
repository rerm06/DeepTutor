import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { Location } from "../../api/types";
import { ErrorNote, LiveResult, Loading, Plate, Section, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type Product, canManage, errorKey, useStoreApi } from "./api";
import { type StoreKey, useStoreT } from "./dict";

/** Levels per location, low-stock list; owner and location managers also receive, adjust and transfer. */
export function InventoryScreen() {
  const { t } = useStoreT();
  const { api, role } = useSession();
  const store = useStoreApi();
  const manage = canManage(role);
  const locations = useAsync(() => api.locations(), [api]);
  const products = useAsync(() => store.products(), [store]);
  const [locationId, setLocationId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [version, setVersion] = useState(0);
  const [announce, setAnnounce] = useState<string | null>(null);
  const levels = useAsync(
    () => store.inventory(locationId || undefined, lowOnly),
    [store, locationId, lowOnly, version],
  );
  const ids = { loc: useId(), low: useId() };
  const locs = locations.data?.data ?? [];
  const locName = new Map(locs.map((l) => [l.id, l.name]));
  const done = () => {
    setAnnounce(t("inv.saved"));
    setVersion((v) => v + 1);
  };

  return (
    <div className="page">
      <h1 className="page__title">{t("inv.title")}</h1>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      <div className="toolbar">
        <div className="field">
          <label htmlFor={ids.loc}>{t("location")}</label>
          <select
            id={ids.loc}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            data-tour-id="store-inv-location"
          >
            <option value="">{t("sales.all")}</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="store-check">
          <input
            id={ids.low}
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            data-tour-id="store-inv-low"
          />
          <label htmlFor={ids.low}>{t("inv.lowOnly")}</label>
        </div>
      </div>

      {levels.loading ? <Loading /> : null}
      {levels.error ? <ErrorNote code={levels.error} onRetry={levels.reload} /> : null}
      {levels.data && levels.data.data.length === 0 ? (
        <p className="muted">{t("inv.empty")}</p>
      ) : null}
      {levels.data && levels.data.data.length > 0 ? (
        <TableWrap label={t("inv.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("product")}</th>
                <th scope="col">{t("sku")}</th>
                <th scope="col">{t("location")}</th>
                <th scope="col">{t("inv.onHand")}</th>
                <th scope="col">{t("inv.reserved")}</th>
                <th scope="col">{t("available")}</th>
                <th scope="col">{t("inv.reorder")}</th>
                <th scope="col">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {levels.data.data.map((r) => (
                <tr key={`${r.product_id}-${r.location_id}`}>
                  <th scope="row">{r.name}</th>
                  <td className="mono">{r.sku}</td>
                  <td>{locName.get(r.location_id) ?? ""}</td>
                  <td className="mono">{r.on_hand}</td>
                  <td className="mono">{r.reserved}</td>
                  <td className="mono">{r.available}</td>
                  <td className="mono">{r.reorder_point}</td>
                  <td>
                    <Plate tone={r.low ? "warn" : "ok"}>{r.low ? t("inv.low") : t("inv.ok")}</Plate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {manage ? (
        <StockForms locations={locs} products={products.data?.data ?? []} onDone={done} />
      ) : (
        <p className="muted">{t("inv.readOnly")}</p>
      )}
    </div>
  );
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StoreKey | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
      return true;
    } catch (err) {
      setError(errorKey(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function Picks({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder: string;
}) {
  return (
    <select id={id} required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function StockForms({
  locations,
  products,
  onDone,
}: {
  locations: Location[];
  products: Product[];
  onDone: () => void;
}) {
  const { t } = useStoreT();
  const store = useStoreApi();
  const prodOpts = products.map((p) => ({ id: p.id, name: `${p.name} (${p.sku})` }));
  const first = locations[0]?.id ?? "";
  const ph = t("inv.choose");

  // Receive
  const rcv = useAction(onDone);
  const [r, setR] = useState({ loc: "", product: "", qty: "1", ref: "" });
  // Adjust
  const adj = useAction(onDone);
  const [a, setA] = useState({ loc: "", product: "", delta: "-1", reason: "" });
  // Transfer
  const trf = useAction(onDone);
  const [tr, setTr] = useState({ from: "", to: "", product: "", qty: "1", note: "" });
  // Reorder point
  const ro = useAction(onDone);
  const [o, setO] = useState({ loc: "", product: "", point: "0" });
  useEffect(() => {
    if (!first) return;
    setR((v) => (v.loc ? v : { ...v, loc: first }));
    setA((v) => (v.loc ? v : { ...v, loc: first }));
    setTr((v) => (v.from ? v : { ...v, from: first }));
    setO((v) => (v.loc ? v : { ...v, loc: first }));
  }, [first]);
  const ids = {
    rLoc: useId(),
    rProd: useId(),
    rQty: useId(),
    rRef: useId(),
    aLoc: useId(),
    aProd: useId(),
    aDelta: useId(),
    aReason: useId(),
    tFrom: useId(),
    tTo: useId(),
    tProd: useId(),
    tQty: useId(),
    tNote: useId(),
    oLoc: useId(),
    oProd: useId(),
    oPoint: useId(),
  };
  const destinations = locations.filter((l) => l.id !== tr.from);
  const err = (e: StoreKey | null) =>
    e ? (
      <p className="note note--error" role="alert">
        {t(e)}
      </p>
    ) : null;

  return (
    <>
      <Section title={t("inv.receive")} level={2}>
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void rcv.run(() =>
              store.receive({
                location_id: r.loc,
                product_id: r.product,
                qty: Number(r.qty),
                ...(r.ref.trim() ? { ref: r.ref.trim() } : {}),
              }),
            );
          }}
        >
          <div className="form__grid">
            <Field id={ids.rLoc} label={t("location")}>
              <Picks
                id={ids.rLoc}
                value={r.loc}
                onChange={(v) => setR({ ...r, loc: v })}
                options={locations}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.rProd} label={t("product")}>
              <Picks
                id={ids.rProd}
                value={r.product}
                onChange={(v) => setR({ ...r, product: v })}
                options={prodOpts}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.rQty} label={t("qty")}>
              <input
                id={ids.rQty}
                type="number"
                min={1}
                max={100000}
                required
                value={r.qty}
                onChange={(e) => setR({ ...r, qty: e.target.value })}
              />
            </Field>
            <Field id={ids.rRef} label={t("inv.ref")}>
              <input
                id={ids.rRef}
                maxLength={60}
                pattern="[A-Za-z0-9 ._/#\-]{1,60}"
                value={r.ref}
                onChange={(e) => setR({ ...r, ref: e.target.value })}
              />
            </Field>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={rcv.busy}
              data-tour-id="store-inv-receive"
            >
              {t("inv.receive")}
            </button>
          </div>
          {err(rcv.error)}
        </form>
      </Section>

      <Section title={t("inv.adjust")} level={2}>
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void adj.run(() =>
              store.adjust({
                location_id: a.loc,
                product_id: a.product,
                delta: Number(a.delta),
                reason: a.reason.trim(),
              }),
            );
          }}
        >
          <div className="form__grid">
            <Field id={ids.aLoc} label={t("location")}>
              <Picks
                id={ids.aLoc}
                value={a.loc}
                onChange={(v) => setA({ ...a, loc: v })}
                options={locations}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.aProd} label={t("product")}>
              <Picks
                id={ids.aProd}
                value={a.product}
                onChange={(v) => setA({ ...a, product: v })}
                options={prodOpts}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.aDelta} label={t("inv.delta")}>
              <input
                id={ids.aDelta}
                type="number"
                min={-100000}
                max={100000}
                required
                value={a.delta}
                onChange={(e) => setA({ ...a, delta: e.target.value })}
              />
            </Field>
            <Field id={ids.aReason} label={t("inv.reason")}>
              <input
                id={ids.aReason}
                required
                minLength={3}
                maxLength={200}
                value={a.reason}
                onChange={(e) => setA({ ...a, reason: e.target.value })}
              />
            </Field>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={adj.busy}
              data-tour-id="store-inv-adjust"
            >
              {t("inv.adjust")}
            </button>
          </div>
          {err(adj.error)}
        </form>
      </Section>

      <Section title={t("inv.transfer")} level={2}>
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void trf.run(() =>
              store.transfer({
                from_location_id: tr.from,
                to_location_id: tr.to,
                lines: [{ product_id: tr.product, qty: Number(tr.qty) }],
                ...(tr.note.trim() ? { note: tr.note.trim() } : {}),
              }),
            );
          }}
        >
          {destinations.length === 0 ? <p className="muted">{t("inv.noDestination")}</p> : null}
          <div className="form__grid">
            <Field id={ids.tFrom} label={t("inv.from")}>
              <Picks
                id={ids.tFrom}
                value={tr.from}
                onChange={(v) => setTr({ ...tr, from: v, to: "" })}
                options={locations}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.tTo} label={t("inv.to")}>
              <Picks
                id={ids.tTo}
                value={tr.to}
                onChange={(v) => setTr({ ...tr, to: v })}
                options={destinations}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.tProd} label={t("product")}>
              <Picks
                id={ids.tProd}
                value={tr.product}
                onChange={(v) => setTr({ ...tr, product: v })}
                options={prodOpts}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.tQty} label={t("qty")}>
              <input
                id={ids.tQty}
                type="number"
                min={1}
                max={999}
                required
                value={tr.qty}
                onChange={(e) => setTr({ ...tr, qty: e.target.value })}
              />
            </Field>
            <Field id={ids.tNote} label={t("inv.note")}>
              <input
                id={ids.tNote}
                maxLength={200}
                value={tr.note}
                onChange={(e) => setTr({ ...tr, note: e.target.value })}
              />
            </Field>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={trf.busy || destinations.length === 0}
              data-tour-id="store-inv-transfer"
            >
              {t("inv.transfer")}
            </button>
          </div>
          {err(trf.error)}
        </form>
      </Section>

      <Section title={t("inv.setReorder")} level={2}>
        <form
          className="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void ro.run(() =>
              store.reorderPoint({
                location_id: o.loc,
                product_id: o.product,
                reorder_point: Number(o.point),
              }),
            );
          }}
        >
          <div className="form__grid">
            <Field id={ids.oLoc} label={t("location")}>
              <Picks
                id={ids.oLoc}
                value={o.loc}
                onChange={(v) => setO({ ...o, loc: v })}
                options={locations}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.oProd} label={t("product")}>
              <Picks
                id={ids.oProd}
                value={o.product}
                onChange={(v) => setO({ ...o, product: v })}
                options={prodOpts}
                placeholder={ph}
              />
            </Field>
            <Field id={ids.oPoint} label={t("inv.reorder")}>
              <input
                id={ids.oPoint}
                type="number"
                min={0}
                max={100000}
                required
                value={o.point}
                onChange={(e) => setO({ ...o, point: e.target.value })}
              />
            </Field>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={ro.busy}
              data-tour-id="store-inv-reorder"
            >
              {t("inv.submit")}
            </button>
          </div>
          {err(ro.error)}
        </form>
      </Section>
    </>
  );
}
