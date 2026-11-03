import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ConsentPanel } from "../components/ConsentPanel";
import { MemberAvatar, MemberPhotoCard } from "../components/MemberPhotoCard";
import { MessageHistory, MessagePanel } from "../components/MessagePanel";
import { ErrorNote, Loading, Plate, memberStatusTone } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { brandsFor } from "../lib/brands";
import { ROUTES, canManageMembers } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { MODULES } from "../modules/registry";
import { allows } from "../modules/types";
import { useSession } from "../session/SessionContext";
import { Stat, initialsOf, useCoreCopy } from "./kit";

interface RecordTab {
  id: string;
  label: string;
  panel: ReactNode;
}

export function MemberDetailScreen() {
  const { id = "" } = useParams();
  const { t, tv, lang } = useI18n();
  const c = useCoreCopy();
  const { api, role } = useSession();
  // The contract has no GET /members/:id; the record comes from the caller's scoped list.
  const members = useAsync(() => api.members(), [api]);
  const locations = useAsync(() => api.locations(), [api]);
  const [sent, setSent] = useState(0);

  const member = members.data?.data.find((m) => m.id === id) ?? null;
  const locs = locations.data?.data ?? [];
  const home = locs.find((l) => l.id === member?.home_location_id);
  const brands = useMemo(
    () =>
      member
        ? brandsFor(locs, [member.home_location_id], (names) =>
            t("member.brandOf", { locations: names }),
          )
        : [],
    [locs, member, t],
  );

  const tabs: RecordTab[] = member
    ? [
        {
          id: "photo",
          label: lang === "en" ? "Photo" : "Foto",
          panel: <MemberPhotoCard memberId={member.id} canEdit={canManageMembers(role)} />,
        },
        {
          id: "consents",
          label: c("member.tab.consents"),
          panel: (
            <ConsentPanel
              memberId={member.id}
              brands={brands}
              mode="staff"
              canEdit={canManageMembers(role)}
              onChanged={() => setSent((n) => n + 1)}
            />
          ),
        },
        {
          id: "messages",
          label: c("member.tab.messages"),
          panel: (
            <>
              <MessagePanel
                memberId={member.id}
                brands={brands}
                onSent={() => setSent((n) => n + 1)}
              />
              <MessageHistory memberId={member.id} version={sent} />
            </>
          ),
        },
        ...MODULES.flatMap((m) => m.memberTabs ?? [])
          .filter((tab) => allows(tab.audience, role))
          .map((tab) => ({
            id: tab.id,
            label: tab.label[lang === "en" ? "en" : "es"],
            panel: <tab.Component memberId={member.id} />,
          })),
      ]
    : [];

  return (
    <div className="page core-page">
      <p>
        <Link to={ROUTES.members} className="back-link">
          {t("common.back")}
        </Link>
      </p>
      {member ? (
        <header className="ds-hero core-member">
          <MemberAvatar
            memberId={member.id}
            name={member.full_name}
            size={88}
            className="core-member__avatar"
          />
          <div className="core-member__text">
            <h1 className="page__title">{member.full_name}</h1>
            <p className="core-member__meta">
              <span className="mono">{member.member_no ?? t("common.none")}</span>
              <Plate tone={memberStatusTone(member.status)}>{tv("status", member.status)}</Plate>
            </p>
          </div>
        </header>
      ) : (
        <h1 className="page__title">{t("member.title")}</h1>
      )}
      {members.loading ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
      {members.data && !member ? <p className="note note--warn">{t("member.notFound")}</p> : null}

      {member ? (
        <>
          <div className="ds-stats core-facts">
            <Stat icon="pin" label={t("member.location")} value={home?.name ?? t("common.none")} />
            <Stat icon="mail" label={t("member.email")} value={member.email} mono />
            {brands[0] ? (
              <Stat icon="building" label={t("member.brand")} value={brands[0].label} />
            ) : null}
          </div>
          <RecordTabs label={c("member.tabs")} tabs={tabs} />
        </>
      ) : null}
    </div>
  );
}

/**
 * The record's sections as an ARIA tab strip. Every panel stays mounted (hidden when not selected), so each
 * module tab loads exactly as before; the selected tab is kept in `?tab=` so a record can be linked to a tab.
 */
function RecordTabs({ label, tabs }: { label: string; tabs: RecordTab[] }) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("tab");
  const current = tabs.find((tab) => tab.id === wanted)?.id ?? tabs[0]?.id ?? "";
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function select(id: string, focus = false) {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true });
    if (focus) refs.current.get(id)?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((tab) => tab.id === current);
    const last = tabs.length - 1;
    const to =
      e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    const tab = tabs[to];
    if (tab) select(tab.id, true);
  }

  return (
    <div className="core-tabs">
      <div className="core-tabs__strip">
        <div role="tablist" aria-label={label} className="core-tabs__list" onKeyDown={onKey}>
          {tabs.map((tab) => {
            const on = tab.id === current;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) refs.current.set(tab.id, el);
                  else refs.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                id={`member-tab-${tab.id}`}
                aria-selected={on}
                aria-controls={`member-panel-${tab.id}`}
                tabIndex={on ? 0 : -1}
                className="core-tabs__tab"
                onClick={() => select(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`member-panel-${tab.id}`}
          aria-labelledby={`member-tab-${tab.id}`}
          className="core-tabs__panel"
          hidden={tab.id !== current}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
