//! 激活码校验（咸鱼一次性买断授权）。
//!
//! 算法必须与 deploy/gen-license.mjs 逐位一致：
//!   HMAC-SHA256(secret, payload) → base32 大写 → 取前 16 位；激活码 = `payload.signature`。
//!
//! 码型：
//!  - `V1:<序号>`   通用码，任意机器可激活（会被复用，仅应急用）。
//!  - `V2:<机器码>` 绑定本机（推荐）。机器码 = 本机硬件 UUID 的单向哈希（20 位 base32），
//!    不含隐私，可让买家放心发给卖家。
//!
//! 密钥在构建时经 RS_LICENSE_SECRET 环境变量注入（见 deploy/build-macos.sh）；
//! 未注入时回落到开发密钥（与 gen-license.mjs 的 DEV_FALLBACK_SECRET 一致），便于联调。
//!
//! 开发便利：debug 构建默认视为已激活（不挡 pnpm dev）；设 RS_LICENSE_FORCE=1
//! 可在 debug 下强制走真实校验，用于调试激活界面。release 构建始终强制校验。

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri_plugin_store::StoreExt;

type HmacSha256 = Hmac<Sha256>;

const STORE_FILE: &str = "license.json";
const STORE_KEY: &str = "code";
const SIGNATURE_LEN: usize = 16;
const MACHINE_ID_LEN: usize = 20;
const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// 构建时注入的授权密钥；未注入用开发密钥（正式销售前必须注入强随机串）。
const SECRET: &str = match option_env!("RS_LICENSE_SECRET") {
  Some(s) => s,
  None => "reposensei-dev-secret-do-not-ship",
};

/// 与 gen-license.mjs 的 toBase32 逐位一致。
fn to_base32(bytes: &[u8]) -> String {
  let mut bits = 0u32;
  let mut value = 0u32;
  let mut out = String::new();
  for &byte in bytes {
    value = (value << 8) | u32::from(byte);
    bits += 8;
    while bits >= 5 {
      out.push(char::from(BASE32_ALPHABET[((value >> (bits - 5)) & 31) as usize]));
      bits -= 5;
    }
  }
  if bits > 0 {
    out.push(char::from(BASE32_ALPHABET[((value << (5 - bits)) & 31) as usize]));
  }
  out
}

/// 对 payload 签名，产出完整激活码 `payload.signature`。
fn sign(payload: &str, secret: &str) -> Result<String, String> {
  let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
    .map_err(|e| format!("hmac init failed: {e}"))?;
  mac.update(payload.as_bytes());
  let digest = mac.finalize().into_bytes();
  let sig: String = to_base32(&digest).chars().take(SIGNATURE_LEN).collect();
  Ok(format!("{payload}.{sig}"))
}

/// 校验激活码：签名一致 + 码型合法 + V2 须匹配本机机器码。
fn verify_code(code: &str, machine: &str, secret: &str) -> Result<(), String> {
  // 生成端 payload 与签名均为大写；这里统一大写，容忍买家复制时的大小写差异。
  let code = code.trim().to_uppercase();
  let Some((payload, _sig)) = code.rsplit_once('.') else {
    return Err("激活码格式不对：缺少签名段（形如 V2:XXXX.XXXX）".to_string());
  };
  let expected = sign(payload, secret)?;
  if expected != code {
    return Err("激活码无效：签名校验失败（请整段复制，勿手打）".to_string());
  }
  if let Some(bound) = payload.strip_prefix("V2:") {
    if bound != machine {
      return Err("此激活码绑定的不是本机——请把 App 显示的本机识别码发给卖家重新生成".to_string());
    }
    return Ok(());
  }
  if payload.starts_with("V1:") {
    return Ok(());
  }
  Err("未知的激活码类型".to_string())
}

/// 本机硬件指纹原文（macOS 取 IOPlatformUUID；失败回退主机名+用户名弱指纹）。
fn raw_fingerprint() -> String {
  #[cfg(target_os = "macos")]
  {
    if let Ok(out) = std::process::Command::new("ioreg")
      .args(["-rd1", "-c", "IOPlatformExpertDevice"])
      .output()
    {
      let text = String::from_utf8_lossy(&out.stdout);
      for line in text.lines() {
        if line.contains("IOPlatformUUID") {
          if let Some(uuid) = line.split('"').nth(3) {
            return uuid.to_string();
          }
        }
      }
    }
  }
  // 回退：弱指纹。取不到硬件 UUID 时保证功能可用，绑定强度降级。
  let host = std::process::Command::new("hostname")
    .output()
    .ok()
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .unwrap_or_else(|| "unknown-host".to_string());
  let user = std::env::var("USER").unwrap_or_else(|_| "unknown-user".to_string());
  format!("{host}|{user}")
}

/// 本机识别码：指纹的 SHA-256 → base32 前 20 位。单向哈希，不含隐私，可外发。
pub fn machine_id() -> String {
  let digest = Sha256::digest(raw_fingerprint().as_bytes());
  to_base32(&digest).chars().take(MACHINE_ID_LEN).collect()
}

fn stored_code(app: &tauri::AppHandle) -> Option<String> {
  let store = app.store(STORE_FILE).ok()?;
  store
    .get(STORE_KEY)
    .and_then(|v| v.as_str().map(std::string::ToString::to_string))
}

/// debug 构建默认放行（不挡日常开发）；RS_LICENSE_FORCE=1 时强制真实校验。
fn dev_bypass() -> bool {
  cfg!(debug_assertions) && std::env::var("RS_LICENSE_FORCE").is_err()
}

/// 供其他命令做服务端拦截：未激活时拒绝执行 LLM 类命令（绕过前端 UI 也无效）。
pub fn ensure_activated(app: &tauri::AppHandle) -> Result<(), String> {
  if dev_bypass() {
    return Ok(());
  }
  let machine = machine_id();
  match stored_code(app) {
    Some(code) if verify_code(&code, &machine, SECRET).is_ok() => Ok(()),
    _ => Err("尚未激活：请在激活界面输入激活码".to_string()),
  }
}

/// 前端可见的激活状态。machineId 即「本机识别码」，买家发给卖家换绑定码。
#[derive(Debug, Serialize)]
pub struct LicenseStatus {
  pub activated: bool,
  #[serde(rename = "machineId")]
  pub machine_id: String,
}

#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> LicenseStatus {
  let machine = machine_id();
  let activated = dev_bypass()
    || stored_code(&app)
      .map(|code| verify_code(&code, &machine, SECRET).is_ok())
      .unwrap_or(false);
  LicenseStatus {
    activated,
    machine_id: machine,
  }
}

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, code: String) -> Result<(), String> {
  let machine = machine_id();
  verify_code(&code, &machine, SECRET)?;
  let store = app
    .store(STORE_FILE)
    .map_err(|e| format!("open store failed: {e}"))?;
  store.set(STORE_KEY, serde_json::json!(code.trim().to_uppercase()));
  store
    .save()
    .map_err(|e| format!("save store failed: {e}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// 与 deploy/gen-license.mjs 的开发密钥保持一致。
  const DEV_SECRET: &str = "reposensei-dev-secret-do-not-ship";

  /// 跨语言基准：以下两个码由 gen-license.mjs（node）用开发密钥生成，
  /// Rust 校验必须逐位认可，保证两端算法一致。
  #[test]
  fn accepts_v1_code_generated_by_node() {
    let code = "V1:0001.XIRXAXOOSFIZLQKH";
    assert!(verify_code(code, "ANYMACHINE", DEV_SECRET).is_ok());
  }

  #[test]
  fn accepts_v2_code_only_on_bound_machine() {
    let code = "V2:TESTMACHINE234567AB.ZQDGYNRVSFJHJZGB";
    assert!(verify_code(code, "TESTMACHINE234567AB", DEV_SECRET).is_ok());
    assert!(verify_code(code, "OTHERMACHINE2345678", DEV_SECRET).is_err());
  }

  #[test]
  fn rejects_tampered_signature() {
    let code = "V1:0001.AAAAAAAAAAAAAAAA";
    assert!(verify_code(code, "ANY", DEV_SECRET).is_err());
  }

  #[test]
  fn rejects_wrong_secret() {
    let code = "V1:0001.XIRXAXOOSFIZLQKH";
    assert!(verify_code(code, "ANY", "another-secret").is_err());
  }

  #[test]
  fn rejects_malformed_code() {
    assert!(verify_code("no-dot-here", "ANY", DEV_SECRET).is_err());
    assert!(verify_code("V3:0001.XIRXAXOOSFIZLQKH", "ANY", DEV_SECRET).is_err());
    assert!(verify_code("", "ANY", DEV_SECRET).is_err());
  }

  #[test]
  fn tolerates_whitespace_and_lowercase() {
    let code = "  v1:0001.xirxaxoosfizlqkh  ";
    assert!(verify_code(code, "ANY", DEV_SECRET).is_ok());
  }

  #[test]
  fn machine_id_is_stable_and_shaped() {
    let a = machine_id();
    let b = machine_id();
    assert_eq!(a, b);
    assert_eq!(a.len(), MACHINE_ID_LEN);
    assert!(a.bytes().all(|c| BASE32_ALPHABET.contains(&c)));
  }
}
