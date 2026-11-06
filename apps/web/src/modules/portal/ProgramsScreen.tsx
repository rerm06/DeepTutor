import { Link } from "react-router-dom";
import { ErrorNote, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { type Program, usePortalApi } from "./api";
import { usePortalT } from "./dict";
import "./portal.css";

/** Member portal "Mis Programas": circuits in progress and published training plans, with progress. */
export function ProgramsScreen() {
  const { t } = usePortalT();
  const papi = usePortalApi();
  const home = useAsync(() => papi.home(), [papi]);
  const programs = home.data?.programs ?? [];

  return (
    <div className="page">
      <h1 className="page__title">{t("programs.title")}</h1>
      <p className="lede">{t("programs.lede")}</p>
      {home.loading && !home.data ? <Loading /> : null}
      {home.error ? <ErrorNote code={home.error} onRetry={home.reload} /> : null}
      {home.data && programs.length === 0 ? (
        <div className="note">
          <span>{t("programs.empty")}</span>
          <Link className="btn" to="/me/circuits" data-tour-id="portal-programs-circuits">
            {t("programs.circuits")}
          </Link>
        </div>
      ) : null}
      {programs.length > 0 ? (
        <ul className="portal-cards">
          {programs.map((p) => (
            <ProgramCard key={`${p.kind}-${p.id}`} program={p} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProgramCard({ program: p }: { program: Program }) {
  const { t } = usePortalT();
  return (
    <li className="portal-card">
      <p className="portal-card__kind">{t(`programs.kind.${p.kind}`)}</p>
      <h2 className="portal-card__title">{p.name}</h2>
      {p.week !== null && p.weeks !== null ? (
        <p className="muted">{t("programs.week", { week: p.week, weeks: p.weeks })}</p>
      ) : null}
      <div className="portal-meter">
        <progress max={100} value={p.pct} aria-label={t("programs.progress", { name: p.name })} />
        <span className="portal-meter__pct">{t("programs.pct", { pct: p.pct })}</span>
      </div>
      <Link
        className="btn"
        to={p.href}
        aria-label={t("programs.open", { name: p.name })}
        data-tour-id={`portal-program-${p.kind}`}
      >
        {p.kind === "circuit" ? t("programs.circuits") : t("programs.plan")}
      </Link>
    </li>
  );
}
