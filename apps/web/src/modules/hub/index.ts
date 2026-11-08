import type { AppModule } from "../types";
import { dict } from "./dict";
import { AgentsScreen, HelpScreen } from "./screens";

const AI_ROLES = ["owner", "location_manager", "front_desk"];
const label = (k: "nav.ai" | "nav.help") => ({ es: dict.es[k], en: dict.en[k] });

/** Hub pages: the AI agents overview (staff) and Help & Academy (everyone signed in). */
export const module: AppModule = {
  id: "hub",
  routes: [
    { path: "/staff/ai", audience: AI_ROLES, Component: AgentsScreen },
    { path: "/help", audience: "staff", Component: HelpScreen },
    { path: "/help", audience: "member", Component: HelpScreen },
  ],
  nav: [
    { to: "/staff/ai", label: label("nav.ai"), audience: AI_ROLES },
    { to: "/help", label: label("nav.help"), audience: "staff" },
    { to: "/help", label: label("nav.help"), audience: "member" },
  ],
};
