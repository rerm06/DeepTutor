import { createContext, useContext } from "react";

/**
 * The set of routes the signed-in role can open, provided by the shell (Layout) from the module registry.
 * Lives in its own file so module screens can read it without importing the registry (no import cycle).
 */
export const NavTargets = createContext<ReadonlySet<string>>(new Set());
export const useNavTargets = () => useContext(NavTargets);
