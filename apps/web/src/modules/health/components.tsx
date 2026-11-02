import { useId } from "react";
import type { Member } from "../../api/types";
import { Plate, type Tone } from "../../components/ui";
import { useModuleT } from "../i18n";
import type { Level, PlanSection, Triage } from "./api";
import { dict } from "./dict";
import "./health.css";

export const useHealthT = () => useModuleT(dict);

export const levelTone = (l: Level): Tone =>
  l === "green" ? "ok" : l === "amber" ? "warn" : "blocked";

/** Persistent notice on every member-facing health view. */
export function DeviceNotice() {
  const { t } = useHealthT();
  return (
    <p className="note note--warn health-notice" data-tour-id="health-device-notice">
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
      <p className="health-emergency__title">{t("emergency.title")}</p>
      <p>{preview ? t("emergency.preview") : t("emergency.body", { location })}</p>
      <a className="btn btn--danger" href="tel:911">
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
        {title ?? t("triage.title", { version: triage.rule_version })}
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
        <div key={i}>
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
