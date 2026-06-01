//! BYOK 设置持久化。用 tauri-plugin-store 把 provider/key/baseUrl/model 存到 app
//! 数据目录的 settings.json。启动时与保存时把这些值写进进程 env，让 llm.rs 的
//! resolve_config() 无需改动即可读到（来源优先级：store/env > .env.local）。
//!
//! 安全：key 是敏感信息，存本地文件（与 .env.local 同等本地优先级）。
//! get_settings 返回时对 key 做脱敏，绝不把明文 key 回传前端或写日志。

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";

/// 前端可见的设置（key 脱敏）。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SettingsView {
  pub provider: String, // "anthropic" | "openai"
  #[serde(rename = "baseUrl")]
  pub base_url: String,
  #[serde(rename = "summaryModel")]
  pub summary_model: String,
  #[serde(rename = "chatModel")]
  pub chat_model: String,
  /// key 是否已设置（不回传明文）。
  #[serde(rename = "hasKey")]
  pub has_key: bool,
  /// 脱敏预览，如 "sk-…last4"。
  #[serde(rename = "keyHint")]
  pub key_hint: String,
}

/// 前端提交的设置（含明文 key，仅入站）。
#[derive(Debug, Deserialize)]
pub struct SettingsInput {
  pub provider: String,
  #[serde(rename = "baseUrl")]
  pub base_url: Option<String>,
  #[serde(rename = "apiKey")]
  pub api_key: Option<String>,
  #[serde(rename = "summaryModel")]
  pub summary_model: Option<String>,
  #[serde(rename = "chatModel")]
  pub chat_model: Option<String>,
}

fn store_get(app: &tauri::AppHandle, key: &str) -> Option<String> {
  let store = app.store(STORE_FILE).ok()?;
  store
    .get(key)
    .and_then(|v| v.as_str().map(|s| s.to_string()))
}

/// 把 store 里的设置应用到进程 env，使 resolve_config() 能读到。
/// 启动时与每次保存后调用。store 缺值则不覆盖（保留 .env.local 行为）。
pub fn apply_to_env(app: &tauri::AppHandle) {
  let provider = store_get(app, "provider").unwrap_or_default();
  let key = store_get(app, "apiKey").unwrap_or_default();
  let base_url = store_get(app, "baseUrl").unwrap_or_default();
  let summary_model = store_get(app, "summaryModel").unwrap_or_default();
  let chat_model = store_get(app, "chatModel").unwrap_or_default();

  match provider.as_str() {
    "openai" => {
      if !base_url.is_empty() {
        std::env::set_var("OPENAI_BASE_URL", &base_url);
      }
      if !key.is_empty() {
        std::env::set_var("OPENAI_API_KEY", &key);
      }
    }
    "anthropic" => {
      // 切到 anthropic 时清掉 OPENAI_BASE_URL，否则 resolve_config 会优先走 openai。
      std::env::remove_var("OPENAI_BASE_URL");
      if !key.is_empty() {
        std::env::set_var("ANTHROPIC_API_KEY", &key);
      }
    }
    _ => {}
  }
  if !summary_model.is_empty() {
    std::env::set_var("RS_SUMMARY_MODEL", &summary_model);
  }
  if !chat_model.is_empty() {
    std::env::set_var("RS_CHAT_MODEL", &chat_model);
  }
}

fn key_hint(key: &str) -> String {
  if key.is_empty() {
    return String::new();
  }
  let tail: String = key
    .chars()
    .rev()
    .take(4)
    .collect::<String>()
    .chars()
    .rev()
    .collect();
  format!("…{tail}")
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<SettingsView, String> {
  let key = store_get(&app, "apiKey").unwrap_or_default();
  Ok(SettingsView {
    provider: store_get(&app, "provider").unwrap_or_default(),
    base_url: store_get(&app, "baseUrl").unwrap_or_default(),
    summary_model: store_get(&app, "summaryModel").unwrap_or_default(),
    chat_model: store_get(&app, "chatModel").unwrap_or_default(),
    has_key: !key.is_empty(),
    key_hint: key_hint(&key),
  })
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: SettingsInput) -> Result<(), String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("open store failed: {e}"))?;

  store.set("provider", serde_json::json!(settings.provider));
  if let Some(v) = settings.base_url {
    store.set("baseUrl", serde_json::json!(v));
  }
  // 空 key 表示「不修改已存 key」，避免前端不回显明文时误清空。
  if let Some(v) = settings.api_key {
    if !v.is_empty() {
      store.set("apiKey", serde_json::json!(v));
    }
  }
  if let Some(v) = settings.summary_model {
    store.set("summaryModel", serde_json::json!(v));
  }
  if let Some(v) = settings.chat_model {
    store.set("chatModel", serde_json::json!(v));
  }
  store
    .save()
    .map_err(|e| format!("save store failed: {e}"))?;

  apply_to_env(&app);
  Ok(())
}

/// 用当前配置发一个最小请求验证凭据可用（不依赖已索引项目）。
#[tauri::command]
pub async fn test_connection(app: tauri::AppHandle) -> Result<String, String> {
  apply_to_env(&app);
  crate::llm::ping().await
}
