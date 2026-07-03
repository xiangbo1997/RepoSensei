"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type FileContent, languageForPath } from "@/lib/file-tree";
import { useT } from "@/lib/i18n";

interface Props {
  projectRoot: string;
  selectedFile: string | null;
  onAskAboutFile: (relativePath: string) => void;
  onAskAboutCode?: (code: string, relativePath: string) => void;
  /** 需要滚动定位并高亮的目标行（1-based）。来自搜索命中跳转。 */
  targetLine?: number | null;
}

/** 超过该字节数的文件默认只高亮开头，避免同步高亮阻塞主线程（1MB 文件可卡数秒）。 */
const HIGHLIGHT_BYTE_LIMIT = 200 * 1024;

type Stage =
  | { kind: "empty" }
  | { kind: "loading"; path: string }
  | {
      kind: "ready";
      file: FileContent;
      html: string;
      /** 被截断时的已高亮行数；未截断为 null。 */
      truncatedAtLine: number | null;
    }
  | { kind: "error"; path: string; error: string };

interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string | null;
}

let highlighterPromise: Promise<{
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
  ) => Promise<string>;
}> | null = null;

async function getHighlighter() {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const shiki = await import("shiki");
    const hl = await shiki.createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "json",
        "markdown",
        "rust",
        "python",
        "go",
        "java",
        "ruby",
        "php",
        "c",
        "cpp",
        "csharp",
        "shell",
        "yaml",
        "toml",
        "css",
        "scss",
        "html",
        "xml",
        "vue",
        "svelte",
        "sql",
        "docker",
        "makefile",
      ],
    });
    return {
      codeToHtml: async (code, opts) => {
        try {
          return hl.codeToHtml(code, { lang: opts.lang, theme: opts.theme });
        } catch {
          return hl.codeToHtml(code, { lang: "text", theme: opts.theme });
        }
      },
    };
  })();
  return highlighterPromise;
}

/** 当前系统主题对应的 shiki theme。 */
function currentTheme(): string {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "github-dark"
    : "github-light";
}

/**
 * 高亮文件内容。大文件默认只高亮前 HIGHLIGHT_BYTE_LIMIT 字节，
 * 返回 truncatedAtLine（已高亮的行数）以便 UI 提示；full=true 时强制全量。
 */
async function highlightFile(
  file: FileContent,
  full: boolean,
): Promise<{ html: string; truncatedAtLine: number | null }> {
  const hl = await getHighlighter();
  const lang = languageForPath(file.path);
  const theme = currentTheme();
  const overLimit =
    !full && typeof file.size === "number" && file.size > HIGHLIGHT_BYTE_LIMIT;
  if (!overLimit) {
    const html = await hl.codeToHtml(file.content, { lang, theme });
    return { html, truncatedAtLine: null };
  }
  // 按字节截断到上限内的最后一个完整行，避免高亮半行。
  const slice = file.content.slice(0, HIGHLIGHT_BYTE_LIMIT);
  const lastNewline = slice.lastIndexOf("\n");
  const partial = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  const shownLines = partial.split("\n").length;
  const html = await hl.codeToHtml(partial, { lang, theme });
  return { html, truncatedAtLine: shownLines };
}

export function CodeViewer({
  projectRoot,
  selectedFile,
  onAskAboutFile,
  onAskAboutCode,
  targetLine,
}: Props) {
  const { t } = useT();
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const codeHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedFile) {
      setStage({ kind: "empty" });
      setMenu(null);
      return;
    }
    let cancelled = false;
    setStage({ kind: "loading", path: selectedFile });
    setMenu(null);
    void (async () => {
      try {
        const file = await invoke<FileContent>("read_file", {
          root: projectRoot,
          relative: selectedFile,
        });
        const { html, truncatedAtLine } = await highlightFile(file, false);
        if (!cancelled) {
          setStage({ kind: "ready", file, html, truncatedAtLine });
        }
      } catch (e) {
        if (!cancelled) {
          setStage({
            kind: "error",
            path: selectedFile,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedFile]);

  // 「显示全部」：应用户请求对大文件做全量高亮。
  const showAll = useCallback(async () => {
    if (stage.kind !== "ready" || stage.truncatedAtLine === null) return;
    setExpanding(true);
    try {
      const { html } = await highlightFile(stage.file, true);
      setStage({
        kind: "ready",
        file: stage.file,
        html,
        truncatedAtLine: null,
      });
    } finally {
      setExpanding(false);
    }
  }, [stage]);

  // 目标行滚动定位 + 闪烁高亮。文件已加载或 targetLine 变化时都会触发。
  useEffect(() => {
    if (stage.kind !== "ready" || !targetLine) return;
    const host = codeHostRef.current;
    if (!host) return;
    const lines = host.querySelectorAll<HTMLElement>("code > .line");
    const el = lines[targetLine - 1];
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.setAttribute("data-flash", "true");
    const timer = setTimeout(() => {
      el.removeAttribute("data-flash");
    }, 2000);
    return () => {
      clearTimeout(timer);
      el.removeAttribute("data-flash");
    };
  }, [stage, targetLine]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sel = window.getSelection();
    const selectedText = sel && !sel.isCollapsed ? sel.toString().trim() : null;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Simple boundary check to prevent menu from flowing out of the viewer
      const menuWidth = 220;
      const menuHeight = 160;
      const adjustedX = x + menuWidth > rect.width ? x - menuWidth : x;
      const adjustedY = y + menuHeight > rect.height ? y - menuHeight : y;

      setMenu({
        x: adjustedX,
        y: adjustedY,
        selectedText,
      });
    }
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const handleGlobalClick = () => closeMenu();
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [closeMenu]);

  const handleCopy = useCallback(() => {
    if (menu?.selectedText) {
      navigator.clipboard.writeText(menu.selectedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    closeMenu();
  }, [menu, closeMenu]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 容器仅承载右键菜单(onContextMenu)，非可聚焦交互元素
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none overflow-hidden relative"
      onContextMenu={handleContextMenu}
    >
      {/* 目标行闪烁高亮：搜索跳转后定位的那一行短暂高亮再淡出。 */}
      <style>{`
        .shiki-host .line[data-flash] {
          display: inline-block;
          width: 100%;
          background-color: rgba(245, 158, 11, 0.28);
          border-radius: 3px;
          animation: cv-flash 2s ease-out forwards;
        }
        @keyframes cv-flash {
          0% { background-color: rgba(245, 158, 11, 0.45); }
          100% { background-color: rgba(245, 158, 11, 0); }
        }
      `}</style>
      <div className="px-6 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-4 min-h-[56px]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-sm shrink-0">
            {stage.kind === "ready" ? "📄" : "🔍"}
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
              {stage.kind === "ready"
                ? stage.file.path.split("/").pop()
                : stage.kind === "loading"
                  ? stage.path.split("/").pop()
                  : stage.kind === "error"
                    ? "Error"
                    : t("code.noFile")}
            </div>
            {stage.kind === "ready" && (
              <div className="font-mono text-[9px] text-slate-400 dark:text-slate-500 truncate uppercase tracking-widest">
                {stage.file.path}
              </div>
            )}
          </div>
        </div>

        {stage.kind === "ready" && (
          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                {stage.file.content.split("\n").length} Lines
              </span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
                {(stage.file.size / 1024).toFixed(1)} KB
              </span>
            </div>
            <button
              type="button"
              onClick={() => onAskAboutFile(stage.file.path)}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-lg shadow-amber-600/20 active:scale-95"
            >
              {t("code.askAboutFile")}
            </button>
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-auto bg-[#fafafa] dark:bg-[#0d1117]"
        onScroll={closeMenu}
      >
        {stage.kind === "empty" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 dark:text-slate-500 italic px-8 text-center animate-in">
            <div className="text-4xl opacity-10">⌨️</div>
            <div className="text-sm">{t("code.pickFile")}</div>
          </div>
        )}
        {stage.kind === "loading" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400 italic text-sm animate-in">
            <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <div>{t("code.loading")}</div>
          </div>
        )}
        {stage.kind === "error" && (
          <div className="p-8 text-sm text-red-700 dark:text-red-400 flex flex-col items-center gap-4 animate-in">
            <div className="text-3xl">🚫</div>
            <div className="font-mono bg-red-50 dark:bg-red-950/20 p-4 rounded-xl border border-red-100 dark:border-red-900/30">
              {stage.error}
            </div>
          </div>
        )}
        {stage.kind === "ready" && (
          <>
            {stage.truncatedAtLine !== null && (
              <div className="flex items-center justify-between gap-3 px-6 py-2.5 text-[11px] bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-900/30 text-amber-800 dark:text-amber-300">
                <span>
                  {t("code.truncated", {
                    shown: stage.truncatedAtLine,
                    total: stage.file.content.split("\n").length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={showAll}
                  disabled={expanding}
                  className="shrink-0 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold transition-colors disabled:opacity-50"
                >
                  {t("code.showAll")}
                </button>
              </div>
            )}
            <div
              ref={codeHostRef}
              className="shiki-host font-mono text-[13px] leading-relaxed p-6"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is sanitized HTML
              dangerouslySetInnerHTML={{ __html: stage.html }}
            />
          </>
        )}
      </div>

      {copied && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-xs font-bold shadow-2xl animate-in fade-in zoom-in duration-150">
          {t("code.copied")}
        </div>
      )}

      {menu && stage.kind === "ready" && (
        // biome-ignore lint/a11y/noStaticElementInteractions: onClick 仅用于阻止冒泡，非交互入口；内部按钮可键盘操作
        // biome-ignore lint/a11y/useKeyWithClickEvents: 同上，stopPropagation 不需要键盘等价处理
        <div
          className="absolute z-50 min-w-[220px] p-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/20 animate-in fade-in zoom-in duration-150"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 mb-1">
            {t("code.actions")}
          </div>

          {menu.selectedText && onAskAboutCode && (
            <button
              type="button"
              onClick={() => {
                if (menu.selectedText) {
                  onAskAboutCode(menu.selectedText, stage.file.path);
                }
                closeMenu();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-amber-600 hover:text-white rounded-xl transition-colors text-left group"
            >
              <span className="text-base">✨</span>
              <span className="flex-1">{t("code.askSelection")}</span>
              <span className="text-[10px] opacity-40 group-hover:opacity-100 font-mono">
                ⌘I
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onAskAboutFile(stage.file.path);
              closeMenu();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-colors text-left"
          >
            <span className="text-base">📄</span>
            <span className="flex-1">{t("code.askAboutFile")}</span>
          </button>

          <div className="h-px bg-slate-100 dark:bg-white/5 my-1" />

          {menu.selectedText && (
            <button
              type="button"
              onClick={handleCopy}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-colors text-left group"
            >
              <span className="text-base">📋</span>
              <span className="flex-1">{t("code.copy")}</span>
              <span className="text-[10px] opacity-40 group-hover:opacity-100 font-mono">
                ⌘C
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
