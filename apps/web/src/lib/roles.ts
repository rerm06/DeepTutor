import type { MessageKey } from "../i18n/dict";

/** Roles that see the member portal instead of the staff console. */
export function isMemberRole(role: string | null | undefined): boolean {
  return role === "member" || role === "guardian";
}

/** Front of house: register members, change status, record consents (contract: POST /members). */
export function canManageMembers(role: string | null | undefined): boolean {
  return role === "owner" || role === "location_manager" || role === "front_desk";
}

/** Contract: /audit-log is for the owner and for managers (their locations). */
export function canSeeAudit(role: string | null | undefined): boolean {
  return role === "owner" || role === "location_manager";
}

export interface NavItem {
  to: string;
  label: MessageKey;
}

export const ROUTES = {
  entry: "/",
  members: "/staff/members",
  member: (id: string) => `/staff/members/${encodeURIComponent(id)}`,
  inbox: "/staff/inbox",
  audit: "/staff/audit",
  org: "/staff/org",
  myAccount: "/me/account",
  myConsents: "/me/consents",
} as const;

export function navFor(role: string | null | undefined): NavItem[] {
  if (!role) return [];
  if (isMemberRole(role))
    return [
      { to: ROUTES.myAccount, label: "nav.myAccount" },
      { to: ROUTES.myConsents, label: "nav.myConsents" },
    ];
  const items: NavItem[] = [
    { to: ROUTES.members, label: "nav.members" },
    { to: ROUTES.inbox, label: "nav.inbox" },
  ];
  if (canSeeAudit(role)) items.push({ to: ROUTES.audit, label: "nav.audit" });
  items.push({ to: ROUTES.org, label: "nav.org" });
  return items;
}

export function homeFor(role: string | null | undefined): string {
  // Members land on their dashboard ("Mi Panel", module memberhome).
  if (isMemberRole(role)) return "/me/home";
  // Owners and managers land on the executive panel (reports module); everyone else on members.
  if (role === "owner" || role === "location_manager") return "/staff/panel";
  return ROUTES.members;
}

/** Opt in to React Router v7 behaviour now (silences the v6 deprecation warnings). */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
