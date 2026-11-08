import { type ReactNode, useId } from "react";
import { Icon, type IconName } from "../../components/icons";

/** Extra stroke paths used only by the CRM screens (24-unit grid, same style as components/icons.tsx). */
export const CRM_D = {
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  funnel: "M3 5h18l-7 8.5V20l-4-2v-4.5L3 5Z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01",
  xCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6",
  percent: "M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
} as const;

/** `.section` card whose title starts with a gold icon (design system v2). Same semantics as ui.tsx Section. */
export function CrmSection({
  title,
  icon,
  d,
  level = 2,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  icon?: IconName;
  d?: string;
  level?: 2 | 3;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`section${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="section__head">
        <Heading id={id} className="section__title">
          <Icon name={icon} d={d} size={22} />
          <span>{title}</span>
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Count pill for headings: the visible pill is decorative, screen readers hear " (n)" as before. */
export function CountPill({ n }: { n: number }) {
  return (
    <>
      <span className="sr-only"> ({n})</span>
      <span className="crm-count" aria-hidden="true">
        {n}
      </span>
    </>
  );
}

/** Up to two initials from a person's name (decorative; the name is always shown next to it). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters
    .map((p) => p?.charAt(0) ?? "")
    .join("")
    .toLocaleUpperCase();
}

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span className={`crm-avatar crm-avatar--${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
