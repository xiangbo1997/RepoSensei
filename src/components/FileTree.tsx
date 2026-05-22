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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
          {t("tree.title")}
        </span>
        <span className="text-[10px] text-slate-400 tabular-nums">
          {files.length}
        </span>
      </div>
      <div className="p-2 border-b border-slate-200 dark:border-slate-800">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("tree.search")}
          className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>
      <div className="flex-1 overflow-auto p-2 text-sm">
        {tree.kind === "dir" && tree.children.length === 0 ? (
          <div className="text-xs text-slate-400 italic px-2 py-4 text-center">
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
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left flex items-center gap-1 py-0.5 rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          style={pad}
        >
          <span className="w-3 text-slate-400 text-xs">{open ? "▾" : "▸"}</span>
          <span className="text-amber-600 dark:text-amber-500">📁</span>
          <span className="truncate">{node.name}</span>
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
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={
        isSelected
          ? "w-full text-left flex items-center gap-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200"
          : "w-full text-left flex items-center gap-1 py-0.5 rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
      }
      style={pad}
    >
      <span className="w-3" />
      <span>📄</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}
