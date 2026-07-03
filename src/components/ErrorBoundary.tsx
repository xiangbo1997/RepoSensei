"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 全局错误边界：任何子树渲染抛错（典型如恢复旧版历史记录时字段缺失）
 * 都收敛到这里的恢复面板，而不是整个 webview 白屏只能杀进程。
 * 刻意不依赖 LocaleProvider——错误可能就发生在 Provider 内部，双语硬编码。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-screen flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-lg w-full p-8 bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-900/30 rounded-3xl space-y-4">
          <div className="flex items-center gap-3 text-red-600 dark:text-red-400 font-bold">
            <span className="text-xl">⚠️</span>
            出错了 / Something went wrong
          </div>
          <div className="p-4 rounded-xl bg-white/50 dark:bg-black/20 border border-red-100 dark:border-red-900/50 font-mono text-xs text-red-800 dark:text-red-300 overflow-auto max-h-[200px]">
            {this.state.error.message}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            重新加载 / Reload
          </button>
        </div>
      </div>
    );
  }
}
