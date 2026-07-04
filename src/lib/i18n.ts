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
  "cta.pickProject.sub":
    "Select a local directory to begin your repository analysis",

  "onboard.noKey":
    "No API key configured yet — set one up first, or analysis will fail.",
  "onboard.noKey.cta": "Open Settings",

  "stage.picking": "Waiting for you to pick a folder…",
  "stage.packing": "Packing the repository with Repomix…",
  "stage.summarizing": "Asking the model to read it for you…",
  "stage.tokens": "{files} files · {tokens} tokens",
  "stage.elapsed": "{seconds}s elapsed",
  "stage.slow":
    "Taking longer than usual — large repos and busy models need more time…",

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
  "summary.concept.official": "Official docs",
  "summary.tour": "Suggested reading order",
  "summary.tour.step": "Step {n}",

  "chat.title": "Ask the Sensei",
  "chat.hint":
    'Try: "What\'s the entry point?" · "How is auth handled?" · "What should I read first?"',
  "chat.thinking": "Sensei is thinking…",
  "chat.waitingIndex":
    "Waiting for the code index to finish so I can cite real source…",
  "chat.input.placeholder": "Ask about this codebase…",
  "chat.send": "Send",
  "chat.stop": "Stop",
  "chat.copy": "Copy",
  "chat.copied": "Copied ✓",
  "chat.retry": "Retry",
  "chat.askNow": "Ask now anyway",
  "chat.error": "⚠️ Error: {message}",

  "mermaid.failed": "Mermaid render failed — show source",
  "mermaid.zoomIn": "Zoom in",
  "mermaid.zoomOut": "Zoom out",
  "mermaid.zoomReset": "Reset zoom",
  "mermaid.export": "Export SVG",

  "panel.files": "Files",
  "panel.chat": "Sensei",

  "index.building": "Indexing code…",
  "index.ready": "Index ready",

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
  "code.actions": "Actions",
  "code.askSelection": "Ask AI about selection",
  "code.copy": "Copy",
  "code.copied": "Copied ✓",
  "code.truncated":
    "Large file — showing first {shown} of {total} lines for performance",
  "code.showAll": "Show full file",

  "summary.toggle.show": "Show summary",
  "summary.toggle.hide": "Hide summary",
  "summary.export": "⬇ Export Markdown",
  "summary.exported": "Exported ✓",
  "summary.moduleFiles": "{n} files",

  "deep.button": "🔬 Deep analysis",
  "deep.title": "Deep analysis",
  "deep.cost":
    "Runs several focused LLM passes in parallel — uses extra tokens.",
  "deep.running": "Analyzing from multiple perspectives…",
  "deep.error": "Deep analysis failed: {message}",
  "deep.close": "Close",
  "deep.perspective.dataflow": "Data flow",
  "deep.perspective.security": "Security surface",
  "deep.perspective.testing": "Testing & quality",
  "deep.perspective.failed": "(could not be generated)",
  "deep.unavailable.restored":
    "Deep analysis needs the packed source — re-analyze this project to enable it.",

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
  "settings.error.keyRequired": "API key is required",
  "settings.error.baseUrlRequired": "Base URL is required",
  "settings.error.modelRequired": "Summary model is required",

  "license.title": "Activate RepoSensei",
  "license.desc":
    "One code per machine. Send the machine ID below to the seller and paste back the activation code you receive.",
  "license.machineId": "Machine ID",
  "license.copy": "Copy",
  "license.copied": "Copied ✓",
  "license.hint":
    "The machine ID is a one-way hash of this Mac's hardware identifier — it contains no personal data and is safe to share.",
  "license.placeholder": "Paste activation code, e.g. V2:XXXX.XXXX",
  "license.activate": "Activate",
  "license.activating": "Activating…",

  "footer.build": "v{version} · Tauri 2 + Next.js 16",
};

const zh: Dict = {
  "app.title": "RepoSensei",
  "app.tagline": "你的 AI 仓库师父 — 拖个 Git 项目进来。",
  "app.tagline.hero": "你的 AI 仓库师父 — 拖个 Git 项目进来，15 分钟看懂它。",
  "header.newProject": "← 换一个项目",

  "dialog.title": "选择一个 Git 项目来学习",
  "cta.pickProject": "📁 选择本地项目分析",
  "cta.pickProject.sub": "选择一个本地目录，开始分析这个仓库",

  "onboard.noKey": "还没配置 API key——先设置一下，否则分析会失败。",
  "onboard.noKey.cta": "打开设置",

  "stage.picking": "等你选一个文件夹…",
  "stage.packing": "用 Repomix 打包仓库中…",
  "stage.summarizing": "请模型先读一遍代码…",
  "stage.tokens": "{files} 个文件 · {tokens} tokens",
  "stage.elapsed": "已用时 {seconds} 秒",
  "stage.slow": "比平时慢一些——大仓库或模型繁忙时需要更久…",

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
  "summary.concept.official": "官方文档",
  "summary.tour": "建议阅读顺序",
  "summary.tour.step": "第 {n} 步",

  "chat.title": "请教师父",
  "chat.hint":
    "试试问：「入口在哪？」 · 「认证是怎么做的？」 · 「应该先读哪个文件？」",
  "chat.thinking": "师父思考中…",
  "chat.waitingIndex": "等代码索引建完，好引用真实源码再回答…",
  "chat.input.placeholder": "针对这个项目提问…",
  "chat.send": "发送",
  "chat.stop": "停止",
  "chat.copy": "复制",
  "chat.copied": "已复制 ✓",
  "chat.retry": "重试",
  "chat.askNow": "直接提问",
  "chat.error": "⚠️ 出错了：{message}",

  "mermaid.failed": "Mermaid 渲染失败 — 查看源码",
  "mermaid.zoomIn": "放大",
  "mermaid.zoomOut": "缩小",
  "mermaid.zoomReset": "重置缩放",
  "mermaid.export": "导出 SVG",

  "panel.files": "文件",
  "panel.chat": "师父",

  "index.building": "正在建立代码索引…",
  "index.ready": "索引已就绪",

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
  "code.actions": "操作",
  "code.askSelection": "针对选中代码提问",
  "code.copy": "复制",
  "code.copied": "已复制 ✓",
  "code.truncated": "大文件——为保证流畅只显示前 {shown} / {total} 行",
  "code.showAll": "显示完整文件",

  "summary.toggle.show": "展开总结",
  "summary.toggle.hide": "收起总结",
  "summary.export": "⬇ 导出 Markdown",
  "summary.exported": "已导出 ✓",
  "summary.moduleFiles": "{n} 个文件",

  "deep.button": "🔬 深度分析",
  "deep.title": "深度分析",
  "deep.cost": "并行跑多个专项 LLM 分析 — 会额外消耗 token。",
  "deep.running": "正在从多个视角分析…",
  "deep.error": "深度分析失败：{message}",
  "deep.close": "关闭",
  "deep.perspective.dataflow": "数据流",
  "deep.perspective.security": "安全面",
  "deep.perspective.testing": "测试与质量",
  "deep.perspective.failed": "（未能生成）",
  "deep.unavailable.restored":
    "深度分析需要完整打包内容——重新分析本项目后可用。",

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
  "settings.error.keyRequired": "API key 不能为空",
  "settings.error.baseUrlRequired": "Base URL 不能为空",
  "settings.error.modelRequired": "总结模型不能为空",

  "license.title": "激活 RepoSensei",
  "license.desc":
    "本 App 一机一码。把下面的「本机识别码」发给卖家，把收到的激活码粘贴回来即可。",
  "license.machineId": "本机识别码",
  "license.copy": "复制",
  "license.copied": "已复制 ✓",
  "license.hint":
    "识别码是本机硬件标识的单向哈希，不含任何隐私信息，可放心发给卖家。",
  "license.placeholder": "粘贴激活码，形如 V2:XXXX.XXXX",
  "license.activate": "激活",
  "license.activating": "激活中…",

  "footer.build": "v{version} · Tauri 2 + Next.js 16",
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
