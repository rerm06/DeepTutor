import type { AppModule } from "../types";
import { ChatScreen } from "./ChatScreen";
import { MemoryScreen } from "./MemoryScreen";
import { CoachMemberTab, NutritionDraftTab } from "./StaffTabs";
import { TodayScreen } from "./TodayScreen";

/**
 * Web UI for module coach (coach diario, spec §6.3). Member/guardian: Hoy (check-in + approved plan), Mi memoria
 * and Coach (AI chat, members only). Staff: member-record tab "Coach" for trainer / location manager only (never
 * owner, front desk, chef or accountant — the API returns nothing to them either) and "Borrador de energía" for the
 * licensed-nutrition role.
 */
const COACH_STAFF = ["trainer", "location_manager"] as const;

export const module: AppModule = {
  id: "coach",
  routes: [
    { path: "/me/coach/today", audience: "member", Component: TodayScreen },
    { path: "/me/coach/memory", audience: "member", Component: MemoryScreen },
    { path: "/me/coach/chat", audience: ["member"], Component: ChatScreen },
  ],
  nav: [
    { to: "/me/coach/today", label: { es: "Hoy", en: "Today" }, audience: "member" },
    { to: "/me/coach/memory", label: { es: "Mi memoria", en: "My memory" }, audience: "member" },
    { to: "/me/coach/chat", label: { es: "Coach", en: "Coach" }, audience: ["member"] },
  ],
  memberTabs: [
    {
      id: "coach",
      label: { es: "Coach", en: "Coach" },
      audience: COACH_STAFF,
      Component: CoachMemberTab,
    },
    {
      id: "coach-nutrition",
      label: { es: "Borrador de energía", en: "Energy draft" },
      audience: ["nutritionist"],
      Component: NutritionDraftTab,
    },
  ],
};
