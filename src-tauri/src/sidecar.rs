//! Spawn the Node sidecar (`sidecar/pack-server.mjs`) once per request and
//! exchange one newline-delimited JSON message. Three commands supported:
//!   - pack:       run Repomix on a project
//!   - list_files: enumerate the file tree (skipping noise + binaries)
//!   - read_file:  return one file's UTF-8 contents

use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackedProject {
  pub name: String,
  pub path: String,
  #[serde(rename = "filesScanned")]
  pub files_scanned: u32,
  #[serde(rename = "totalChars")]
  pub total_chars: u32,
  #[serde(rename = "totalTokens")]
  pub total_tokens: u32,
  pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
  pub path: String,
  pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileListing {
  pub root: String,
  pub files: Vec<FileEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileContent {
  pub path: String,
  pub size: u64,
  pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexResult {
  pub root: String,
  pub files: u32,
  pub chunks: u32,
  #[serde(default)]
  pub reused: u32,
  #[serde(default)]
  pub reindexed: u32,
  #[serde(default)]
  pub removed: u32,
  #[serde(default)]
  pub embedded: u32,
  #[serde(rename = "dbPath")]
  pub db_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeHit {
  pub path: String,
  pub score: f64,
  pub content: String,
  #[serde(rename = "startLine", default)]
  pub start_line: u32,
  #[serde(rename = "endLine", default)]
  pub end_line: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
  pub hits: Vec<CodeHit>,
  #[serde(default)]
  pub indexed: bool,
  #[serde(default)]
  pub hybrid: bool,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse {
  ok: bool,
  data: Option<serde_json::Value>,
  error: Option<String>,
}

/// dev 下源码树里的 sidecar 脚本路径（CARGO_MANIFEST_DIR/../sidecar/pack-server.mjs）。
/// 仅当 bundled resource 不存在时作为回退使用。
fn dev_script_path() -> PathBuf {
  let manifest_dir = env!("CARGO_MANIFEST_DIR");
  PathBuf::from(manifest_dir)
    .parent()
    .map(|p| p.join("sidecar").join("pack-server.mjs"))
    .unwrap_or_else(|| PathBuf::from("sidecar/pack-server.mjs"))
}

/// 解析 sidecar 入口脚本：优先用打进 bundle 的 resources/sidecar/pack-server.mjs，
/// 该文件不存在（dev 运行）时回退到源码树。
fn resolve_script_path(app: &AppHandle) -> PathBuf {
  if let Ok(p) = app
    .path()
    .resolve("sidecar/pack-server.mjs", BaseDirectory::Resource)
  {
    if p.exists() {
      return p;
    }
  }
  dev_script_path()
}

/// 解析 node 可执行文件：优先用打进 bundle 的 resources/node（最终用户无需自带 node），
/// 该文件不存在（dev 运行）时回退到系统 PATH 里的 "node"。
fn resolve_node_command(app: &AppHandle) -> String {
  if let Ok(p) = app.path().resolve("node", BaseDirectory::Resource) {
    if p.exists() {
      return p.to_string_lossy().into_owned();
    }
  }
  "node".to_string()
}

/// Generic call: spawn node sidecar, write one JSON line, read one JSON
/// response, then kill the child. Deserialize the response data into T.
async fn call_sidecar<T>(
  app: &AppHandle,
  cmd: &str,
  args: serde_json::Value,
) -> Result<T, String>
where
  T: serde::de::DeserializeOwned,
{
  let script = resolve_script_path(app);
  if !script.exists() {
    return Err(format!("sidecar script not found at {}", script.display()));
  }
  let node = resolve_node_command(app);

  let mut child = Command::new(&node)
    .arg(&script)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("failed to spawn node sidecar: {e}"))?;

  let request = serde_json::json!({
      "id": "req-1",
      "cmd": cmd,
      "args": args,
  });

  if let Some(stdin) = child.stdin.as_mut() {
    stdin
      .write_all(format!("{}\n", request).as_bytes())
      .await
      .map_err(|e| format!("write to sidecar stdin failed: {e}"))?;
  }

  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "sidecar stdout missing".to_string())?;
  let mut reader = BufReader::new(stdout).lines();

  let line = reader
    .next_line()
    .await
    .map_err(|e| format!("read sidecar stdout failed: {e}"))?
    .ok_or_else(|| "sidecar produced no output".to_string())?;

  let _ = child.kill().await;

  let resp: SidecarResponse = serde_json::from_str(&line)
    .map_err(|e| format!("invalid sidecar response: {e}\nraw: {}", line))?;

  if !resp.ok {
    return Err(resp.error.unwrap_or_else(|| "unknown sidecar error".into()));
  }

  let data = resp
    .data
    .ok_or_else(|| "sidecar ok=true with no data".to_string())?;
  serde_json::from_value::<T>(data).map_err(|e| format!("decode {cmd} response failed: {e}"))
}

pub async fn pack_project(app: &AppHandle, project_path: String) -> Result<PackedProject, String> {
  call_sidecar(app, "pack", serde_json::json!({ "path": project_path })).await
}

pub async fn list_files(app: &AppHandle, project_path: String) -> Result<FileListing, String> {
  call_sidecar(app, "list_files", serde_json::json!({ "path": project_path })).await
}

pub async fn read_file(
  app: &AppHandle,
  root: String,
  relative: String,
) -> Result<FileContent, String> {
  call_sidecar(
    app,
    "read_file",
    serde_json::json!({ "root": root, "relative": relative }),
  )
  .await
}

pub async fn index_project(app: &AppHandle, project_path: String) -> Result<IndexResult, String> {
  call_sidecar(app, "index_project", serde_json::json!({ "path": project_path })).await
}

pub async fn search_code(
  app: &AppHandle,
  project_path: String,
  query: String,
  limit: u32,
) -> Result<SearchResult, String> {
  call_sidecar(
    app,
    "search_code",
    serde_json::json!({ "path": project_path, "query": query, "limit": limit }),
  )
  .await
}
