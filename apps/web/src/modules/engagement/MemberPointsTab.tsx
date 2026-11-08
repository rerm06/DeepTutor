import { useState } from "react";
import type { ErrorCode } from "../../api/client";
import { Icon } from "../../components/icons";
import { ErrorNote, LiveResult } from "../../components/ui";
import { useEngT } from "./dict";
import { PointsSummary, act, useEng } from "./shared";

/** Tab inside the staff member record (front of house): balance, weekly streak, quick visit/class award. */
export function MemberPointsTab({ memberId }: { memberId: string }) {
  const { t } = useEngT();
  const eng = useEng();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const award = (event: "visit" | "class") =>
    act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
      const r = await eng.award(memberId, event);
      setVersion((v) => v + 1);
      return t("points.awardDone", { n: r.points });
    });
  return (
    <>
      <PointsSummary memberId={memberId} title={t("points.tab")} version={version} />
      <div className="row-actions eng-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          data-tour-id="eng-award-visit"
          onClick={() => award("visit")}
        >
          <Icon name="checkCircle" size={18} />
          {t("points.awardVisit")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-tour-id="eng-award-class"
          onClick={() => award("class")}
        >
          <Icon name="calendar" size={18} />
          {t("points.awardClass")}
        </button>
      </div>
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </>
  );
}
