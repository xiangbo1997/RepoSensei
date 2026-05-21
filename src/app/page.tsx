"use client";

import { useCallback, useState } from "react";

type Stage = "idle" | "picking" | "loading" | "ready" | "error";

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePickProject = useCallback(async () => {
    setStage("picking");
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Pick a Git project to learn",
      });
      if (typeof selected === "string") {
        setProjectPath(selected);
        setStage("ready");
      } else {
        setStage("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-12 gap-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <header className="text-center space-y-3">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Repo<span className="text-amber-600 dark:text-amber-400">Sensei</span>
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 max-w-xl">
          Your AI repo sensei — drop in any Git project and understand it in 15
          minutes.
        </p>
      </header>

      <section className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 p-8">
        {stage === "idle" || stage === "picking" ? (
          <button
            type="button"
            onClick={handlePickProject}
            disabled={stage === "picking"}
            className="w-full py-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400 hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50"
          >
            {stage === "picking"
              ? "Opening picker…"
              : "📁 Pick a local project"}
          </button>
        ) : null}

        {stage === "ready" && projectPath ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-500 dark:text-slate-500">
              Loaded project
            </div>
            <div className="font-mono text-sm break-all text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 p-3 rounded-lg">
              {projectPath}
            </div>
            <button
              type="button"
              onClick={() => {
                setStage("idle");
                setProjectPath(null);
              }}
              className="text-sm text-slate-500 hover:text-amber-600"
            >
              Pick another
            </button>
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg text-sm text-amber-900 dark:text-amber-200">
              Next steps (M0-3 → M0-6 in progress): Repomix pack → Claude
              summary → Mermaid diagram → Q&amp;A.
            </div>
          </div>
        ) : null}

        {stage === "error" && error ? (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-900 dark:text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      <footer className="text-xs text-slate-500 dark:text-slate-600">
        M0 prototype · v0.1.0 · Tauri 2 + Next.js 16
      </footer>
    </main>
  );
}
