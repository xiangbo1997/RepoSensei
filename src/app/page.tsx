"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SummaryView } from "@/components/SummaryView";
import { useT } from "@/lib/i18n";
import type { PackedProject, ProjectSummary } from "@/lib/types";

type Stage = "idle" | "picking" | "packing" | "summarizing" | "ready" | "error";

export default function Home() {
  const { t, locale } = useT();
  const [stage, setStage] = useState<Stage>("idle");
  const [packed, setPacked] = useState<PackedProject | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setPacked(null);
    setSummary(null);
    setError(null);
  }, []);

  const handlePick = useCallback(async () => {
    setStage("picking");
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("dialog.title"),
      });
      if (typeof selected !== "string") {
        setStage("idle");
        return;
      }

      setStage("packing");
      const packedResult = await invoke<PackedProject>("pack_project", {
        path: selected,
      });
      setPacked(packedResult);

      setStage("summarizing");
      const summaryResult = await invoke<ProjectSummary>("summarize_project", {
        packed: packedResult,
        locale,
      });
      setSummary(summaryResult);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [locale, t]);

  const isWorking =
    stage === "picking" || stage === "packing" || stage === "summarizing";

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <header className="px-8 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 backdrop-blur flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            Repo
            <span className="text-amber-600 dark:text-amber-400">Sensei</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("app.tagline")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {packed && stage === "ready" && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-slate-500 hover:text-amber-600 dark:hover:text-amber-400"
            >
              {t("header.newProject")}
            </button>
          )}
          <LocaleSwitcher />
        </div>
      </header>

      <div className="flex-1 px-8 py-6 max-w-6xl mx-auto w-full">
        {stage === "idle" && (
          <div className="flex items-center justify-center min-h-[60vh]">
            <button
              type="button"
              onClick={handlePick}
              className="px-12 py-8 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl text-lg text-slate-600 dark:text-slate-400 hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors bg-white/40 dark:bg-slate-900/40"
            >
              {t("cta.pickProject")}
            </button>
          </div>
        )}

        {isWorking && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {stage === "picking" && t("stage.picking")}
              {stage === "packing" && t("stage.packing")}
              {stage === "summarizing" && (
                <>
                  {t("stage.summarizing")}
                  {packed && (
                    <div className="mt-1 text-xs text-slate-400">
                      {t("stage.tokens", {
                        files: packed.filesScanned,
                        tokens: packed.totalTokens.toLocaleString(),
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {stage === "error" && error && (
          <div className="max-w-2xl mx-auto p-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl">
            <div className="text-red-900 dark:text-red-200 font-semibold mb-2">
              {t("error.title")}
            </div>
            <pre className="text-xs text-red-800 dark:text-red-300 whitespace-pre-wrap font-mono">
              {error}
            </pre>
            <button
              type="button"
              onClick={reset}
              className="mt-4 text-sm text-amber-600 hover:text-amber-700"
            >
              {t("error.retry")}
            </button>
          </div>
        )}

        {stage === "ready" && summary && packed && (
          <div className="grid lg:grid-cols-[1fr_400px] gap-6">
            <div>
              <div className="mb-4 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("panel.loaded")}
                </div>
                <div className="font-mono text-sm text-slate-900 dark:text-slate-100 truncate">
                  {packed.path}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t("stage.tokens", {
                    files: packed.filesScanned,
                    tokens: packed.totalTokens.toLocaleString(),
                  })}
                </div>
              </div>
              <SummaryView summary={summary} />
            </div>
            <div className="lg:sticky lg:top-6 lg:self-start">
              <ChatPanel summary={summary} />
            </div>
          </div>
        )}
      </div>

      <footer className="px-8 py-3 text-xs text-slate-500 dark:text-slate-600 text-center border-t border-slate-200 dark:border-slate-800">
        {t("footer.build")}
      </footer>
    </main>
  );
}
