"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { CodeViewer } from "@/components/CodeViewer";
import { FileTree } from "@/components/FileTree";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SummaryView } from "@/components/SummaryView";
import type { FileEntry, FileListing } from "@/lib/file-tree";
import { useT } from "@/lib/i18n";
import type { PackedProject, ProjectSummary } from "@/lib/types";

type Stage =
  | "idle"
  | "picking"
  | "packing"
  | "listing"
  | "summarizing"
  | "ready"
  | "error";

export default function Home() {
  const { t, locale } = useT();
  const [stage, setStage] = useState<Stage>("idle");
  const [packed, setPacked] = useState<PackedProject | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatRef = useRef<ChatPanelHandle | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setPacked(null);
    setSummary(null);
    setFiles([]);
    setProjectRoot(null);
    setSelectedFile(null);
    setSummaryOpen(false);
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

      setProjectRoot(selected);

      // Run list_files + pack in parallel — list is fast, pack is slow.
      setStage("listing");
      const [listing, packedResult] = await Promise.all([
        invoke<FileListing>("list_files", { path: selected }),
        invoke<PackedProject>("pack_project", { path: selected }),
      ]);
      setFiles(listing.files);
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

  const handleAskAboutFile = useCallback(
    (relativePath: string) => {
      chatRef.current?.prefill(
        t("code.askPrompt", { path: relativePath }),
        true,
      );
    },
    [t],
  );

  const isWorking =
    stage === "picking" ||
    stage === "packing" ||
    stage === "listing" ||
    stage === "summarizing";

  return (
    <main className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <header className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 backdrop-blur flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50 shrink-0">
            Repo
            <span className="text-amber-600 dark:text-amber-400">Sensei</span>
          </h1>
          {packed && stage === "ready" && (
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">
              {packed.path}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {summary && stage === "ready" && (
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              className="text-xs text-slate-500 hover:text-amber-600 dark:hover:text-amber-400"
            >
              {summaryOpen
                ? t("summary.toggle.hide")
                : t("summary.toggle.show")}
            </button>
          )}
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

      <div className="flex-1 min-h-0 overflow-hidden">
        {stage === "idle" && (
          <div className="h-full flex items-center justify-center p-8">
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
          <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-600 dark:text-slate-400 text-center">
              {stage === "picking" && t("stage.picking")}
              {stage === "packing" && t("stage.packing")}
              {stage === "listing" && t("stage.packing")}
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
          <div className="h-full flex items-center justify-center p-8">
            <div className="max-w-2xl p-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl">
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
          </div>
        )}

        {stage === "ready" && summary && packed && projectRoot && (
          <div className="h-full grid grid-cols-[240px_minmax(0,1fr)_360px] gap-3 p-3 min-h-0">
            <div className="min-h-0">
              <FileTree
                files={files}
                selected={selectedFile}
                onSelect={setSelectedFile}
              />
            </div>

            <div className="min-h-0 flex flex-col gap-3">
              {summaryOpen && (
                <div className="max-h-[40%] overflow-auto p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                  <SummaryView summary={summary} />
                </div>
              )}
              <div className="flex-1 min-h-0">
                <CodeViewer
                  projectRoot={projectRoot}
                  selectedFile={selectedFile}
                  onAskAboutFile={handleAskAboutFile}
                />
              </div>
            </div>

            <div className="min-h-0">
              <ChatPanel ref={chatRef} summary={summary} />
            </div>
          </div>
        )}
      </div>

      <footer className="px-6 py-2 text-[10px] text-slate-500 dark:text-slate-600 text-center border-t border-slate-200 dark:border-slate-800 shrink-0">
        {t("footer.build")}
      </footer>
    </main>
  );
}
