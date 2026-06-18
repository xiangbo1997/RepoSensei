"use client";

import { useEffect, useId, useState } from "react";
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

export function MermaidView({ code, streaming = false }: Props) {
  const { t } = useT();
  const id = useId().replace(/:/g, "-");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 流式追加期间不渲染：半截 mermaid 必然解析失败，留到完成后一次性渲染。
    if (streaming) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const render = async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({
            startOnLoad: false,
            theme: "default",
            securityLevel: "loose",
          });
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

  // 渲染成功：注入 svg。
  if (svg && !error) {
    return (
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: svg 来自本地 mermaid 渲染，securityLevel:loose 下已由 mermaid 内部 sanitize
        dangerouslySetInnerHTML={{ __html: svg }}
        className="mermaid-container w-full overflow-auto bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800"
      />
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
