"use client";

import { createContext, useContext } from "react";

export type Locale = "en" | "zh";

export const LOCALE_STORAGE_KEY = "reposensei.locale";

type Dict = Record<string, string>;

const en: Dict = {
  "app.title": "RepoSensei",
  "app.tagline": "Your AI repo sensei — drop in any Git project.",
  "app.tagline.hero":
    "Your AI repo sensei — drop in any Git project and understand it in 15 minutes.",
  "header.newProject": "← New project",

  "dialog.title": "Pick a Git project to learn",
  "cta.pickProject": "📁 Pick a local project to analyze",

  "stage.picking": "Waiting for you to pick a folder…",
  "stage.packing": "Packing the repository with Repomix…",
  "stage.summarizing": "Asking the model to read it for you…",
  "stage.tokens": "{files} files · {tokens} tokens",

  "error.title": "Something went wrong",
  "error.retry": "Try another project",

  "panel.loaded": "Loaded",

  "summary.overview": "Overview",
  "summary.techStack": "Tech stack",
  "summary.entryPoints": "Entry points",
  "summary.architecture": "Architecture",
  "summary.modules": "Modules",
  "summary.concepts": "Concepts to learn",
  "summary.concept.found": "Found: {evidence}",
  "summary.concept.learnMore": "Learn more ↗",

  "chat.title": "Ask the Sensei",
  "chat.hint":
    'Try: "What\'s the entry point?" · "How is auth handled?" · "What should I read first?"',
  "chat.thinking": "Sensei is thinking…",
  "chat.input.placeholder": "Ask about this codebase…",
  "chat.send": "Send",
  "chat.error": "⚠️ Error: {message}",

  "mermaid.failed": "Mermaid render failed — show source",

  "footer.build": "M1 prototype · v0.1.0 · Tauri 2 + Next.js 16",
};

const zh: Dict = {
  "app.title": "RepoSensei",
  "app.tagline": "你的 AI 仓库师父 — 拖个 Git 项目进来。",
  "app.tagline.hero": "你的 AI 仓库师父 — 拖个 Git 项目进来，15 分钟看懂它。",
  "header.newProject": "← 换一个项目",

  "dialog.title": "选择一个 Git 项目来学习",
  "cta.pickProject": "📁 选择本地项目分析",

  "stage.picking": "等你选一个文件夹…",
  "stage.packing": "用 Repomix 打包仓库中…",
  "stage.summarizing": "请模型先读一遍代码…",
  "stage.tokens": "{files} 个文件 · {tokens} tokens",

  "error.title": "出错了",
  "error.retry": "换一个项目试试",

  "panel.loaded": "已加载",

  "summary.overview": "项目概览",
  "summary.techStack": "技术栈",
  "summary.entryPoints": "入口文件",
  "summary.architecture": "架构图",
  "summary.modules": "模块",
  "summary.concepts": "可以顺手学的概念",
  "summary.concept.found": "出现在：{evidence}",
  "summary.concept.learnMore": "去学一下 ↗",

  "chat.title": "请教师父",
  "chat.hint":
    "试试问：「入口在哪？」 · 「认证是怎么做的？」 · 「应该先读哪个文件？」",
  "chat.thinking": "师父思考中…",
  "chat.input.placeholder": "针对这个项目提问…",
  "chat.send": "发送",
  "chat.error": "⚠️ 出错了：{message}",

  "mermaid.failed": "Mermaid 渲染失败 — 查看源码",

  "footer.build": "M1 原型 · v0.1.0 · Tauri 2 + Next.js 16",
};

export const dict: Record<Locale, Dict> = { en, zh };

export function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  const lang = window.navigator.language?.toLowerCase() ?? "";
  return lang.startsWith("zh") ? "zh" : "en";
}

export function format(
  template: string,
  vars?: Record<string, string | number>,
) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined ? `{${key}}` : String(v);
  });
}

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useT() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useT must be used inside <LocaleProvider>");
  }
  return ctx;
}
