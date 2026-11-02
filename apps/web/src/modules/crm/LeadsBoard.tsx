import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Location } from "../../api/types";
import { ErrorNote, LiveResult, Loading } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  type Lead,
  type LeadSource,
  type LeadStage,
  MANUAL_STAGES,
  type StaffOption,
  crmApi,
} from "./api";
import { useCrmT } from "./dict";
import "./crm.css";

export const CRM_ROUTES = {
  leads: "/staff/crm/leads",
  lead: (id: string) => `/staff/crm/leads/${encodeURIComponent(id)}`,
  tasks: "/staff/crm/tasks",
  funnel: "/staff/crm/funnel",
} as const;

/** Pipeline board: one column per stage. Moving a lead uses a labelled select + button (keyboard, no drag). */
export function LeadsBoard() {
  const { t } = useCrmT();
  const common = useI18n();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const [locationId, setLocationId] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const locations = useAsync(() => api.locations(), [api]);
  const leads = useAsync(() => crm.leads(locationId || undefined), [crm, locationId]);
  const filterId = useId();
  const newFormId = useId();
  const locs = locations.data?.data ?? [];
  const rows = leads.data?.data ?? [];

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">{t("leads.title")}</h1>
        <button
          type="button"
          className="btn btn--primary"
          data-tour-id="crm-lead-new"
          aria-expanded={showNew}
          aria-controls={newFormId}
          onClick={() => setShowNew((v) => !v)}
        >
          {t("leads.new")}
        </button>
      </div>
      <p className="lede">{t("leads.lede")}</p>

      {showNew ? (
        <div id={newFormId}>
          <NewLeadForm
            locations={locs}
            onCreated={(msg) => {
              setAnnounce(msg);
              leads.reload();
            }}
          />
        </div>
      ) : null}

      <div className="toolbar">
        <div className="field">
          <label htmlFor={filterId}>{t("leads.filterLocation")}</label>
          <select
            id={filterId}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            data-tour-id="crm-lead-filter-location"
          >
            <option value="">{common.t("common.all")}</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <LiveResult>{announce}</LiveResult>
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
      {leads.error ? <ErrorNote code={leads.error} onRetry={leads.reload} /> : null}
      {leads.loading ? <Loading /> : null}
      {leads.data ? (
        <>
          <p className="muted">{t("leads.count", { n: rows.length })}</p>
          <div className="crm-board" data-tour-id="crm-board">
            {LEAD_STAGES.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                leads={rows.filter((l) => l.stage === stage)}
                onMoved={(msg) => {
                  setAnnounce(msg);
                  leads.reload();
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onMoved,
}: {
  stage: LeadStage;
  leads: Lead[];
  onMoved: (msg: string) => void;
}) {
  const { t } = useCrmT();
  const headingId = useId();
  return (
    <section className={`crm-col crm-col--${stage}`} aria-labelledby={headingId}>
      <h2 id={headingId} className="crm-col__title">
        {t(`stage.${stage}`)} <span className="crm-col__count">({leads.length})</span>
      </h2>
      {leads.length === 0 ? (
        <p className="muted crm-col__empty">{t("leads.empty")}</p>
      ) : (
        <ul
          className="crm-cards"
          aria-label={t("leads.columnLabel", { stage: t(`stage.${stage}`), n: leads.length })}
        >
          {leads.map((l) => (
            <li key={l.id}>
              <LeadCard lead={l} onMoved={onMoved} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeadCard({ lead, onMoved }: { lead: Lead; onMoved: (msg: string) => void }) {
  const { t, lang } = useCrmT();
  const { api } = useSession();
  const [target, setTarget] = useState<LeadStage>(lead.stage);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { stage: useId(), reason: useId(), help: useId() };
  const needsReason = target === "lost" && lead.stage !== "lost";
  const canMove = lead.stage !== "won" && target !== lead.stage && (!needsReason || reason.trim());

  async function move(e: FormEvent) {
    e.preventDefault();
    if (!canMove || target === "won") return;
    setBusy(true);
    setError(null);
    try {
      await crmApi(api).updateLead(lead.id, {
        stage: target,
        ...(target === "lost" ? { lost_reason: reason.trim() } : {}),
      });
      onMoved(t("leads.moved", { name: lead.full_name, stage: t(`stage.${target}`) }));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="crm-card">
      <h3 className="crm-card__name">
        <Link to={CRM_ROUTES.lead(lead.id)} aria-label={t("leads.open", { name: lead.full_name })}>
          {lead.full_name}
        </Link>
      </h3>
      <p className="crm-card__meta">
        <span>
          {t("leads.source")}: {t(`source.${lead.source}`)}
        </span>
        <span>
          {t("leads.owner")}: {lead.owner_name ?? t("leads.noOwner")}
        </span>
        <span className="muted">
          {t("leads.since", { when: formatDateTime(lead.stage_changed_at, lang) })}
        </span>
        {lead.lost_reason ? <span className="muted">{lead.lost_reason}</span> : null}
      </p>
      {lead.stage !== "won" ? (
        <form className="crm-move" onSubmit={move}>
          <div className="field">
            <label htmlFor={ids.stage}>{t("leads.moveTo")}</label>
            <select
              id={ids.stage}
              value={target}
              data-tour-id="crm-lead-stage"
              onChange={(e) => setTarget(e.target.value as LeadStage)}
            >
              {MANUAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`stage.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {needsReason ? (
            <div className="field">
              <label htmlFor={ids.reason}>{t("leads.lostReason")}</label>
              <input
                id={ids.reason}
                type="text"
                maxLength={300}
                required
                aria-describedby={ids.help}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p id={ids.help} className="help">
                {t("leads.lostReasonHelp")}
              </p>
            </div>
          ) : null}
          <button
            type="submit"
            className="btn btn--ghost"
            disabled={busy || !canMove}
            data-tour-id="crm-lead-move"
          >
            {t("leads.move")}
          </button>
          {error ? <ErrorNote code={error} /> : null}
        </form>
      ) : null}
    </article>
  );
}

export function NewLeadForm({
  locations,
  onCreated,
}: {
  locations: Location[];
  onCreated: (msg: string) => void;
}) {
  const { t } = useCrmT();
  const common = useI18n();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [source, setSource] = useState<LeadSource>("walk_in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [missing, setMissing] = useState(false);
  const base = useId();
  const id = (s: string) => `${base}-${s}`;

  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locationId, locations]);
  useEffect(() => {
    if (!locationId) return;
    let alive = true;
    crm
      .staff(locationId, "lead")
      .then((r) => alive && setStaff(r.data))
      .catch(() => alive && setStaff([]));
    return () => {
      alive = false;
    };
  }, [crm, locationId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBusy(true);
    setError(null);
    try {
      await crm.createLead({
        location_id: locationId,
        source,
        full_name: fullName.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(owner ? { owner_staff_id: owner } : {}),
      });
      setFullName("");
      setEmail("");
      setPhone("");
      setNotes("");
      onCreated(t("form.created"));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form form--boxed" onSubmit={submit} noValidate aria-labelledby={id("title")}>
      <h2 id={id("title")} className="form__title">
        {t("form.title")}
      </h2>
      <p className="note note--warn" id={id("consent")} data-tour-id="crm-consent-note">
        {t("form.consentNote")}
      </p>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={id("loc")}>{t("form.location")}</label>
          <select id={id("loc")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("src")}>{t("form.source")}</label>
          <select
            id={id("src")}
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSource)}
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={id("name")}>
            {t("form.fullName")} {common.t("common.required")}
          </label>
          <input
            id={id("name")}
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            data-tour-id="crm-lead-name"
          />
        </div>
        <div className="field">
          <label htmlFor={id("email")}>{t("form.email")}</label>
          <input
            id={id("email")}
            type="email"
            maxLength={254}
            autoComplete="off"
            aria-describedby={id("contact")}
            aria-invalid={missing}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id("phone")}>{t("form.phone")}</label>
          <input
            id={id("phone")}
            type="tel"
            maxLength={20}
            autoComplete="off"
            aria-describedby={id("contact")}
            aria-invalid={missing}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={id("owner")}>
            {t("form.owner")} {common.t("common.optional")}
          </label>
          <select id={id("owner")} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t("leads.noOwner")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={id("notes")}>
            {t("form.notes")} {common.t("common.optional")}
          </label>
          <textarea
            id={id("notes")}
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <p id={id("contact")} className="help">
        {t("form.contactHelp")}
      </p>
      {missing ? (
        <p className="field-error" role="alert">
          {t("form.needContact")}
        </p>
      ) : null}
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !fullName.trim() || !locationId}
          data-tour-id="crm-lead-save"
        >
          {busy ? t("form.saving") : t("form.submit")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}
