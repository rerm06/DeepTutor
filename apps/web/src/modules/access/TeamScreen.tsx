import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../../api/client";
import { ErrorNote, Loading, TableWrap } from "../../components/ui";
import { useI18n } from "../../i18n/I18nContext";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { IconSection } from "../schedule/shared";
import { type AccessKey, dict } from "./dict";

interface Account {
  staff_id: string;
  display_name: string;
  email: string;
  role: string;
  active: boolean;
  has_password: boolean;
  must_change: boolean;
}
const ROLES = [
  "owner",
  "location_manager",
  "front_desk",
  "trainer",
  "nutritionist",
  "chef",
  "clinician",
  "accountant",
] as const;
const ORG_WIDE = new Set(["owner", "accountant"]);

/** Owner: the team and new staff accounts (sign-in with e-mail + password, changed at first sign-in). */
export function TeamScreen() {
  const { t } = useModuleT(dict);
  const { tv } = useI18n();
  const { api } = useSession();
  const uid = useId();
  const accounts = useAsync(
    () => api.request<{ data: Account[] }>("GET", "/staff/accounts"),
    [api],
  );
  const locations = useAsync(() => api.locations(), [api]);
  const [f, setF] = useState({
    name: "",
    email: "",
    role: "front_desk",
    location: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ key: AccessKey; ok: boolean } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.request("POST", "/staff/accounts", {
        email: f.email.trim(),
        full_name: f.name.trim(),
        role: f.role,
        location_id: ORG_WIDE.has(f.role) ? null : f.location || null,
        password: f.password,
      });
      setMsg({ key: "team.created", ok: true });
      setF({ name: "", email: "", role: f.role, location: f.location, password: "" });
      accounts.reload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setMsg({
        key: status === 409 ? "team.exists" : status === 400 ? "team.locRequired" : "team.error",
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const needsLoc = !ORG_WIDE.has(f.role);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">{t("team.title")}</h1>
          <p className="lede">{t("team.lede")}</p>
        </div>
      </header>

      <IconSection icon="userPlus" title={t("team.add")}>
        <form className="form" onSubmit={create}>
          <div className="form__grid">
            <div className="field">
              <label htmlFor={`${uid}-n`}>{t("team.name")}</label>
              <input
                id={`${uid}-n`}
                required
                maxLength={120}
                value={f.name}
                onChange={set("name")}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-e`}>{t("team.email")}</label>
              <input
                id={`${uid}-e`}
                type="email"
                required
                maxLength={254}
                value={f.email}
                onChange={set("email")}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-r`}>{t("team.role")}</label>
              <select id={`${uid}-r`} value={f.role} onChange={set("role")}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tv("role", r, r)}
                  </option>
                ))}
              </select>
            </div>
            {needsLoc ? (
              <div className="field">
                <label htmlFor={`${uid}-l`}>{t("team.location")}</label>
                <select id={`${uid}-l`} required value={f.location} onChange={set("location")}>
                  <option value="">—</option>
                  {(locations.data?.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor={`${uid}-p`}>{t("team.password")}</label>
              <input
                id={`${uid}-p`}
                type="text"
                required
                minLength={8}
                maxLength={128}
                value={f.password}
                onChange={set("password")}
                autoComplete="off"
                aria-describedby={`${uid}-ph`}
                data-agent="manual"
              />
              <p className="help" id={`${uid}-ph`}>
                {t("team.passwordHelp")}
              </p>
            </div>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={
                busy ||
                f.name.trim().length < 2 ||
                !f.email.includes("@") ||
                f.password.length < 8 ||
                (needsLoc && !f.location)
              }
            >
              {t("team.create")}
            </button>
          </div>
          <output
            aria-live="polite"
            className={
              msg ? (msg.ok ? "acc-msg acc-msg--info" : "acc-msg acc-msg--error") : "acc-msg"
            }
          >
            {msg ? t(msg.key) : null}
          </output>
        </form>
      </IconSection>

      <IconSection icon="users" title={t("team.list")}>
        {accounts.loading ? <Loading /> : null}
        {accounts.error ? <ErrorNote code={accounts.error} onRetry={accounts.reload} /> : null}
        {accounts.data ? (
          <TableWrap label={t("team.list")}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("team.colName")}</th>
                  <th scope="col">{t("team.colEmail")}</th>
                  <th scope="col">{t("team.colRole")}</th>
                  <th scope="col">{t("team.colAccess")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.data.map((a) => (
                  <tr key={a.staff_id}>
                    <th scope="row">{a.display_name}</th>
                    <td className="mono">{a.email}</td>
                    <td>{tv("role", a.role, a.role)}</td>
                    <td>
                      <span
                        className={`plate plate--${a.has_password ? (a.must_change ? "warn" : "ok") : "neutral"}`}
                      >
                        {a.has_password
                          ? a.must_change
                            ? t("team.access.pending")
                            : t("team.access.pw")
                          : t("team.access.none")}
                      </span>
                    </td>
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
