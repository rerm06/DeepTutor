import type { AppModule } from "../types";
import { FinanceScreen } from "./FinanceScreen";
import { dict } from "./dict";
import { FINANCE_READERS } from "./shared";

export const FINANCE_ROUTES = { finance: "/staff/finance" } as const;

/**
 * Web UI for module finance (spec §8 · Finanzas, gastos y cuentas por pagar). Owner, location managers (their
 * locations) and the accountant (read-only + exports). Nobody else — mirrors app.fin_reader_at in migration 0013.
 */
export const module: AppModule = {
  id: "finance",
  routes: [{ path: FINANCE_ROUTES.finance, audience: FINANCE_READERS, Component: FinanceScreen }],
  nav: [
    {
      to: FINANCE_ROUTES.finance,
      label: { es: dict.es["nav.finance"], en: dict.en["nav.finance"] },
      audience: FINANCE_READERS,
    },
  ],
  memberTabs: [],
};
