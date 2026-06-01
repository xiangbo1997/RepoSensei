"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * 三栏布局：左(可折叠+可拖拽) | 中(弹性主区) | 右(可折叠+可拖拽)。
 *
 * 规则：
 *   - 左/右栏可拖拽 gutter 改宽，可点按钮折叠成窄条。
 *   - 中间栏 flex-1 弹性：任一侧折叠/变窄，空间自动归中间。
 *   - 两侧都折叠时中间独占全部 →「只剩一个展开时它独占所有空间」。
 *   - 宽度与折叠态持久化到 localStorage，重开记住。
 *
 * 自研而非引库：仅 3 栏、规则明确，零依赖更可控（符合最小依赖）。
 */

const STORAGE_KEY = "reposensei.layout";

const LEFT_MIN = 180;
const LEFT_MAX = 480;
const RIGHT_MIN = 260;
const RIGHT_MAX = 640;
const COLLAPSED_BAR = 36; // 折叠后的窄条宽度

interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 260,
  rightWidth: 380,
  leftCollapsed: false,
  rightCollapsed: false,
};

function loadLayout(): LayoutState {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_LAYOUT, ...parsed };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

interface Props {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  /** 折叠时窄条上显示的标题（竖排）。 */
  leftLabel: string;
  rightLabel: string;
}

export function ResizablePanels({
  left,
  center,
  right,
  leftLabel,
  rightLabel,
}: Props) {
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const containerRef = useRef<HTMLDivElement>(null);
  // 拖拽中标记，避免拖动时选中文本/触发子组件交互。
  const dragRef = useRef<null | "left" | "right">(null);

  // 客户端挂载后再读 localStorage（SSG 首屏用默认值，避免水合不一致）。
  useEffect(() => {
    setLayout(loadLayout());
  }, []);

  const persist = useCallback((next: LayoutState) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 隐私模式等存储不可用，忽略
    }
  }, []);

  // 拖拽：根据鼠标 X 相对容器，计算左/右栏新宽度。
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const side = dragRef.current;
      const el = containerRef.current;
      if (!side || !el) return;
      const rect = el.getBoundingClientRect();
      if (side === "left") {
        const w = clamp(e.clientX - rect.left, LEFT_MIN, LEFT_MAX);
        setLayout((prev) => ({ ...prev, leftWidth: w }));
      } else {
        const w = clamp(rect.right - e.clientX, RIGHT_MIN, RIGHT_MAX);
        setLayout((prev) => ({ ...prev, rightWidth: w }));
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // 拖拽结束落盘当前宽度。
        setLayout((cur) => {
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
          } catch {}
          return cur;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const toggleLeft = () =>
    persist({ ...layout, leftCollapsed: !layout.leftCollapsed });
  const toggleRight = () =>
    persist({ ...layout, rightCollapsed: !layout.rightCollapsed });

  const leftW = layout.leftCollapsed ? COLLAPSED_BAR : layout.leftWidth;
  const rightW = layout.rightCollapsed ? COLLAPSED_BAR : layout.rightWidth;

  return (
    <div ref={containerRef} className="h-full flex gap-0 p-4 min-h-0">
      {/* 左栏 */}
      <div className="min-h-0 shrink-0 flex flex-col" style={{ width: leftW }}>
        {layout.leftCollapsed ? (
          <CollapsedBar label={leftLabel} side="left" onExpand={toggleLeft} />
        ) : (
          <div className="h-full min-h-0 flex flex-col">
            <PanelHeaderToggle
              label={leftLabel}
              side="left"
              onCollapse={toggleLeft}
            />
            <div className="flex-1 min-h-0">{left}</div>
          </div>
        )}
      </div>

      {/* 左 gutter（仅展开时可拖） */}
      {!layout.leftCollapsed && <Gutter onMouseDown={startDrag("left")} />}

      {/* 中栏：弹性主区 */}
      <div className="flex-1 min-w-0 min-h-0 px-2">{center}</div>

      {/* 右 gutter */}
      {!layout.rightCollapsed && <Gutter onMouseDown={startDrag("right")} />}

      {/* 右栏 */}
      <div className="min-h-0 shrink-0 flex flex-col" style={{ width: rightW }}>
        {layout.rightCollapsed ? (
          <CollapsedBar
            label={rightLabel}
            side="right"
            onExpand={toggleRight}
          />
        ) : (
          <div className="h-full min-h-0 flex flex-col">
            <PanelHeaderToggle
              label={rightLabel}
              side="right"
              onCollapse={toggleRight}
            />
            <div className="flex-1 min-h-0">{right}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 可拖拽分隔条。 */
function Gutter({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Resize panel"
      onMouseDown={onMouseDown}
      className="group relative w-2 shrink-0 cursor-col-resize flex items-center justify-center"
    >
      <span className="w-0.5 h-10 rounded-full bg-slate-200 dark:bg-white/10 group-hover:bg-amber-500/60 transition-colors" />
    </button>
  );
}

/** 展开态的折叠按钮（小箭头，放栏顶部）。 */
function PanelHeaderToggle({
  label,
  side,
  onCollapse,
}: {
  label: string;
  side: "left" | "right";
  onCollapse: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-1 pb-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 truncate">
        {label}
      </span>
      <button
        type="button"
        onClick={onCollapse}
        title={label}
        className="p-1 rounded-md text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
      >
        {side === "left" ? "⟨" : "⟩"}
      </button>
    </div>
  );
}

/** 折叠态的竖条：点一下展开。 */
function CollapsedBar({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={label}
      className="h-full w-full flex flex-col items-center gap-3 py-4 rounded-2xl bg-white/60 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:border-amber-500/40 transition-colors"
    >
      <span className="text-slate-400 group-hover:text-amber-600">
        {side === "left" ? "⟩" : "⟨"}
      </span>
      <span
        className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}
