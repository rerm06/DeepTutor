import type { AppModule } from "../types";
import { AgendaScreen } from "./AgendaScreen";
import { AppointmentsScreen } from "./AppointmentsScreen";
import { CheckInScreen } from "./CheckInScreen";
import { MemberScheduleTab } from "./MemberScheduleTab";
import { MyClassesScreen } from "./MyClassesScreen";
import { MyCredentialScreen } from "./MyCredentialScreen";
import { dict } from "./dict";
import "./schedule.css";

const FOH = ["owner", "location_manager", "front_desk"];
const AGENDA = [...FOH, "trainer"];
const APPOINTMENTS = [...AGENDA, "nutritionist", "clinician"];
const label = (key: keyof typeof dict.es) => ({ es: dict.es[key], en: dict.en[key] });

/** Web UI for module schedule (Agenda, reservas y acceso). */
export const module: AppModule = {
  id: "schedule",
  routes: [
    { path: "/staff/schedule", audience: AGENDA, Component: AgendaScreen },
    { path: "/staff/check-in", audience: FOH, Component: CheckInScreen },
    { path: "/staff/appointments", audience: APPOINTMENTS, Component: AppointmentsScreen },
    { path: "/me/classes", audience: "member", Component: MyClassesScreen },
    { path: "/me/credential", audience: "member", Component: MyCredentialScreen },
  ],
  nav: [
    { to: "/staff/schedule", label: label("nav.agenda"), audience: AGENDA },
    { to: "/staff/check-in", label: label("nav.checkin"), audience: FOH },
    { to: "/staff/appointments", label: label("nav.appointments"), audience: APPOINTMENTS },
    { to: "/me/classes", label: label("nav.classes"), audience: "member" },
    { to: "/me/credential", label: label("nav.credential"), audience: "member" },
  ],
  memberTabs: [
    { id: "schedule", label: label("tab.title"), audience: FOH, Component: MemberScheduleTab },
  ],
};
