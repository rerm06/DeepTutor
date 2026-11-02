import { type ReactNode, useEffect, useId, useMemo } from "react";
import type { Location } from "../../api/types";
import { Icon, type IconName } from "../../components/icons";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { scheduleApi } from "./api";
import { dict } from "./dict";
import { DEFAULT_TZ } from "./time";

export const FRONT_OF_HOUSE = ["owner", "location_manager", "front_desk"];
export const SESSION_MANAGERS = ["owner", "location_manager"];

export function useScheduleApi() {
  const { api } = useSession();
  return useMemo(() => scheduleApi(api), [api]);
}
export function useST() {
  return useModuleT(dict);
}

/** Locations the caller can see, plus a selected id that defaults to the first one. */
export function useLocations(selected: string, setSelected: (id: string) => void) {
  const { api } = useSession();
  const locations = useAsync(() => api.locations(), [api]);
  const list: Location[] = locations.data?.data ?? [];
  const first = list[0]?.id;
  useEffect(() => {
    if (!selected && first) setSelected(first);
  }, [selected, first, setSelected]);
  const current = list.find((l) => l.id === selected) ?? null;
  return { locations, list, current, tz: current?.timezone || DEFAULT_TZ };
}

export function LocationSelect({
  list,
  value,
  onChange,
  tourId,
}: {
  list: Location[];
  value: string;
  onChange: (id: string) => void;
  tourId: string;
}) {
  const { t } = useST();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{t("common.location")}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-tour-id={tourId}
      >
        {list.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A `.section` card whose title starts with a gold icon (design system v2). */
export function IconSection({
  icon,
  title,
  actions,
  children,
  level = 2,
  className,
}: {
  icon: IconName;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`section${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="section__head">
        <Heading id={id} className="section__title">
          <Icon name={icon} size={24} />
          {title}
        </Heading>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One key number: gold icon · label · value · hint. */
export function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="ds-stat">
      <Icon name={icon} size={34} />
      <dl className="ds-stat__text sched-stat">
        <dt className="ds-stat__label">{label}</dt>
        <dd className="ds-stat__value">{value}</dd>
        {hint ? <dd className="ds-stat__hint">{hint}</dd> : null}
      </dl>
    </div>
  );
}

/* Class photo by name: same mapping as the staff home's "Agenda de hoy" (reports/Home.tsx), copied to keep
   modules independent. Only the tenant's own /brand/* assets. */
const THUMBS: ReadonlyArray<readonly [RegExp, string]> = [
  [/hiit|funcional|functional|cross|boot|circuit/i, "/brand/class-hiit.jpg"],
  [/spin|ciclo|cycl|bike/i, "/brand/class-spinning.jpg"],
  [/movil|mobil|yoga|stretch|estira|pilates|flex/i, "/brand/class-movilidad.jpg"],
];
export function classThumb(name: string): string | null {
  return THUMBS.find(([re]) => re.test(name))?.[1] ?? null;
}

/** Decorative class photo, or a gold dumbbell tile when the class has no photo. */
export function ClassThumb({ name }: { name: string }) {
  const src = classThumb(name);
  return src ? (
    <img className="sched-thumb" src={src} alt="" width={76} height={56} loading="lazy" />
  ) : (
    <span className="sched-thumb sched-thumb--icon" aria-hidden="true">
      <Icon name="dumbbell" size={26} />
    </span>
  );
}

/** "6:00 am" in the location's zone, for the gold time pill (same format as the staff home agenda). */
export function pillTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(new Date(iso))
    .toLowerCase();
}

/** Occupancy as a gold bar (decorative; the text next to it carries the numbers). */
export function OccupancyBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
  return (
    <span className={`ds-bar sched-bar${pct >= 100 ? " sched-bar--full" : ""}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
