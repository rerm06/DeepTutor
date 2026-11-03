import { type KeyboardEvent, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/icons";
import { useSession } from "../../session/SessionContext";
import { CommissionsTab } from "./CommissionsTab";
import { ExpensesTab } from "./ExpensesTab";
import { ExportTab } from "./ExportTab";
import { PayablesTab } from "./PayablesTab";
import { PnlTab } from "./PnlTab";
import { type FinKey, useFinT } from "./dict";
import { isExporter } from "./shared";
import "./finance.css";

type TabId = "pnl" | "payables" | "expenses" | "commissions" | "export";
const TAB_ICON: Record<TabId, IconName> = {
  pnl: "chart",
  payables: "receipt",
  expenses: "card",
  commissions: "users",
  export: "download",
};

/** Staff "Finanzas": P&L, accounts payable, expenses, commissions and the journal export (spec §8). */
export function FinanceScreen() {
  const { t } = useFinT();
  const { role } = useSession();
  const tabs: TabId[] = ["pnl", "payables", "expenses", "commissions"];
  if (isExporter(role)) tabs.push("export");
  const [active, setActive] = useState<TabId>("pnl");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next] as TabId;
    setActive(id);
    refs.current[id]?.focus();
  }

  return (
    <div className="page fin">
      <div className="fin-head">
        <h1 className="page__title">{t("title")}</h1>
        <p className="lede">{t("lede")}</p>
      </div>
      <div role="tablist" aria-label={t("tabs.label")} className="fin-tabs">
        {tabs.map((id, i) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`fin-tab-${id}`}
            aria-selected={active === id}
            aria-controls={`fin-panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            className="fin-tab"
            data-tour-id={`fin-tab-${id}`}
            onClick={() => setActive(id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Icon name={TAB_ICON[id]} size={18} />
            {t(`tabs.${id}` as FinKey)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`fin-panel-${active}`}
        aria-labelledby={`fin-tab-${active}`}
        className="fin-panel"
      >
        {active === "pnl" ? <PnlTab /> : null}
        {active === "payables" ? <PayablesTab /> : null}
        {active === "expenses" ? <ExpensesTab /> : null}
        {active === "commissions" ? <CommissionsTab /> : null}
        {active === "export" && isExporter(role) ? <ExportTab /> : null}
      </div>
    </div>
  );
}
