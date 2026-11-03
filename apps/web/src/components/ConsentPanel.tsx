import { type FormEvent, useEffect, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";
import {
  CHANNELS,
  type Channel,
  type Consent,
  type ConsentSource,
  PURPOSES,
  type Purpose,
} from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { formatDateTime, shortId } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Card, GoldIcon, useCoreCopy } from "../screens/kit";
import { useSession } from "../session/SessionContext";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap } from "./ui";

export interface BrandOption {
  id: string;
  label: string;
}

/**
 * Consents of one member for one brand: channel × purpose with status, source and date; grant (with
 * evidence), revoke and brand-wide opt-out. Staff record with source front_desk/web_form, members and
 * guardians with member_portal (contract).
 */
export function ConsentPanel({
  memberId,
  brands,
  mode,
  canEdit,
  onChanged,
}: {
  memberId: string;
  brands: BrandOption[];
  mode: "staff" | "member";
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t, tv, lang } = useI18n();
  const copy = useCoreCopy();
  const { api } = useSession();
  const consents = useAsync(() => api.consents(memberId), [api, memberId]);

  // Brands come from the member's location and from any consent row already on file.
  const all: BrandOption[] = [...brands];
  for (const r of consents.data?.data ?? [])
    if (!all.some((b) => b.id === r.brand_id))
      all.push({ id: r.brand_id, label: `${t("consent.brand")} ${shortId(r.brand_id)}` });

  const [brandId, setBrandId] = useState("");
  const firstBrand = all[0]?.id ?? "";
  useEffect(() => {
    if (!brandId && firstBrand) setBrandId(firstBrand);
  }, [brandId, firstBrand]);

  const [announce, setAnnounce] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const brandSelectId = useId();

  const rows = (consents.data?.data ?? []).filter((c) => c.brand_id === brandId);
  const find = (ch: Channel, p: Purpose): Consent | undefined =>
    rows.find((r) => r.channel === ch && r.purpose === p);
  const grantedCount = rows.filter((r) => r.status === "granted").length;
  const revokedCount = rows.length - grantedCount;

  const label = (ch: Channel, p: Purpose) => ({
    channel: tv("channel", ch),
    purpose: tv("purpose", p),
  });

  async function change(
    ch: Channel,
    p: Purpose,
    granted: boolean,
    source: ConsentSource,
    evidence?: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setAnnounce(null);
    try {
      await api.setConsent(memberId, {
        brand_id: brandId,
        channel: ch,
        purpose: p,
        granted,
        source,
        ...(evidence ? { evidence } : {}),
      });
      setAnnounce(t(granted ? "consent.granted" : "consent.revoked", label(ch, p)));
      consents.reload();
      onChanged?.();
      return true;
    } catch (err) {
      setError(toErrorCode(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const revokeSource: ConsentSource = mode === "member" ? "member_portal" : "front_desk";

  return (
    <Card icon="shield" title={t("consent.title")}>
      {all.length === 0 && !consents.loading ? (
        <p className="muted">{t("consent.noBrand")}</p>
      ) : null}
      {all.length > 1 ? (
        <div className="field field--inline">
          <label htmlFor={brandSelectId}>{t("consent.brand")}</label>
          <select id={brandSelectId} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {all.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      ) : all[0] ? (
        <p className="core-brand">
          <span className="muted">{t("consent.brand")}:</span>{" "}
          <span className="ds-pill">{all[0].label}</span>
        </p>
      ) : null}
      {brandId && consents.data ? (
        <p className="core-counts">
          <Plate tone="ok">
            {grantedCount} {copy("consent.granted")}
          </Plate>
          <Plate tone={revokedCount ? "blocked" : "neutral"}>
            {revokedCount} {copy("consent.revoked")}
          </Plate>
        </p>
      ) : null}

      {consents.loading ? <Loading /> : null}
      {consents.error ? <ErrorNote code={consents.error} onRetry={consents.reload} /> : null}
      {!canEdit ? <p className="muted">{t("consent.readOnly")}</p> : null}

      {brandId ? (
        <TableWrap label={t("consent.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("consent.col.channel")}</th>
                <th scope="col">{t("consent.col.purpose")}</th>
                <th scope="col">{t("consent.col.status")}</th>
                <th scope="col">{t("consent.col.source")}</th>
                <th scope="col">{t("consent.col.date")}</th>
                {canEdit ? <th scope="col">{t("consent.col.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {CHANNELS.flatMap((ch) =>
                PURPOSES.map((p) => {
                  const c = find(ch, p);
                  const granted = c?.status === "granted";
                  const date = granted ? c?.granted_at : (c?.revoked_at ?? c?.updated_at);
                  return (
                    <tr key={`${ch}-${p}`}>
                      <th scope="row">{tv("channel", ch)}</th>
                      <td>{tv("purpose", p)}</td>
                      <td>
                        {c ? (
                          <Plate tone={granted ? "ok" : "blocked"}>
                            {tv("consent.status", c.status)}
                          </Plate>
                        ) : (
                          <Plate tone="neutral">{t("consent.status.none")}</Plate>
                        )}
                      </td>
                      <td>{c ? tv("source", c.source) : t("common.none")}</td>
                      <td className="nowrap">
                        {c ? formatDateTime(date, lang) : t("common.none")}
                      </td>
                      {canEdit ? (
                        <td>
                          {granted ? (
                            <button
                              type="button"
                              className="btn"
                              data-tour-id="consent-revoke"
                              disabled={busy}
                              onClick={() => change(ch, p, false, revokeSource)}
                            >
                              {t("consent.revoke")}
                              <span className="sr-only">
                                : {t("consent.revokeFor", label(ch, p))}
                              </span>
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}

      {canEdit && brandId ? (
        <>
          <GrantForm
            mode={mode}
            busy={busy}
            onGrant={(ch, p, source, evidence) => change(ch, p, true, source, evidence)}
          />
          <OptOut
            mode={mode}
            onConfirm={async () => {
              setBusy(true);
              setError(null);
              setAnnounce(null);
              try {
                const res = await api.optOut(memberId, brandId, revokeSource);
                setAnnounce(t("optout.done", { n: Number(res?.revoked ?? 0) }));
                consents.reload();
                onChanged?.();
              } catch (err) {
                setError(toErrorCode(err));
              } finally {
                setBusy(false);
              }
            }}
            busy={busy}
          />
        </>
      ) : null}
    </Card>
  );
}

function GrantForm({
  mode,
  busy,
  onGrant,
}: {
  mode: "staff" | "member";
  busy: boolean;
  onGrant: (ch: Channel, p: Purpose, source: ConsentSource, evidence: string) => Promise<boolean>;
}) {
  const { t, tv } = useI18n();
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [purpose, setPurpose] = useState<Purpose>("reminder");
  const [source, setSource] = useState<ConsentSource>(
    mode === "member" ? "member_portal" : "front_desk",
  );
  const [evidence, setEvidence] = useState(
    mode === "member" ? t("consent.memberEvidenceDefault") : "",
  );
  const [missing, setMissing] = useState(false);
  const ids = { ch: useId(), p: useId(), src: useId(), ev: useId(), help: useId(), err: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = evidence.trim();
    if (!text) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const ok = await onGrant(channel, purpose, source, text);
    if (ok && mode === "staff") setEvidence("");
  }

  return (
    <form className="form form--boxed" onSubmit={submit} noValidate>
      <h3 className="form__title core-form-title">
        <GoldIcon icon="checkCircle" size={20} />
        {t("consent.grantTitle")}
      </h3>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={ids.ch}>{t("consent.channel")}</label>
          <select
            id={ids.ch}
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {tv("channel", c)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.p}>{t("consent.purpose")}</label>
          <select
            id={ids.p}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as Purpose)}
          >
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {tv("purpose", p)}
              </option>
            ))}
          </select>
        </div>
        {mode === "staff" ? (
          <div className="field">
            <label htmlFor={ids.src}>{t("consent.source")}</label>
            <select
              id={ids.src}
              value={source}
              onChange={(e) => setSource(e.target.value as ConsentSource)}
            >
              <option value="front_desk">{tv("source", "front_desk")}</option>
              <option value="web_form">{tv("source", "web_form")}</option>
            </select>
          </div>
        ) : null}
        <div className="field field--wide">
          <label htmlFor={ids.ev}>
            {t("consent.evidence")} <span className="muted">{t("common.required")}</span>
          </label>
          <textarea
            id={ids.ev}
            rows={2}
            maxLength={500}
            required
            aria-required="true"
            aria-invalid={missing}
            aria-describedby={missing ? `${ids.help} ${ids.err}` : ids.help}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <p id={ids.help} className="help">
            {t("consent.evidenceHelp")}
          </p>
          {missing ? (
            <p id={ids.err} className="field-error" role="alert">
              {t("consent.evidenceMissing")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="consent-grant"
        >
          {t("consent.grant")}
        </button>
      </div>
    </form>
  );
}

function OptOut({
  mode,
  busy,
  onConfirm,
}: {
  mode: "staff" | "member";
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const explainId = useId();
  const label = t(mode === "member" ? "optout.member" : "optout.staff");

  return (
    <div className="danger-zone">
      <p id={explainId} className="muted">
        {t("optout.explain")}
      </p>
      {confirming ? (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            aria-describedby={explainId}
            data-tour-id="opt-out-confirm"
            onClick={async () => {
              await onConfirm();
              setConfirming(false);
            }}
          >
            {t("optout.confirm")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--danger-outline"
          aria-describedby={explainId}
          data-tour-id="opt-out"
          onClick={() => setConfirming(true)}
        >
          {label}
        </button>
      )}
    </div>
  );
}
