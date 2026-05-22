mod llm;
mod sidecar;

use llm::{ChatMessage, ProjectSummary};
use sidecar::{FileContent, FileListing, PackedProject};

#[tauri::command]
async fn pack_project(path: String) -> Result<PackedProject, String> {
  sidecar::pack_project(path).await
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
) -> Result<(), String> {
  llm::chat_stream(window, &summary, &history, &question, &locale).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      pack_project,
      list_files,
      read_file,
      summarize_project,
      chat_ask,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
