//! Spawn the Node sidecar (`sidecar/pack-server.mjs`) once per request and
//! exchange one newline-delimited JSON message. Three commands supported:
//!   - pack:       run Repomix on a project
//!   - list_files: enumerate the file tree (skipping noise + binaries)
//!   - read_file:  return one file's UTF-8 contents

use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
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
    #[serde(rename = "dbPath")]
    pub db_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeHit {
    pub path: String,
    pub score: f64,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub hits: Vec<CodeHit>,
    #[serde(default)]
    pub indexed: bool,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse {
    ok: bool,
    data: Option<serde_json::Value>,
    error: Option<String>,
}

fn sidecar_script_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .map(|p| p.join("sidecar").join("pack-server.mjs"))
        .unwrap_or_else(|| PathBuf::from("sidecar/pack-server.mjs"))
}

/// Generic call: spawn node sidecar, write one JSON line, read one JSON
/// response, then kill the child. Deserialize the response data into T.
async fn call_sidecar<T>(cmd: &str, args: serde_json::Value) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    let script = sidecar_script_path();
    if !script.exists() {
        return Err(format!("sidecar script not found at {}", script.display()));
    }

    let mut child = Command::new("node")
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
    serde_json::from_value::<T>(data)
        .map_err(|e| format!("decode {cmd} response failed: {e}"))
}

pub async fn pack_project(project_path: String) -> Result<PackedProject, String> {
    call_sidecar("pack", serde_json::json!({ "path": project_path })).await
}

pub async fn list_files(project_path: String) -> Result<FileListing, String> {
    call_sidecar("list_files", serde_json::json!({ "path": project_path })).await
}

pub async fn read_file(root: String, relative: String) -> Result<FileContent, String> {
    call_sidecar(
        "read_file",
        serde_json::json!({ "root": root, "relative": relative }),
    )
    .await
}

pub async fn index_project(project_path: String) -> Result<IndexResult, String> {
    call_sidecar("index_project", serde_json::json!({ "path": project_path })).await
}

pub async fn search_code(
    project_path: String,
    query: String,
    limit: u32,
) -> Result<SearchResult, String> {
    call_sidecar(
        "search_code",
        serde_json::json!({ "path": project_path, "query": query, "limit": limit }),
    )
    .await
}
