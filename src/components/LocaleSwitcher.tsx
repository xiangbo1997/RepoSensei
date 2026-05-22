"use client";

import { type Locale, useT } from "@/lib/i18n";

const OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中" },
];

export function LocaleSwitcher() {
  const { locale, setLocale } = useT();
  return (
    <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
      {OPTIONS.map((opt) => {
        const active = opt.value === locale;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLocale(opt.value)}
            className={
              active
                ? "px-3 py-1 bg-amber-600 text-white"
                : "px-3 py-1 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
