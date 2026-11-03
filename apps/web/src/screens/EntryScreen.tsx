import { useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";
import type { Persona } from "../api/types";
import { Icon } from "../components/icons";
import { ErrorNote, LiveResult, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { useAsync } from "../lib/useAsync";
import { JoinLink } from "../modules/signup";
import { useSession } from "../session/SessionContext";
import { Empty, GoldIcon, Stat, initialsOf, useCoreCopy } from "./kit";

interface OrgGroup {
  org: string;
  name: string;
  logo: string | null;
  personas: Persona[];
}

export function groupByOrg(personas: Persona[]): OrgGroup[] {
  const groups = new Map<string, OrgGroup>();
  for (const p of personas) {
    const g = groups.get(p.org) ?? {
      org: p.org,
      name: p.org_name,
      logo: p.org_logo_url ?? null,
      personas: [],
    };
    g.personas.push(p);
    groups.set(p.org, g);
  }
  return [...groups.values()].sort((a, b) => a.org.localeCompare(b.org));
}

export function EntryScreen() {
  const { t, tv } = useI18n();
  const { api, login, lost } = useSession();
  const personas = useAsync(() => api.personas(), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const c = useCoreCopy();
  const groups = groupByOrg(personas.data?.data ?? []);

  async function pick(p: Persona) {
    setBusy(p.id);
    setError(null);
    try {
      await login(p.id);
    } catch (err) {
      setError(toErrorCode(err));
      setBusy(null);
    }
  }

  return (
    <div className="page core-page">
      <header className="core-head">
        <h1 className="page__title">{t("entry.title")}</h1>
        <p className="lede">{t("entry.intro")}</p>
        <span className="core-head__rule" aria-hidden="true" />
      </header>
      {lost ? <p className="note note--warn">{t("session.lost")}</p> : null}
      <LiveResult>
        {busy ? t("entry.starting") : null}
        {error ? <ErrorNote code={error} /> : null}
      </LiveResult>

      {personas.loading ? <Loading /> : null}
      {personas.error ? <ErrorNote code={personas.error} onRetry={personas.reload} /> : null}
      {personas.data && personas.data.data.length === 0 ? (
        <Empty icon="users" title={t("entry.empty")} />
      ) : null}

      {groups.length > 0 ? (
        <div className="ds-stats">
          <Stat icon="building" label={c("entry.orgs")} value={groups.length} />
          <Stat
            icon="users"
            label={c("entry.personas")}
            value={personas.data?.data.length ?? 0}
            hint={c("entry.personasHint")}
          />
        </div>
      ) : null}

      <div className="org-groups">
        {groups.map((g) => (
          <section key={g.org} className="section org-group" aria-labelledby={`org-${g.org}`}>
            <div className="section__head">
              <h2 id={`org-${g.org}`} className="section__title org-group__title">
                <GoldIcon icon="building" size={24} />
                <span className="org-group__code">{t("entry.org", { org: g.org })}</span>
                {g.logo ? (
                  <img className="org-group__logo" src={g.logo} alt={g.name} height={40} />
                ) : (
                  <span>{g.name}</span>
                )}
              </h2>
              <div className="section__actions">
                <JoinLink org={g.org} name={g.name} />
              </div>
            </div>
            <ul className="persona-list">
              {g.personas.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="persona"
                    data-tour-id="persona-pick"
                    aria-label={t("entry.enter", { name: p.display_name })}
                    aria-describedby={`persona-${p.id}-role`}
                    aria-busy={busy === p.id}
                    disabled={busy !== null}
                    onClick={() => pick(p)}
                  >
                    <span className="avatar persona__avatar" aria-hidden="true">
                      {initialsOf(p.display_name)}
                    </span>
                    <span className="persona__text">
                      <span className="persona__name">{p.display_name}</span>
                      <span className="persona__role" id={`persona-${p.id}-role`}>
                        {[
                          tv("role", p.role, t("role.unknown", { role: p.role })),
                          p.home
                            ? t("entry.home", { home: p.home })
                            : p.role === "guardian" || p.role === "member"
                              ? ""
                              : t("entry.homeNone"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <Icon name="chevronRight" className="persona__go" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
