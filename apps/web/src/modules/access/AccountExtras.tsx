import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useI18n } from "../../i18n/I18nContext";
import { useSession } from "../../session/SessionContext";
import { useModuleT } from "../i18n";
import { type JoinAccepted, adoptSession } from "../signup/api";
import { dict } from "./dict";

/** Account-menu items for signed-in staff: switch between their roles, change their password. */
export function AccountExtras() {
  const { t } = useModuleT(dict);
  const { tv } = useI18n();
  const { api, role } = useSession();
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const staff = role !== null && role !== "member" && role !== "guardian";

  useEffect(() => {
    if (!staff) return;
    let alive = true;
    api
      .request<{ data: string[] }>("GET", "/auth/roles")
      .then((r) => {
        if (alive) setRoles(r.data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, staff]);

  const hasPassword = api.persona?.id.startsWith("pw-") ?? false;
  if (!staff) return null;
  return (
    <>
      {roles.length > 1 ? (
        <fieldset className="menu__group">
          <legend className="menu__legend">{t("role.switch")}</legend>
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              className="menu__item"
              aria-pressed={r === role}
              disabled={busy || r === role}
              onClick={async () => {
                setBusy(true);
                try {
                  const s = await api.request<{ session: NonNullable<JoinAccepted["session"]> }>(
                    "POST",
                    "/auth/switch",
                    { role: r },
                  );
                  adoptSession(s.session, null, "/");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name={r === role ? "checkCircle" : "users"} />
              <span>{tv("role", r, r)}</span>
            </button>
          ))}
        </fieldset>
      ) : null}
      {hasPassword ? (
        <Link className="menu__item" to="/account/password">
          <Icon name="gear" />
          <span>{t("pw.menu")}</span>
        </Link>
      ) : null}
    </>
  );
}
