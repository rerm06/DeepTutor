import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../components/icons";
import { isMemberRole } from "../../lib/roles";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { type HubKey, useHubT } from "./dict";
import "./hub.css";

type Status = "on" | "demo" | "soon";

function AgentCard({
  icon,
  title,
  body,
  status,
  note,
  to,
}: {
  icon: IconName;
  title: string;
  body: string;
  status: Status;
  note?: string;
  to?: string;
}) {
  const { t } = useHubT();
  const plate = status === "on" ? "ok" : status === "demo" ? "warn" : "neutral";
  return (
    <li className="hub-card">
      <span className="hub-card__icon">
        <Icon name={icon} size={26} />
      </span>
      <div className="hub-card__body">
        <h2 className="hub-card__title">{title}</h2>
        <p>{body}</p>
        {note ? <p className="help">{note}</p> : null}
      </div>
      <div className="hub-card__side">
        <span className={`plate plate--${plate}`}>{t(`ai.status.${status}` as HubKey)}</span>
        {to ? (
          <Link className="btn" to={to}>
            {t("ai.open")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function AgentsScreen() {
  const { t } = useHubT();
  const { api } = useSession();
  const status = useAsync(
    () => api.request<{ provider: string; enabled: boolean }>("GET", "/coach/status"),
    [api],
  );
  const coachOn = Boolean(status.data?.enabled);
  return (
    <div className="page">
      <h1 className="page__title">{t("ai.title")}</h1>
      <p className="lede">{t("ai.lede")}</p>
      <ul className="hub-list" data-tour-id="ai-agents">
        <AgentCard
          icon="sparkle"
          title={t("ai.coach.title")}
          body={t("ai.coach.body")}
          status={coachOn ? "on" : "demo"}
          note={
            coachOn
              ? t("ai.coach.on", { provider: status.data?.provider ?? "" })
              : t("ai.coach.demo")
          }
        />
        <AgentCard
          icon="bell"
          title={t("ai.reminders.title")}
          body={t("ai.reminders.body")}
          status="demo"
          note={t("ai.reminders.note")}
          to="/staff/inbox"
        />
        <AgentCard
          icon="chat"
          title={t("ai.sales.title")}
          body={t("ai.sales.body")}
          status="soon"
          note={t("ai.sales.note")}
        />
        <AgentCard
          icon="crm"
          title={t("ai.voice.title")}
          body={t("ai.voice.body")}
          status="soon"
          note={t("ai.voice.note")}
        />
      </ul>
    </div>
  );
}

const STAFF_GUIDES = ["checkin", "sell", "class", "join", "panel"] as const;

export function HelpScreen() {
  const { t } = useHubT();
  const { role } = useSession();
  const guides = useMemo(() => (isMemberRole(role) ? (["member"] as const) : STAFF_GUIDES), [role]);
  return (
    <div className="page">
      <h1 className="page__title">{t("help.title")}</h1>
      <p className="lede">{t("help.lede")}</p>
      <ol className="hub-guides">
        {guides.map((g) => (
          <li key={g} className="hub-guide">
            <h2 className="hub-guide__title">{t(`help.${g}.title` as HubKey)}</h2>
            <p>{t(`help.${g}.body` as HubKey)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
