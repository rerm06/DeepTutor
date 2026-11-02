import { useEffect, useId, useMemo } from "react";
import type { Location } from "../../api/types";
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
