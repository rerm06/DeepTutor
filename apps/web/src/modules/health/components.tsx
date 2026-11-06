import { type ReactNode, useId } from "react";
import type { Member } from "../../api/types";
import { Icon, type IconName } from "../../components/icons";
import { Plate, type Tone } from "../../components/ui";
import { useModuleT } from "../i18n";
import type { Level, PlanKind, PlanSection, Triage } from "./api";
import { dict } from "./dict";
import "./health.css";

export const useHealthT = () => useModuleT(dict);

/** Extra stroke icons for health and coach screens (24-unit grid, same style as components/icons.tsx). */
export const HICON = {
  alert: "M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.5h.01",
  phone:
    "M5 3.5h3.5l2 5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5 5 2V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2Z",
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
  shield: "M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z",
  shieldCheck: "M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3ZM9 12l2.2 2.2L15.5 10",
  clipboard: "M9 4h6v3H9zM9 5.5H6V21h12V5.5h-3M9 12h6M9 16h4",
  plus: "M12 5v14M5 12h14",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.5h.01",
  pen: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
} as const;

/** Date only (Puerto Rico time), for stat tiles. */
export function formatDay(iso: string | null | undefined, lang: "es" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "es" ? "es-PR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Puerto_Rico",
  })
    .format(d)
    .replace(".", "");
}

/** Card section whose title starts with a gold icon (design system v2). */
export function IconSection({
  title,
  icon,
  d,
  actions,
  level = 2,
  className,
  tour,
  children,
}: {
  title: ReactNode;
  icon?: IconName;
  d?: string;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
  tour?: string;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      className={className ? `section ${className}` : "section"}
      aria-labelledby={id}
      data-tour-id={tour}
    >
      <div className="section__head">
        <Heading id={id} className="section__title">
          <Icon name={icon} d={d} size={24} />
          <span>{title}</span>
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` tile: gold icon, label, value, optional hint. */
export function Stat({
  icon,
  d,
  label,
  value,
  hint,
}: {
  icon?: IconName;
  d?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="ds-stat">
      <Icon name={icon} d={d} size={30} />
      <div className="ds-stat__text">
        <span className="ds-stat__label">{label}</span>
        <span className="ds-stat__value">{value}</span>
        {hint ? <span className="ds-stat__hint">{hint}</span> : null}
      </div>
    </div>
  );
}

/** `.ds-empty`: gold icon, one bold line, optional action. */
export function Empty({
  icon,
  d,
  children,
  action,
}: {
  icon?: IconName;
  d?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <Icon name={icon} d={d} size={34} />
      <strong>{children}</strong>
      {action}
    </div>
  );
}

export const KIND_ICON: Record<PlanKind, IconName> = {
  training: "dumbbell",
  nutrition: "apple",
  treatment: "checkCircle",
};

export const levelTone = (l: Level): Tone =>
  l === "green" ? "ok" : l === "amber" ? "warn" : "blocked";

/** Persistent notice on every member-facing health view. */
export function DeviceNotice() {
  const { t } = useHealthT();
  return (
    <p className="note note--warn health-notice" data-tour-id="health-device-notice">
      <Icon d={HICON.info} size={20} />
      {t("notice.device")}
    </p>
  );
}

/** Emergency banner: acute symptoms → call 911 and alert the location's staff. */
export function EmergencyBanner({
  location,
  preview = false,
}: { location: string; preview?: boolean }) {
  const { t } = useHealthT();
  return (
    <div className="health-emergency" role="alert" data-tour-id="health-emergency">
      <span className="health-emergency__icon">
        <Icon d={HICON.alert} size={30} />
      </span>
      <div className="health-emergency__text">
        <p className="health-emergency__title">{t("emergency.title")}</p>
        <p>{preview ? t("emergency.preview") : t("emergency.body", { location })}</p>
      </div>
      <a className="btn btn--danger health-emergency__call" href="tel:911">
        <Icon d={HICON.phone} size={22} />
        911
      </a>
    </div>
  );
}

export function reasonText(t: ReturnType<typeof useHealthT>["t"], reason: string): string {
  if (reason.startsWith("condition_")) {
    const c = reason.slice("condition_".length);
    return t("reason.condition", { name: t(`cond.${c}` as never) });
  }
  return t(`reason.${reason}` as never);
}

/** Colour plates (with text, never colour alone) + flags + reasons. */
export function TriagePanel({ triage, title }: { triage: Triage; title?: string }) {
  const { t } = useHealthT();
  const id = useId();
  return (
    <section className="health-triage" aria-labelledby={id} data-tour-id="health-triage">
      <h3 id={id} className="health-triage__title">
        <Icon d={HICON.pulse} size={22} />
        <span>{title ?? t("triage.title", { version: triage.rule_version })}</span>
      </h3>
      <p className="health-triage__plates">
        <Plate tone={levelTone(triage.exercise_level)}>
          {t("triage.exercise", { level: t(`triage.${triage.exercise_level}`) })}
        </Plate>{" "}
        <Plate tone={levelTone(triage.nutrition_level)}>
          {t("triage.nutrition", { level: t(`triage.${triage.nutrition_level}`) })}
        </Plate>
        {triage.requires_medical_referral ? (
          <>
            {" "}
            <Plate tone="warn">{t("triage.referral")}</Plate>
          </>
        ) : null}
        {triage.no_calorie_counting ? (
          <>
            {" "}
            <Plate tone="neutral">{t("triage.noCalories")}</Plate>
          </>
        ) : null}
      </p>
      <p className="health-triage__label">{t("triage.reasons")}</p>
      <ul className="health-triage__reasons">
        {triage.reasons.map((r) => (
          <li key={r}>{reasonText(t, r)}</li>
        ))}
      </ul>
    </section>
  );
}

export function PlanBodyView({ sections }: { sections: PlanSection[] }) {
  return (
    <div className="health-plan-body">
      {sections.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sections are static, ordered content.
        <div key={i} className="health-plan-body__block">
          <h4 className="health-plan-body__heading">{s.heading}</h4>
          <ul>
            {s.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items are static, ordered content.
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function MemberPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useHealthT();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{t("member.pick")}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-tour-id="health-member-pick"
      >
        <option value="">{t("member.pickPrompt")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
