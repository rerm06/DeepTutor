import type { AppModule } from "../types";
import { InventoryScreen } from "./InventoryScreen";
import { MemberPurchasesTab } from "./MemberPurchasesTab";
import { PosScreen } from "./PosScreen";
import { ProductsScreen } from "./ProductsScreen";
import { SalesScreen } from "./SalesScreen";
import { ShopScreen } from "./ShopScreen";
import { storeDict } from "./dict";
import "./store.css";

const SELLERS = ["owner", "location_manager", "front_desk"] as const;
const MANAGERS = ["owner", "location_manager"] as const;
const SALES_READERS = [...SELLERS, "accountant"] as const;
const label = (key: keyof typeof storeDict.es) => ({
  es: storeDict.es[key],
  en: storeDict.en[key],
});

export const STORE_ROUTES = {
  pos: "/staff/store/pos",
  inventory: "/staff/store/inventory",
  sales: "/staff/store/sales",
  products: "/staff/store/products",
  shop: "/me/store",
} as const;

/**
 * Web UI for module store (Tienda, POS e inventario). Trainers, nutrition, chef and clinical roles get nothing;
 * the accountant reads sales only; members and guardians get the shop (only members order).
 */
export const module: AppModule = {
  id: "store",
  routes: [
    { path: STORE_ROUTES.pos, audience: SELLERS, Component: PosScreen },
    { path: STORE_ROUTES.inventory, audience: SELLERS, Component: InventoryScreen },
    { path: STORE_ROUTES.sales, audience: SALES_READERS, Component: SalesScreen },
    { path: STORE_ROUTES.products, audience: MANAGERS, Component: ProductsScreen },
    { path: STORE_ROUTES.shop, audience: "member", Component: ShopScreen },
  ],
  nav: [
    { to: STORE_ROUTES.pos, label: label("nav.pos"), audience: SELLERS },
    { to: STORE_ROUTES.inventory, label: label("nav.inventory"), audience: SELLERS },
    { to: STORE_ROUTES.sales, label: label("nav.sales"), audience: SALES_READERS },
    { to: STORE_ROUTES.products, label: label("nav.products"), audience: MANAGERS },
    { to: STORE_ROUTES.shop, label: label("nav.shop"), audience: "member" },
  ],
  memberTabs: [
    {
      id: "store-purchases",
      label: label("tab.title"),
      audience: SALES_READERS,
      Component: MemberPurchasesTab,
    },
  ],
};
