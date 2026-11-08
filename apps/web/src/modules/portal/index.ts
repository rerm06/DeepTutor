import type { AppModule } from "../types";
import { DocumentsScreen } from "./DocumentsScreen";
import { NutritionScreen } from "./NutritionScreen";
import { ProgramsScreen } from "./ProgramsScreen";
import { ProgressScreen } from "./ProgressScreen";
import { dict } from "./dict";

const label = (key: keyof typeof dict.es) => ({ es: dict.es[key], en: dict.en[key] });

export const PORTAL_ROUTES = {
  progress: "/me/progress",
  programs: "/me/programs",
  nutrition: "/me/nutrition",
  documents: "/me/documents",
} as const;

/**
 * Web UI for module portal (member portal). Member audience only (members and guardians; a guardian sees the
 * ward's data and cannot change the goal). The member home screen is built elsewhere against GET /v1/me/home.
 */
export const module: AppModule = {
  id: "portal",
  routes: [
    { path: PORTAL_ROUTES.progress, audience: "member", Component: ProgressScreen },
    { path: PORTAL_ROUTES.programs, audience: "member", Component: ProgramsScreen },
    { path: PORTAL_ROUTES.nutrition, audience: "member", Component: NutritionScreen },
    { path: PORTAL_ROUTES.documents, audience: "member", Component: DocumentsScreen },
  ],
  nav: [
    { to: PORTAL_ROUTES.progress, label: label("nav.progress"), audience: "member" },
    { to: PORTAL_ROUTES.programs, label: label("nav.programs"), audience: "member" },
    { to: PORTAL_ROUTES.nutrition, label: label("nav.nutrition"), audience: "member" },
    { to: PORTAL_ROUTES.documents, label: label("nav.documents"), audience: "member" },
  ],
  memberTabs: [],
};
