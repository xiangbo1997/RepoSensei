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
  ref?: Ref<ChatPanelHandle>;
}

export interface ChatPanelHandle {
  prefill: (text: string, focus?: boolean) => void;
}

export function ChatPanel({ summary, ref }: Props) {
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

  // Subscribe to streaming deltas from Rust.
  // No accumulating ref: we append directly inside the setState updater so
  // React Strict Mode double-invocation (or any duplicate listeners) can't
  // multiply the text.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void (async () => {
      const u = await listen<string>("chat:delta", (event) => {
        const delta = event.payload;
        setHistory((prev) => {
          const targetId = currentBotIdRef.current;
          if (!targetId) {
            // No active bot bubble — create one.
            const id = nextId();
            currentBotIdRef.current = id;
            return [...prev, { id, role: "assistant", content: delta }];
          }
          // Append delta to the active bot bubble; create if missing.
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

  // Auto-scroll on new content.
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;
    setInput("");
    setStreaming(true);

    // Reset the bot bubble pointer — the next delta will create a fresh one.
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
  }, [history, input, streaming, summary, locale, t]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {t("chat.title")}
      </div>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[400px]"
      >
        {history.length === 0 ? (
          <div className="text-sm text-slate-400 dark:text-slate-500 italic">
            {t("chat.hint")}
          </div>
        ) : (
          history.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                  m.role === "user"
                    ? "bg-amber-600 text-white whitespace-pre-wrap"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                }`}
              >
                {m.role === "user" ? (
                  m.content
                ) : (
                  <div className="markdown-body prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {streaming &&
          (history.length === 0 ||
            history[history.length - 1].role === "user") && (
            <div className="text-xs text-slate-400 italic animate-pulse">
              {t("chat.thinking")}
            </div>
          )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.input.placeholder")}
          disabled={streaming}
          className="flex-1 px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="px-4 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {streaming ? "…" : t("chat.send")}
        </button>
      </form>
    </div>
  );
}
