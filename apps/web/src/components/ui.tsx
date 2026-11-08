import { type ReactNode, useId } from "react";
import type { ErrorCode } from "../api/client";
import { useI18n } from "../i18n/I18nContext";

export type Tone = "ok" | "warn" | "blocked" | "neutral";

/** Status plate: colour plus text, never colour alone. */
export function Plate({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`plate plate--${tone}`}>{children}</span>;
}

export function ErrorNote({ code, onRetry }: { code: ErrorCode; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="note note--error" role="alert">
      <span>{t(`error.${code}`)}</span>
      {onRetry ? (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <output className="muted loading">{t("common.loading")}</output>;
}

/** Polite live region for async results; keep it mounted so screen readers pick up changes. */
export function LiveResult({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return (
    <output className={`live${tone ? ` live--${tone}` : ""}`} aria-live="polite">
      {children}
    </output>
  );
}

/** Table wrapper that scrolls inside itself on narrow screens and is reachable by keyboard. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section
      className="table-wrap"
      aria-label={t("common.tableScroll", { name: label })}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable (WCAG 2.1.1).
      tabIndex={0}
    >
      {children}
    </section>
  );
}

export function Section({
  title,
  children,
  actions,
  level = 2,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <Heading id={id} className="section__title">
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function memberStatusTone(status: string): Tone {
  if (status === "active") return "ok";
  if (status === "frozen" || status === "past_due" || status === "trial") return "warn";
  if (status === "cancelled") return "blocked";
  return "neutral";
}

export function messageStatusTone(status: string): Tone {
  if (status === "queued" || status === "sent" || status === "delivered") return "ok";
  if (status === "blocked" || status === "failed") return "blocked";
  return "neutral";
}
