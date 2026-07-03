mod concept_docs;
mod history;
mod llm;
mod settings;
mod sidecar;

use llm::{ChatMessage, DeepInsight, ProjectSummary};
use sidecar::{FileContent, FileListing, IndexResult, PackedProject, SearchResult};

#[tauri::command]
async fn pack_project(app: tauri::AppHandle, path: String) -> Result<PackedProject, String> {
  sidecar::pack_project(&app, path).await
}

#[tauri::command]
async fn index_project(app: tauri::AppHandle, path: String) -> Result<IndexResult, String> {
  sidecar::index_project(&app, path).await
}

#[tauri::command]
async fn search_code(
  app: tauri::AppHandle,
  path: String,
  query: String,
  limit: Option<u32>,
) -> Result<SearchResult, String> {
  sidecar::search_code(&app, path, query, limit.unwrap_or(10)).await
}

#[tauri::command]
async fn list_files(app: tauri::AppHandle, path: String) -> Result<FileListing, String> {
  sidecar::list_files(&app, path).await
}

#[tauri::command]
async fn read_file(
  app: tauri::AppHandle,
  root: String,
  relative: String,
) -> Result<FileContent, String> {
  sidecar::read_file(&app, root, relative).await
}

#[tauri::command]
async fn summarize_project(
  packed: PackedProject,
  locale: String,
) -> Result<ProjectSummary, String> {
  llm::summarize(&packed, &locale).await
}

#[tauri::command]
async fn deep_analyze(
  packed: PackedProject,
  summary: ProjectSummary,
  locale: String,
) -> Result<Vec<DeepInsight>, String> {
  llm::deep_analyze(&packed, &summary, &locale).await
}

#[tauri::command]
async fn chat_ask(
  window: tauri::Window,
  summary: ProjectSummary,
  history: Vec<ChatMessage>,
  question: String,
  locale: String,
  project_root: Option<String>,
) -> Result<(), String> {
  llm::chat_stream(
    window,
    &summary,
    &history,
    &question,
    &locale,
    project_root.as_deref(),
  )
  .await
}

/// 取消进行中的 chat 流式回答。前端点「停止」时调用；置取消标志，
/// 正在跑的 SSE 循环在下一个 chunk 边界感知并提前收尾。
#[tauri::command]
fn chat_cancel() {
  llm::cancel_chat();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .setup(|app| {
      // 启动时把已保存的 BYOK 设置加载进进程 env，供 resolve_config 读取。
      settings::apply_to_env(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      pack_project,
      index_project,
      search_code,
      list_files,
      read_file,
      summarize_project,
      deep_analyze,
      chat_ask,
      chat_cancel,
      settings::get_settings,
      settings::save_settings,
      settings::test_connection,
      history::save_recent,
      history::get_recents,
      history::remove_recent,
      history::path_exists,
      history::save_chat,
      history::get_chat,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
