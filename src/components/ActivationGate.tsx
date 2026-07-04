"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { errMsg } from "@/lib/errMsg";
import { useT } from "@/lib/i18n";

interface Props {
  /** 本机识别码（Rust 端硬件指纹的单向哈希），买家发给卖家换绑定激活码。 */
  machineId: string;
  onActivated: () => void;
}

/** 首启激活门：全屏遮挡主界面，激活成功前不放行。一机一码（V2）为主流程。 */
export function ActivationGate({ machineId, onActivated }: Props) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyMachineId = useCallback(() => {
    void navigator.clipboard.writeText(machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [machineId]);

  const activate = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("activate_license", { code: trimmed });
      onActivated();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [code, busy, onActivated]);

  return (
    <div className="h-full flex items-center justify-center p-8 animate-in">
      <div className="max-w-md w-full p-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-xl shadow-slate-200/40 dark:shadow-none space-y-6">
        <div className="text-center space-y-2">
          <div className="text-3xl">🔐</div>
          <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-200">
            {t("license.title")}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t("license.desc")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            {t("license.machineId")}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 font-mono text-sm text-slate-800 dark:text-slate-200 tracking-wider select-all">
              {machineId}
            </code>
            <button
              type="button"
              onClick={copyMachineId}
              className="shrink-0 px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
            >
              {copied ? t("license.copied") : t("license.copy")}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
            {t("license.hint")}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void activate();
          }}
          className="space-y-3"
        >
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder={t("license.placeholder")}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full px-4 py-3 text-sm font-mono rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
          />
          {error && (
            <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-900/40 text-xs text-red-700 dark:text-red-300 leading-relaxed">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full py-3 rounded-2xl bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-medium transition-colors shadow-lg shadow-amber-600/20 disabled:shadow-none"
          >
            {busy ? t("license.activating") : t("license.activate")}
          </button>
        </form>
      </div>
    </div>
  );
}
