import { type FormEvent, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading, Plate, Section } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { formatDateTime } from "../../lib/format";
import { ROUTES } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { CRM_ROUTES } from "./LeadsBoard";
import { TaskList } from "./Tasks";
import { ACTIVITY_KINDS, type Activity, type LeadDetail as LeadRecord, crmApi } from "./api";
import { useCrmT } from "./dict";
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
    <div className="page">
      <p>
        <Link to={CRM_ROUTES.leads} className="back-link">
          {t("detail.back")}
        </Link>
      </p>
      <h1 className="page__title">{l ? l.full_name : t("detail.data")}</h1>
      <LiveResult>{announce}</LiveResult>
      {lead.loading ? <Loading /> : null}
      {lead.error ? <ErrorNote code={lead.error} onRetry={lead.reload} /> : null}
      {l ? (
        <>
          <Section title={t("detail.data")}>
            <dl className="facts">
              <div>
                <dt>{t("detail.stage")}</dt>
                <dd>
                  <Plate
                    tone={l.stage === "won" ? "ok" : l.stage === "lost" ? "blocked" : "neutral"}
                  >
                    {t(`stage.${l.stage}`)}
                  </Plate>
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
          </Section>

          {l.stage !== "won" ? (
            <ConvertPanel
              lead={l}
              onConverted={(msg) => {
                setAnnounce(msg);
                lead.reload();
              }}
            />
          ) : null}

          <Section title={t("detail.timeline")}>
            <AddActivity
              leadId={l.id}
              onAdded={(msg) => {
                setAnnounce(msg);
                lead.reload();
              }}
            />
            <Timeline activities={l.activities} lang={lang} />
          </Section>

          <TaskList
            title={t("nav.tasks")}
            filter={{ leadId: l.id }}
            create={{ locationId: l.location_id, leadId: l.id }}
            level={2}
          />
        </>
      ) : null}
    </div>
  );
}

function Timeline({ activities, lang }: { activities: Activity[]; lang: "es" | "en" }) {
  const { t } = useCrmT();
  if (activities.length === 0) return <p className="muted">{t("detail.timelineEmpty")}</p>;
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
    <form className="form form--boxed" onSubmit={submit} aria-labelledby={ids.title}>
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
    <Section title={t("detail.convert")}>
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
            className="btn btn--primary"
            disabled={!lead.email}
            aria-describedby={helpId}
            onClick={() => setConfirming(true)}
            data-tour-id="crm-lead-convert"
          >
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
    </Section>
  );
}
