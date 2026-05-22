"use client";

import { useT } from "@/lib/i18n";
import type { ProjectSummary } from "@/lib/types";
import { MermaidView } from "./MermaidView";

interface Props {
  summary: ProjectSummary;
}

export function SummaryView({ summary }: Props) {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          {t("summary.overview")}
        </h2>
        <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
          {summary.overview}
        </p>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          {t("summary.techStack")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {summary.techStack.map((t) => (
            <span
              key={t}
              className="px-2 py-1 text-xs rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {summary.entryPoints.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            {t("summary.entryPoints")}
          </h2>
          <ul className="space-y-1">
            {summary.entryPoints.map((ep) => (
              <li
                key={ep}
                className="font-mono text-sm text-slate-700 dark:text-slate-300"
              >
                · {ep}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          {t("summary.architecture")}
        </h2>
        <MermaidView code={summary.mermaidArchitecture} />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          {t("summary.modules")}
        </h2>
        <div className="grid gap-3">
          {summary.modules.map((m) => (
            <div
              key={m.path}
              className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {m.path}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {m.purpose}
              </div>
              {m.keyFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.keyFiles.map((f) => (
                    <span
                      key={f}
                      className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {summary.conceptCards.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {t("summary.concepts")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {summary.conceptCards.map((c) => (
              <div
                key={c.name}
                className="p-4 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border border-amber-200 dark:border-amber-900"
              >
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  {c.name}
                </div>
                <div className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                  {c.oneLiner}
                </div>
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-400 italic">
                  {t("summary.concept.found", { evidence: c.evidence })}
                </div>
                <a
                  href={c.learnMore}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-amber-700 dark:text-amber-400 underline hover:text-amber-900 dark:hover:text-amber-200"
                >
                  {t("summary.concept.learnMore")}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
