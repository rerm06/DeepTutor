import { useCallback, useMemo, useState } from "react";
import { useAsync } from "../../lib/useAsync";
import { type CartLine, type Quote, useStoreApi } from "./api";

/** Cart state (product → qty) plus a server-side quote that follows every change. No money math here. */
export function useCart() {
  const store = useStoreApi();
  const [qty, setQty] = useState<Record<string, number>>({});
  const lines: CartLine[] = useMemo(
    () =>
      Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([product_id, q]) => ({ product_id, qty: q })),
    [qty],
  );
  const key = JSON.stringify(lines);
  const quote = useAsync<Quote | null>(
    () => (lines.length ? store.quote(lines) : Promise.resolve(null)),
    [store, key],
  );
  const add = useCallback(
    (id: string, max?: number) =>
      setQty((c) => {
        const next = (c[id] ?? 0) + 1;
        return { ...c, [id]: max !== undefined ? Math.min(next, Math.max(max, 1)) : next };
      }),
    [],
  );
  const set = useCallback(
    (id: string, n: number) =>
      setQty((c) => ({ ...c, [id]: Math.max(0, Math.min(999, Math.trunc(n) || 0)) })),
    [],
  );
  const remove = useCallback(
    (id: string) =>
      setQty((c) => {
        const { [id]: _, ...rest } = c;
        return rest;
      }),
    [],
  );
  const clear = useCallback(() => setQty({}), []);
  return { qty, lines, quote, add, set, remove, clear };
}
