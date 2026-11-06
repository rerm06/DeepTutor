import QRCode from "qrcode";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  type Asset,
  type AssetStatus,
  FLOOR_MANAGERS,
  type Issue,
  STATION_CODE,
  floorApi,
  normalizeCode,
} from "./api";
import { useFloorT } from "./dict";
import { assetTone, formatWhen } from "./shared";
import "./floor.css";
import { Card, Empty, FLOOR_ICON, Stat } from "./ui";

/** Staff "Equipos": equipment by location with status toggle, the issues queue and a printable code list. */
export function EquipmentScreen() {
  const { t } = useFloorT();
  const { api, role } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const manage = FLOOR_MANAGERS.includes(role ?? "");
  const [locationId, setLocationId] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const locations = useAsync(() => api.locations(), [api]);
  const assets = useAsync(() => floor.assets(locationId || undefined), [floor, locationId]);
  const filterId = useId();
  const newId = useId();
  const printId = useId();

  const locs = locations.data?.data ?? [];
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const rows = assets.data?.data ?? [];

  return (
    <div className="page floor-page">
      <div className="page__head">
        <div className="floor-head">
          <h1 className="page__title">{t("equipment.title")}</h1>
          <p className="lede">{t("equipment.lede")}</p>
        </div>
        <div className="row-actions">
          {manage ? (
            <button
              type="button"
              className="btn btn--primary"
              data-tour-id="floor-asset-new"
              aria-expanded={showNew}
              aria-controls={newId}
              onClick={() => setShowNew((v) => !v)}
            >
              <Icon d={FLOOR_ICON.plus} size={18} />
              {t("equipment.new")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            data-tour-id="floor-print-codes"
            aria-expanded={showPrint}
            aria-controls={printId}
            onClick={() => setShowPrint((v) => !v)}
          >
            <Icon name="qr" size={18} />
            {t("equipment.print")}
          </button>
        </div>
      </div>
      {assets.data ? (
        <div className="ds-stats">
          <Stat icon={{ name: "dumbbell" }} label={t("equipment.statTotal")} value={rows.length} />
          <Stat
            icon={{ name: "checkCircle" }}
            label={t("equipment.statOk")}
            value={rows.filter((a) => a.status === "ok").length}
          />
          <Stat
            icon={{ d: FLOOR_ICON.wrench }}
            label={t("equipment.statDown")}
            value={rows.filter((a) => a.status !== "ok").length}
          />
          <Stat
            icon={{ name: "bell" }}
            label={t("equipment.statIssues")}
            value={rows.reduce((n, a) => n + a.open_issues, 0)}
          />
        </div>
      ) : null}

      {manage && showNew ? (
        <div id={newId}>
          <NewAssetForm
            locations={locs}
            onCreated={(code) => {
              setAnnounce(t("equipment.created", { code }));
              assets.reload();
            }}
          />
        </div>
      ) : null}

      <LiveResult>{announce}</LiveResult>
      {showPrint && assets.data ? (
        <div id={printId}>
          <PrintList assets={rows} locName={locName} />
        </div>
      ) : null}

      <Card
        title={t("equipment.list")}
        icon={{ name: "dumbbell" }}
        actions={
          <div className="field field--inline">
            <label htmlFor={filterId}>{t("common.location")}</label>
            <select
              id={filterId}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              data-tour-id="floor-filter-location"
            >
              <option value="">{t("common.allLocations")}</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
        {assets.error ? <ErrorNote code={assets.error} onRetry={assets.reload} /> : null}
        {assets.loading ? <Loading /> : null}
        {assets.data ? (
          rows.length === 0 ? (
            <Empty icon={{ name: "dumbbell" }} text={t("common.empty")} />
          ) : (
            <TableWrap label={t("equipment.title")}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t("common.code")}</th>
                    <th scope="col">{t("common.type")}</th>
                    <th scope="col">{t("common.location")}</th>
                    <th scope="col">{t("equipment.brand")}</th>
                    <th scope="col">{t("equipment.openIssues")}</th>
                    <th scope="col">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <AssetRow
                      key={a.id}
                      asset={a}
                      locationName={locName.get(a.location_id) ?? ""}
                      manage={manage}
                      onChanged={(msg) => {
                        setAnnounce(msg);
                        assets.reload();
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )
        ) : null}
      </Card>

      <IssuesQueue
        locationId={locationId}
        canResolve={manage}
        onChanged={(msg) => {
          setAnnounce(msg);
          assets.reload();
        }}
      />
    </div>
  );
}

function AssetRow({
  asset,
  locationName,
  manage,
  onChanged,
}: {
  asset: Asset;
  locationName: string;
  manage: boolean;
  onChanged: (msg: string) => void;
}) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = useId();

  async function change(status: AssetStatus) {
    setBusy(true);
    setError(null);
    try {
      const r = await floor.setAssetStatus(asset.id, status);
      onChanged(
        t("equipment.statusSaved", { code: asset.station_code, status: label("status", r.status) }),
      );
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <th scope="row" className="mono">
        {asset.station_code}
      </th>
      <td>{label("eq", asset.equipment_type)}</td>
      <td>{locationName}</td>
      <td>{[asset.brand, asset.model].filter(Boolean).join(" · ") || "—"}</td>
      <td>
        {asset.open_issues > 0 ? (
          <span className="floor-count floor-count--warn">{asset.open_issues}</span>
        ) : (
          <span className="floor-count">{asset.open_issues}</span>
        )}
      </td>
      <td>
        {manage ? (
          <div className="field">
            <label htmlFor={selectId} className="sr-only">
              {t("equipment.statusFor", { code: asset.station_code })}
            </label>
            <select
              id={selectId}
              value={asset.status}
              disabled={busy}
              data-tour-id="floor-asset-status"
              onChange={(e) => change(e.target.value as AssetStatus)}
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label("status", s)}
                </option>
              ))}
            </select>
            {error ? <ErrorNote code={error} /> : null}
          </div>
        ) : (
          <Plate tone={assetTone(asset.status)}>{label("status", asset.status)}</Plate>
        )}
      </td>
    </tr>
  );
}

function NewAssetForm({
  locations,
  onCreated,
}: {
  locations: Location[];
  onCreated: (code: string) => void;
}) {
  const { t, label } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState<string>(ASSET_TYPES[0]);
  const [code, setCode] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = {
    loc: useId(),
    type: useId(),
    code: useId(),
    help: useId(),
    brand: useId(),
    model: useId(),
  };
  const loc = locationId || locations[0]?.id || "";
  const normalized = normalizeCode(code);
  const codeOk = code === "" || STATION_CODE.test(normalized);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!STATION_CODE.test(normalized) || !loc) {
      setError("invalid_input");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await floor.createAsset({
        location_id: loc,
        equipment_type: type,
        station_code: normalized,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
      });
      onCreated(normalized);
      setCode("");
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("equipment.new")} icon={{ d: FLOOR_ICON.plus }}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.loc}>{t("common.location")}</label>
            <select id={ids.loc} value={loc} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.type}>{t("common.type")}</label>
            <select id={ids.type} value={type} onChange={(e) => setType(e.target.value)}>
              {ASSET_TYPES.map((x) => (
                <option key={x} value={x}>
                  {label("eq", x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.code}>{t("common.code")}</label>
            <input
              id={ids.code}
              value={code}
              required
              maxLength={24}
              autoComplete="off"
              className="mono"
              aria-describedby={ids.help}
              aria-invalid={!codeOk}
              onChange={(e) => setCode(e.target.value)}
            />
            <p id={ids.help} className="help">
              {t("equipment.codeHelp")}
            </p>
          </div>
          <div className="field">
            <label htmlFor={ids.brand}>
              {t("equipment.brand")} <span className="muted">{t("common.optional")}</span>
            </label>
            <input
              id={ids.brand}
              value={brand}
              maxLength={80}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.model}>
              {t("equipment.model")} <span className="muted">{t("common.optional")}</span>
            </label>
            <input
              id={ids.model}
              value={model}
              maxLength={80}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>
        {error ? <ErrorNote code={error} /> : null}
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="floor-asset-save"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function IssuesQueue({
  locationId,
  canResolve,
  onChanged,
}: {
  locationId: string;
  canResolve: boolean;
  onChanged: (msg: string) => void;
}) {
  const { t, label, lang } = useFloorT();
  const { api } = useSession();
  const floor = useMemo(() => floorApi(api), [api]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const issues = useAsync(
    () => floor.issues(locationId || undefined, onlyOpen ? "reported" : undefined),
    [floor, locationId, onlyOpen],
  );
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filterId = useId();

  async function act(issue: Issue, action: "confirm" | "resolve") {
    setBusyId(issue.id);
    setError(null);
    try {
      if (action === "confirm") {
        await floor.confirm(issue.id);
        onChanged(t("issues.confirmed", { code: issue.station_code }));
      } else {
        const r = await floor.resolve(issue.id);
        onChanged(
          t("issues.resolved", {
            code: issue.station_code,
            status: label("status", r.asset_status),
          }),
        );
      }
      issues.reload();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusyId(null);
    }
  }

  const rows = issues.data?.data ?? [];
  return (
    <Card
      title={t("issues.title")}
      icon={{ d: FLOOR_ICON.wrench }}
      actions={
        <div className="field field--inline">
          <label htmlFor={filterId}>{t("issues.filter")}</label>
          <select
            id={filterId}
            value={onlyOpen ? "open" : "all"}
            onChange={(e) => setOnlyOpen(e.target.value === "open")}
          >
            <option value="open">{t("issues.open")}</option>
            <option value="all">{t("issues.all")}</option>
          </select>
        </div>
      }
    >
      {issues.error ? <ErrorNote code={issues.error} onRetry={issues.reload} /> : null}
      {error ? <ErrorNote code={error} /> : null}
      {issues.loading ? <Loading /> : null}
      {issues.data && rows.length === 0 ? (
        <Empty icon={{ name: "checkCircle" }} text={t("issues.empty")} />
      ) : null}
      {rows.length > 0 ? (
        <TableWrap label={t("issues.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("common.code")}</th>
                <th scope="col">{t("issues.kind")}</th>
                <th scope="col">{t("common.status")}</th>
                <th scope="col">{t("issues.when")}</th>
                <th scope="col">{t("issues.note")}</th>
                <th scope="col">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <th scope="row" className="mono">
                    {i.station_code}
                  </th>
                  <td>
                    <Plate tone={i.kind === "out_of_service" ? "blocked" : "warn"}>
                      {label("issue", i.kind)}
                    </Plate>
                  </td>
                  <td>
                    <Plate
                      tone={
                        i.status === "resolved"
                          ? "ok"
                          : i.status === "confirmed"
                            ? "blocked"
                            : "neutral"
                      }
                    >
                      {label("issueStatus", i.status)}
                    </Plate>
                  </td>
                  <td className="nowrap">{formatWhen(i.reported_at, lang)}</td>
                  <td>{i.note ?? "—"}</td>
                  <td>
                    <div className="row-actions">
                      {i.kind === "out_of_service" && i.status === "reported" ? (
                        <button
                          type="button"
                          className="btn btn--danger-outline"
                          disabled={busyId === i.id}
                          data-tour-id="floor-issue-confirm"
                          onClick={() => act(i, "confirm")}
                        >
                          {t("issues.confirm")}
                          <span className="sr-only">: {i.station_code}</span>
                        </button>
                      ) : null}
                      {canResolve && i.status !== "resolved" ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busyId === i.id}
                          data-tour-id="floor-issue-resolve"
                          onClick={() => act(i, "resolve")}
                        >
                          {t("issues.resolve")}
                          <span className="sr-only">: {i.station_code}</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </Card>
  );
}

/** Printable list: station code, type and an SVG QR (encodes only the code; no URL, no tracking). */
function PrintList({ assets, locName }: { assets: Asset[]; locName: Map<string, string> }) {
  const { t, label } = useFloorT();
  const [qr, setQr] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(
      assets.map(async (a) => {
        const svg = await QRCode.toString(a.station_code, { type: "svg", margin: 1 });
        return [
          a.station_code,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        ] as const;
      }),
    )
      .then((pairs) => {
        if (alive) setQr(Object.fromEntries(pairs));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [assets]);

  return (
    <section className="section floor-print" aria-label={t("equipment.printTitle")}>
      <div className="section__head">
        <h2 className="section__title">
          <Icon name="qr" size={24} className="floor-noprint" />
          {t("equipment.printTitle")}
        </h2>
        <div className="section__actions floor-noprint">
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <Icon d={FLOOR_ICON.printer} size={18} />
            {t("equipment.printNow")}
          </button>
        </div>
      </div>
      <ul className="floor-labels">
        {assets.map((a) => (
          <li key={a.id} className="floor-label">
            {qr[a.station_code] ? (
              <img
                src={qr[a.station_code]}
                width={96}
                height={96}
                alt={t("equipment.qrAlt", { code: a.station_code })}
              />
            ) : null}
            <span className="floor-label__code mono">{a.station_code}</span>
            <span>{label("eq", a.equipment_type)}</span>
            <span className="muted">{locName.get(a.location_id) ?? ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
