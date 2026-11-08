import { type FormEvent, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult, Loading, Plate } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { formatDateTime } from "../../lib/format";
import { ROUTES } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { CRM_ROUTES, Stat } from "./LeadsBoard";
import { TaskList } from "./Tasks";
import { ACTIVITY_KINDS, type Activity, type LeadDetail as LeadRecord, crmApi } from "./api";
import { useCrmT } from "./dict";
import { Avatar, CRM_D, CrmSection } from "./parts";
import "./crm.css";

export function LeadDetailScreen() {
  const { id = "" } = useParams();
  const { t, lang } = useCrmT();
  const { api } = useSession();
  const crm = useMemo(() => crmApi(api), [api]);
  const lead = useAsync(() => crm.lead(id), [crm, id]);
  const locations = useAsync(() => api.locations(), [api]);
  const [announce, setAnnounce] = useState<string | null>(null);
  const l = lead.data;
  const locName = locations.data?.data.find((x) => x.id === l?.location_id)?.name;

  return (
    <div className="page crm">
      <p className="crm-back">
        <Link to={CRM_ROUTES.leads} className="back-link">
          <Icon d="M19 12H5M11 6l-6 6 6 6" size={18} />
          {t("detail.back")}
        </Link>
      </p>
      <div className="crm-lead-head">
        {l ? <Avatar name={l.full_name} size="lg" /> : null}
        <div className="crm-head">
          <h1 className="page__title">{l ? l.full_name : t("detail.data")}</h1>
          {l ? (
            <p className="crm-lead-head__meta">
              <Plate tone={stageTone(l.stage)}>{t(`stage.${l.stage}`)}</Plate>
              <span className="crm-chip">
                <span className="sr-only">{t("leads.source")}: </span>
                {t(`source.${l.source}`)}
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <LiveResult>{announce}</LiveResult>
      {lead.loading ? <Loading /> : null}
      {lead.error ? <ErrorNote code={lead.error} onRetry={lead.reload} /> : null}
      {l ? (
        <>
          <div className="ds-stats">
            <Stat
              icon={<Icon d={CRM_D.activity} size={34} />}
              label={t("detail.stat.activities")}
              value={l.activities.length}
            />
            <Stat
              icon={<Icon d={CRM_D.clock} size={34} />}
              label={t("detail.stat.since")}
              value={
                <span className="crm-stat-text">{formatDateTime(l.stage_changed_at, lang)}</span>
              }
            />
            <Stat
              icon={<Icon name="calendar" size={34} />}
              label={t("detail.stat.created")}
              value={<span className="crm-stat-text">{formatDateTime(l.created_at, lang)}</span>}
            />
          </div>
          <div className="crm-detail">
            <CrmSection title={t("detail.data")} icon="doc">
              <dl className="facts">
                <div>
                  <dt>{t("detail.stage")}</dt>
                  <dd>
                    <Plate tone={stageTone(l.stage)}>{t(`stage.${l.stage}`)}</Plate>
                    {l.lost_reason ? <span className="cell-note">{l.lost_reason}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>{t("leads.source")}</dt>
                  <dd>{t(`source.${l.source}`)}</dd>
                </div>
                <div>
                  <dt>{t("form.location")}</dt>
                  <dd>{locName ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("leads.owner")}</dt>
                  <dd>{l.owner_name ?? t("leads.noOwner")}</dd>
                </div>
                <div>
                  <dt>{t("form.email")}</dt>
                  <dd className="mono">{l.email ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("form.phone")}</dt>
                  <dd className="mono">{l.phone ?? "—"}</dd>
                </div>
                {l.notes ? (
                  <div>
                    <dt>{t("form.notes")}</dt>
                    <dd>{l.notes}</dd>
                  </div>
                ) : null}
                {l.member_id ? (
                  <div>
                    <dt>{t("detail.member")}</dt>
                    <dd>
                      <Link to={ROUTES.member(l.member_id)}>{t("detail.openMember")}</Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="help">{t("form.consentNote")}</p>
            </CrmSection>

            {l.stage !== "won" ? (
              <ConvertPanel
                lead={l}
                onConverted={(msg) => {
                  setAnnounce(msg);
                  lead.reload();
                }}
              />
            ) : null}

            <CrmSection title={t("detail.timeline")} icon="chat">
              <AddActivity
                leadId={l.id}
                onAdded={(msg) => {
                  setAnnounce(msg);
                  lead.reload();
                }}
              />
              <Timeline activities={l.activities} lang={lang} />
            </CrmSection>

            <TaskList
              title={t("nav.tasks")}
              filter={{ leadId: l.id }}
              create={{ locationId: l.location_id, leadId: l.id }}
              level={2}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

const stageTone = (s: LeadRecord["stage"]) =>
  s === "won"
    ? "ok"
    : s === "lost"
      ? "blocked"
      : s === "trial" || s === "tour_booked"
        ? "warn"
        : "neutral";

function Timeline({ activities, lang }: { activities: Activity[]; lang: "es" | "en" }) {
  const { t } = useCrmT();
  if (activities.length === 0)
    return (
      <div className="ds-empty">
        <Icon name="chat" size={36} />
        <strong>{t("detail.timelineEmpty")}</strong>
      </div>
    );
  return (
    <ol className="crm-timeline" data-tour-id="crm-timeline">
      {activities.map((a) => (
        <li key={a.id} className={`crm-timeline__item crm-timeline__item--${a.kind}`}>
          <p className="crm-timeline__head">
            <strong>{t(`kind.${a.kind}`)}</strong>{" "}
            <time dateTime={a.at} className="muted">
              {formatDateTime(a.at, lang)}
            </time>
            {a.by_name ? (
              <span className="muted"> · {t("detail.by", { name: a.by_name })}</span>
            ) : null}
          </p>
          {a.kind === "stage_change" && a.from_stage && a.to_stage ? (
            <p>
              {t("detail.stageChange", {
                from: t(`stage.${a.from_stage}`),
                to: t(`stage.${a.to_stage}`),
              })}
            </p>
          ) : null}
          {a.body ? <p className="crm-timeline__body">{a.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function AddActivity({ leadId, onAdded }: { leadId: string; onAdded: (msg: string) => void }) {
  const { t } = useCrmT();
  const { api } = useSession();
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>("note");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const ids = { kind: useId(), body: useId(), title: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await crmApi(api).addActivity(leadId, kind, body.trim());
      setBody("");
      onAdded(t("detail.added"));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form crm-subform" onSubmit={submit} aria-labelledby={ids.title}>
      <h3 id={ids.title} className="form__title">
        {t("detail.addActivity")}
      </h3>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.kind}>{t("detail.kind")}</label>
          <select
            id={ids.kind}
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof ACTIVITY_KINDS)[number])}
            data-tour-id="crm-activity-kind"
          >
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor={ids.body}>{t("detail.body")}</label>
          <textarea
            id={ids.body}
            rows={2}
            maxLength={2000}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !body.trim()}
          data-tour-id="crm-activity-add"
        >
          {t("detail.addSubmit")}
        </button>
      </div>
      {error ? <ErrorNote code={error} /> : null}
    </form>
  );
}

function ConvertPanel({
  lead,
  onConverted,
}: { lead: LeadRecord; onConverted: (msg: string) => void }) {
  const { t } = useCrmT();
  const common = useI18n();
  const { api } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const helpId = useId();

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      await crmApi(api).convert(lead.id);
      setConfirming(false);
      onConverted(t("detail.converted", { name: lead.full_name }));
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmSection title={t("detail.convert")} icon="userPlus">
      <p id={helpId} className="help">
        {t("detail.convertHelp")}
      </p>
      {!lead.email ? <p className="note note--warn">{t("detail.convertNeedsEmail")}</p> : null}
      <div className="form__actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              aria-describedby={helpId}
              onClick={convert}
              data-tour-id="crm-lead-convert-confirm"
            >
              {busy ? t("detail.converting") : t("detail.convertConfirm", { name: lead.full_name })}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
              {common.t("common.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ds-cta"
            disabled={!lead.email}
            aria-describedby={helpId}
            onClick={() => setConfirming(true)}
            data-tour-id="crm-lead-convert"
          >
            <Icon name="userPlus" size={20} />
            {t("detail.convert")}
          </button>
        )}
      </div>
      {error === "conflict" ? (
        <p className="note note--warn" role="alert">
          {t("detail.alreadyConverted")}
        </p>
      ) : error ? (
        <ErrorNote code={error} />
      ) : null}
    </CrmSection>
  );
}
