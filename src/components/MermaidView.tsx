"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Props {
  code: string;
}

export function MermaidView({ code }: Props) {
  const id = useId().replace(/:/g, "-");
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
        });
        const { svg } = await mermaid.render(`mermaid-${id}`, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <details className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm">
        <summary className="text-red-900 dark:text-red-200 cursor-pointer">
          Mermaid render failed — show source
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

  return (
    <div
      ref={ref}
      className="mermaid-container w-full overflow-auto bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800"
    />
  );
}
