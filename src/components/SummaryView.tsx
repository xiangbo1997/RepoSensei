"use client";

import { useT } from "@/lib/i18n";
import { buildTour } from "@/lib/tour";
import type { ProjectSummary } from "@/lib/types";
import { MermaidView } from "./MermaidView";

interface Props {
  summary: ProjectSummary;
}

export function SummaryView({ summary }: Props) {
  const { t } = useT();
  const tour = buildTour(summary.modules);
  // 仅当 LLM 给出了模块依赖（产生多于一层）时才展示学习路径，否则与 Modules 冗余。
  const showTour = tour.some((s) => s.layer > 0);
  return (
    <div className="space-y-10 py-2">
      <section className="animate-in" style={{ animationDelay: "0ms" }}>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
          {t("summary.overview")}
        </h2>
        <p className="text-base text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
          {summary.overview}
        </p>
      </section>

      <section className="animate-in" style={{ animationDelay: "100ms" }}>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
          {t("summary.techStack")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {summary.techStack.map((stack) => (
            <span
              key={stack}
              className="px-3 py-1 text-xs font-bold rounded-full bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/5 hover:border-amber-500/30 transition-colors"
            >
              {stack}
            </span>
          ))}
        </div>
      </section>

      {summary.entryPoints.length > 0 && (
        <section className="animate-in" style={{ animationDelay: "200ms" }}>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
            {t("summary.entryPoints")}
          </h2>
          <div className="grid gap-2">
            {summary.entryPoints.map((ep) => (
              <div
                key={ep}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5"
              >
                <span className="text-amber-500">🚀</span>
                <code className="text-xs font-mono text-slate-700 dark:text-slate-300">
                  {ep}
                </code>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="animate-in" style={{ animationDelay: "300ms" }}>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
          {t("summary.architecture")}
        </h2>
        <div className="p-4 rounded-2xl bg-white dark:bg-black/20 border border-slate-100 dark:border-white/5 shadow-inner">
          <MermaidView code={summary.mermaidArchitecture} />
        </div>
      </section>

      {showTour && (
        <section className="animate-in" style={{ animationDelay: "350ms" }}>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
            🧭 {t("summary.tour")}
          </h2>
          <ol className="relative border-l-2 border-amber-200 dark:border-amber-900/40 ml-2 space-y-3">
            {tour.map((step, i) => (
              <li key={step.module.path} className="ml-4">
                <div className="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-white dark:ring-slate-900" />
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest shrink-0">
                    {t("summary.tour.step", { n: i + 1 })}
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    {step.module.path}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                  {step.module.purpose}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="animate-in" style={{ animationDelay: "400ms" }}>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-6">
          {t("summary.modules")}
        </h2>
        <div className="grid gap-4">
          {summary.modules.map((m) => (
            <div
              key={m.path}
              className="group p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:border-amber-500/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-amber-500/5 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {m.path}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-mono">
                  {m.keyFiles.length} Files
                </div>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                {m.purpose}
              </div>
              {m.keyFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.keyFiles.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 text-[10px] font-mono rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5"
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
        <section className="animate-in" style={{ animationDelay: "500ms" }}>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-6">
            {t("summary.concepts")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {summary.conceptCards.map((c) => (
              <div
                key={c.name}
                className="flex flex-col p-5 rounded-[1.5rem] bg-gradient-to-br from-amber-500/5 to-orange-500/5 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-500/20 dark:border-amber-500/20 hover:border-amber-500 transition-all duration-300"
              >
                <div className="font-bold text-lg text-amber-900 dark:text-amber-100 mb-1">
                  {c.name}
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed mb-4">
                  {c.oneLiner}
                </div>
                <div className="mt-auto space-y-3">
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white/50 dark:bg-black/20 border border-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400 italic leading-snug">
                    <span className="not-italic">📍</span>
                    {t("summary.concept.found", { evidence: c.evidence })}
                  </div>
                  {c.learnMore && (
                    <a
                      href={c.learnMore}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all active:scale-95"
                    >
                      {c.verified
                        ? `✓ ${t("summary.concept.official")}`
                        : t("summary.concept.learnMore")}
                      <span>↗</span>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
