"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { type FileContent, languageForPath } from "@/lib/file-tree";
import { useT } from "@/lib/i18n";

interface Props {
  projectRoot: string;
  selectedFile: string | null;
  onAskAboutFile: (relativePath: string) => void;
}

type Stage =
  | { kind: "empty" }
  | { kind: "loading"; path: string }
  | { kind: "ready"; file: FileContent; html: string }
  | { kind: "error"; path: string; error: string };

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
          return hl.codeToHtml(code, {
            lang: opts.lang,
            theme: opts.theme,
          });
        } catch {
          // Unknown lang — fall back to plain.
          return hl.codeToHtml(code, { lang: "text", theme: opts.theme });
        }
      },
    };
  })();
  return highlighterPromise;
}

export function CodeViewer({
  projectRoot,
  selectedFile,
  onAskAboutFile,
}: Props) {
  const { t } = useT();
  const [stage, setStage] = useState<Stage>({ kind: "empty" });

  useEffect(() => {
    if (!selectedFile) {
      setStage({ kind: "empty" });
      return;
    }
    let cancelled = false;
    setStage({ kind: "loading", path: selectedFile });
    void (async () => {
      try {
        const file = await invoke<FileContent>("read_file", {
          root: projectRoot,
          relative: selectedFile,
        });
        const theme =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches
            ? "github-dark"
            : "github-light";
        const hl = await getHighlighter();
        const lang = languageForPath(file.path);
        const html = await hl.codeToHtml(file.content, { lang, theme });
        if (!cancelled) setStage({ kind: "ready", file, html });
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 min-h-[44px]">
        <div className="font-mono text-xs text-slate-700 dark:text-slate-300 truncate">
          {stage.kind === "ready"
            ? stage.file.path
            : stage.kind === "loading"
              ? stage.path
              : stage.kind === "error"
                ? stage.path
                : t("code.noFile")}
        </div>
        {stage.kind === "ready" && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-slate-400 tabular-nums">
              {t("code.stats", {
                lines: stage.file.content.split("\n").length,
                bytes: stage.file.size,
              })}
            </span>
            <button
              type="button"
              onClick={() => onAskAboutFile(stage.file.path)}
              className="px-3 py-1 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700"
            >
              {t("code.askAboutFile")}
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto text-xs">
        {stage.kind === "empty" && (
          <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 italic text-sm px-4 text-center">
            {t("code.pickFile")}
          </div>
        )}
        {stage.kind === "loading" && (
          <div className="h-full flex items-center justify-center text-slate-400 italic text-sm">
            {t("code.loading")}
          </div>
        )}
        {stage.kind === "error" && (
          <div className="p-4 text-sm text-red-700 dark:text-red-300">
            {stage.error}
          </div>
        )}
        {stage.kind === "ready" && (
          <div
            className="shiki-host font-mono text-[12px] leading-relaxed"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is sanitized HTML
            dangerouslySetInnerHTML={{ __html: stage.html }}
          />
        )}
      </div>
    </div>
  );
}
