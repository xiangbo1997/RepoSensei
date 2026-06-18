"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel, type ChatPanelHandle } from "@/components/ChatPanel";
import { CodeSearch } from "@/components/CodeSearch";
import { CodeViewer } from "@/components/CodeViewer";
import { DeepAnalysisPanel } from "@/components/DeepAnalysisPanel";
import { FileTree } from "@/components/FileTree";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ResizablePanels } from "@/components/ResizablePanels";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SummaryView } from "@/components/SummaryView";
import type { FileEntry, FileListing } from "@/lib/file-tree";
import { languageForPath } from "@/lib/file-tree";
import { useT } from "@/lib/i18n";
import type { PackedProject, ProjectSummary, RecentProject } from "@/lib/types";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  // 代码检索索引的后台构建状态：用户提问前需要知道索引是否就绪——
  // 未就绪时 Q&A 无法 grounding 到真实源码（见 build_grounding_block）。
  const [indexStatus, setIndexStatus] = useState<"idle" | "building" | "ready">(
    "idle",
  );
  const chatRef = useRef<ChatPanelHandle | null>(null);

  const refreshRecents = useCallback(async () => {
    try {
      setRecents(await invoke<RecentProject[]>("get_recents"));
    } catch {
      // 首次无历史，忽略
    }
  }, []);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  const reset = useCallback(() => {
    setStage("idle");
    setPacked(null);
    setSummary(null);
    setFiles([]);
    setProjectRoot(null);
    setSelectedFile(null);
    setSummaryOpen(false);
    setError(null);
    setIndexStatus("idle");
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

      // 写入最近项目（存完整 summary，供下次秒级恢复）。
      void invoke("save_recent", {
        project: {
          path: selected,
          name: packedResult.name,
          techStack: summaryResult.techStack,
          summary: summaryResult,
          openedAt: new Date().toISOString(),
        },
      })
        .then(refreshRecents)
        .catch(() => {});

      // 后台建代码检索索引（不阻塞 UI）：用户读 summary 时索引已在构建，
      // 等到提问时 Q&A 就能 grounding 到真实源码。失败仅降级，不打断流程。
      // 状态透传给 UI，让用户知道首问前索引是否就绪（避免「刚选完就问→答得很泛」）。
      setIndexStatus("building");
      void invoke("index_project", { path: selected })
        .then(() => setIndexStatus("ready"))
        .catch((err) => {
          console.warn("background index_project failed (non-fatal):", err);
          setIndexStatus("idle");
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [locale, t, refreshRecents]);

  // 一键恢复最近项目：复用已存的 summary（不重新打包/总结）+ 磁盘上的检索索引。
  // 仅重新 list_files（快）并在后台增量重建索引以捕获文件变更。
  const restoreRecent = useCallback(
    async (r: RecentProject) => {
      setError(null);
      const exists = await invoke<boolean>("path_exists", { path: r.path });
      if (!exists) {
        await invoke("remove_recent", { path: r.path }).catch(() => {});
        await refreshRecents();
        setError(t("recents.gone"));
        setStage("error");
        return;
      }
      setStage("listing");
      setProjectRoot(r.path);
      setSummary(r.summary);
      try {
        const listing = await invoke<FileListing>("list_files", {
          path: r.path,
        });
        setFiles(listing.files);
        setStage("ready");
        // 后台增量重建索引：捕获上次打开后文件的变更（增量，未变文件跳过）。
        setIndexStatus("building");
        void invoke("index_project", { path: r.path })
          .then(() => setIndexStatus("ready"))
          .catch(() => setIndexStatus("idle"));
        void invoke("save_recent", {
          project: {
            path: r.path,
            name: r.name,
            techStack: r.techStack,
            summary: r.summary,
            openedAt: new Date().toISOString(),
          },
        })
          .then(refreshRecents)
          .catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage("error");
      }
    },
    [t, refreshRecents],
  );

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
          {projectRoot && stage === "ready" && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate uppercase tracking-widest">
                {projectRoot}
              </span>
            </div>
          )}
          {stage === "ready" && indexStatus !== "idle" && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 shrink-0"
              title={
                indexStatus === "building"
                  ? t("index.building")
                  : t("index.ready")
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  indexStatus === "building"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-emerald-500"
                }`}
              />
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {indexStatus === "building"
                  ? t("index.building")
                  : t("index.ready")}
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
          {projectRoot && stage === "ready" && (
            <button
              type="button"
              onClick={reset}
              className="text-xs font-medium text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              {t("header.newProject")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={t("settings.title")}
            className="text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label={t("settings.title")}
            >
              <title>{t("settings.title")}</title>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-1" />
          <LocaleSwitcher />
        </div>
      </header>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <div className="flex-1 min-h-0 overflow-hidden relative z-10">
        {stage === "idle" && (
          <div className="h-full flex flex-col items-center justify-center gap-5 p-8 animate-in">
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
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="text-xs text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              ⚙️ {t("settings.needed")}
            </button>

            {recents.length > 0 && (
              <div className="w-full max-w-md mt-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-3 px-1">
                  {t("recents.title")}
                </div>
                <div className="flex flex-col gap-2">
                  {recents.map((r) => (
                    <div
                      key={r.path}
                      className="group flex items-center gap-3 p-3 rounded-2xl bg-white/60 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:border-amber-500/40 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => restoreRecent(r)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                          {r.name}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">
                          {r.path}
                        </div>
                        {r.techStack.length > 0 && (
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {r.techStack.slice(0, 4).join(" · ")}
                          </div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await invoke("remove_recent", {
                            path: r.path,
                          }).catch(() => {});
                          await refreshRecents();
                        }}
                        title={t("recents.remove")}
                        className="shrink-0 p-1 text-slate-300 hover:text-red-500 transition-colors text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

        {stage === "ready" && summary && projectRoot && (
          <div className="h-full min-h-0 animate-in">
            <ResizablePanels
              leftLabel={t("panel.files")}
              rightLabel={t("panel.chat")}
              left={
                <div className="h-full min-h-0 flex flex-col gap-3">
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
              }
              center={
                <div className="h-full min-h-0 flex flex-col gap-4">
                  {summaryOpen && (
                    <div className="max-h-[45%] overflow-auto p-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none space-y-5">
                      <SummaryView summary={summary} />
                      {/* 深度分析需要完整打包内容（packed）。从历史恢复时不重新打包，
                          故 packed 为 null——此时隐藏深度分析，主界面其余部分照常可用。 */}
                      {packed && (
                        <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                          <DeepAnalysisPanel
                            packed={packed}
                            summary={summary}
                          />
                        </div>
                      )}
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
              }
              right={
                <ChatPanel
                  ref={chatRef}
                  summary={summary}
                  projectRoot={projectRoot}
                  indexStatus={indexStatus}
                />
              }
            />
          </div>
        )}
      </div>

      <footer className="px-6 py-2 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600 text-center border-t border-slate-200 dark:border-white/5 shrink-0 relative z-10">
        {t("footer.build")}
      </footer>
    </main>
  );
}
