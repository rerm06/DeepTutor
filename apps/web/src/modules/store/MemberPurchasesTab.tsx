import { ErrorNote, Loading } from "../../components/ui";
import { useAsync } from "../../lib/useAsync";
import { useSession } from "../../session/SessionContext";
import { SalesTable } from "./SalesScreen";
import { useStoreApi } from "./api";
import { StoreEmpty, StoreSection } from "./components";
import { useStoreT } from "./dict";

/** Store purchases of one member, inside the staff member record (sellers and the accountant). */
export function MemberPurchasesTab({ memberId }: { memberId: string }) {
  const { t } = useStoreT();
  const { api } = useSession();
  const store = useStoreApi();
  const sales = useAsync(() => store.sales({ member_id: memberId }), [store, memberId]);
  const locations = useAsync(() => api.locations(), [api]);
  const locName = new Map((locations.data?.data ?? []).map((l) => [l.id, l.name]));
  return (
    <StoreSection title={t("tab.title")} icon="bag">
      {sales.loading ? <Loading /> : null}
      {sales.error ? <ErrorNote code={sales.error} onRetry={sales.reload} /> : null}
      {sales.data && sales.data.data.length === 0 ? (
        <StoreEmpty icon="bag" title={t("tab.empty")} />
      ) : null}
      {sales.data && sales.data.data.length > 0 ? (
        <SalesTable rows={sales.data.data} locName={locName} onChanged={() => sales.reload()} />
      ) : null}
    </StoreSection>
  );
}
