mod history;
mod llm;
mod settings;
mod sidecar;

use llm::{ChatMessage, ProjectSummary};
use sidecar::{FileContent, FileListing, IndexResult, PackedProject, SearchResult};

#[tauri::command]
async fn pack_project(path: String) -> Result<PackedProject, String> {
  sidecar::pack_project(path).await
}

#[tauri::command]
async fn index_project(path: String) -> Result<IndexResult, String> {
  sidecar::index_project(path).await
}

#[tauri::command]
async fn search_code(
  path: String,
  query: String,
  limit: Option<u32>,
) -> Result<SearchResult, String> {
  sidecar::search_code(path, query, limit.unwrap_or(10)).await
}

#[tauri::command]
async fn list_files(path: String) -> Result<FileListing, String> {
  sidecar::list_files(path).await
}

#[tauri::command]
async fn read_file(root: String, relative: String) -> Result<FileContent, String> {
  sidecar::read_file(root, relative).await
}

#[tauri::command]
async fn summarize_project(
  packed: PackedProject,
  locale: String,
) -> Result<ProjectSummary, String> {
  llm::summarize(&packed, &locale).await
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
      chat_ask,
      settings::get_settings,
      settings::save_settings,
      settings::test_connection,
      history::save_recent,
      history::get_recents,
      history::remove_recent,
      history::path_exists,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
