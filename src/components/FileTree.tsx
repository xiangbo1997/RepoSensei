"use client";

import { useMemo, useState } from "react";
import { buildTree, type FileEntry, type TreeNode } from "@/lib/file-tree";
import { useT } from "@/lib/i18n";

interface Props {
  files: FileEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({ files, selected, onSelect }: Props) {
  const { t } = useT();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return files;
    const lower = filter.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(lower));
  }, [files, filter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  return (
    <div className="flex flex-col h-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 shrink-0">
          {t("tree.title")}
        </span>
        <div className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-[9px] font-mono text-slate-500 dark:text-slate-400 tabular-nums border border-slate-200 dark:border-white/5">
          {files.length}
        </div>
      </div>
      <div className="p-3">
        <div className="relative group">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tree.search")}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] opacity-40 group-focus-within:opacity-100 transition-opacity">
            🔍
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-4 text-[13px] scrollbar-none">
        {tree.kind === "dir" && tree.children.length === 0 ? (
          <div className="text-xs text-slate-400 italic px-2 py-8 text-center leading-relaxed">
            {filter ? t("tree.empty.filtered") : t("tree.empty")}
          </div>
        ) : tree.kind === "dir" ? (
          tree.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={0}
              selected={selected}
              onSelect={onSelect}
              autoOpen={filter.length > 0}
            />
          ))
        ) : null}
      </div>
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  autoOpen: boolean;
}

function TreeRow({ node, depth, selected, onSelect, autoOpen }: RowProps) {
  const [open, setOpen] = useState(depth < 1 || autoOpen);
  const isSelected = node.kind === "file" && node.path === selected;
  const pad = { paddingLeft: `${depth * 14 + 12}px` };

  if (node.kind === "dir") {
    return (
      <div className="my-0.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left flex items-center gap-2 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-white/5 transition-colors group"
          style={pad}
        >
          <span
            className={`text-[8px] transition-transform duration-200 ${open ? "rotate-90" : "rotate-0"} opacity-40 group-hover:opacity-100`}
          >
            ▶
          </span>
          <span className="text-amber-600 dark:text-amber-500 text-sm">📁</span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open &&
          node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              autoOpen={autoOpen}
            />
          ))}
      </div>
    );
  }

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={
          isSelected
            ? "w-full text-left flex items-center gap-2 py-1.5 rounded-lg bg-amber-600 shadow-md shadow-amber-600/20 text-white font-medium z-10 relative"
            : "w-full text-left flex items-center gap-2 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100/50 dark:hover:bg-white/5 transition-colors"
        }
        style={pad}
      >
        <span className="w-2" />
        <span className="text-sm">📄</span>
        <span className="truncate">{node.name}</span>
      </button>
    </div>
  );
}
