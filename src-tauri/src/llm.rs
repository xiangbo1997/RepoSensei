//! LLM client. Talks to either:
//!   - Anthropic native API (ANTHROPIC_API_KEY set), or
//!   - OpenAI-compatible proxy (OPENAI_BASE_URL + OPENAI_API_KEY set).
//!
//! Uses bare reqwest to avoid the OpenAI SDK fingerprint headers that some
//! Cloudflare-fronted proxies WAF-block.

use std::path::PathBuf;
use std::sync::OnceLock;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModuleSummary {
    pub path: String,
    pub purpose: String,
    #[serde(rename = "keyFiles")]
    pub key_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConceptCard {
    pub name: String,
    #[serde(rename = "oneLiner")]
    pub one_liner: String,
    pub evidence: String,
    #[serde(rename = "learnMore")]
    pub learn_more: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSummary {
    #[serde(rename = "techStack")]
    pub tech_stack: Vec<String>,
    pub modules: Vec<ModuleSummary>,
    #[serde(rename = "entryPoints")]
    pub entry_points: Vec<String>,
    pub overview: String,
    #[serde(rename = "mermaidArchitecture")]
    pub mermaid_architecture: String,
    #[serde(rename = "conceptCards")]
    pub concept_cards: Vec<ConceptCard>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

const SUMMARY_INSTRUCTIONS_BASE: &str = r#"You are RepoSensei. Analyze the given repository and return a single JSON object matching exactly this shape:
{
  "techStack": string[],
  "modules": [{ "path": string, "purpose": string, "keyFiles": string[] }],
  "entryPoints": string[],
  "overview": string,
  "mermaidArchitecture": string,
  "conceptCards": [{ "name": string, "oneLiner": string, "evidence": string, "learnMore": string }]
}

Rules:
- Cite real file paths.
- Mermaid: use `graph LR`, max 12 nodes, group by module.
- Concept cards: only patterns/libs actually used. Authoritative learnMore URL.
- Return ONLY the JSON object, no prose, no fences."#;

/// Build the system prompt for the summarize step, injecting a language
/// directive based on the requested locale. JSON field names stay English so
/// the TypeScript types don't break; only the *values* (overview, purpose,
/// oneLiner, etc.) localize.
fn summary_instructions(locale: &str) -> String {
  let directive = locale_directive_summary(locale);
  format!("{SUMMARY_INSTRUCTIONS_BASE}\n\n{directive}")
}

fn locale_directive_summary(locale: &str) -> &'static str {
  match normalize_locale(locale) {
    "zh" => "Respond in Simplified Chinese (zh-CN). Keep JSON field names in English (techStack, modules, conceptCards, etc.), but write all VALUES in Simplified Chinese — overview, module purposes, concept oneLiner, evidence, etc. Mermaid node IDs and labels for code symbols (file names, class names) stay in their original language.",
    _ => "Respond entirely in English (US).",
  }
}

fn locale_directive_chat(locale: &str) -> &'static str {
  match normalize_locale(locale) {
    "zh" => "Always reply in Simplified Chinese (zh-CN). Keep code identifiers and file paths in their original form.",
    _ => "Always reply in English (US).",
  }
}

fn normalize_locale(locale: &str) -> &'static str {
  let lower = locale.to_ascii_lowercase();
  if lower.starts_with("zh") {
    "zh"
  } else {
    "en"
  }
}

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("reposensei/0.1")
            .build()
            .unwrap_or_default()
    })
}

#[derive(Clone, Copy)]
enum Provider {
    Anthropic,
    OpenAICompat,
}

struct Config {
    provider: Provider,
    base_url: String,
    api_key: String,
    summary_model: String,
    chat_model: String,
}

fn read_dotenv() {
    // Only load once per process; ignore if missing.
    static LOADED: OnceLock<()> = OnceLock::new();
    LOADED.get_or_init(|| {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let env_path = PathBuf::from(manifest_dir)
            .parent()
            .map(|p| p.join(".env.local"))
            .unwrap_or_else(|| PathBuf::from(".env.local"));
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
                    if std::env::var_os(k).is_none() {
                        std::env::set_var(k, v);
                    }
                }
            }
        }
    });
}

fn resolve_config() -> Result<Config, String> {
    read_dotenv();
    if let Ok(base) = std::env::var("OPENAI_BASE_URL") {
        let key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| "OPENAI_BASE_URL set but OPENAI_API_KEY missing".to_string())?;
        let summary_model =
            std::env::var("RS_SUMMARY_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".into());
        let chat_model = std::env::var("RS_CHAT_MODEL").unwrap_or_else(|_| summary_model.clone());
        return Ok(Config {
            provider: Provider::OpenAICompat,
            base_url: base.trim_end_matches('/').to_string(),
            api_key: key,
            summary_model,
            chat_model,
        });
    }
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        let summary_model =
            std::env::var("RS_SUMMARY_MODEL").unwrap_or_else(|_| "claude-sonnet-4-6".into());
        let chat_model = std::env::var("RS_CHAT_MODEL")
            .unwrap_or_else(|_| "claude-haiku-4-5-20251001".into());
        return Ok(Config {
            provider: Provider::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            api_key: key,
            summary_model,
            chat_model,
        });
    }
    Err("No LLM credentials. Set OPENAI_BASE_URL+OPENAI_API_KEY or ANTHROPIC_API_KEY (e.g. via .env.local).".into())
}

pub async fn summarize(
    packed: &crate::sidecar::PackedProject,
    locale: &str,
) -> Result<ProjectSummary, String> {
    let cfg = resolve_config()?;
    let instructions = summary_instructions(locale);
    let user_prompt = format!(
        "<repository name=\"{}\" files=\"{}\">\n{}\n</repository>\n\nProduce the JSON now.",
        packed.name, packed.files_scanned, packed.content
    );

    let raw = match cfg.provider {
        Provider::OpenAICompat => openai_chat(&cfg, false, &cfg.summary_model, &instructions, &user_prompt, &[], None).await?,
        Provider::Anthropic => anthropic_chat(&cfg, false, &cfg.summary_model, &instructions, &user_prompt, &[], None).await?,
    };

    let cleaned = strip_fences(&raw);
    serde_json::from_str::<ProjectSummary>(&cleaned)
        .map_err(|e| format!("model returned unparseable JSON: {e}\n--- raw (first 400) ---\n{}", &cleaned.chars().take(400).collect::<String>()))
}

pub async fn chat_stream(
    window: Window,
    summary: &ProjectSummary,
    history: &[ChatMessage],
    question: &str,
    locale: &str,
) -> Result<(), String> {
    let cfg = resolve_config()?;
    let directive = locale_directive_chat(locale);
    let system = format!(
        "You are RepoSensei. Help the developer understand this codebase.\nTech: {}\nOverview: {}\nModules:\n{}\n\nGround every claim in the project's actual files. If unsure, say so.\n\n{directive}",
        summary.tech_stack.join(", "),
        summary.overview,
        summary
            .modules
            .iter()
            .map(|m| format!("- {}: {}", m.path, m.purpose))
            .collect::<Vec<_>>()
            .join("\n")
    );

    match cfg.provider {
        Provider::OpenAICompat => {
            openai_chat(&cfg, true, &cfg.chat_model, &system, question, history, Some(window)).await?;
        }
        Provider::Anthropic => {
            anthropic_chat(&cfg, true, &cfg.chat_model, &system, question, history, Some(window)).await?;
        }
    }
    Ok(())
}

fn strip_fences(text: &str) -> String {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("```json").or_else(|| t.strip_prefix("```")) {
        return rest.trim_end_matches("```").trim().to_string();
    }
    t.to_string()
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI-compatible
// ─────────────────────────────────────────────────────────────────────

async fn openai_chat(
    cfg: &Config,
    stream: bool,
    model: &str,
    system: &str,
    user: &str,
    history: &[ChatMessage],
    window: Option<Window>,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", cfg.base_url);
    let mut messages = vec![serde_json::json!({ "role": "system", "content": system })];
    for h in history {
        messages.push(serde_json::json!({ "role": h.role, "content": h.content }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": user }));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": if stream { 1024 } else { 4096 },
        "stream": stream,
        "messages": messages,
    });

    let mut accumulated = String::new();

    let resp = http()
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("LLM error {status}: {}", text.chars().take(400).collect::<String>()));
    }

    if !stream {
        #[derive(Deserialize)]
        struct C { content: String }
        #[derive(Deserialize)]
        struct Choice { message: C }
        #[derive(Deserialize)]
        struct R { choices: Vec<Choice> }
        let parsed: R = resp.json().await.map_err(|e| format!("decode JSON failed: {e}"))?;
        let content = parsed.choices.into_iter().next()
            .map(|c| c.message.content)
            .unwrap_or_default();
        return Ok(content);
    }

    let mut stream_resp = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream_resp.next().await {
        let bytes = chunk.map_err(|e| format!("stream chunk failed: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        loop {
            let Some(nl) = buf.find('\n') else { break };
            let line = buf[..nl].trim().to_string();
            buf.drain(..=nl);
            let Some(payload) = line.strip_prefix("data: ") else { continue };
            if payload == "[DONE]" {
                return Ok(accumulated);
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) {
                if let Some(delta) = json
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|s| s.as_str())
                {
                    accumulated.push_str(delta);
                    if let Some(w) = window.as_ref() {
                        let _ = w.emit("chat:delta", delta);
                    }
                }
            }
        }
    }
    Ok(accumulated)
}

// ─────────────────────────────────────────────────────────────────────
// Anthropic native
// ─────────────────────────────────────────────────────────────────────

async fn anthropic_chat(
    cfg: &Config,
    stream: bool,
    model: &str,
    system: &str,
    user: &str,
    history: &[ChatMessage],
    window: Option<Window>,
) -> Result<String, String> {
    let url = format!("{}/v1/messages", cfg.base_url);
    let mut messages = Vec::new();
    for h in history {
        messages.push(serde_json::json!({ "role": h.role, "content": h.content }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": user }));

    let body = serde_json::json!({
        "model": model,
        "max_tokens": if stream { 1024 } else { 4096 },
        "stream": stream,
        "system": system,
        "messages": messages,
    });

    let resp = http()
        .post(&url)
        .header("x-api-key", &cfg.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic error {status}: {}", text.chars().take(400).collect::<String>()));
    }

    if !stream {
        let json: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
        let text = json
            .get("content")
            .and_then(|c| c.get(0))
            .and_then(|b| b.get("text"))
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string();
        return Ok(text);
    }

    let mut accumulated = String::new();
    let mut stream_resp = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream_resp.next().await {
        let bytes = chunk.map_err(|e| format!("stream chunk failed: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        loop {
            let Some(nl) = buf.find('\n') else { break };
            let line = buf[..nl].trim().to_string();
            buf.drain(..=nl);
            let Some(payload) = line.strip_prefix("data: ") else { continue };
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) {
                if let Some(delta) = json
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|s| s.as_str())
                {
                    accumulated.push_str(delta);
                    if let Some(w) = window.as_ref() {
                        let _ = w.emit("chat:delta", delta);
                    }
                }
            }
        }
    }
    Ok(accumulated)
}
