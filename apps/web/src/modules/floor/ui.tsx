import { type ReactNode, useId } from "react";
import { Icon, type IconName } from "../../components/icons";

/** Extra stroke icons for this module (24-unit grid, same style as components/icons.tsx). */
export const FLOOR_ICON = {
  plus: "M12 5v14M5 12h14",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  wrench:
    "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z",
  printer: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  alert: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
} as const;

export type IconSpec = { name?: IconName; d?: string };

/** Design-system v2 card: `.section` whose title starts with a gold icon. */
export function Card({
  title,
  icon,
  children,
  actions,
  className,
  label,
}: {
  title: ReactNode;
  icon: IconSpec;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Explicit accessible name (otherwise the heading names the region). */
  label?: string;
}) {
  const id = useId();
  return (
    <section
      className={className ? `section ${className}` : "section"}
      aria-labelledby={label ? undefined : id}
      aria-label={label}
    >
      <div className="section__head">
        <h2 id={id} className="section__title">
          <Icon {...icon} size={24} />
          {title}
        </h2>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One `.ds-stat` tile: gold icon, label, value, optional hint. */
export function Stat({
  icon,
  label,
  value,
  hint,
}: { icon: IconSpec; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="ds-stat">
      <Icon {...icon} size={34} />
      <dl className="ds-stat__text floor-stat">
        <dt className="ds-stat__label">{label}</dt>
        <dd className="ds-stat__value">{value}</dd>
        {hint ? <dd className="ds-stat__hint">{hint}</dd> : null}
      </dl>
    </div>
  );
}

/** `.ds-empty`: gold icon, one bold line, optional action. */
export function Empty({
  icon,
  text,
  action,
}: { icon: IconSpec; text: string; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <Icon {...icon} size={36} />
      <strong>{text}</strong>
      {action}
    </div>
  );
}
