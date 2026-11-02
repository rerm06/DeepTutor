import { useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";
import type { Persona } from "../api/types";
import { ErrorNote, LiveResult, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";

interface OrgGroup {
  org: string;
  name: string;
  personas: Persona[];
}

export function groupByOrg(personas: Persona[]): OrgGroup[] {
  const groups = new Map<string, OrgGroup>();
  for (const p of personas) {
    const g = groups.get(p.org) ?? { org: p.org, name: p.org_name, personas: [] };
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
    <div className="page">
      <h1 className="page__title">{t("entry.title")}</h1>
      <p className="lede">{t("entry.intro")}</p>
      {lost ? <p className="note note--warn">{t("session.lost")}</p> : null}
      <LiveResult>
        {busy ? t("entry.starting") : null}
        {error ? <ErrorNote code={error} /> : null}
      </LiveResult>

      {personas.loading ? <Loading /> : null}
      {personas.error ? <ErrorNote code={personas.error} onRetry={personas.reload} /> : null}
      {personas.data && personas.data.data.length === 0 ? (
        <p className="muted">{t("entry.empty")}</p>
      ) : null}

      <div className="org-groups">
        {groupByOrg(personas.data?.data ?? []).map((g) => (
          <section key={g.org} className="org-group" aria-labelledby={`org-${g.org}`}>
            <h2 id={`org-${g.org}`} className="org-group__title">
              <span className="org-group__code">{t("entry.org", { org: g.org })}</span>
              <span>{g.name}</span>
            </h2>
            <ul className="persona-list">
              {g.personas.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="persona"
                    data-tour-id="persona-pick"
                    aria-label={t("entry.enter", { name: p.display_name })}
                    aria-describedby={`persona-${p.id}-role`}
                    disabled={busy !== null}
                    onClick={() => pick(p)}
                  >
                    <span className="persona__name">{p.display_name}</span>
                    <span className="persona__role" id={`persona-${p.id}-role`}>
                      {tv("role", p.role, t("role.unknown", { role: p.role }))}
                      {" · "}
                      {p.home ? t("entry.home", { home: p.home }) : t("entry.homeNone")}
                    </span>
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
