import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Lang, type MessageKey, type Params, hasKey, translate } from "./dict";

const LANG_KEY = "gym.lang";

function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === "es" || stored === "en") return stored;
  } catch {
    // Storage blocked: Spanish first.
  }
  return "es";
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  /** Translate `${prefix}.${value}` when it exists, else `fallback` (or the raw value). */
  tv: (prefix: string, value: string, fallback?: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, lang: fixed }: { children: ReactNode; lang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => fixed ?? initialLang());

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, "app.title");
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // Not persisted; the choice still applies to this tab.
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      tv: (prefix, v, fallback) => {
        const key = `${prefix}.${v}`;
        return hasKey(key) ? translate(lang, key) : (fallback ?? v);
      },
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
