import { useMemo } from "react";
import type { Member } from "../../api/types";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { coachApi } from "./api";
import { dict } from "./dict";
import "./coach.css";

export const useCoachT = () => useModuleT(dict);

export function useCoachApi() {
  const { api } = useSession();
  return useMemo(() => coachApi(api), [api]);
}

/** Members the caller acts for (the member themself, or a guardian's wards) plus location names. */
export function useMyMembers() {
  const { api } = useSession();
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const list: Member[] = members.data?.data ?? [];
  const locationName = (m: Member | undefined) =>
    locations.data?.data.find((l) => l.id === m?.home_location_id)?.name ?? "";
  return { members, list, locationName };
}

/** Picker shown only when a guardian has more than one ward. */
export function MemberPick({
  list,
  value,
  onChange,
}: {
  list: Member[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useCoachT();
  if (list.length < 2) return null;
  return (
    <div className="field field--inline">
      <label htmlFor="coach-member">{t("member.pick")}</label>
      <select
        id="coach-member"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-tour-id="coach-member-pick"
      >
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EstimateNotice() {
  const { t } = useCoachT();
  return (
    <p className="note note--warn coach-notice" data-tour-id="coach-estimate-notice">
      {t("notice.estimate")}
    </p>
  );
}
