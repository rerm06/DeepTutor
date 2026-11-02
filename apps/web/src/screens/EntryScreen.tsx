import { useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";
import type { Persona } from "../api/types";
import { ErrorNote, LiveResult, Loading } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { useAsync } from "../lib/useAsync";
import { JoinLink } from "../modules/signup";
import { useSession } from "../session/SessionContext";

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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("");
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
              {g.logo ? (
                <img className="org-group__logo" src={g.logo} alt={g.name} height={40} />
              ) : (
                <span>{g.name}</span>
              )}
            </h2>
            <JoinLink org={g.org} name={g.name} />
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
                    <svg
                      className="icon persona__go"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
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
