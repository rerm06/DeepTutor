import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { canSeeAudit, homeFor, isMemberRole } from "./lib/roles";
import { AuditScreen } from "./screens/AuditScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { InboxScreen } from "./screens/InboxScreen";
import { MemberDetailScreen } from "./screens/MemberDetailScreen";
import { MembersScreen } from "./screens/MembersScreen";
import { MyAccountScreen } from "./screens/MyAccountScreen";
import { MyConsentsScreen } from "./screens/MyConsentsScreen";
import { OrgScreen } from "./screens/OrgScreen";
import { useSession } from "./session/SessionContext";

export function AppRoutes() {
  const { persona, role } = useSession();

  if (!persona) {
    return (
      <Layout>
        <EntryScreen />
      </Layout>
    );
  }

  const member = isMemberRole(role);
  return (
    <Layout>
      <Routes>
        {member ? (
          <>
            <Route path="/me/account" element={<MyAccountScreen />} />
            <Route path="/me/consents" element={<MyConsentsScreen />} />
          </>
        ) : (
          <>
            <Route path="/staff/members" element={<MembersScreen />} />
            <Route path="/staff/members/:id" element={<MemberDetailScreen />} />
            <Route path="/staff/inbox" element={<InboxScreen />} />
            {canSeeAudit(role) ? <Route path="/staff/audit" element={<AuditScreen />} /> : null}
            <Route path="/staff/org" element={<OrgScreen />} />
          </>
        )}
        <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
      </Routes>
    </Layout>
  );
}
