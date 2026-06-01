"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "@/lib/i18n";
import type { ChatBubble, ChatMessage, ProjectSummary } from "@/lib/types";

let messageCounter = 0;
const nextId = () => `msg-${++messageCounter}`;

interface Props {
  summary: ProjectSummary;
  projectRoot: string;
  ref?: Ref<ChatPanelHandle>;
}

export interface ChatPanelHandle {
  prefill: (text: string, focus?: boolean) => void;
}

export function ChatPanel({ summary, projectRoot, ref }: Props) {
  const { t, locale } = useT();
  const [history, setHistory] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const currentBotIdRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: history 是「触发依赖」——每次消息变化/流式追加都重新滚到底，虽未在体内读取
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [history]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    setStreaming(true);

    currentBotIdRef.current = null;

    const userBubble: ChatBubble = {
      id: nextId(),
      role: "user",
      content: question,
    };
    setHistory((prev) => [...prev, userBubble]);

    const historyForApi: ChatMessage[] = history.map(({ role, content }) => ({
      role,
      content,
    }));

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
          content: t("chat.error", {
            message: e instanceof Error ? e.message : String(e),
          }),
        },
      ]);
    } finally {
      setStreaming(false);
      currentBotIdRef.current = null;
    }
  }, [history, input, streaming, summary, projectRoot, locale, t]);

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
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in`}
            >
              <div
                className={`max-w-[90%] px-4 py-3 shadow-sm ${
                  m.role === "user"
                    ? "bg-amber-600 text-white rounded-[1.25rem] rounded-tr-none"
                    : "bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-slate-100 rounded-[1.25rem] rounded-tl-none border border-slate-200 dark:border-white/5"
                }`}
              >
                {m.role === "user" ? (
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className="markdown-body text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
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
            placeholder={t("chat.input.placeholder")}
            disabled={streaming}
            className="w-full pl-4 pr-12 py-3 text-sm rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="absolute right-2 p-2 text-amber-600 hover:text-amber-700 disabled:text-slate-300 dark:disabled:text-slate-700 transition-colors"
          >
            {streaming ? (
              <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            ) : (
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
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
