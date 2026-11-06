import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../../components/icons";
import { useCurrentBrand } from "../../lib/brandTheme";
import { useNavTargets } from "../../lib/navTargets";
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
    <li className="section hub-card">
      <div className="hub-card__head">
        <span className="hub-card__icon">
          <Icon name={icon} size={26} />
        </span>
        <span className={`plate plate--${plate}`}>{t(`ai.status.${status}` as HubKey)}</span>
      </div>
      <h3 className="hub-card__title">{title}</h3>
      <p className="hub-card__body">{body}</p>
      {note ? <p className="help hub-card__note">{note}</p> : null}
      {to ? (
        <Link className="ds-cta hub-card__cta" to={to}>
          {t("ai.open")}
          <Icon name="arrowRight" size={18} />
        </Link>
      ) : null}
    </li>
  );
}

/** Title + lede over the brand's promo image (own /brand asset, decorative). */
function HubHero({
  title,
  lede,
  icon,
  img,
}: {
  title: string;
  lede: string;
  icon: IconName;
  img?: string;
}) {
  return (
    <header
      className={`hub-hero${img ? " hub-hero--photo" : ""}`}
      style={img ? { ["--hub-img" as string]: `url("${img}")` } : undefined}
    >
      <span className="hub-hero__mark" aria-hidden="true">
        <Icon name={icon} size={30} />
      </span>
      <h1 className="page__title">{title}</h1>
      <span className="hub-hero__rule" aria-hidden="true" />
      <p className="lede hub-hero__lede">{lede}</p>
    </header>
  );
}

export function AgentsScreen() {
  const { t } = useHubT();
  const { api } = useSession();
  const brand = useCurrentBrand();
  const status = useAsync(
    () => api.request<{ provider: string; enabled: boolean }>("GET", "/coach/status"),
    [api],
  );
  const coachOn = Boolean(status.data?.enabled);
  return (
    <div className="page">
      <HubHero
        title={t("ai.title")}
        lede={t("ai.lede")}
        icon="sparkle"
        img={brand?.theme.promo_url}
      />
      <section className="hub-block" aria-labelledby="hub-agents">
        <h2 id="hub-agents" className="section__title">
          <Icon name="layers" size={24} />
          {t("ai.agents")}
        </h2>
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
            icon="headset"
            title={t("ai.voice.title")}
            body={t("ai.voice.body")}
            status="soon"
            note={t("ai.voice.note")}
          />
        </ul>
      </section>
    </div>
  );
}

const STAFF_GUIDES = ["checkin", "sell", "class", "join", "panel"] as const;
type Guide = (typeof STAFF_GUIDES)[number] | "member";
const GUIDE_ICON: Record<Guide, IconName> = {
  checkin: "qr",
  sell: "receipt",
  class: "calendarPlus",
  join: "userPlus",
  panel: "chart",
  member: "home",
};
/** Shortcut tiles: shown only when the signed-in role can open the route (from the shell's nav targets). */
const STAFF_TILES: ReadonlyArray<readonly [HubKey, IconName, string]> = [
  ["help.checkin.title", "qr", "/staff/check-in"],
  ["help.sell.title", "receipt", "/staff/store/pos"],
  ["help.class.title", "calendarPlus", "/staff/schedule"],
  ["help.join.title", "userPlus", "/staff/online-join"],
  ["help.panel.title", "chart", "/staff/panel"],
];
const MEMBER_TILES: ReadonlyArray<readonly [HubKey, IconName, string]> = [
  ["help.tile.membership", "card", "/me/membership"],
  ["help.tile.classes", "calendarPlus", "/me/classes"],
  ["help.tile.credential", "qr", "/me/credential"],
  ["help.tile.coach", "chat", "/me/coach/chat"],
];

export function HelpScreen() {
  const { t } = useHubT();
  const { role } = useSession();
  const brand = useCurrentBrand();
  const targets = useNavTargets();
  const member = isMemberRole(role);
  const guides = useMemo<readonly Guide[]>(() => (member ? ["member"] : STAFF_GUIDES), [member]);
  const tiles = (member ? MEMBER_TILES : STAFF_TILES).filter(([, , to]) => targets.has(to));
  return (
    <div className="page">
      <HubHero
        title={t(member ? "help.titleMember" : "help.title")}
        lede={t("help.lede")}
        icon={member ? "headset" : "academy"}
        img={brand?.theme.hero_url}
      />
      {tiles.length > 0 ? (
        <section className="hub-block" aria-labelledby="hub-shortcuts">
          <h2 id="hub-shortcuts" className="section__title">
            <Icon name="grid" size={24} />
            {t("help.shortcuts")}
          </h2>
          <div className="ds-tiles">
            {tiles.map(([key, icon, to]) => (
              <Link key={to} className="ds-tile" to={to}>
                <Icon name={icon} size={34} />
                <span>{t(key)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section className="hub-block" aria-labelledby="hub-guides">
        <h2 id="hub-guides" className="section__title">
          <Icon name="academy" size={24} />
          {t("help.guides")}
        </h2>
        <ol className="hub-guides">
          {guides.map((g) => (
            <li key={g} className="section hub-guide">
              <h3 className="section__title hub-guide__title">
                <Icon name={GUIDE_ICON[g]} size={24} />
                {t(`help.${g}.title` as HubKey)}
              </h3>
              <p>{t(`help.${g}.body` as HubKey)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
