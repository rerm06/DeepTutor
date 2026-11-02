import type { AppModule } from "../types";
import { AssessmentsScreen } from "./AssessmentsScreen";
import { MyAssessmentScreen, MyPlanScreen } from "./MemberScreens";
import { HealthMemberTab } from "./MemberTab";
import { PlansScreen } from "./PlansScreen";
import { HEALTH_STAFF } from "./api";

/**
 * Web UI for module health (Evaluación, triaje y planes). Staff entries only for health roles — never
 * front_desk, chef or accountant (the API returns no rows to them either).
 */
export const module: AppModule = {
  id: "health",
  routes: [
    { path: "/staff/health/assessments", audience: HEALTH_STAFF, Component: AssessmentsScreen },
    { path: "/staff/health/plans", audience: HEALTH_STAFF, Component: PlansScreen },
    { path: "/me/health/assessment", audience: "member", Component: MyAssessmentScreen },
    { path: "/me/health/plan", audience: "member", Component: MyPlanScreen },
  ],
  nav: [
    {
      to: "/staff/health/assessments",
      label: { es: "Evaluaciones", en: "Assessments" },
      audience: HEALTH_STAFF,
    },
    { to: "/staff/health/plans", label: { es: "Planes", en: "Plans" }, audience: HEALTH_STAFF },
    {
      to: "/me/health/assessment",
      label: { es: "Mi evaluación", en: "My assessment" },
      audience: "member",
    },
    { to: "/me/health/plan", label: { es: "Mi plan", en: "My plan" }, audience: "member" },
  ],
  memberTabs: [
    {
      id: "health",
      label: { es: "Salud", en: "Health" },
      audience: HEALTH_STAFF,
      Component: HealthMemberTab,
    },
  ],
};
