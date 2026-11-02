import type { ApiClient } from "../../api/client";

/** GET /v1/me/home — the member's dashboard read model (module portal, migration 0021). */
export interface MemberHome {
  member: {
    id: string;
    first_name: string;
    member_no: string | null;
    location_name: string | null;
  };
  membership: {
    kind: "subscription" | "credits" | "none";
    name: string | null;
    status: "active" | "frozen" | "past_due" | "expired" | "none";
    renews_on: string | null;
    credits_left: number | null;
    expires_on: string | null;
  };
  next_class: {
    booking_id: string;
    class_name: string;
    room: string | null;
    starts_at: string;
  } | null;
  streak: { days: number; last7: boolean[] };
  week: {
    goal: number;
    trainings: number;
    classes_booked: number;
    classes_attended: number;
    active_minutes: number;
    pct: number;
  };
  programs: Array<{
    id: string;
    kind: "circuit" | "training_plan";
    name: string;
    week: number | null;
    weeks: number | null;
    pct: number;
    href: string;
  }>;
  challenge: { id: string; name: string; joined: boolean; ends_on: string; perks: string[] } | null;
  coach: { enabled: boolean };
  documents: number;
}

export const memberHomeApi = (api: ApiClient) => ({
  home: () => api.request<MemberHome>("GET", "/me/home"),
});
