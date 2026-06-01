"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { CodeSearch } from "@/components/CodeSearch";
import { CodeViewer } from "@/components/CodeViewer";
import { FileTree } from "@/components/FileTree";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SummaryView } from "@/components/SummaryView";
import type { FileEntry, FileListing } from "@/lib/file-tree";
import { languageForPath } from "@/lib/file-tree";
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

      // 后台建代码检索索引（不阻塞 UI）：用户读 summary 时索引已在构建，
      // 等到提问时 Q&A 就能 grounding 到真实源码。失败仅降级，不打断流程。
      void invoke("index_project", { path: selected }).catch((err) => {
        console.warn("background index_project failed (non-fatal):", err);
      });
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

  const handleAskAboutCode = useCallback(
    (code: string, relativePath: string) => {
      const lang = languageForPath(relativePath);
      const prompt = `I have a question about this code in \`${relativePath}\`:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
      chatRef.current?.prefill(prompt, true);
    },
    [],
  );

  const isWorking =
    stage === "picking" ||
    stage === "packing" ||
    stage === "listing" ||
    stage === "summarizing";

  return (
    <main className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-amber-200 dark:selection:bg-amber-900">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none opacity-40 dark:opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-amber-400/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-orange-400/20 blur-[120px]" />
      </div>

      <header className="px-6 py-3 border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-slate-950/70 backdrop-blur-md flex items-center justify-between shrink-0 relative z-10">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-50 shrink-0">
            Repo
            <span className="text-amber-600 dark:text-amber-400 font-extrabold italic">
              Sensei
            </span>
          </h1>
          {packed && stage === "ready" && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate uppercase tracking-widest">
                {packed.path}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {summary && stage === "ready" && (
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              className="text-xs font-medium text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
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
              className="text-xs font-medium text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              {t("header.newProject")}
            </button>
          )}
          <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
          <LocaleSwitcher />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden relative z-10">
        {stage === "idle" && (
          <div className="h-full flex items-center justify-center p-8 animate-in">
            <button
              type="button"
              onClick={handlePick}
              className="group relative flex flex-col items-center gap-6 p-16 rounded-[2.5rem] bg-white/40 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 hover:border-amber-500/50 hover:bg-white/60 dark:hover:bg-white/[0.04] transition-all duration-500 shadow-2xl shadow-slate-200/50 dark:shadow-none"
            >
              <div className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-4xl group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
                📂
              </div>
              <div className="text-center space-y-2">
                <div className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-200">
                  {t("cta.pickProject")}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-500 max-w-[240px]">
                  Select a local directory to begin your repository analysis
                </div>
              </div>
              <div className="absolute inset-0 rounded-[2.5rem] ring-1 ring-inset ring-slate-900/5 dark:ring-white/5 pointer-events-none" />
            </button>
          </div>
        )}

        {isWorking && (
          <div className="h-full flex flex-col items-center justify-center gap-6 p-8 animate-in">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-amber-500/20 rounded-full" />
              <div className="absolute inset-0 w-16 h-16 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center space-y-2">
              <div className="text-lg font-medium text-slate-700 dark:text-slate-300">
                {stage === "picking" && t("stage.picking")}
                {stage === "packing" && t("stage.packing")}
                {stage === "listing" && t("stage.packing")}
                {stage === "summarizing" && t("stage.summarizing")}
              </div>
              {packed && stage === "summarizing" && (
                <div className="text-xs font-mono text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  {t("stage.tokens", {
                    files: packed.filesScanned,
                    tokens: packed.totalTokens.toLocaleString(),
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "error" && error && (
          <div className="h-full flex items-center justify-center p-8 animate-in">
            <div className="max-w-2xl p-8 bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-900/30 rounded-3xl backdrop-blur-sm">
              <div className="flex items-center gap-3 text-red-600 dark:text-red-400 font-bold mb-4">
                <span className="text-xl">⚠️</span>
                {t("error.title")}
              </div>
              <div className="p-4 rounded-xl bg-white/50 dark:bg-black/20 border border-red-100 dark:border-red-900/50 font-mono text-xs text-red-800 dark:text-red-300 overflow-auto max-h-[200px]">
                {error}
              </div>
              <button
                type="button"
                onClick={reset}
                className="mt-6 w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition-colors shadow-lg shadow-red-600/20"
              >
                {t("error.retry")}
              </button>
            </div>
          </div>
        )}

        {stage === "ready" && summary && packed && projectRoot && (
          <div className="h-full grid grid-cols-[260px_minmax(0,1fr)_380px] gap-4 p-4 min-h-0 animate-in">
            <div className="min-h-0 flex flex-col gap-3">
              <div className="shrink-0 p-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-2xl shadow-sm">
                <CodeSearch
                  projectRoot={projectRoot}
                  onSelectFile={setSelectedFile}
                />
              </div>
              <div className="flex-1 min-h-0">
                <FileTree
                  files={files}
                  selected={selectedFile}
                  onSelect={setSelectedFile}
                />
              </div>
            </div>

            <div className="min-h-0 flex flex-col gap-4">
              {summaryOpen && (
                <div className="max-h-[45%] overflow-auto p-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none">
                  <SummaryView summary={summary} />
                </div>
              )}
              <div className="flex-1 min-h-0">
                <CodeViewer
                  projectRoot={projectRoot}
                  selectedFile={selectedFile}
                  onAskAboutFile={handleAskAboutFile}
                  onAskAboutCode={handleAskAboutCode}
                />
              </div>
            </div>

            <div className="min-h-0">
              <ChatPanel
                ref={chatRef}
                summary={summary}
                projectRoot={projectRoot}
              />
            </div>
          </div>
        )}
      </div>

      <footer className="px-6 py-2 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600 text-center border-t border-slate-200 dark:border-white/5 shrink-0 relative z-10">
        {t("footer.build")}
      </footer>
    </main>
  );
}
