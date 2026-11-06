import { useCallback, useEffect, useRef, useState } from "react";
import { type ErrorCode, toErrorCode } from "../api/client";

export interface AsyncState<T> {
  data: T | null;
  error: ErrorCode | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` on mount and whenever `deps` change; ignores results from superseded runs. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller.
  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((d) => {
        if (id === run.current) setData(d);
      })
      .catch((err: unknown) => {
        if (id === run.current) setError(toErrorCode(err));
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
