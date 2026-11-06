import { useEffect, useId, useState } from "react";
import { useAsync } from "../../lib/useAsync";
import type { MyMember } from "./api";
import { useST, useScheduleApi } from "./shared";

/** Whom a member/guardian acts for: themself, or one of their wards. */
export function useMyMembers() {
  const sched = useScheduleApi();
  const mine = useAsync(() => sched.myMembers(), [sched]);
  const [memberId, setMemberId] = useState("");
  const list: MyMember[] = mine.data?.data ?? [];
  const first = list[0]?.id;
  useEffect(() => {
    if (!memberId && first) setMemberId(first);
  }, [memberId, first]);
  return {
    mine,
    list,
    memberId,
    setMemberId,
    current: list.find((m) => m.id === memberId) ?? null,
  };
}

export function MemberPicker({
  list,
  value,
  onChange,
}: {
  list: MyMember[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useST();
  const id = useId();
  if (list.length < 2) return null;
  return (
    <div className="field">
      <label htmlFor={id}>{t("common.forMember")}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-tour-id="schedule-member-pick"
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
