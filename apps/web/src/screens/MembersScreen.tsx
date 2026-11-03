import { type FormEvent, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ErrorCode, toErrorCode } from "../api/client";
import { type Location, MEMBER_STATUSES, type Member, type MemberStatus } from "../api/types";
import { Icon } from "../components/icons";
import {
  ErrorNote,
  LiveResult,
  Loading,
  Plate,
  TableWrap,
  memberStatusTone,
} from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { ROUTES, canManageMembers } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";
import { Card, Empty, Stat, useCoreCopy } from "./kit";

export function filterMembers(members: Member[], term: string): Member[] {
  const q = term.trim().toLocaleLowerCase();
  if (!q) return members;
  return members.filter(
    (m) => m.full_name.toLocaleLowerCase().includes(q) || m.email.toLocaleLowerCase().includes(q),
  );
}

export function MembersScreen() {
  const { t } = useI18n();
  const c = useCoreCopy();
  const { api, role } = useSession();
  const manage = canManageMembers(role);
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const locations = useAsync(() => api.locations(), [api]);
  const members = useAsync(() => api.members(locationId || undefined), [api, locationId]);
  const filterId = useId();
  const searchId = useId();
  const newFormId = useId();

  const locs = locations.data?.data ?? [];
  const locName = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const all = members.data?.data ?? [];
  const rows = filterMembers(all, search);
  const active = all.filter((m) => m.status === "active").length;
  const attention = all.filter((m) => m.status === "past_due" || m.status === "frozen").length;

  return (
    <div className="page core-page">
      <div className="page__head">
        <div className="core-head">
          <h1 className="page__title">{t("members.title")}</h1>
          <p className="lede">{c("members.lede")}</p>
        </div>
        {manage ? (
          <button
            type="button"
            className="btn btn--primary"
            data-tour-id="member-new"
            aria-expanded={showNew}
            aria-controls={newFormId}
            onClick={() => setShowNew((v) => !v)}
          >
            <Icon name="userPlus" size={20} />
            {t("members.new")}
          </button>
        ) : null}
      </div>

      {members.data ? (
        <div className="ds-stats">
          <Stat icon="users" label={c("members.shown")} value={all.length} />
          <Stat icon="checkCircle" label={c("members.active")} value={active} />
          <Stat
            icon="alert"
            label={c("members.attention")}
            value={attention}
            hint={c("members.attentionHint")}
          />
        </div>
      ) : null}

      {manage && showNew ? (
        <div id={newFormId}>
          <NewMemberForm
            locations={locs}
            onCreated={() => {
              members.reload();
            }}
          />
        </div>
      ) : null}

      <Card icon="idCard" title={c("members.directory")} tourId="member-directory">
        <div className="toolbar">
          <div className="field">
            <label htmlFor={filterId}>{t("members.filterLocation")}</label>
            <select
              id={filterId}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              data-tour-id="member-filter-location"
            >
              <option value="">{t("common.all")}</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--grow">
            <label htmlFor={searchId}>{t("members.search")}</label>
            <input
              id={searchId}
              type="search"
              value={search}
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
              data-tour-id="member-search"
            />
          </div>
        </div>

        <LiveResult>{announce}</LiveResult>
        {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
        {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
        {members.loading ? <Loading /> : null}

        {members.data ? (
          <>
            <p className="muted" aria-live="polite">
              {t("members.count", { n: rows.length })}
            </p>
            {rows.length === 0 ? (
              <Empty icon="users" title={t("members.empty")} />
            ) : (
              <TableWrap label={t("members.title")}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("members.col.no")}</th>
                      <th scope="col">{t("members.col.name")}</th>
                      <th scope="col">{t("members.col.email")}</th>
                      <th scope="col">{t("members.col.location")}</th>
                      <th scope="col">{t("members.col.status")}</th>
                      <th scope="col">{t("members.col.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        locationName={locName.get(m.home_location_id) ?? ""}
                        manage={manage}
                        onChanged={(msg) => {
                          setAnnounce(msg);
                          members.reload();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}

function MemberRow({
  member,
  locationName,
  manage,
  onChanged,
}: {
  member: Member;
  locationName: string;
  manage: boolean;
  onChanged: (message: string) => void;
}) {
  const { t, tv } = useI18n();
  const { api } = useSession();
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const selectId = useId();

  async function apply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.setMemberStatus(member.id, status);
      onChanged(
        t("members.statusSaved", { name: member.full_name, status: tv("status", res.status) }),
      );
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="mono">{member.member_no ?? ""}</td>
      <th scope="row">{member.full_name}</th>
      <td className="mono">{member.email}</td>
      <td>{locationName}</td>
      <td>
        <Plate tone={memberStatusTone(member.status)}>{tv("status", member.status)}</Plate>
      </td>
      <td>
        <div className="row-actions">
          <Link className="btn btn--ghost" to={ROUTES.member(member.id)}>
            {t("common.open")}
            <span className="sr-only">: {member.full_name}</span>
          </Link>
          {manage ? (
            <form className="inline-form" onSubmit={apply}>
              <label htmlFor={selectId} className="sr-only">
                {t("members.statusFor", { name: member.full_name })}
              </label>
              <select
                id={selectId}
                value={status}
                onChange={(e) => setStatus(e.target.value as MemberStatus)}
                data-tour-id="member-status"
              >
                {MEMBER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tv("status", s)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="btn"
                disabled={busy || status === member.status}
                data-tour-id="member-status-apply"
              >
                {t("common.apply")}
              </button>
            </form>
          ) : null}
        </div>
        {error ? <ErrorNote code={error} /> : null}
      </td>
    </tr>
  );
}

function NewMemberForm({
  locations,
  onCreated,
}: {
  locations: Location[];
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { api } = useSession();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [home, setHome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const ids = { email: useId(), name: useId(), phone: useId(), home: useId(), hint: useId() };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await api.createMember({
        email: email.trim(),
        full_name: fullName.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        home_location_id: home,
      });
      setCreated(res.id);
      setEmail("");
      setFullName("");
      setPhone("");
      onCreated(res.id);
    } catch (err) {
      setError(toErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card icon="userPlus" title={t("members.new.title")}>
      <form className="form" onSubmit={submit} aria-describedby={ids.hint}>
        <p id={ids.hint} className="muted">
          {t("members.new.demoHint")}
        </p>
        <div className="form__grid">
          <div className="field">
            <label htmlFor={ids.email}>
              {t("members.new.email")} <span className="muted">{t("common.required")}</span>
            </label>
            <input
              id={ids.email}
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.name}>
              {t("members.new.name")} <span className="muted">{t("common.required")}</span>
            </label>
            <input
              id={ids.name}
              required
              maxLength={200}
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.phone}>
              {t("members.new.phone")} <span className="muted">{t("common.optional")}</span>
            </label>
            <input
              id={ids.phone}
              type="tel"
              maxLength={32}
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.home}>
              {t("members.new.location")} <span className="muted">{t("common.required")}</span>
            </label>
            <select id={ids.home} required value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">{t("members.new.choose")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy}
            data-tour-id="member-new-submit"
          >
            {t("members.new.submit")}
          </button>
        </div>
        <LiveResult tone={created ? "ok" : undefined}>
          {created ? (
            <span>
              {t("members.new.done")}{" "}
              <Link to={ROUTES.member(created)}>{t("members.new.openNew")}</Link>
            </span>
          ) : null}
        </LiveResult>
        {error ? <ErrorNote code={error} /> : null}
      </form>
    </Card>
  );
}
