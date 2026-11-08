import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading } from "../../components/ui";
import { ROUTES } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  BILLING_ICON,
  CYCLE_RUNNERS,
  FEE_READERS,
  InvoiceTable,
  Panel,
  SELLERS,
  SellForm,
  Stat,
  money,
  useBillingApi,
} from "./components";
import { useBillingT } from "./dict";

type Filter = "open" | "overdue" | "paid" | "all";

/** Staff "Facturación": quick "Cobrar sesión", open/overdue invoices with payments, and the renewal cycle. */
export function BillingScreen() {
  const { t, lang } = useBillingT();
  const { api, role } = useSession();
  const bapi = useBillingApi();
  const seller = SELLERS.includes(role ?? "");
  const [filter, setFilter] = useState<Filter>("open");
  const [locationId, setLocationId] = useState("");
  const [memberId, setMemberId] = useState("");
  const ids = { filter: useId(), loc: useId(), member: useId(), sell: useId() };

  const locations = useAsync(() => api.locations(), [api]);
  const members = useAsync(() => (seller ? api.members() : Promise.resolve(null)), [api, seller]);
  const catalog = useAsync(() => (seller ? bapi.catalog() : Promise.resolve(null)), [bapi, seller]);
  const invoices = useAsync(
    () =>
      bapi.invoices({
        status: filter === "all" ? undefined : filter === "overdue" ? "open" : filter,
        overdue: filter === "overdue",
        location_id: locationId || undefined,
      }),
    [bapi, filter, locationId],
  );
  const fees = useAsync(
    () => (FEE_READERS.includes(role ?? "") ? bapi.fees() : Promise.resolve(null)),
    [bapi, role],
  );
  const feeMap = useMemo(
    () =>
      fees.data
        ? new Map(fees.data.data.map((f) => [f.invoice_id, f.application_fee_cents]))
        : undefined,
    [fees.data],
  );
  const rows = invoices.data?.data ?? [];
  const outstanding = rows.reduce((s, i) => s + (i.status === "open" ? i.balance_cents : 0), 0);
  const overdue = rows.filter((i) => i.status === "open" && i.overdue).length;
  const memberList = members.data?.data ?? [];
  const chosenMember = memberList.find((m) => m.id === memberId);
  const locationName = locations.data?.data.find((l) => l.id === locationId)?.name;
  const dash = "—";

  return (
    <div className="page">
      <h1 className="page__title">{t("billing.title")}</h1>
      <p className="lede">{t("billing.lede")}</p>

      <div className="ds-stats billing-stats" aria-live="polite">
        <Stat
          icon="receipt"
          label={t("billing.stat.view")}
          value={invoices.data ? rows.length : dash}
          hint={`${t(`billing.filter.${filter}`)} · ${locationName ?? t("billing.allLocations")}`}
        />
        <Stat
          icon="coin"
          label={t("billing.stat.open")}
          value={invoices.data ? money(outstanding, lang) : dash}
          hint={t("billing.stat.openHint")}
        />
        <Stat
          icon={{ d: BILLING_ICON.alert }}
          label={t("billing.filter.overdue")}
          value={invoices.data ? overdue : dash}
          hint={t("billing.stat.overdueHint")}
        />
      </div>

      {seller ? (
        <Panel
          title={t("sell.title")}
          icon="coin"
          titleId={ids.sell}
          className="billing-quick"
          actions={<span className="ds-pill">{t("model.payPerSession")}</span>}
        >
          <div className="field billing-quick__member">
            <label htmlFor={ids.member}>{t("sell.member")}</label>
            <select
              id={ids.member}
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              data-tour-id="billing-quick-member"
            >
              <option value="">{t("sell.pickMember")}</option>
              {memberList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                  {m.member_no ? ` · ${m.member_no}` : ""}
                </option>
              ))}
            </select>
          </div>
          {memberId && catalog.data && locations.data ? (
            <SellForm
              key={memberId}
              memberId={memberId}
              catalog={catalog.data}
              locations={locations.data.data}
              defaultLocationId={chosenMember?.home_location_id}
              onSold={invoices.reload}
              tourId="billing-quick-charge"
            />
          ) : null}
          {memberId ? (
            <p className="billing-quick__link">
              <Link to={ROUTES.member(memberId)}>
                {chosenMember?.full_name}
                <Icon name="arrowRight" size={18} />
              </Link>
            </p>
          ) : null}
        </Panel>
      ) : null}

      {CYCLE_RUNNERS.includes(role ?? "") ? (
        <CyclePanel locationId={locationId} onDone={invoices.reload} />
      ) : null}

      <Panel title={t("inv.title")} icon="receipt">
        <div className="toolbar">
          <div className="field">
            <label htmlFor={ids.filter}>{t("billing.filter")}</label>
            <select
              id={ids.filter}
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              data-tour-id="billing-filter"
            >
              {(["open", "overdue", "paid", "all"] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`billing.filter.${f}`)}
                </option>
              ))}
            </select>
          </div>
          {(locations.data?.data.length ?? 0) > 1 ? (
            <div className="field">
              <label htmlFor={ids.loc}>{t("billing.location")}</label>
              <select
                id={ids.loc}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">{t("billing.allLocations")}</option>
                {locations.data?.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        {invoices.loading ? <Loading /> : null}
        {invoices.error ? <ErrorNote code={invoices.error} onRetry={invoices.reload} /> : null}
        {invoices.data ? (
          <InvoiceTable
            invoices={rows}
            canPay={seller}
            showMember
            fees={feeMap}
            onPaid={invoices.reload}
            label={t("inv.title")}
          />
        ) : null}
      </Panel>
    </div>
  );
}

function CyclePanel({ locationId, onDone }: { locationId: string; onDone: () => void }) {
  const { t } = useBillingT();
  const bapi = useBillingApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await bapi.runCycle(locationId ? { location_id: locationId } : {});
      setDone(
        t("billing.cycleDone", {
          renewed: r.renewed,
          invoices: r.invoices,
          cancelled: r.cancelled,
          pastDue: r.past_due_members,
        }),
      );
      setConfirming(false);
      onDone();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("billing.cycle")} icon="refresh">
      <p className="help">{t("billing.cycleHelp")}</p>
      <div className="form__actions">
        {!confirming ? (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirming(true)}
            data-tour-id="billing-cycle"
          >
            {t("billing.cycleRun")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={run}
              data-tour-id="billing-cycle-confirm"
            >
              {t("billing.cycleConfirm")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t("billing.cycleBack")}
            </button>
          </>
        )}
      </div>
      <LiveResult tone={done ? "ok" : undefined}>{done}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Panel>
  );
}
