//! 最近项目历史。用 tauri-plugin-store 存到 history.json（与含 key 的 settings.json
//! 分开，便于单独清理）。每条记录完整的 ProjectSummary，重开应用可秒级恢复三栏，
//! 无需重新打包/总结；代码检索索引本就按路径 hash 落磁盘持久，直接复用。

use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "history.json";
const RECENTS_KEY: &str = "recents";
const MAX_RECENTS: usize = 12;

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
pub fn save_recent(app: tauri::AppHandle, project: RecentProject) -> Result<(), String> {
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
pub fn remove_recent(app: tauri::AppHandle, path: String) -> Result<(), String> {
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
