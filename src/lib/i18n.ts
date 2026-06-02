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
  "summary.tour": "Suggested reading order",
  "summary.tour.step": "Step {n}",

  "chat.title": "Ask the Sensei",
  "chat.hint":
    'Try: "What\'s the entry point?" · "How is auth handled?" · "What should I read first?"',
  "chat.thinking": "Sensei is thinking…",
  "chat.input.placeholder": "Ask about this codebase…",
  "chat.send": "Send",
  "chat.error": "⚠️ Error: {message}",

  "mermaid.failed": "Mermaid render failed — show source",

  "panel.files": "Files",
  "panel.chat": "Sensei",

  "recents.title": "Recent projects",
  "recents.reindexing": "Re-indexing in background…",
  "recents.gone": "Folder no longer exists — removed from history",
  "recents.remove": "Remove",
  "tree.title": "Files",
  "tree.search": "Filter files…",
  "tree.empty": "No files",
  "tree.empty.filtered": "Nothing matches",

  "code.noFile": "No file selected",
  "code.pickFile": "Pick a file on the left to view its source",
  "code.loading": "Loading…",
  "code.stats": "{lines} lines · {bytes} B",
  "code.askAboutFile": "💬 Ask about this file",
  "code.askPrompt": "[{path}] What does this file do? Explain it to me.",

  "summary.toggle.show": "Show summary",
  "summary.toggle.hide": "Hide summary",

  "search.title": "Search code",
  "search.placeholder": "Search symbols / code…",
  "search.indexing": "Indexing…",
  "search.noIndex": "Index not ready yet — try again shortly",
  "search.empty": "No matches",
  "search.hint":
    "Search functions, classes, or any code. Try path: or kind: filters.",

  "settings.title": "Settings",
  "settings.provider": "Provider",
  "settings.provider.anthropic": "Anthropic (native)",
  "settings.provider.openai": "OpenAI-compatible",
  "settings.baseUrl": "Base URL",
  "settings.baseUrl.placeholder": "https://your-proxy.example.com/v1",
  "settings.apiKey": "API key",
  "settings.apiKey.placeholder": "Paste your key (stored locally)",
  "settings.apiKey.set": "Key set ({hint}) — leave blank to keep",
  "settings.summaryModel": "Summary model",
  "settings.chatModel": "Chat model",
  "settings.save": "Save",
  "settings.saved": "Saved ✓",
  "settings.test": "Test connection",
  "settings.testing": "Testing…",
  "settings.test.ok": "Connected: {label}",
  "settings.test.fail": "Failed: {message}",
  "settings.close": "Close",
  "settings.hint.byok":
    "Your key is stored locally and never leaves your machine.",
  "settings.needed": "Set your API key in Settings to begin.",

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
  "summary.tour": "建议阅读顺序",
  "summary.tour.step": "第 {n} 步",

  "chat.title": "请教师父",
  "chat.hint":
    "试试问：「入口在哪？」 · 「认证是怎么做的？」 · 「应该先读哪个文件？」",
  "chat.thinking": "师父思考中…",
  "chat.input.placeholder": "针对这个项目提问…",
  "chat.send": "发送",
  "chat.error": "⚠️ 出错了：{message}",

  "mermaid.failed": "Mermaid 渲染失败 — 查看源码",

  "panel.files": "文件",
  "panel.chat": "师父",

  "recents.title": "最近的项目",
  "recents.reindexing": "后台重建索引中…",
  "recents.gone": "目录已不存在 — 已从历史移除",
  "recents.remove": "移除",
  "tree.title": "文件树",
  "tree.search": "过滤文件…",
  "tree.empty": "没有文件",
  "tree.empty.filtered": "没有匹配项",

  "code.noFile": "未选择文件",
  "code.pickFile": "在左边选一个文件查看源码",
  "code.loading": "加载中…",
  "code.stats": "{lines} 行 · {bytes} B",
  "code.askAboutFile": "💬 针对此文件提问",
  "code.askPrompt": "[{path}] 这个文件是干什么的？讲一下。",

  "summary.toggle.show": "展开总结",
  "summary.toggle.hide": "收起总结",

  "search.title": "搜索代码",
  "search.placeholder": "搜索符号 / 代码…",
  "search.indexing": "建立索引中…",
  "search.noIndex": "索引还没就绪 — 稍后再试",
  "search.empty": "没有匹配项",
  "search.hint": "搜索函数、类或任意代码。可用 path: 或 kind: 过滤。",

  "settings.title": "设置",
  "settings.provider": "服务商",
  "settings.provider.anthropic": "Anthropic（原生）",
  "settings.provider.openai": "OpenAI 兼容",
  "settings.baseUrl": "Base URL",
  "settings.baseUrl.placeholder": "https://你的代理.example.com/v1",
  "settings.apiKey": "API 密钥",
  "settings.apiKey.placeholder": "粘贴你的 key（仅存本地）",
  "settings.apiKey.set": "已设置（{hint}）— 留空则保持不变",
  "settings.summaryModel": "总结模型",
  "settings.chatModel": "对话模型",
  "settings.save": "保存",
  "settings.saved": "已保存 ✓",
  "settings.test": "测试连接",
  "settings.testing": "测试中…",
  "settings.test.ok": "已连接：{label}",
  "settings.test.fail": "失败：{message}",
  "settings.close": "关闭",
  "settings.hint.byok": "你的 key 仅存本地，绝不离开你的机器。",
  "settings.needed": "在「设置」里填入 API key 即可开始。",

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
