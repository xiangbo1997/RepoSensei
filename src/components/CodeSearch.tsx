"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { CodeHit, SearchResult } from "@/lib/types";

interface Props {
  projectRoot: string;
  /** 点击结果跳转到 CodeViewer；line 为命中片段起始行，供滚动定位。 */
  onSelectFile: (relativePath: string, line?: number) => void;
}

/**
 * 代码检索框：直接消费 FTS5 索引，让用户搜符号/代码并点击结果跳转到 CodeViewer。
 * 与 Q&A 的隐式 grounding 共用同一个 search_code 后端命令。
 */
export function CodeSearch({ projectRoot, onSelectFile }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexed, setIndexed] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await invoke<SearchResult>("search_code", {
          path: projectRoot,
          query: q,
          limit: 12,
        });
        setHits(result.hits);
        setIndexed(result.indexed);
      } catch (err) {
        console.warn("search_code failed:", err);
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectRoot]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {t("search.title")}
        </span>
        {searching && (
          <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("search.placeholder")}
        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
      />
      {query.trim().length >= 2 && (
        <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
          {!indexed ? (
            <div className="text-[11px] text-slate-400 italic px-1 py-2">
              {t("search.noIndex")}
            </div>
          ) : hits.length === 0 && !searching ? (
            <div className="text-[11px] text-slate-400 italic px-1 py-2">
              {t("search.empty")}
            </div>
          ) : (
            hits.map((hit) => (
              <button
                key={`${hit.path}:${hit.startLine}`}
                type="button"
                onClick={() => onSelectFile(hit.path, hit.startLine)}
                className="text-left px-2 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 transition-colors group"
              >
                <div className="font-mono text-[10px] text-amber-700 dark:text-amber-400 truncate">
                  {hit.path}
                  <span className="text-slate-400 dark:text-slate-500">
                    :{hit.startLine}-{hit.endLine}
                  </span>
                </div>
                <div className="font-mono text-[9px] text-slate-500 dark:text-slate-500 truncate leading-tight">
                  {firstMeaningfulLine(hit.content)}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 取片段里第一行非空内容做预览。 */
function firstMeaningfulLine(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 80);
  }
  return "";
}
