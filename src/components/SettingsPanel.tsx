"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { errMsg } from "@/lib/errMsg";
import { useT } from "@/lib/i18n";
import type { LlmProvider, SettingsView } from "@/lib/types";

interface FieldErrors {
  baseUrl?: string;
  apiKey?: string;
  summaryModel?: string;
}

interface Props {
  onClose: () => void;
  /** 保存成功后通知父组件（用于刷新「是否已配置凭据」状态）。 */
  onSaved?: () => void;
}

/** BYOK 设置面板：选 provider、填 key/baseUrl/model，保存到本地 store，测试连接。 */
export function SettingsPanel({ onClose, onSaved }: Props) {
  const { t } = useT();
  const [provider, setProvider] = useState<LlmProvider>("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [summaryModel, setSummaryModel] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    void (async () => {
      try {
        const s = await invoke<SettingsView>("get_settings");
        if (s.provider === "openai" || s.provider === "anthropic") {
          setProvider(s.provider);
        }
        setBaseUrl(s.baseUrl);
        setSummaryModel(s.summaryModel);
        setChatModel(s.chatModel);
        setKeyHint(s.keyHint);
        setHasKey(s.hasKey);
      } catch {
        // 首次无配置，留默认
      }
    })();
  }, []);

  // Esc 关闭面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 保存前校验：openai 需要 baseUrl+summaryModel；已存 key 时 key 可空（表示保持不变）。 */
  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (provider === "openai") {
      if (!baseUrl.trim()) next.baseUrl = t("settings.error.baseUrlRequired");
      if (!summaryModel.trim())
        next.summaryModel = t("settings.error.modelRequired");
    }
    if (!hasKey && !apiKey.trim()) {
      next.apiKey = t("settings.error.keyRequired");
    }
    return next;
  };

  const save = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setSaved(false);
    setTestMsg(null);
    try {
      await invoke("save_settings", {
        settings: {
          provider,
          baseUrl: provider === "openai" ? baseUrl : "",
          // 空 key 表示保持已存的 key 不变
          apiKey,
          summaryModel,
          chatModel,
        },
      });
      setSaved(true);
      setApiKey("");
      if (apiKey) setHasKey(true);
      onSaved?.();
    } catch (e) {
      setTestMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const label = await invoke<string>("test_connection");
      setTestMsg({ ok: true, text: t("settings.test.ok", { label }) });
    } catch (e) {
      setTestMsg({
        ok: false,
        text: t("settings.test.fail", { message: errMsg(e) }),
      });
    } finally {
      setTesting(false);
    }
  };

  // 点击遮罩关闭；点击面板本身不关闭。
  const onBackdrop = useCallback(() => onClose(), [onClose]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩层仅承载「点击关闭」，Esc 提供键盘等价关闭
    // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘关闭由上方 Escape 监听处理
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-in"
      onClick={onBackdrop}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: onClick 仅阻止冒泡以避免点面板误关闭 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation 无需键盘等价 */}
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-auto p-8 rounded-[2rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-50">
            ⚙️ {t("settings.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            {t("settings.close")}
          </button>
        </div>

        <div className="space-y-5">
          <Field label={t("settings.provider")}>
            <div className="flex gap-2">
              {(["anthropic", "openai"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 px-3 py-2 text-xs font-bold rounded-xl border transition-colors ${
                    provider === p
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-amber-500/50"
                  }`}
                >
                  {t(`settings.provider.${p}`)}
                </button>
              ))}
            </div>
          </Field>

          {provider === "openai" && (
            <Field label={t("settings.baseUrl")}>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setErrors((prev) => ({ ...prev, baseUrl: undefined }));
                }}
                placeholder={t("settings.baseUrl.placeholder")}
                className={`w-full px-3 py-2 text-sm rounded-xl border bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                  errors.baseUrl
                    ? "border-red-400 dark:border-red-500/60"
                    : "border-slate-200 dark:border-white/10"
                }`}
              />
              {errors.baseUrl && <FieldError message={errors.baseUrl} />}
            </Field>
          )}

          <Field label={t("settings.apiKey")}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setErrors((prev) => ({ ...prev, apiKey: undefined }));
              }}
              placeholder={t("settings.apiKey.placeholder")}
              className={`w-full px-3 py-2 text-sm rounded-xl border bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono ${
                errors.apiKey
                  ? "border-red-400 dark:border-red-500/60"
                  : "border-slate-200 dark:border-white/10"
              }`}
            />
            {errors.apiKey && <FieldError message={errors.apiKey} />}
            {hasKey && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                {t("settings.apiKey.set", { hint: keyHint })}
              </div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.summaryModel")}>
              <input
                type="text"
                value={summaryModel}
                onChange={(e) => {
                  setSummaryModel(e.target.value);
                  setErrors((prev) => ({ ...prev, summaryModel: undefined }));
                }}
                placeholder={
                  provider === "openai"
                    ? "e.g. gpt-4o-mini (required)"
                    : "claude-sonnet-4-6"
                }
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono ${
                  errors.summaryModel
                    ? "border-red-400 dark:border-red-500/60"
                    : "border-slate-200 dark:border-white/10"
                }`}
              />
              {errors.summaryModel && (
                <FieldError message={errors.summaryModel} />
              )}
            </Field>
            <Field label={t("settings.chatModel")}>
              <input
                type="text"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder={
                  provider === "openai"
                    ? "e.g. gpt-4o-mini"
                    : "claude-haiku-4-5-20251001"
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono"
              />
            </Field>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-500 italic">
            🔒 {t("settings.hint.byok")}
          </div>

          {testMsg && (
            <div
              className={`text-xs p-3 rounded-xl font-mono break-words ${
                testMsg.ok
                  ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
              }`}
            >
              {testMsg.text}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {saved ? t("settings.saved") : t("settings.save")}
            </button>
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 font-bold text-sm hover:border-amber-500/50 transition-colors disabled:opacity-50"
            >
              {testing ? t("settings.testing") : t("settings.test")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">
      {message}
    </div>
  );
}
