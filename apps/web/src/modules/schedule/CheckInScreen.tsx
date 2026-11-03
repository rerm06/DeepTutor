import { type FormEvent, useId, useRef, useState } from "react";
import { type ErrorCode, toErrorCode } from "../../api/client";
import type { Member } from "../../api/types";
import { MemberAvatar } from "../../components/MemberPhotoCard";
import { Icon } from "../../components/icons";
import { ErrorNote, Loading, Plate, TableWrap, memberStatusTone } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import type { CheckInResult } from "./api";
import { IconSection, LocationSelect, useLocations, useST, useScheduleApi } from "./shared";
import { formatDateTimeIn } from "./time";

const DENIED_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6";

/** Name, email or member number; at most `limit` matches. */
export function searchMembers(members: Member[], term: string, limit = 6): Member[] {
  const q = term.trim().toLocaleLowerCase();
  if (q.length < 2) return [];
  return members
    .filter(
      (m) =>
        m.full_name.toLocaleLowerCase().includes(q) ||
        m.email.toLocaleLowerCase().includes(q) ||
        String(m.member_no ?? "")
          .toLocaleLowerCase()
          .includes(q),
    )
    .slice(0, limit);
}

export function CheckInScreen() {
  const { t, lang } = useST();
  const { tv } = useI18n();
  const { api } = useSession();
  const sched = useScheduleApi();
  const [locationId, setLocationId] = useState("");
  const { list, tz } = useLocations(locationId, setLocationId);
  const members = useAsync(() => api.members(), [api]);
  const [version, setVersion] = useState(0);
  const recent = useAsync(
    () =>
      locationId
        ? sched.checkIns({ location_id: locationId, limit: "10" })
        : Promise.resolve({ data: [] }),
    [sched, locationId, version],
  );
  const [term, setTerm] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const ids = { search: useId(), hint: useId(), token: useId(), tokenHint: useId() };
  const matches = searchMembers(members.data?.data ?? [], term);

  async function run(fn: () => Promise<CheckInResult>) {
    if (!locationId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fn());
      setVersion((v) => v + 1);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitToken(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    await run(() => sched.checkInToken(locationId, value));
    setToken("");
  }

  const allowed = result?.result === "allowed";
  return (
    <div className="page">
      <h1 className="page__title">{t("checkin.title")}</h1>
      <p className="lede">{t("checkin.lede")}</p>
      <div className="toolbar">
        <LocationSelect
          list={list}
          value={locationId}
          onChange={setLocationId}
          tourId="checkin-location"
        />
      </div>

      <output
        className={`sched-result${result ? (allowed ? " sched-result--ok" : " sched-result--blocked") : ""}`}
        aria-live="assertive"
        data-tour-id="checkin-result"
      >
        {result ? (
          <>
            <span className="sched-result__icon">
              {allowed ? <Icon name="checkCircle" size={72} /> : <Icon d={DENIED_ICON} size={72} />}
            </span>
            <span className="sched-result__text">
              <span className="sched-result__verdict">
                {allowed ? t("checkin.allowed") : t("checkin.denied")}
              </span>
              <span className="sched-result__who">{result.full_name ?? t("checkin.unknown")}</span>
              {result.member_no ? (
                <span className="mono sched-result__no">{result.member_no}</span>
              ) : null}
              <span className="sched-result__reason">{t(`reason.${result.reason}`)}</span>
            </span>
          </>
        ) : null}
      </output>
      {error ? <ErrorNote code={error} /> : null}

      <div className="sched-checkin">
        <IconSection icon="users" title={t("checkin.searchTitle")}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const only = matches.length === 1 ? matches[0] : undefined;
              if (only) run(() => sched.checkInMember(locationId, only.id));
            }}
          >
            <div className="field">
              <label htmlFor={ids.search}>{t("checkin.search")}</label>
              <input
                id={ids.search}
                ref={searchRef}
                type="search"
                autoComplete="off"
                value={term}
                aria-describedby={ids.hint}
                onChange={(e) => setTerm(e.target.value)}
                data-tour-id="checkin-search"
              />
              <p id={ids.hint} className="help">
                {t("checkin.searchHint")}
              </p>
            </div>
            {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
            {term.trim().length >= 2 && matches.length === 0 && members.data ? (
              <p className="muted">{t("checkin.noMatch")}</p>
            ) : null}
            {matches.length > 0 ? (
              <ul className="sched-matches">
                {matches.map((m) => (
                  <li key={m.id} className="sched-match">
                    <MemberAvatar
                      memberId={m.id}
                      name={m.full_name}
                      size={52}
                      className="sched-match__photo"
                    />
                    <span className="sched-match__who">
                      <strong>{m.full_name}</strong>
                      <span className="muted mono">
                        {m.member_no ? `${m.member_no} · ` : ""}
                        {m.email}
                      </span>
                    </span>
                    <Plate tone={memberStatusTone(m.status)}>{tv("status", m.status)}</Plate>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy || !locationId}
                      data-tour-id="checkin-member"
                      onClick={() =>
                        run(() => sched.checkInMember(locationId, m.id)).then(() => {
                          setTerm("");
                          searchRef.current?.focus();
                        })
                      }
                    >
                      {t("checkin.do")}
                      <span className="sr-only">: {m.full_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>
        </IconSection>

        <IconSection icon="qr" title={t("checkin.scanTitle")}>
          <form className="form" onSubmit={submitToken}>
            <div className="field">
              <label htmlFor={ids.token}>{t("checkin.token")}</label>
              <input
                id={ids.token}
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={token}
                aria-describedby={ids.tokenHint}
                onChange={(e) => setToken(e.target.value)}
                data-tour-id="checkin-token"
              />
              <p id={ids.tokenHint} className="help">
                {t("checkin.tokenHint")}
              </p>
            </div>
            <div className="form__actions">
              <button
                type="submit"
                className="btn"
                disabled={busy || !token.trim() || !locationId}
                data-tour-id="checkin-token-submit"
              >
                <Icon name="qr" size={18} />
                {t("checkin.validate")}
              </button>
            </div>
          </form>
        </IconSection>
      </div>

      <IconSection icon="checkCircle" title={t("checkin.recent")}>
        {recent.loading ? <Loading /> : null}
        {recent.error ? <ErrorNote code={recent.error} onRetry={recent.reload} /> : null}
        {recent.data && recent.data.data.length === 0 ? (
          <div className="ds-empty">
            <Icon name="checkCircle" size={36} />
            <strong>{t("checkin.none")}</strong>
          </div>
        ) : null}
        {recent.data && recent.data.data.length > 0 ? (
          <TableWrap label={t("checkin.recent")}>
            <table className="table sched-recent">
              <thead>
                <tr>
                  <th scope="col">{t("checkin.col.when")}</th>
                  <th scope="col">{t("checkin.col.member")}</th>
                  <th scope="col">{t("checkin.col.result")}</th>
                  <th scope="col">{t("checkin.col.reason")}</th>
                  <th scope="col">{t("checkin.col.source")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{formatDateTimeIn(c.at, lang, tz)}</td>
                    <th scope="row">{c.full_name ?? t("checkin.unknown")}</th>
                    <td>
                      <Plate tone={c.result === "allowed" ? "ok" : "blocked"}>
                        {c.result === "allowed" ? t("checkin.allowed") : t("checkin.denied")}
                      </Plate>
                    </td>
                    <td>{t(`reason.${c.reason}`)}</td>
                    <td>{t(`source.${c.source as "qr" | "front_desk" | "app" | "door"}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
      </IconSection>
    </div>
  );
}
