import type { AppModule } from "../types";
import { MemberHomeScreen } from "./MemberHome";
import { dict } from "./dict";

/** Member home ("Mi Panel"): the member's dashboard (client design). Data: GET /v1/me/home (module portal). */
export const module: AppModule = {
  id: "memberhome",
  routes: [{ path: "/me/home", audience: "member", Component: MemberHomeScreen }],
  nav: [
    {
      to: "/me/home",
      label: { es: dict.es["nav.home"], en: dict.en["nav.home"] },
      audience: "member",
    },
  ],
};
