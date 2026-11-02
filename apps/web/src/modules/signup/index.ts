import type { AppModule } from "../types";
import { AgreementsTab } from "./AgreementsTab";
import { StaffJoinScreen } from "./StaffJoinScreen";
import { dict } from "./dict";
import "./signup.css";

export { JoinScreen } from "./JoinScreen";
export { JoinLink } from "./JoinLink";
export { JoinWelcome } from "./JoinWelcome";

const SWITCH = ["owner", "location_manager"];
const FOH = ["owner", "location_manager", "front_desk"];
const label = (key: keyof typeof dict.es) => ({ es: dict.es[key], en: dict.en[key] });

/**
 * Web UI for module signup ("Únete"). The public page /join/:orgId lives outside the shell (wired in App.tsx because
 * it has no session); here are the signed-in parts: the per-location switch and the agreements tab.
 */
export const module: AppModule = {
  id: "signup",
  routes: [{ path: "/staff/online-join", audience: SWITCH, Component: StaffJoinScreen }],
  nav: [{ to: "/staff/online-join", label: label("nav.join"), audience: SWITCH }],
  memberTabs: [
    { id: "agreements", label: label("tab.agreements"), audience: FOH, Component: AgreementsTab },
  ],
};
