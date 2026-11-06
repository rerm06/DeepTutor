import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ApiClient, toErrorCode } from "../api/client";
import type { Me, Persona } from "../api/types";

export interface Session {
  api: ApiClient;
  persona: Persona | null;
  me: Me | null;
  /** Role from /me when loaded, else from the persona. */
  role: string | null;
  /** True when the last session ended on its own (expired and could not be renewed). */
  lost: boolean;
  login: (personaId: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [persona, setPersona] = useState<Persona | null>(api.persona);
  const [me, setMe] = useState<Me | null>(null);
  const [lost, setLost] = useState(false);
  const manualLogout = useRef(false);

  useEffect(
    () =>
      api.subscribe((p) => {
        setPersona((prev) => (prev?.id === p?.id ? prev : p));
        if (!p) {
          setMe(null);
          setLost(!manualLogout.current);
          manualLogout.current = false;
        } else setLost(false);
      }),
    [api],
  );

  const personaId = persona?.id;
  useEffect(() => {
    if (!personaId) return;
    let alive = true;
    api
      .me()
      .then((m) => {
        if (alive) setMe(m);
      })
      .catch((err: unknown) => {
        // Screens show their own errors; an expired session is handled by the subscription.
        if (alive && toErrorCode(err) !== "unauthenticated") setMe(null);
      });
    return () => {
      alive = false;
    };
  }, [api, personaId]);

  const login = useCallback(
    async (id: string) => {
      setMe(null);
      await api.startSession(id);
    },
    [api],
  );
  const logout = useCallback(() => {
    manualLogout.current = true;
    api.endSession();
  }, [api]);

  const value = useMemo<Session>(
    () => ({ api, persona, me, role: me?.role ?? persona?.role ?? null, lost, login, logout }),
    [api, persona, me, lost, login, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

export function useApi(): ApiClient {
  return useSession().api;
}
