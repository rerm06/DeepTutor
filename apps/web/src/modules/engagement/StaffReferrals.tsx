import { useState } from "react";
import type { ErrorCode } from "../../api/client";
import { ErrorNote, LiveResult, Plate, TableWrap } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { type EngKey, useEngT } from "./dict";
import { Card, Empty, act, statusTone, useEng } from "./shared";

/** Referrals of the members this front desk can see; "Acreditar" once the invitee is an active member. */
export function StaffReferrals() {
  const { t, lang } = useEngT();
  const eng = useEng();
  const rows = useAsync(() => eng.referrals(), [eng]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const open = (rows.data?.data ?? []).filter((r) => r.status !== "credited");
  return (
    <Card title={t("refer.staffTitle")} icon={{ name: "userPlus" }}>
      {rows.error ? <ErrorNote code={rows.error} onRetry={rows.reload} /> : null}
      {rows.data && open.length === 0 ? (
        <Empty icon={{ name: "userPlus" }} text={t("refer.none")} />
      ) : null}
      {open.length > 0 ? (
        <TableWrap label={t("refer.staffTitle")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("refer.col.referrer")}</th>
                <th scope="col">{t("refer.col.email")}</th>
                <th scope="col">{t("refer.col.status")}</th>
                <th scope="col">{t("common.date")}</th>
                <th scope="col">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.referrer_name ?? "—"}</th>
                  <td className="mono">{r.referred_email}</td>
                  <td>
                    <Plate tone={statusTone(r.status)}>{t(`status.${r.status}` as EngKey)}</Plate>
                  </td>
                  <td className="nowrap">{formatDateTime(r.created_at, lang)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      data-tour-id="eng-referral-credit"
                      onClick={() =>
                        act({ busy: setBusy, error: setError, announce: setAnnounce }, async () => {
                          const res = await eng.creditReferral(r.id);
                          rows.reload();
                          return t(`status.${res.status}` as EngKey);
                        })
                      }
                    >
                      {t("refer.credit")}
                      <span className="sr-only">: {r.referred_email}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <LiveResult tone={announce ? "ok" : undefined}>{announce}</LiveResult>
      {error ? <ErrorNote code={error} /> : null}
    </Card>
  );
}
