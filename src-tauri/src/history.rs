//! 最近项目历史。用 tauri-plugin-store 存到 history.json（与含 key 的 settings.json
//! 分开，便于单独清理）。每条记录完整的 ProjectSummary，重开应用可秒级恢复三栏，
//! 无需重新打包/总结；代码检索索引本就按路径 hash 落磁盘持久，直接复用。
//!
//! 聊天记录另存到 chats.json，按项目 path 键分桶，每桶只保留最近 MAX_CHAT_MESSAGES 条。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

const STORE_FILE: &str = "history.json";
const RECENTS_KEY: &str = "recents";
const MAX_RECENTS: usize = 12;

const CHAT_STORE_FILE: &str = "chats.json";
const CHATS_KEY: &str = "chats";
/// 每个项目最多保留的聊天消息数，防止 chats.json 无限增长。
const MAX_CHAT_MESSAGES: usize = 200;

/// 串行化所有 store 读改写。tauri-plugin-store 的 read→mutate→save 非原子，
/// 前端「即发即忘」的并发调用会交错、丢条目。所有写命令先拿这把锁，保证互斥。
/// 命令都是 async，await 一把 tokio Mutex 不阻塞运行时线程。
static STORE_LOCK: Mutex<()> = Mutex::const_new(());

/// 一条最近项目记录。summary 用 Value 透传，避免与 llm::ProjectSummary 强耦合。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentProject {
  pub path: String,
  pub name: String,
  #[serde(rename = "techStack", default)]
  pub tech_stack: Vec<String>,
  /// 完整 ProjectSummary（JSON），用于秒级恢复。
  pub summary: serde_json::Value,
  #[serde(rename = "openedAt")]
  pub opened_at: String,
}

fn read_recents(app: &tauri::AppHandle) -> Vec<RecentProject> {
  let Ok(store) = app.store(STORE_FILE) else {
    return Vec::new();
  };
  store
    .get(RECENTS_KEY)
    .and_then(|v| serde_json::from_value::<Vec<RecentProject>>(v).ok())
    .unwrap_or_default()
}

/// 写入一条最近项目（按 path 去重，最近置顶，上限 MAX_RECENTS）。
#[tauri::command]
pub async fn save_recent(app: tauri::AppHandle, project: RecentProject) -> Result<(), String> {
  // 持锁串行化 read→mutate→save，避免并发调用交错丢条目。
  let _guard = STORE_LOCK.lock().await;
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("open history store failed: {e}"))?;

  let mut recents = read_recents(&app);
  recents.retain(|r| r.path != project.path); // 去重
  recents.insert(0, project); // 最近置顶
  recents.truncate(MAX_RECENTS);

  store.set(RECENTS_KEY, serde_json::json!(recents));
  store
    .save()
    .map_err(|e| format!("save history failed: {e}"))?;
  Ok(())
}

/// 读取最近项目列表（最近在前）。
#[tauri::command]
pub fn get_recents(app: tauri::AppHandle) -> Result<Vec<RecentProject>, String> {
  Ok(read_recents(&app))
}

/// 从历史移除一条（目录已删/失效时）。
#[tauri::command]
pub async fn remove_recent(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let _guard = STORE_LOCK.lock().await;
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("open history store failed: {e}"))?;
  let mut recents = read_recents(&app);
  recents.retain(|r| r.path != path);
  store.set(RECENTS_KEY, serde_json::json!(recents));
  store
    .save()
    .map_err(|e| format!("save history failed: {e}"))?;
  Ok(())
}

/// 校验路径是否仍为可访问的目录（前端点击恢复前调用）。
#[tauri::command]
pub fn path_exists(path: String) -> bool {
  std::path::Path::new(&path).is_dir()
}

// ── 聊天记录持久化 ──────────────────────────────────────────────────────
// chats.json 里存一个 { path -> [ChatMessage] } 的 map，按项目路径分桶。
// 每桶只保留最近 MAX_CHAT_MESSAGES 条，避免长对话把文件撑大。

/// 读出整个 { path -> messages } map（缺失/损坏时返回空 map）。
fn read_chats(app: &tauri::AppHandle) -> HashMap<String, Vec<crate::llm::ChatMessage>> {
  let Ok(store) = app.store(CHAT_STORE_FILE) else {
    return HashMap::new();
  };
  store
    .get(CHATS_KEY)
    .and_then(|v| serde_json::from_value(v).ok())
    .unwrap_or_default()
}

/// 保存某项目的聊天记录（覆盖该 path 的桶，只留最近 MAX_CHAT_MESSAGES 条）。
#[tauri::command]
pub async fn save_chat(
  app: tauri::AppHandle,
  path: String,
  messages: Vec<crate::llm::ChatMessage>,
) -> Result<(), String> {
  let _guard = STORE_LOCK.lock().await;
  let store = app
    .store(CHAT_STORE_FILE)
    .map_err(|e| format!("open chat store failed: {e}"))?;

  let mut chats = read_chats(&app);
  // 只保留最近 MAX_CHAT_MESSAGES 条：超出则从尾部（最新）反向截取。
  let capped = if messages.len() > MAX_CHAT_MESSAGES {
    messages[messages.len() - MAX_CHAT_MESSAGES..].to_vec()
  } else {
    messages
  };
  chats.insert(path, capped);

  store.set(CHATS_KEY, serde_json::json!(chats));
  store.save().map_err(|e| format!("save chat failed: {e}"))?;
  Ok(())
}

/// 读取某项目的聊天记录（无记录返回空 vec）。
#[tauri::command]
pub async fn get_chat(
  app: tauri::AppHandle,
  path: String,
) -> Result<Vec<crate::llm::ChatMessage>, String> {
  Ok(read_chats(&app).remove(&path).unwrap_or_default())
}
