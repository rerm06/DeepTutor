import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";
import { CHANNELS, type Channel, type Locale, type SendResult } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/dict";
import { formatDateTime } from "../lib/format";
import {
  type ClientVar,
  type Segment,
  buildVars,
  neededVars,
  normalizeVar,
  previewSegments,
} from "../lib/template";
import { useAsync } from "../lib/useAsync";
import { Card, Empty } from "../screens/kit";
import { useSession } from "../session/SessionContext";
import type { BrandOption } from "./ConsentPanel";
import { ErrorNote, LiveResult, Loading, Plate, TableWrap, messageStatusTone } from "./ui";

const VAR_LABEL: Record<ClientVar, MessageKey> = {
  date: "send.var.date",
  time: "send.var.time",
  amount: "send.var.amount",
  last4: "send.var.last4",
  discount: "send.var.discount",
};

export function useBlockReason() {
  const { t, tv } = useI18n();
  return (reason: string | null) =>
    reason ? tv("block", reason, t("block.unknown", { reason })) : "";
}

/** Live preview: client vars substituted, server vars shown as "filled by the system". */
export function TemplatePreview({ body, segments }: { body: string; segments: Segment[] }) {
  const { t, tv } = useI18n();
  if (!body) return null;
  return (
    <p className="preview__body" data-testid="template-preview">
      {segments.map((s, i) => {
        const key = `${i}-${s.kind}`;
        if (s.kind === "text") return <span key={key}>{s.text}</span>;
        if (s.kind === "client")
          return s.value ? (
            <mark key={key} className="var var--client">
              {s.value}
            </mark>
          ) : (
            <span key={key} className="var var--missing">
              [{t(VAR_LABEL[s.name])}: {t("send.missing")}]
            </span>
          );
        return (
          <span key={key} className="var var--server">
            [{tv("send.serverVar", s.name)}: {t("send.server")}]
          </span>
        );
      })}
    </p>
  );
}

export function MessagePanel({
  memberId,
  brands,
  onSent,
}: {
  memberId: string;
  brands: BrandOption[];
  onSent: () => void;
}) {
  const { t, tv, lang } = useI18n();
  const { api } = useSession();
  const blockReason = useBlockReason();
  const templates = useAsync(() => api.templates(), [api]);
  const [locale, setLocale] = useState<Locale>(lang);
  const [key, setKey] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [raw, setRaw] = useState<Partial<Record<ClientVar, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [invalid, setInvalid] = useState<ClientVar[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  const ids = {
    locale: useId(),
    tpl: useId(),
    ch: useId(),
    brand: useId(),
    preview: useId(),
    varPrefix: useId(),
  };

  useEffect(() => {
    if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brandId, brands]);

  const forLocale = useMemo(
    () => (templates.data?.data ?? []).filter((tpl) => tpl.locale === locale),
    [templates.data, locale],
  );
  const template = forLocale.find((tpl) => tpl.key === key) ?? null;
  const needed = template ? neededVars(template.key, template.body) : [];

  // Preview shows what is valid so far; invalid input shows as missing.
  const previewVars: Partial<Record<ClientVar, string>> = {};
  for (const v of needed) {
    const norm = normalizeVar(v, raw[v] ?? "");
    if (norm) previewVars[v] = norm;
  }
  const segments = template ? previewSegments(template.body, previewVars) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!template) return;
    const built = buildVars(needed, raw);
    setInvalid(built.invalid);
    if (built.invalid.length > 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.sendMessage({
        member_id: memberId,
        brand_id: brandId,
        channel,
        template_key: template.key,
        locale,
        vars: built.vars,
      });
      setResult(res);
      onSent();
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card icon="send" title={t("send.title")}>
      {templates.loading ? <Loading /> : null}
      {templates.error ? <ErrorNote code={templates.error} onRetry={templates.reload} /> : null}
      <form className="form form--boxed" onSubmit={submit} noValidate>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.locale}>{t("send.locale")}</label>
            <select
              id={ids.locale}
              value={locale}
              onChange={(e) => {
                setLocale(e.target.value as Locale);
                setKey("");
              }}
            >
              <option value="es">{t("lang.es")}</option>
              <option value="en">{t("lang.en")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.tpl}>{t("send.template")}</label>
            <select
              id={ids.tpl}
              value={key}
              required
              data-tour-id="message-template"
              onChange={(e) => {
                setKey(e.target.value);
                setInvalid([]);
                setResult(null);
              }}
            >
              <option value="">{t("send.chooseTemplate")}</option>
              {forLocale.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tv("template", tpl.key)} · {tv("purpose", tpl.purpose)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.ch}>{t("send.channel")}</label>
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
          {brands.length > 1 ? (
            <div className="field">
              <label htmlFor={ids.brand}>{t("send.brand")}</label>
              <select id={ids.brand} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {templates.data && forLocale.length === 0 ? (
          <p className="muted">{t("send.noTemplates")}</p>
        ) : null}

        {needed.length > 0 ? (
          <div className="form__grid">
            {needed.map((v) => (
              <VarInput
                key={v}
                id={`${ids.varPrefix}-${v}`}
                name={v}
                value={raw[v] ?? ""}
                invalid={invalid.includes(v)}
                onChange={(value) => setRaw((r) => ({ ...r, [v]: value }))}
              />
            ))}
          </div>
        ) : null}

        {template ? (
          <div className="preview" aria-labelledby={ids.preview}>
            <h3 id={ids.preview} className="preview__title">
              {t("send.preview")}
            </h3>
            <TemplatePreview body={template.body} segments={segments} />
            <p className="help">{t("send.previewHelp")}</p>
          </div>
        ) : null}

        {invalid.length > 0 ? (
          <p className="field-error" role="alert">
            {t("send.invalid", { fields: invalid.map((v) => t(VAR_LABEL[v])).join(", ") })}
          </p>
        ) : null}

        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !template || !brandId}
            data-tour-id="message-send"
          >
            {busy ? t("send.sending") : t("send.submit")}
          </button>
        </div>
        <LiveResult tone={result ? (result.status === "queued" ? "ok" : "blocked") : undefined}>
          {result ? (
            <span className="result">
              <Plate tone={result.status === "queued" ? "ok" : "blocked"}>
                {tv("msgstatus", result.status)}
              </Plate>{" "}
              {result.status === "queued"
                ? t("send.queued", { when: formatDateTime(result.scheduled_for, lang) })
                : t("send.blocked", { reason: blockReason(result.block_reason) })}
            </span>
          ) : null}
        </LiveResult>
        {error ? <ErrorNote code={error} /> : null}
      </form>
    </Card>
  );
}

function VarInput({
  id,
  name,
  value,
  invalid,
  onChange,
}: {
  id: string;
  name: ClientVar;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const helpId = `${id}-help`;
  const common = {
    id,
    value,
    required: true,
    "aria-invalid": invalid,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    "data-tour-id": `message-var-${name}`,
  };
  let input: JSX.Element;
  switch (name) {
    case "date":
      input = <input type="date" {...common} />;
      break;
    case "time":
      input = <input type="time" step={60} {...common} />;
      break;
    case "amount":
      input = (
        <span className="affix">
          <span className="affix__text" aria-hidden="true">
            $
          </span>
          <input type="text" inputMode="decimal" aria-describedby={helpId} {...common} />
        </span>
      );
      break;
    case "last4":
      input = (
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]{4}"
          autoComplete="off"
          {...common}
        />
      );
      break;
    case "discount":
      input = (
        <span className="affix">
          <input type="number" min={1} max={99} step={1} {...common} />
          <span className="affix__text" aria-hidden="true">
            %
          </span>
        </span>
      );
      break;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{t(VAR_LABEL[name])}</label>
      {input}
      {name === "amount" ? (
        <p id={helpId} className="help">
          {t("send.var.amountHelp")}
        </p>
      ) : null}
    </div>
  );
}

export function MessageHistory({ memberId, version }: { memberId: string; version: number }) {
  const { t, tv, lang } = useI18n();
  const { api } = useSession();
  const blockReason = useBlockReason();
  const messages = useAsync(() => api.messages(memberId), [api, memberId, version]);
  const rows = messages.data?.data ?? [];
  return (
    <Card icon="history" title={t("messages.title")}>
      {messages.loading ? <Loading /> : null}
      {messages.error ? <ErrorNote code={messages.error} onRetry={messages.reload} /> : null}
      {messages.data && rows.length === 0 ? (
        <Empty icon="chat" title={t("messages.empty")} />
      ) : null}
      {rows.length > 0 ? (
        <TableWrap label={t("messages.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("messages.col.created")}</th>
                <th scope="col">{t("messages.col.channel")}</th>
                <th scope="col">{t("messages.col.template")}</th>
                <th scope="col">{t("messages.col.status")}</th>
                <th scope="col">{t("messages.col.scheduled")}</th>
                <th scope="col">{t("messages.col.body")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{formatDateTime(m.created_at, lang)}</td>
                  <td>{tv("channel", m.channel)}</td>
                  <td>
                    {tv("template", m.template_key)}
                    <span className="muted"> · {tv("purpose", m.purpose)}</span>
                  </td>
                  <td>
                    <Plate tone={messageStatusTone(m.status)}>{tv("msgstatus", m.status)}</Plate>
                    {m.block_reason ? (
                      <span className="cell-note">{blockReason(m.block_reason)}</span>
                    ) : null}
                  </td>
                  <td className="nowrap">{formatDateTime(m.scheduled_for, lang)}</td>
                  <td className="cell-body">{m.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </Card>
  );
}
