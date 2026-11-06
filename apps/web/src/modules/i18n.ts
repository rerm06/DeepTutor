import { useI18n } from "../i18n/I18nContext";
import type { Lang } from "./types";

/**
 * Module-local dictionaries: each module keeps its own ES/EN strings next to its screens, so modules never edit
 * the core dictionary. Both languages must carry the same keys (checked by `defineDict`'s types).
 * Copy rule (Ley 82): never call any role or feature by the regulated nutrition titles.
 */
export function defineDict<K extends string>(d: { es: Record<K, string>; en: Record<K, string> }) {
  return d;
}

export function useModuleT<K extends string>(d: { es: Record<K, string>; en: Record<K, string> }) {
  const { lang } = useI18n();
  return {
    lang: lang as Lang,
    t(key: K, params?: Record<string, string | number>): string {
      let s = d[lang as Lang][key] ?? key;
      if (params)
        for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
  };
}
