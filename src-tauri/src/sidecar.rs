//! Spawn the Node sidecar (`sidecar/pack-server.mjs`) and exchange one
//! newline-delimited JSON request/response. Returns the parsed payload.

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

#[derive(Debug, Deserialize)]
struct SidecarResponse {
    ok: bool,
    data: Option<serde_json::Value>,
    error: Option<String>,
}

/// Path to the sidecar script.
///
/// In dev mode, the script lives at `<repo>/sidecar/pack-server.mjs` relative
/// to the cargo manifest. In production we rely on a bundled resource path,
/// but M1 only targets dev mode.
fn sidecar_script_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .map(|p| p.join("sidecar").join("pack-server.mjs"))
        .unwrap_or_else(|| PathBuf::from("sidecar/pack-server.mjs"))
}

pub async fn pack_project(project_path: String) -> Result<PackedProject, String> {
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
        "id": "pack-1",
        "cmd": "pack",
        "args": { "path": project_path },
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

    // Single response, single line.
    let line = reader
        .next_line()
        .await
        .map_err(|e| format!("read sidecar stdout failed: {e}"))?
        .ok_or_else(|| "sidecar produced no output".to_string())?;

    // Kill child eagerly; sidecar exits naturally after responding but we
    // don't want a dangling node process if anything goes wrong.
    let _ = child.kill().await;

    let resp: SidecarResponse = serde_json::from_str(&line)
        .map_err(|e| format!("invalid sidecar response: {e}\nraw: {}", line))?;

    if !resp.ok {
        return Err(resp.error.unwrap_or_else(|| "unknown sidecar error".into()));
    }

    let data = resp
        .data
        .ok_or_else(|| "sidecar ok=true with no data".to_string())?;
    serde_json::from_value::<PackedProject>(data)
        .map_err(|e| format!("decode PackedProject failed: {e}"))
}
