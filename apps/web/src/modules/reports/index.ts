import { createElement } from "react";
import { Navigate } from "react-router-dom";
import type { AppModule } from "../types";
import { PanelScreen } from "./Panel";
import { IvuReportScreen, MembersReportScreen, SalesReportScreen } from "./Reports";
import { TodayScreen } from "./Today";
import {
  FINANCE_ROLES,
  MEMBERS_REPORT_ROLES,
  PANEL_ROLES,
  REPORTS_ROUTES,
  TODAY_ROLES,
} from "./api";

function ReportsIndex() {
  return createElement(Navigate, { to: REPORTS_ROUTES.ivu, replace: true });
}

/**
 * Web UI for module reports (Panel y reportes). Visibility mirrors the database role gates (migration 0014):
 * Panel for owners and location managers; "Hoy" for front desk (also reachable by managers); IVU and Ventas also
 * for the accountant (read-only); Socios for owners and managers. Members, guardians and the other staff roles
 * see nothing here.
 */
export const module: AppModule = {
  id: "reports",
  routes: [
    { path: REPORTS_ROUTES.panel, audience: PANEL_ROLES, Component: PanelScreen },
    { path: REPORTS_ROUTES.today, audience: TODAY_ROLES, Component: TodayScreen },
    { path: REPORTS_ROUTES.reports, audience: FINANCE_ROLES, Component: ReportsIndex },
    { path: REPORTS_ROUTES.ivu, audience: FINANCE_ROLES, Component: IvuReportScreen },
    { path: REPORTS_ROUTES.sales, audience: FINANCE_ROLES, Component: SalesReportScreen },
    {
      path: REPORTS_ROUTES.members,
      audience: MEMBERS_REPORT_ROLES,
      Component: MembersReportScreen,
    },
  ],
  nav: [
    { to: REPORTS_ROUTES.panel, label: { es: "Panel", en: "Dashboard" }, audience: PANEL_ROLES },
    { to: REPORTS_ROUTES.today, label: { es: "Hoy", en: "Today" }, audience: ["front_desk"] },
    { to: REPORTS_ROUTES.ivu, label: { es: "Reportes", en: "Reports" }, audience: FINANCE_ROLES },
  ],
  memberTabs: [],
};
