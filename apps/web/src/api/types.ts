/** Shapes from docs/api-contract.md (v1). The contract is the only backend this app assumes. */

export type Role =
  | "owner"
  | "location_manager"
  | "front_desk"
  | "trainer"
  | "nutritionist"
  | "chef"
  | "clinician"
  | "accountant"
  | "member"
  | "guardian";

export interface Persona {
  id: string;
  org: "A" | "B";
  org_name: string;
  /** Logo of the organisation's brand for the entry screen (served from /brand/). */
  org_logo_url?: string | null;
  role: Role | string;
  display_name: string;
  home: string | null;
}

export interface DemoSession {
  token: string;
  expires_in: number;
  persona: Persona;
}

export interface Me {
  organization: { id: string; name: string; saas_plan: string };
  person: { id: string; email: string };
  role: Role | string;
  location_ids: string[];
}

export interface Location {
  id: string;
  name: string;
  brand_id: string;
  timezone: string;
  municipality: string;
}

export interface AuditEntry {
  id: string;
  actor_person_id: string;
  actor_role: string;
  action: string;
  entity: string;
  entity_id: string;
  location_id: string | null;
  at: string;
}

export const MEMBER_STATUSES = [
  "lead",
  "trial",
  "active",
  "frozen",
  "past_due",
  "cancelled",
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export interface Member {
  id: string;
  status: MemberStatus;
  member_no: string | number | null;
  home_location_id: string;
  full_name: string;
  email: string;
}

export interface NewMember {
  email: string;
  full_name: string;
  phone?: string;
  home_location_id: string;
}

export const CHANNELS = ["whatsapp", "sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const PURPOSES = ["transactional", "reminder", "marketing"] as const;
export type Purpose = (typeof PURPOSES)[number];
export type ConsentSource = "front_desk" | "member_portal" | "web_form" | "import";
export type Locale = "es" | "en";

export interface Consent {
  id: string;
  brand_id: string;
  channel: Channel;
  purpose: Purpose;
  status: "granted" | "revoked" | string;
  source: string;
  evidence: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  updated_at: string;
}

export interface ConsentChange {
  brand_id: string;
  channel: Channel;
  purpose: Purpose;
  granted: boolean;
  source: ConsentSource;
  evidence?: string;
}

export interface Template {
  key: string;
  locale: Locale | string;
  purpose: Purpose;
  body: string;
}

export interface MessageVars {
  date?: string;
  time?: string;
  amount?: string;
  last4?: string;
  discount?: string;
}

export interface SendMessage {
  member_id: string;
  brand_id: string;
  channel: Channel;
  template_key: string;
  locale: Locale;
  vars: MessageVars;
}

export interface SendResult {
  id: string;
  status: "queued" | "blocked";
  block_reason: string | null;
  scheduled_for: string | null;
}

export interface Message {
  id: string;
  channel: Channel;
  purpose: Purpose;
  template_key: string;
  body: string;
  status: string;
  block_reason: string | null;
  scheduled_for: string | null;
  created_at: string;
}

export interface InboxItem {
  id: string;
  brand_id: string;
  location_id: string;
  member_id: string | null;
  channel: Channel;
  from_address: string;
  body: string;
  received_at: string;
  handled: boolean;
}

export interface ListOf<T> {
  data: T[];
}

export interface BrandTheme {
  logo_url?: string;
  icon_url?: string;
  logo_alt?: string;
  colors?: Partial<
    Record<
      | "accent"
      | "accent_hover"
      | "accent_text"
      | "header_bg"
      | "header_text"
      | "highlight"
      | "accent_dark"
      | "accent_dark_text",
      string
    >
  >;
  tagline_es?: string;
  tagline_en?: string;
  /** Default colour mode for this brand's console; a person's own choice on the device wins. */
  mode?: "light" | "dark";
}
export interface Brand {
  id: string;
  name: string;
  theme: BrandTheme;
}
