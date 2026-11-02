import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConsentPanel } from "../components/ConsentPanel";
import { MessageHistory, MessagePanel } from "../components/MessagePanel";
import { ErrorNote, Loading, Plate, Section, memberStatusTone } from "../components/ui";
import { useI18n } from "../i18n/I18nContext";
import { brandsFor } from "../lib/brands";
import { ROUTES, canManageMembers } from "../lib/roles";
import { useAsync } from "../lib/useAsync";
import { useSession } from "../session/SessionContext";

export function MemberDetailScreen() {
  const { id = "" } = useParams();
  const { t, tv } = useI18n();
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

  return (
    <div className="page">
      <p>
        <Link to={ROUTES.members} className="back-link">
          {t("common.back")}
        </Link>
      </p>
      <h1 className="page__title">{member ? member.full_name : t("member.title")}</h1>
      {members.loading ? <Loading /> : null}
      {members.error ? <ErrorNote code={members.error} onRetry={members.reload} /> : null}
      {locations.error ? <ErrorNote code={locations.error} onRetry={locations.reload} /> : null}
      {members.data && !member ? <p className="note note--warn">{t("member.notFound")}</p> : null}

      {member ? (
        <>
          <Section title={t("member.data")}>
            <dl className="facts">
              <div>
                <dt>{t("member.no")}</dt>
                <dd className="mono">{member.member_no ?? t("common.none")}</dd>
              </div>
              <div>
                <dt>{t("member.email")}</dt>
                <dd className="mono">{member.email}</dd>
              </div>
              <div>
                <dt>{t("member.location")}</dt>
                <dd>{home?.name ?? t("common.none")}</dd>
              </div>
              <div>
                <dt>{t("member.status")}</dt>
                <dd>
                  <Plate tone={memberStatusTone(member.status)}>
                    {tv("status", member.status)}
                  </Plate>
                </dd>
              </div>
            </dl>
          </Section>
          <ConsentPanel
            memberId={member.id}
            brands={brands}
            mode="staff"
            canEdit={canManageMembers(role)}
            onChanged={() => setSent((n) => n + 1)}
          />
          <MessagePanel memberId={member.id} brands={brands} onSent={() => setSent((n) => n + 1)} />
          <MessageHistory memberId={member.id} version={sent} />
        </>
      ) : null}
    </div>
  );
}
