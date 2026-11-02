import type { AppModule } from "../types";
import { FunnelScreen } from "./Funnel";
import { LeadDetailScreen } from "./LeadDetail";
import { CRM_ROUTES, LeadsBoard } from "./LeadsBoard";
import { MemberTasksTab, TasksScreen } from "./Tasks";
import { FUNNEL_ROLES, MANAGER_ROLES, TASK_ROLES } from "./api";

/** Web UI for module crm (CRM y leads). Visibility mirrors the database: leads for front of house, tasks also
 * for trainers (only their own), the funnel for owners and location managers. Members see nothing. */
export const module: AppModule = {
  id: "crm",
  routes: [
    { path: CRM_ROUTES.leads, audience: MANAGER_ROLES, Component: LeadsBoard },
    { path: "/staff/crm/leads/:id", audience: MANAGER_ROLES, Component: LeadDetailScreen },
    { path: CRM_ROUTES.tasks, audience: TASK_ROLES, Component: TasksScreen },
    { path: CRM_ROUTES.funnel, audience: FUNNEL_ROLES, Component: FunnelScreen },
  ],
  nav: [
    { to: CRM_ROUTES.leads, label: { es: "Leads", en: "Leads" }, audience: MANAGER_ROLES },
    { to: CRM_ROUTES.tasks, label: { es: "Tareas", en: "Tasks" }, audience: TASK_ROLES },
    { to: CRM_ROUTES.funnel, label: { es: "Embudo", en: "Funnel" }, audience: FUNNEL_ROLES },
  ],
  memberTabs: [
    {
      id: "crm-tasks",
      label: { es: "Tareas", en: "Tasks" },
      audience: TASK_ROLES,
      Component: MemberTasksTab,
    },
  ],
};
