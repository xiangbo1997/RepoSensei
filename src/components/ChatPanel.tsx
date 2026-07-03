"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  memo,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { errMsg } from "@/lib/errMsg";
import { useT } from "@/lib/i18n";
import { isMermaidBlock } from "@/lib/mermaid-detect";
import type { ChatBubble, ChatMessage, ProjectSummary } from "@/lib/types";
import { MermaidView } from "./MermaidView";

let messageCounter = 0;
const nextId = () => `msg-${++messageCounter}`;

/** 行内代码里「相对文件路径 + 可选 :行号 / :行号范围」的形态，命中即渲染成可点击跳转。 */
const FILE_CITATION = /^([\w@./+-]+\.[\w]+)(?::(\d+)(?:-\d+)?)?$/;

interface Props {
  summary: ProjectSummary;
  projectRoot: string;
  /** 代码检索索引的后台构建状态。首问且仍在 building 时会短等就绪（带超时）。 */
  indexStatus?: "idle" | "building" | "ready";
  /** 点击回答里的 file:line 引用时，在中栏 CodeViewer 打开对应文件（可选，由 page.tsx 传入）。 */
  onOpenFile?: (path: string, line?: number) => void;
  ref?: Ref<ChatPanelHandle>;
}

export interface ChatPanelHandle {
  prefill: (text: string, focus?: boolean) => void;
}

/** 首问等待索引就绪的硬超时（毫秒）：到点照常发送，避免永久卡住。 */
const INDEX_WAIT_TIMEOUT_MS = 8000;
const INDEX_WAIT_POLL_MS = 200;

/** 「已复制」提示回落成「复制」的延时（毫秒）。 */
const COPIED_FLASH_MS = 1500;

/**
 * 单条消息气泡，memo 化——关键收益：流式追加时只有正在生成的那条会重渲，
 * 其余已完成的历史气泡（含已渲染的 markdown / mermaid）被 memo 挡住不再重解析。
 * 正在流式的那条只渲纯文本（whitespace-pre-wrap），把逐字符的 markdown 重解析
 * 从每回答约 500 次压到完成时的 1 次。
 */
interface BubbleProps {
  message: ChatBubble;
  /** 这条是否正处于流式追加中——是则渲纯文本，避免半截 markdown 反复重解析。 */
  isStreaming: boolean;
  /** 这条是否是最后一条 assistant 消息——只有它显示「重试」。 */
  isLastAssistant: boolean;
  onOpenFile?: (path: string, line?: number) => void;
  /** 传 (id, content) 而非闭包 content，让父层能传稳定引用，保住 memo。 */
  onCopy: (id: string, content: string) => void;
  onRetry: () => void;
  copyLabel: string;
  copiedLabel: string;
  retryLabel: string;
  justCopied: boolean;
}

const Bubble = memo(function Bubble({
  message,
  isStreaming,
  isLastAssistant,
  onOpenFile,
  onCopy,
  onRetry,
  copyLabel,
  copiedLabel,
  retryLabel,
  justCopied,
}: BubbleProps) {
  const isUser = message.role === "user";
  return (
    <div
      className={`group flex ${isUser ? "justify-end" : "justify-start"} animate-in`}
    >
      <div
        className={`max-w-[90%] min-w-0 px-4 py-3 shadow-sm ${
          isUser
            ? "bg-amber-600 text-white rounded-[1.25rem] rounded-tr-none"
            : "bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-slate-100 rounded-[1.25rem] rounded-tl-none border border-slate-200 dark:border-white/5"
        }`}
      >
        {isUser ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : isStreaming ? (
          // 流式中：纯文本渲染，等 streaming 结束再走完整 markdown 管线。
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <>
            <div className="markdown-body text-sm min-w-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const raw = String(children).replace(/\n$/, "");
                    if (isMermaidBlock(className, raw)) {
                      return <MermaidView code={raw} streaming={false} />;
                    }
                    // 行内代码（无 className 且单行）里若是 file:line 引用，渲染成可点击跳转。
                    if (!className && !raw.includes("\n") && onOpenFile) {
                      const m = FILE_CITATION.exec(raw);
                      if (m) {
                        const path = m[1];
                        const line = m[2] ? Number(m[2]) : undefined;
                        return (
                          <button
                            type="button"
                            onClick={() => onOpenFile(path, line)}
                            title="Open in viewer"
                            className="text-amber-700 dark:text-amber-400 underline decoration-dotted underline-offset-2 hover:decoration-solid font-mono text-[0.85em] cursor-pointer"
                          >
                            {raw}
                          </button>
                        );
                      }
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
            {/* 已完成的 assistant 气泡：hover 出现的复制 / 重试操作。 */}
            <div className="mt-1.5 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => onCopy(message.id, message.content)}
                className="text-[11px] text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                {justCopied ? copiedLabel : copyLabel}
              </button>
              {isLastAssistant && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-[11px] text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  {retryLabel}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export function ChatPanel({
  summary,
  projectRoot,
  indexStatus = "idle",
  onOpenFile,
  ref,
}: Props) {
  const { t, locale } = useT();
  const [history, setHistory] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [waitingIndex, setWaitingIndex] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const currentBotIdRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 一轮问答结束后置位，由下方 effect 在 state 落定后再存档——避免在 setHistory
  // 更新器里塞 invoke 副作用（StrictMode 会双跑），也确保存的是提交后的完整历史。
  const pendingSaveRef = useRef(false);
  // 镜像最新 history 供 handleRetry 等回调同步读取（无需把 history 塞进依赖数组）。
  const historyRef = useRef<ChatBubble[]>(history);
  historyRef.current = history;
  // send 是 useCallback 闭包，会捕获旧的 indexStatus；用 ref 同步最新值供轮询读取。
  const indexStatusRef = useRef(indexStatus);
  indexStatusRef.current = indexStatus;
  // 「立即提问」按钮置位后，首问等待循环立刻跳出，不再等索引就绪。
  const skipWaitRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      prefill: (text, focus = true) => {
        setInput(text);
        if (focus) {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(text.length, text.length);
          });
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void (async () => {
      const u = await listen<string>("chat:delta", (event) => {
        const delta = event.payload;
        setHistory((prev) => {
          const targetId = currentBotIdRef.current;
          if (!targetId) {
            const id = nextId();
            currentBotIdRef.current = id;
            return [...prev, { id, role: "assistant", content: delta }];
          }
          const idx = prev.findIndex((m) => m.id === targetId);
          if (idx === -1) {
            return [
              ...prev,
              { id: targetId, role: "assistant", content: delta },
            ];
          }
          const next = prev.slice();
          next[idx] = { ...next[idx], content: next[idx].content + delta };
          return next;
        });
      });
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 挂载 / 切换项目时：加载该项目的历史对话，并清空未持久化的残留状态。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await invoke<ChatMessage[]>("get_chat", {
          path: projectRoot,
        });
        if (cancelled) return;
        setHistory(saved.map((m) => ({ ...m, id: nextId() })));
      } catch {
        // 读历史失败不致命：留空即可，用户照常提问。
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: history 是「触发依赖」——每次消息变化/流式追加都重新滚到底，虽未在体内读取
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 用 auto 而非 smooth：流式追加每秒触发几十次，smooth 缓动会被不断打断重启，
    // 叠加输入框打字（尤其中文 IME 合成）引发的 re-layout，肉眼即「上下回弹」抖动。
    // 仅当用户本就贴近底部时才自动滚——向上翻看历史时不强行拽回底部。
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history]);

  // 一轮问答结束（streaming 归位、history 已提交）后，把整段历史 fire-and-forget 存盘。
  // pendingSaveRef 保证只在真正完成一轮后触发，切换项目的加载不会误存。
  useEffect(() => {
    if (streaming || !pendingSaveRef.current) return;
    pendingSaveRef.current = false;
    void invoke("save_chat", {
      path: projectRoot,
      messages: history.map(({ role, content }) => ({ role, content })),
    }).catch(() => {
      // 存档失败不影响使用，静默忽略。
    });
  }, [streaming, history, projectRoot]);

  const send = useCallback(
    async (rawQuestion?: string, baseHistory?: ChatBubble[]) => {
      const question = (rawQuestion ?? input).trim();
      if (!question || streaming) return;
      setInput("");
      setStreaming(true);

      currentBotIdRef.current = null;

      const userBubble: ChatBubble = {
        id: nextId(),
        role: "user",
        content: question,
      };
      // 发给 API 的对话历史优先用调用方传入的 baseHistory（重试时是删档后的历史），
      // 否则读 historyRef 同步取最新 state——不依赖 send 的闭包 history。
      const priorHistory = baseHistory ?? historyRef.current;
      const historyForApi: ChatMessage[] = priorHistory.map(
        ({ role, content }) => ({ role, content }),
      );
      const isFirstMessage = priorHistory.length === 0;
      // 有 baseHistory（重试）时以它为基准重建，确保被删的旧气泡不会因未提交的 prev 复现；
      // 否则正常追加到当前 state。
      setHistory((prev) =>
        baseHistory ? [...baseHistory, userBubble] : [...prev, userBubble],
      );

      // 首问 gating：只有「刚选完项目就立刻提问」这一窗口会踩空索引。仅当本次是
      // 第一条消息（history 为空）且索引仍在 building 时，短等就绪——带硬超时，
      // 到点照常发送（降级有 Rust 端的诚实声明兜底）。后续提问索引早已 ready，不等。
      // 用户点了「立即提问」则 skipWaitRef 置位，立刻跳出不再等。
      if (isFirstMessage && indexStatusRef.current === "building") {
        skipWaitRef.current = false;
        setWaitingIndex(true);
        const deadline = Date.now() + INDEX_WAIT_TIMEOUT_MS;
        while (
          indexStatusRef.current === "building" &&
          !skipWaitRef.current &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, INDEX_WAIT_POLL_MS));
        }
        setWaitingIndex(false);
      }

      try {
        await invoke("chat_ask", {
          summary,
          history: historyForApi,
          question,
          locale,
          projectRoot,
        });
      } catch (e) {
        setHistory((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: t("chat.error", { message: errMsg(e) }),
          },
        ]);
      } finally {
        setStreaming(false);
        currentBotIdRef.current = null;
        // 标记「本轮结束需存档」，实际写盘交给下方 effect 在 state 落定后执行。
        pendingSaveRef.current = true;
      }
    },
    [input, streaming, summary, projectRoot, locale, t],
  );

  // 停止生成：取消 Rust 端在途流，chat_ask 会随即 resolve，交由 send 的 finally 清理。
  const stop = useCallback(() => {
    if (!streaming) return;
    void invoke("chat_cancel");
  }, [streaming]);

  // 复制回答原始 markdown，短暂把标签翻成「已复制」。
  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  // 重试最后一条回答：删掉这条 assistant 气泡及其对应的 user 提问，把删档后的历史作为
  // baseHistory 传给 send——send 据此重建 UI 与 API 上下文并重新发同一问，避免重复气泡。
  const handleRetry = useCallback(() => {
    if (streaming) return;
    const cur = historyRef.current;
    const lastAssistantIdx = cur.map((m) => m.role).lastIndexOf("assistant");
    if (lastAssistantIdx === -1) return;
    let userQuestion: string | null = null;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (cur[i].role === "user") {
        userQuestion = cur[i].content;
        break;
      }
    }
    if (!userQuestion) return;
    const trimmed = cur.slice(0, lastAssistantIdx);
    const lastUserIdx = trimmed.map((m) => m.role).lastIndexOf("user");
    const withoutLastUser =
      lastUserIdx === -1 ? trimmed : trimmed.slice(0, lastUserIdx);
    void send(userQuestion, withoutLastUser);
  }, [streaming, send]);

  const onCopyBubble = useCallback(
    (id: string, content: string) => {
      handleCopy(content);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, COPIED_FLASH_MS);
    },
    [handleCopy],
  );

  const lastAssistantId = (() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "assistant") return history[i].id;
    }
    return null;
  })();

  const copyLabel = t("chat.copy");
  const copiedLabel = t("chat.copied");
  const retryLabel = t("chat.retry");

  return (
    <div className="flex flex-col h-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            {t("chat.title")}
          </span>
        </div>
        {streaming && (
          <div className="flex gap-1">
            <div
              className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <div
              className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <div
              className="w-1 h-1 rounded-full bg-amber-500 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        )}
      </div>

      {waitingIndex && (
        <div className="px-6 py-2 bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug flex-1">
            {t("chat.waitingIndex")}
          </span>
          <button
            type="button"
            onClick={() => {
              skipWaitRef.current = true;
            }}
            className="shrink-0 text-[11px] font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200"
          >
            {t("chat.askNow")}
          </button>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-6 space-y-6">
        {history.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8 text-center">
            <div className="max-w-[200px] space-y-2">
              <div className="text-2xl opacity-20">💬</div>
              <div className="text-xs text-slate-400 dark:text-slate-500 italic leading-relaxed">
                {t("chat.hint")}
              </div>
            </div>
          </div>
        ) : (
          history.map((m) => (
            <Bubble
              key={m.id}
              message={m}
              isStreaming={streaming && m.id === currentBotIdRef.current}
              isLastAssistant={
                m.role === "assistant" && m.id === lastAssistantId
              }
              onOpenFile={onOpenFile}
              onCopy={onCopyBubble}
              onRetry={handleRetry}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              retryLabel={retryLabel}
              justCopied={copiedId === m.id}
            />
          ))
        )}
      </div>

      <div className="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="relative flex items-center"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 生成期间按 Escape 停止。
              if (e.key === "Escape" && streaming) {
                e.preventDefault();
                stop();
              }
            }}
            placeholder={t("chat.input.placeholder")}
            className="w-full pl-4 pr-12 py-3 text-sm rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="absolute right-2 p-2 text-amber-600 hover:text-amber-700 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                role="img"
                aria-label={t("chat.stop")}
              >
                <title>{t("chat.stop")}</title>
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="absolute right-2 p-2 text-amber-600 hover:text-amber-700 disabled:text-slate-300 dark:disabled:text-slate-700 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label={t("chat.send")}
              >
                <title>{t("chat.send")}</title>
                <path d="m5 12 7-7 7 7" />
                <path d="M12 19V5" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
