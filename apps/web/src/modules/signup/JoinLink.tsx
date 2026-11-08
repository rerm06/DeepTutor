import { Link } from "react-router-dom";
import { useModuleT } from "../i18n";
import { DEMO_JOIN_ORGS } from "./demoOrgs";
import { dict } from "./dict";

/** "Únete / Join" entry for one organisation group of the entry screen. Renders nothing for unknown groups. */
export function JoinLink({ org, name }: { org: string; name: string }) {
  const { t } = useModuleT(dict);
  const orgId = DEMO_JOIN_ORGS[org];
  if (!orgId) return null;
  return (
    <Link className="btn join-link" to={`/join/${orgId}`} data-tour-id="entry-join">
      {t("entry.join", { org: name })}
    </Link>
  );
}
