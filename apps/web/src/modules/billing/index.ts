import type { AppModule } from "../types";
import { BillingScreen } from "./BillingScreen";
import { CatalogScreen } from "./CatalogScreen";
import { MemberBillingTab } from "./MemberBillingTab";
import { MyMembershipScreen } from "./MyMembershipScreen";
import { billingDict } from "./dict";

const BILLING_READERS = ["owner", "location_manager", "front_desk", "accountant"] as const;
const CATALOG_MANAGERS = ["owner", "location_manager"] as const;

export const BILLING_ROUTES = {
  billing: "/staff/billing",
  catalog: "/staff/billing/catalog",
  myMembership: "/me/membership",
} as const;

const label = (key: keyof typeof billingDict.es) => ({
  es: billingDict.es[key],
  en: billingDict.en[key],
});

/** Web UI for module billing (Membresías, catálogo y facturación). */
export const module: AppModule = {
  id: "billing",
  routes: [
    { path: BILLING_ROUTES.billing, audience: BILLING_READERS, Component: BillingScreen },
    { path: BILLING_ROUTES.catalog, audience: CATALOG_MANAGERS, Component: CatalogScreen },
    { path: BILLING_ROUTES.myMembership, audience: "member", Component: MyMembershipScreen },
  ],
  nav: [
    { to: BILLING_ROUTES.billing, label: label("nav.billing"), audience: BILLING_READERS },
    { to: BILLING_ROUTES.catalog, label: label("nav.catalog"), audience: CATALOG_MANAGERS },
    { to: BILLING_ROUTES.myMembership, label: label("nav.myMembership"), audience: "member" },
  ],
  memberTabs: [
    {
      id: "billing",
      label: label("tab.title"),
      audience: BILLING_READERS,
      Component: MemberBillingTab,
    },
  ],
};
