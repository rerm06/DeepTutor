import { type FormEvent, useId, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { EmergencyBanner } from "../health/components";
import type { Proposal } from "./api";
import { useCoachApi, useCoachT, useMyMembers } from "./shared";

interface Line {
  role: "member" | "coach";
  content: string;
}

/** Member "Coach": AI chat with proposed-action cards (nothing is written until the member confirms). */
export function ChatScreen() {
  const { t, lang } = useCoachT();
  const { role } = useSession();
  const c = useCoachApi();
  const { list, locationName } = useMyMembers();
  const status = useAsync(() => c.status(), [c]);
  const id = useId();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [proposals, setProposals] = useState<Array<Proposal & { state?: string }>>([]);

  if (role && role !== "member")
    return (
      <div className="page">
        <h1 className="page__title">{t("chat.title")}</h1>
        <p className="muted">{t("chat.membersOnly")}</p>
      </div>
    );

  async function send(message: string) {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    const history = lines.slice(-8);
    setLines((l) => [...l, { role: "member", content: message }]);
    setText("");
    try {
      const r = await c.chat(message, history, lang);
      if (r.emergency) setEmergency(true);
      const reply = r.reply ?? (r.notice === "provider_disabled" ? t("chat.disabled") : "");
      if (reply) setLines((l) => [...l, { role: "coach", content: reply }]);
      if (r.proposals.length) setProposals((p) => [...r.proposals, ...p]);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }
  async function decide(p: Proposal, confirm: boolean) {
    setError(null);
    try {
      const r = confirm ? await c.confirm(p.id) : await c.reject(p.id);
      const state =
        r.status === "executed"
          ? t("chat.executed")
          : r.status === "rejected"
            ? t("chat.rejected")
            : t("chat.failed", { error: (r as { error?: string | null }).error ?? r.status });
      setProposals((all) => all.map((x) => (x.id === p.id ? { ...x, state } : x)));
    } catch (err) {
      setError(toErrorCode(err));
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }
  const enabled = status.data?.enabled === true;

  return (
    <div className="page">
      <h1 className="page__title">{t("chat.title")}</h1>
      <p className="note note--warn coach-notice" data-tour-id="coach-ai-notice">
        {t("notice.ai")}
      </p>
      {emergency ? <EmergencyBanner location={locationName(list[0])} /> : null}
      {status.loading ? <Loading /> : null}
      {status.data && !enabled ? (
        <p className="coach-card" data-tour-id="coach-chat-disabled">
          {t("chat.disabled")}
        </p>
      ) : null}
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void send(t("chat.humanAsk"))}
          data-tour-id="coach-chat-human"
        >
          {t("chat.human")}
        </button>
      </div>
      {proposals.length ? (
        <section aria-labelledby={`${id}-p`} className="coach-stack">
          <h2 id={`${id}-p`} className="section__title">
            {t("chat.proposal")}
          </h2>
          <p className="help">{t("chat.proposalHelp")}</p>
          {proposals.map((p) => (
            <article
              key={p.id}
              className="coach-card coach-card--proposal"
              data-tour-id="coach-proposal"
            >
              <p>{p.summary}</p>
              {p.state ? (
                <LiveResult>{p.state}</LiveResult>
              ) : (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void decide(p, true)}
                    data-tour-id="coach-proposal-confirm"
                  >
                    {t("chat.confirm")}
                    <span className="sr-only">: {p.summary}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void decide(p, false)}
                    data-tour-id="coach-proposal-reject"
                  >
                    {t("chat.reject")}
                    <span className="sr-only">: {p.summary}</span>
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      ) : null}
      {lines.length === 0 && enabled ? <p className="muted">{t("chat.empty")}</p> : null}
      <ol className="coach-chat" aria-live="polite">
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only transcript; lines never reorder.
          <li key={i} className={`coach-msg coach-msg--${l.role}`}>
            <span className="coach-msg__who">
              {l.role === "member" ? t("chat.you") : t("chat.coach")}
            </span>
            {l.content}
          </li>
        ))}
      </ol>
      {error ? <ErrorNote code={error} /> : null}
      <form className="coach-composer" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-m`}>{t("chat.input")}</label>
          <input
            id={`${id}-m`}
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            data-tour-id="coach-chat-input"
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || !text.trim()}
          data-tour-id="coach-chat-send"
        >
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}
