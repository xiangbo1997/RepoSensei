"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/lib/i18n";
import type { DeepInsight, PackedProject, ProjectSummary } from "@/lib/types";

interface Props {
  packed: PackedProject;
  summary: ProjectSummary;
}

/**
 * 可选的「深度分析」面板：用户显式点击时，后端并行跑多个专项分析 agent
 * （数据流 / 安全面 / 测试与质量），各产出一段 markdown。BYOK 下成本敏感，
 * 故默认不开、按钮旁明示会额外消耗 token。
 */
export function DeepAnalysisPanel({ packed, summary }: Props) {
  const { t, locale } = useT();
  const [running, setRunning] = useState(false);
  const [insights, setInsights] = useState<DeepInsight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await invoke<DeepInsight[]>("deep_analyze", {
        packed,
        summary,
        locale,
      });
      setInsights(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [running, packed, summary, locale]);

  const perspectiveLabel = (id: string) => {
    const key = `deep.perspective.${id}`;
    const label = t(key);
    // 未知视角 id：i18n 找不到键会原样返回 key，退回用 id 本身。
    return label === key ? id : label;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {running ? t("deep.running") : t("deep.button")}
        </button>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
          {t("deep.cost")}
        </span>
      </div>

      {error && (
        <div className="text-xs p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 font-mono break-words">
          {t("deep.error", { message: error })}
        </div>
      )}

      {insights && insights.length > 0 && (
        <div className="space-y-4">
          {insights.map((ins) => (
            <div
              key={ins.perspective}
              className="p-4 rounded-2xl bg-white/70 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ins.ok ? "bg-emerald-500" : "bg-red-400"
                  }`}
                />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
                  {perspectiveLabel(ins.perspective)}
                </span>
                {!ins.ok && (
                  <span className="text-[10px] text-red-500">
                    {t("deep.perspective.failed")}
                  </span>
                )}
              </div>
              <div className="markdown-body text-sm min-w-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {ins.markdown}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
