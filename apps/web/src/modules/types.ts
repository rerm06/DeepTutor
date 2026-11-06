import type { ComponentType } from "react";

export type Lang = "es" | "en";
export type Localized = Record<Lang, string>;
/** Who sees a module entry: explicit role list, every staff role, or members/guardians. */
export type Audience = readonly string[] | "staff" | "member";

export interface ModuleRoute {
  /** Absolute path, e.g. "/staff/schedule" or "/me/classes". Use ":param" segments as needed. */
  path: string;
  audience: Audience;
  Component: ComponentType;
}
export interface ModuleNavItem {
  to: string;
  label: Localized;
  audience: Audience;
}
/** A tab rendered inside the staff member record (MemberDetailScreen). */
export interface MemberTab {
  id: string;
  label: Localized;
  audience: Audience;
  Component: ComponentType<{ memberId: string }>;
}
export interface AppModule {
  id: string;
  routes: ModuleRoute[];
  nav: ModuleNavItem[];
  memberTabs?: MemberTab[];
}

const MEMBER_ROLES = ["member", "guardian"];
export function allows(audience: Audience, role: string | null | undefined): boolean {
  if (!role) return false;
  if (audience === "staff") return !MEMBER_ROLES.includes(role);
  if (audience === "member") return MEMBER_ROLES.includes(role);
  return audience.includes(role);
}
