"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  detectInitialLocale,
  dict,
  format,
  LOCALE_STORAGE_KEY,
  type Locale,
  LocaleContext,
  type LocaleContextValue,
} from "@/lib/i18n";

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Server starts in "en" for stable SSG output, client resyncs after mount.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => {
        const template = dict[locale][key] ?? dict.en[key] ?? key;
        return format(template, vars);
      },
    }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
