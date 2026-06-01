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

/// summarize 注入仓库内容的字符上限。超大仓库整包送会溢出 context window，
/// 这里保守截断（约 ~100K token），并标注截断让模型知道是部分内容。
/// （来源：codegraph 自适应 token 预算思想；后续可结合 RAG 做更精准的内容选择。）
const SUMMARY_CONTENT_BUDGET: usize = 400_000;

pub async fn summarize(
    packed: &crate::sidecar::PackedProject,
    locale: &str,
) -> Result<ProjectSummary, String> {
    let cfg = resolve_config()?;
    let instructions = summary_instructions(locale);

    let (content, truncated) = if packed.content.len() > SUMMARY_CONTENT_BUDGET {
        // 按字符边界安全截断（content 是 UTF-8，找最近的字符边界）。
        let mut end = SUMMARY_CONTENT_BUDGET;
        while end > 0 && !packed.content.is_char_boundary(end) {
            end -= 1;
        }
        (&packed.content[..end], true)
    } else {
        (packed.content.as_str(), false)
    };

    let truncation_note = if truncated {
        "\n\n[NOTE: repository content truncated to fit context — summarize from what is shown; the codebase is larger.]"
    } else {
        ""
    };

    let user_prompt = format!(
        "<repository name=\"{}\" files=\"{}\">\n{}\n</repository>{}\n\nProduce the JSON now.",
        packed.name, packed.files_scanned, content, truncation_note
    );

    let raw = match cfg.provider {
        Provider::OpenAICompat => openai_chat(&cfg, false, &cfg.summary_model, &instructions, &user_prompt, &[], None).await?,
        Provider::Anthropic => anthropic_chat(&cfg, false, &cfg.summary_model, &instructions, &user_prompt, &[], None).await?,
    };

    parse_summary_resilient(&raw)
}

/// 四级容错解析（思想源自 Understand-Anything 的 sanitize→autofix→drop→fatal）：
/// LLM 输出的 JSON 经常带围栏、夹在散文里、缺字段或某个数组项格式错。直接 serde
/// 解析会因任一瑕疵整体失败。这里逐级抢救，最大化「能渲染就渲染」。
fn parse_summary_resilient(raw: &str) -> Result<ProjectSummary, String> {
    // Tier 1 — 定位 JSON：去围栏；失败则从散文中抽取首个配平的 {...}。
    let cleaned = strip_fences(raw);
    let candidate = match serde_json::from_str::<serde_json::Value>(&cleaned) {
        Ok(v) => v,
        Err(_) => {
            let extracted = extract_first_json_object(&cleaned)
                .ok_or_else(|| format!(
                    "model returned no parseable JSON object\n--- raw (first 400) ---\n{}",
                    cleaned.chars().take(400).collect::<String>()
                ))?;
            serde_json::from_str::<serde_json::Value>(&extracted).map_err(|e| {
                format!("extracted JSON still invalid: {e}\n--- (first 400) ---\n{}",
                    extracted.chars().take(400).collect::<String>())
            })?
        }
    };

    let obj = candidate.as_object().ok_or_else(|| {
        "model JSON root is not an object".to_string()
    })?;

    // Tier 2 + 3 — autofix（缺失字段补默认值）+ drop（坏数组项逐个丢弃）。
    Ok(ProjectSummary {
        tech_stack: string_array(obj.get("techStack")),
        modules: obj
            .get("modules")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(module_from_value).collect())
            .unwrap_or_default(),
        entry_points: string_array(obj.get("entryPoints")),
        overview: obj.get("overview").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        mermaid_architecture: obj
            .get("mermaidArchitecture")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        concept_cards: obj
            .get("conceptCards")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(concept_from_value).collect())
            .unwrap_or_default(),
    })
}

/// 把任意 JSON 值强制成字符串数组（非数组→空；非字符串元素→丢弃）。
fn string_array(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// 从一个 module 值抢救出 ModuleSummary；缺 path 则丢弃（path 是唯一必需键）。
fn module_from_value(v: &serde_json::Value) -> Option<ModuleSummary> {
    let obj = v.as_object()?;
    let path = obj.get("path").and_then(|p| p.as_str())?.to_string();
    if path.is_empty() {
        return None;
    }
    Some(ModuleSummary {
        path,
        purpose: obj.get("purpose").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        key_files: string_array(obj.get("keyFiles")),
    })
}

/// 从一个 concept card 值抢救出 ConceptCard；缺 name 则丢弃。
fn concept_from_value(v: &serde_json::Value) -> Option<ConceptCard> {
    let obj = v.as_object()?;
    let name = obj.get("name").and_then(|n| n.as_str())?.to_string();
    if name.is_empty() {
        return None;
    }
    Some(ConceptCard {
        name,
        one_liner: obj.get("oneLiner").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        evidence: obj.get("evidence").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        learn_more: obj.get("learnMore").and_then(|s| s.as_str()).unwrap_or("").to_string(),
    })
}

/// 从可能含散文的文本中抽取首个括号配平的 JSON 对象（处理字符串内的转义引号）。
fn extract_first_json_object(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for i in start..bytes.len() {
        let c = bytes[i] as char;
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// 注入到 prompt 的检索代码总字符上限（自适应预算的简化版：控制 token 消耗，
/// 避免把整仓塞进上下文。来源：codegraph 的 ExploreOutputBudget 思想）。
const GROUNDING_CHAR_BUDGET: usize = 8000;
/// 检索片段条数上限。
const GROUNDING_MAX_HITS: u32 = 6;

pub async fn chat_stream(
    window: Window,
    summary: &ProjectSummary,
    history: &[ChatMessage],
    question: &str,
    locale: &str,
    project_root: Option<&str>,
) -> Result<(), String> {
    let cfg = resolve_config()?;
    let directive = locale_directive_chat(locale);
    let modules = summary
        .modules
        .iter()
        .map(|m| format!("- {}: {}", m.path, m.purpose))
        .collect::<Vec<_>>()
        .join("\n");

    // grounding：用问题检索真实源码片段，注入到 system 末尾（最贴近问题，规避
    // lost-in-the-middle）。检索失败/无索引不阻塞对话——降级为「仅靠 summary 回答」。
    let grounding = match project_root {
        Some(root) => build_grounding_block(root, question).await,
        None => String::new(),
    };

    // Context 布局顺序：角色/规则 → locale → 项目概述 → 模块清单 → 检索源码（最相关，置底）。
    let mut system = format!(
        "You are RepoSensei. Help the developer understand this codebase.\nGround every claim in the project's actual files. If unsure, say so.\n\n{directive}\n\nProject overview: {}\nTech: {}\n\nModules:\n{}",
        summary.overview,
        summary.tech_stack.join(", "),
        modules
    );
    if !grounding.is_empty() {
        system.push_str(&grounding);
        // 显式要求模型引用检索到的 file:line，让回答可溯源、可核验。
        system.push_str(
            "\n\nWhen your answer relies on the retrieved source above, cite the file and line range (e.g. `src/foo.ts:10-22`). Prefer the retrieved code over assumptions.",
        );
    }

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

/// 检索与问题相关的源码片段，拼成可注入 prompt 的文本块（带预算截断）。
/// 任何错误都吞掉返回空串——grounding 是增强，不该让对话失败。
async fn build_grounding_block(project_root: &str, question: &str) -> String {
    let result = match crate::sidecar::search_code(
        project_root.to_string(),
        question.to_string(),
        GROUNDING_MAX_HITS,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[reposensei] grounding search failed (non-fatal): {e}");
            return String::new();
        }
    };
    if result.hits.is_empty() {
        return String::new();
    }

    let mut block = String::from(
        "\n\nRelevant source code (retrieved for this question — cite these files/lines):\n",
    );
    let mut used = 0usize;
    for hit in &result.hits {
        // 带 file:line 标注，便于模型在回答里给出可溯源的引用。
        let location = if hit.start_line > 0 {
            format!("{}:{}-{}", hit.path, hit.start_line, hit.end_line)
        } else {
            hit.path.clone()
        };
        let snippet = format!(
            "\n--- {} ---\n```\n{}\n```\n",
            location,
            hit.content.trim_end()
        );
        if used + snippet.len() > GROUNDING_CHAR_BUDGET {
            break;
        }
        used += snippet.len();
        block.push_str(&snippet);
    }
    block
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
    // Prompt caching：summarize 阶段的 user content 是「整个打包仓库」这种大而稳定的
    // 前缀，给它打 cache_control: ephemeral 可让重复调用命中缓存、省下大量输入 token。
    // 仅对足够大的内容启用（小于一个缓存块下限时无收益，用纯字符串避免额外开销）。
    const CACHE_MIN_CHARS: usize = 4096;
    if !stream && user.len() >= CACHE_MIN_CHARS {
        messages.push(serde_json::json!({
            "role": "user",
            "content": [{
                "type": "text",
                "text": user,
                "cache_control": { "type": "ephemeral" }
            }]
        }));
    } else {
        messages.push(serde_json::json!({ "role": "user", "content": user }));
    }

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
        // 监控 prompt cache 命中：cache_read 持续为 0 说明缓存键漂移（缓存没生效）。
        if let Some(usage) = json.get("usage") {
            let read = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let created = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            eprintln!("[reposensei] anthropic cache: read={read} created={created}");
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_json() {
        let raw = r#"{"techStack":["Rust"],"modules":[{"path":"src","purpose":"core","keyFiles":["lib.rs"]}],"entryPoints":["main.rs"],"overview":"ok","mermaidArchitecture":"graph LR","conceptCards":[{"name":"DI","oneLiner":"x","evidence":"y","learnMore":"z"}]}"#;
        let s = parse_summary_resilient(raw).unwrap();
        assert_eq!(s.tech_stack, vec!["Rust"]);
        assert_eq!(s.modules.len(), 1);
        assert_eq!(s.concept_cards[0].name, "DI");
    }

    #[test]
    fn tier1_strips_fences_and_prose() {
        let raw = "Here is the JSON:\n```json\n{\"techStack\":[\"Go\"],\"overview\":\"hi\"}\n```\nHope that helps!";
        let s = parse_summary_resilient(raw).unwrap();
        assert_eq!(s.tech_stack, vec!["Go"]);
        assert_eq!(s.overview, "hi");
    }

    #[test]
    fn tier1_extracts_object_from_surrounding_prose() {
        let raw = "Sure! {\"overview\":\"deep {nested} text\",\"techStack\":[\"TS\"]} done";
        let s = parse_summary_resilient(raw).unwrap();
        assert_eq!(s.overview, "deep {nested} text");
        assert_eq!(s.tech_stack, vec!["TS"]);
    }

    #[test]
    fn tier2_fills_missing_fields_with_defaults() {
        let raw = r#"{"overview":"only this"}"#;
        let s = parse_summary_resilient(raw).unwrap();
        assert_eq!(s.overview, "only this");
        assert!(s.tech_stack.is_empty());
        assert!(s.modules.is_empty());
        assert!(s.concept_cards.is_empty());
        assert_eq!(s.mermaid_architecture, "");
    }

    #[test]
    fn tier3_drops_malformed_array_items_keeps_good_ones() {
        let raw = r#"{
            "modules":[
                {"path":"a","purpose":"good"},
                {"purpose":"no path - drop me"},
                {"path":"","purpose":"empty path - drop me"}
            ],
            "conceptCards":[
                {"name":"Saga","oneLiner":"ok"},
                "garbage string",
                {"oneLiner":"no name - drop me"}
            ],
            "techStack":["valid", 123, null]
        }"#;
        let s = parse_summary_resilient(raw).unwrap();
        assert_eq!(s.modules.len(), 1);
        assert_eq!(s.modules[0].path, "a");
        assert_eq!(s.concept_cards.len(), 1);
        assert_eq!(s.concept_cards[0].name, "Saga");
        assert_eq!(s.tech_stack, vec!["valid"]);
    }

    #[test]
    fn tier4_fatal_when_no_json_object() {
        let raw = "I'm sorry, I cannot help with that request.";
        assert!(parse_summary_resilient(raw).is_err());
    }

    #[test]
    fn extract_handles_escaped_quotes_in_strings() {
        let raw = r#"prefix {"overview":"he said \"hi\" and { stuff"} suffix"#;
        let obj = extract_first_json_object(raw).unwrap();
        let v: serde_json::Value = serde_json::from_str(&obj).unwrap();
        assert_eq!(v["overview"], "he said \"hi\" and { stuff");
    }
}
