import type { AppModule } from "../types";
import { KioskScreen } from "./KioskScreen";
import { MyAccessScreen } from "./MyAccessScreen";
import { dict } from "./dict";
import "./access.css";

const FOH = ["owner", "location_manager", "front_desk"];
const label = (key: keyof typeof dict.es) => ({ es: dict.es[key], en: dict.en[key] });

/** Web UI for access: the door tablet (rotating entry/exit QR, who is inside, cameras) and the member's ways in. */
export const module: AppModule = {
  id: "access",
  routes: [
    { path: "/staff/door", audience: FOH, Component: KioskScreen },
    { path: "/me/access", audience: "member", Component: MyAccessScreen },
  ],
  nav: [
    { to: "/staff/door", label: label("nav.door"), audience: FOH },
    { to: "/me/access", label: label("nav.access"), audience: "member" },
  ],
};

export { DoorScreen, MemberEntry, useGyms } from "./DoorScreen";
