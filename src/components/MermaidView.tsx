"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

interface Props {
  code: string;
  /**
   * 是否处于流式追加中。流式期间 code 是半截的，会反复触发解析失败；
   * 此时静默显示「源码 + 等待」而不刷红色错误框，待 streaming 转 false 再正式渲染。
   */
  streaming?: boolean;
}

/** code 变化后等待这么久（无新变化）才真正渲染，避免流式逐字符追加时疯狂重渲。 */
const RENDER_DEBOUNCE_MS = 250;

/** 缩放步进与范围：每次乘 / 除 1.25，夹在 [0.5, 3] 之间。 */
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

/**
 * mermaid.initialize 只需全局跑一次——放进渲染 effect 会随每次渲染重复调用。
 * securityLevel 用 strict：本应用不使用可点击 mermaid 节点，且图源来自 LLM 生成，
 * strict 会剥离脚本 / 事件，避免注入面。
 */
let mermaidInitialized = false;

async function getMermaid() {
  const mermaid = (await import("mermaid")).default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

export function MermaidView({ code, streaming = false }: Props) {
  const { t } = useT();
  const id = useId().replace(/:/g, "-");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 流式追加期间不渲染：半截 mermaid 必然解析失败，留到完成后一次性渲染。
    if (streaming) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const render = async () => {
        try {
          const mermaid = await getMermaid();
          // 把 svg 存进 state（而非写 ref.current.innerHTML）——回退态下挂 ref 的
          // 节点尚未挂载，依赖 ref 会导致「永远渲染不出」的死锁。
          const out = await mermaid.render(`mermaid-${id}`, code.trim());
          if (!cancelled) {
            setSvg(out.svg);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setSvg(null);
          }
        }
      };
      void render();
    }, RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id, streaming]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP)),
    [],
  );
  const zoomReset = useCallback(() => setZoom(1), []);

  // 导出：把已渲染的 SVG 序列化成文件下载。取容器里的 <svg> 节点，序列化后走 Blob + 临时 <a>。
  const exportSvg = useCallback(() => {
    const svgEl = containerRef.current?.querySelector("svg");
    if (!svgEl) return;
    const source = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "architecture.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // 渲染成功：注入 svg + hover 浮层控件（缩放 / 导出）。
  if (svg && !error) {
    return (
      <div className="group relative">
        <div
          ref={containerRef}
          className="mermaid-container w-full overflow-auto bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800"
        >
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: svg 来自本地 mermaid 渲染，securityLevel:strict 下已由 mermaid 内部 sanitize
            dangerouslySetInnerHTML={{ __html: svg }}
            className="origin-top-left transition-transform"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ControlButton onClick={zoomOut} label={t("mermaid.zoomOut")}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
              <path d="M8 11h6" />
            </svg>
          </ControlButton>
          <ControlButton onClick={zoomReset} label={t("mermaid.zoomReset")}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </ControlButton>
          <ControlButton onClick={zoomIn} label={t("mermaid.zoomIn")}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
              <path d="M11 8v6" />
              <path d="M8 11h6" />
            </svg>
          </ControlButton>
          <ControlButton onClick={exportSvg} label={t("mermaid.export")}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </ControlButton>
        </div>
      </div>
    );
  }

  // 渲染失败：可展开查看源码与错误。
  if (error) {
    return (
      <details className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm">
        <summary className="text-red-900 dark:text-red-200 cursor-pointer">
          {t("mermaid.failed")}
        </summary>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-red-800 dark:text-red-300">
          {code}
        </pre>
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          Error: {error}
        </p>
      </details>
    );
  }

  // 流式追加中或尚未出结果：先显示源码（不报错），等待渲染完成。
  return (
    <pre className="my-2 p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs whitespace-pre-wrap overflow-auto text-slate-600 dark:text-slate-300">
      {code}
    </pre>
  );
}

/** 图上悬浮的一颗小控件按钮：统一样式，label 同时作 title / aria-label。 */
function ControlButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300 dark:hover:border-amber-700 shadow-sm transition-colors"
    >
      {children}
    </button>
  );
}
