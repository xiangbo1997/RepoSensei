//! LLM client. Talks to either:
//!   - Anthropic native API (ANTHROPIC_API_KEY set), or
//!   - OpenAI-compatible proxy (OPENAI_BASE_URL + OPENAI_API_KEY set).
//!
//! Uses bare reqwest to avoid the OpenAI SDK fingerprint headers that some
//! Cloudflare-fronted proxies WAF-block.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Window};

/// 进行中的 chat 流式请求的取消标志。前端强制一次只有一个 chat 在飞，
/// 故单个全局标志足够：chat_ask 开始时置 false，两个 SSE 循环每个 chunk 检查它，
/// chat_cancel 命令置 true 让循环提前结束（返回 Ok，不作错误处理）。
static CHAT_CANCELLED: AtomicBool = AtomicBool::new(false);

/// 前端调用以取消进行中的 chat 流式回答。仅置标志，由 SSE 循环在下一个 chunk 边界感知。
pub fn cancel_chat() {
  CHAT_CANCELLED.store(true, Ordering::SeqCst);
}

/// 批量 emit 的最小间隔：累积到该时长才把缓冲的 delta 一次性 emit 给前端，
/// 把每 token 一次 IPC 跨界压成每 ~50ms 一次，显著降低窗口通信开销。
const EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(50);

/// SSE 行缓冲：按原始字节累积，仅在遇到换行时切出完整行并 UTF-8 解码。
///
/// 动机：过去对每个 chunk 直接 `String::from_utf8_lossy` 会把跨 chunk 边界切断的
/// 多字节 UTF-8 字符解成替换符（正确性 bug）；且 `find('\n')` + `drain(..=nl)` 每次
/// 从头搬移是 O(n²)。这里换行字节（0x0A）永不出现在多字节 UTF-8 序列内部，故按字节
/// 扫换行、只对完整行整体解码是安全的；用游标标记已消费位置，每个 chunk 末尾一次性
/// 压缩缓冲区，避免反复 drain 头部。
struct SseLineBuffer {
  /// 尚未切出成完整行的原始字节（可能含一个跨 chunk 的半行）。
  buf: Vec<u8>,
}

impl SseLineBuffer {
  fn new() -> Self {
    Self { buf: Vec::new() }
  }

  /// 追加一段原始字节，返回本次新切出的所有完整行（已去除行尾换行、UTF-8 解码）。
  /// 跨 chunk 的半行留在内部缓冲，等后续字节补齐。
  fn push(&mut self, bytes: &[u8]) -> Vec<String> {
    self.buf.extend_from_slice(bytes);
    let mut lines = Vec::new();
    let mut cursor = 0usize;
    while let Some(offset) = self.buf[cursor..].iter().position(|&b| b == b'\n') {
      let end = cursor + offset;
      // 换行不落在多字节序列内部，故此处按行整体解码安全；lossy 仅作兜底。
      lines.push(String::from_utf8_lossy(&self.buf[cursor..end]).into_owned());
      cursor = end + 1;
    }
    // 每个 chunk 只压缩一次：把已消费前缀丢掉，剩余半行移到缓冲头部。
    if cursor > 0 {
      self.buf.drain(..cursor);
    }
    lines
  }
}

/// delta 批量 emit 器：把流式 token 攒进 pending，仅当距上次 emit 超过
/// EMIT_FLUSH_INTERVAL 才一次性 emit 给前端，末尾再 flush 一次收尾。
/// 前端不变——仍监听 "chat:delta" 累加，只是每次收到的是一小段而非单 token。
struct DeltaEmitter<'a> {
  window: Option<&'a Window>,
  pending: String,
  last_emit: Instant,
}

impl<'a> DeltaEmitter<'a> {
  fn new(window: Option<&'a Window>) -> Self {
    Self {
      window,
      pending: String::new(),
      last_emit: Instant::now(),
    }
  }

  /// 攒入一段 delta，若距上次 emit 已超过间隔则立即 flush。
  fn push(&mut self, delta: &str) {
    self.pending.push_str(delta);
    if self.last_emit.elapsed() >= EMIT_FLUSH_INTERVAL {
      self.flush();
    }
  }

  /// 把 pending 一次性 emit 给前端并清空、重置计时。pending 为空则空操作。
  fn flush(&mut self) {
    if self.pending.is_empty() {
      return;
    }
    if let Some(w) = self.window {
      let _ = w.emit("chat:delta", &self.pending);
    }
    self.pending.clear();
    self.last_emit = Instant::now();
  }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModuleSummary {
  pub path: String,
  pub purpose: String,
  #[serde(rename = "keyFiles")]
  pub key_files: Vec<String>,
  #[serde(rename = "dependsOn", default)]
  pub depends_on: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConceptCard {
  pub name: String,
  #[serde(rename = "oneLiner")]
  pub one_liner: String,
  pub evidence: String,
  #[serde(rename = "learnMore")]
  pub learn_more: String,
  /// learnMore 是否来自本地权威文档映射（而非 LLM 生成）。UI 据此显示「官方」徽章。
  #[serde(default)]
  pub verified: bool,
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
  "modules": [{ "path": string, "purpose": string, "keyFiles": string[], "dependsOn": string[] }],
  "entryPoints": string[],
  "overview": string,
  "mermaidArchitecture": string,
  "conceptCards": [{ "name": string, "oneLiner": string, "evidence": string, "learnMore": string }]
}

Rules:
- Cite ONLY real file paths that appear in the repository. Never invent paths or symbols.
- modules[].dependsOn: other modules' "path" values this module imports/uses. Use [] if none. This drives a topological learning path, so direction matters: "a dependsOn b" means b is the prerequisite — the reader should read b BEFORE a. Example: if `src/app` imports from `src/lib`, then `src/app`.dependsOn includes `src/lib` (read lib first).
- conceptCards[].evidence MUST be a concrete location in the form `path:lineStart-lineEnd` (or just `path` if a line range is unclear) pointing at where the pattern/library actually appears. If you cannot locate it in the shown source, leave evidence as "" — do NOT fabricate a path or line numbers.
- conceptCards: only patterns/libraries ACTUALLY used in this repo. learnMore must be an authoritative/official documentation URL; if unsure, leave it as "".
- mermaidArchitecture: use `graph LR`, max 12 nodes, group by module. Keep node IDs short and labels human-readable. Minimal valid example: `graph LR\n  A[frontend] --> B[api]\n  B --> C[(database)]`
- Return ONLY the JSON object — no prose, no markdown fences.

Minimal example of a well-formed response (shape reference only — produce real content for THIS repo):
{"techStack":["TypeScript","Next.js"],"modules":[{"path":"src/lib","purpose":"Shared types and helpers","keyFiles":["src/lib/types.ts"],"dependsOn":[]},{"path":"src/app","purpose":"App entry and routing","keyFiles":["src/app/page.tsx"],"dependsOn":["src/lib"]}],"entryPoints":["src/app/page.tsx"],"overview":"A Next.js app that ...","mermaidArchitecture":"graph LR\n  A[src/app] --> B[src/lib]","conceptCards":[{"name":"React Server Components","oneLiner":"Server-rendered components in the App Router","evidence":"src/app/page.tsx:1-20","learnMore":"https://react.dev/reference/rsc/server-components"}]}"#;

/// 两步流程第 1 步：只抽**可验证事实**（结构骨架），不写叙述。低温、易做准。
const FACTS_INSTRUCTIONS_BASE: &str = r#"You are RepoSensei. Extract the verifiable STRUCTURAL FACTS of the given repository and return a single JSON object matching exactly this shape:
{
  "techStack": string[],
  "modules": [{ "path": string, "purpose": string, "keyFiles": string[], "dependsOn": string[] }],
  "entryPoints": string[]
}

Rules:
- Cite ONLY real file paths that appear in the repository. Never invent paths or symbols.
- modules[].purpose: one short factual sentence — what this module is, not prose.
- modules[].dependsOn: other modules' "path" values this module imports/uses. Use [] if none. Direction matters: "a dependsOn b" means b is the prerequisite — read b BEFORE a. Example: if `src/app` imports from `src/lib`, then `src/app`.dependsOn includes `src/lib`.
- entryPoints: real entry files (main, index, app bootstrap, CLI entry).
- Return ONLY the JSON object — no prose, no markdown fences.

Minimal example (shape reference only — produce real content for THIS repo):
{"techStack":["TypeScript","Next.js"],"modules":[{"path":"src/lib","purpose":"Shared types and helpers","keyFiles":["src/lib/types.ts"],"dependsOn":[]},{"path":"src/app","purpose":"App entry and routing","keyFiles":["src/app/page.tsx"],"dependsOn":["src/lib"]}],"entryPoints":["src/app/page.tsx"]}"#;

/// 两步流程第 2 步：基于已确定的事实生成**叙述层**。mermaid 照模块依赖图画。
const NARRATIVE_INSTRUCTIONS_BASE: &str = r#"You are RepoSensei. The structural FACTS of this repository (techStack, modules with dependsOn, entryPoints) have already been established and are provided to you. Using those facts plus the source, return a single JSON object matching exactly this shape:
{
  "overview": string,
  "mermaidArchitecture": string,
  "conceptCards": [{ "name": string, "oneLiner": string, "evidence": string, "learnMore": string }]
}

Rules:
- overview: 2-4 sentences — what the project does and how it is structured, consistent with the given modules.
- mermaidArchitecture: use `graph LR`, max 12 nodes, one node per module. Draw arrows to MATCH the modules' dependsOn direction from the given facts (a --> b when a dependsOn b). Keep node IDs short and labels human-readable. Minimal valid example: `graph LR\n  A[src/app] --> B[src/lib]`
- conceptCards[].evidence MUST be a concrete location in the form `path:lineStart-lineEnd` (or just `path`) pointing at where the pattern/library actually appears. If you cannot locate it, leave evidence as "" — do NOT fabricate paths or line numbers.
- conceptCards: only patterns/libraries ACTUALLY used. learnMore must be an authoritative/official documentation URL; if unsure, leave it as "".
- Return ONLY the JSON object — no prose, no markdown fences."#;

/// Build the system prompt for the summarize step, injecting a language
/// directive based on the requested locale. JSON field names stay English so
/// the TypeScript types don't break; only the *values* (overview, purpose,
/// oneLiner, etc.) localize.
fn summary_instructions(locale: &str) -> String {
  let directive = locale_directive_summary(locale);
  format!("{SUMMARY_INSTRUCTIONS_BASE}\n\n{directive}")
}

/// 第 1 步（事实抽取）的 system prompt。
fn facts_instructions(locale: &str) -> String {
  let directive = locale_directive_summary(locale);
  format!("{FACTS_INSTRUCTIONS_BASE}\n\n{directive}")
}

/// 第 2 步（叙述生成）的 system prompt。
fn narrative_instructions(locale: &str) -> String {
  let directive = locale_directive_summary(locale);
  format!("{NARRATIVE_INSTRUCTIONS_BASE}\n\n{directive}")
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
    // OpenAI 兼容端点没有可靠的「默认模型」——不同代理暴露的 model id 各不相同。
    // 过去用占位符 "gpt-5.4-mini" 会让没填 model 的用户首次调用必然 404，且报错隐晦。
    // 改为：未显式配置 model 时明确报错，引导用户去设置面板填写，而非静默撞墙。
    let summary_model = std::env::var("RS_SUMMARY_MODEL").map_err(|_| {
      "OpenAI 兼容端点需要显式指定模型：请在设置面板填写 Summary Model（或设置 RS_SUMMARY_MODEL 环境变量）。"
        .to_string()
    })?;
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
    let chat_model =
      std::env::var("RS_CHAT_MODEL").unwrap_or_else(|_| "claude-haiku-4-5-20251001".into());
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

/// 连接测试：用当前配置发一个最小请求，验证凭据/端点可用。
/// 返回所用 provider+model 的简短描述（不含 key）。
pub async fn ping() -> Result<String, String> {
  let cfg = resolve_config()?;
  let label = match cfg.provider {
    Provider::OpenAICompat => format!(
      "OpenAI-compatible @ {} · {}",
      cfg.base_url, cfg.summary_model
    ),
    Provider::Anthropic => format!("Anthropic · {}", cfg.summary_model),
  };
  // 发一个 1-token 请求探活；非流式。
  let probe = match cfg.provider {
    Provider::OpenAICompat => {
      openai_chat(
        &cfg,
        false,
        &cfg.summary_model,
        "ping",
        "Reply with: ok",
        &[],
        None,
      )
      .await
    }
    Provider::Anthropic => {
      anthropic_chat(
        &cfg,
        false,
        &cfg.summary_model,
        "ping",
        "Reply with: ok",
        &[],
        None,
      )
      .await
    }
  };
  probe.map(|_| label)
}

/// summarize 注入仓库内容的字符上限。超大仓库整包送会溢出 context window，
/// 这里保守截断（约 ~100K token），并标注截断让模型知道是部分内容。
/// （来源：codegraph 自适应 token 预算思想；后续可结合 RAG 做更精准的内容选择。）
const SUMMARY_CONTENT_BUDGET: usize = 400_000;

/// 把打包内容裁到预算内，返回 `(裁后内容, 是否截断)`。
fn budget_content(packed: &crate::sidecar::PackedProject) -> (&str, bool) {
  if packed.content.len() > SUMMARY_CONTENT_BUDGET {
    // 按字符边界安全截断（content 是 UTF-8，找最近的字符边界）。
    let mut end = SUMMARY_CONTENT_BUDGET;
    while end > 0 && !packed.content.is_char_boundary(end) {
      end -= 1;
    }
    (&packed.content[..end], true)
  } else {
    (packed.content.as_str(), false)
  }
}

/// 拼出注入仓库内容的 user message（两步共用同一大前缀，便于 prompt caching 命中）。
fn repository_user_prompt(
  packed: &crate::sidecar::PackedProject,
  content: &str,
  truncated: bool,
  tail: &str,
) -> String {
  let truncation_note = if truncated {
    "\n\n[NOTE: repository content truncated to fit context — summarize from what is shown; the codebase is larger.]"
  } else {
    ""
  };
  format!(
    "<repository name=\"{}\" files=\"{}\">\n{}\n</repository>{}\n\n{}",
    packed.name, packed.files_scanned, content, truncation_note, tail
  )
}

/// 发一次非流式 LLM 请求（summarize 系列共用），按 provider 路由。
async fn summary_call(cfg: &Config, system: &str, user: &str) -> Result<String, String> {
  match cfg.provider {
    Provider::OpenAICompat => {
      openai_chat(cfg, false, &cfg.summary_model, system, user, &[], None).await
    }
    Provider::Anthropic => {
      anthropic_chat(cfg, false, &cfg.summary_model, system, user, &[], None).await
    }
  }
}

/// 项目总结：两步分析（事实抽取 → 叙述生成），失败降级回旧的单步「一把梭」。
///
/// 设计动机：单次调用要同时产出 6 个字段，prompt 面面俱到但每面都浅，且
/// modules/dependsOn 抽错、mermaid 方向反、evidence 编造都直接落库。拆开后：
///   1) 事实层（techStack/modules/dependsOn/entryPoints）低温抽取，先把骨架做准；
///   2) 叙述层（overview/mermaid/conceptCards）基于第 1 步已确定的事实生成，
///      mermaid 直接照模块依赖图画，方向天然正确，concept 有据可依。
///
/// 两步共享 `<repository>` 大前缀 → 第 2 步借 prompt caching 命中缓存读，省 token。
pub async fn summarize(
  packed: &crate::sidecar::PackedProject,
  locale: &str,
) -> Result<ProjectSummary, String> {
  let cfg = resolve_config()?;
  match summarize_two_step(&cfg, packed, locale).await {
    Ok(summary) => Ok(summary),
    Err(e) => {
      // 两步流程任一环节出问题 → 降级回旧的单步，保证永远有可用产出。
      eprintln!("[reposensei] two-step summarize failed ({e}); falling back to one-shot");
      summarize_oneshot(&cfg, packed, locale).await
    }
  }
}

/// 旧的单步「一把梭」：一次调用产出全部 6 字段。作为两步流程的降级 fallback 保留。
async fn summarize_oneshot(
  cfg: &Config,
  packed: &crate::sidecar::PackedProject,
  locale: &str,
) -> Result<ProjectSummary, String> {
  let instructions = summary_instructions(locale);
  let (content, truncated) = budget_content(packed);
  let user_prompt = repository_user_prompt(packed, content, truncated, "Produce the JSON now.");
  let raw = summary_call(cfg, &instructions, &user_prompt).await?;
  parse_summary_resilient(&raw)
}

/// 两步流程：第 1 步抽事实，第 2 步基于事实生成叙述，合并为完整 ProjectSummary。
async fn summarize_two_step(
  cfg: &Config,
  packed: &crate::sidecar::PackedProject,
  locale: &str,
) -> Result<ProjectSummary, String> {
  let (content, truncated) = budget_content(packed);

  // ── 第 1 步：事实抽取（techStack/modules/dependsOn/entryPoints）。
  let facts_system = facts_instructions(locale);
  let facts_user = repository_user_prompt(
    packed,
    content,
    truncated,
    "Extract the FACTS JSON now (techStack, modules with dependsOn, entryPoints).",
  );
  let facts_raw = summary_call(cfg, &facts_system, &facts_user).await?;
  let facts = parse_facts(&facts_raw)?;

  // ── 第 2 步：叙述生成（overview/mermaid/conceptCards），喂回第 1 步已确定的事实。
  // user message 仍以同样的 <repository> 大前缀打头 → 命中第 1 步写入的 prompt 缓存。
  let narrative_system = narrative_instructions(locale);
  let facts_json = serde_json::to_string(&serde_json::json!({
    "techStack": facts.tech_stack,
    "modules": facts.modules.iter().map(|m| serde_json::json!({
      "path": m.path, "purpose": m.purpose, "keyFiles": m.key_files, "dependsOn": m.depends_on,
    })).collect::<Vec<_>>(),
    "entryPoints": facts.entry_points,
  }))
  .unwrap_or_default();
  let narrative_user = repository_user_prompt(
    packed,
    content,
    truncated,
    &format!(
      "These FACTS were already established about this repository:\n{facts_json}\n\n\
Now produce the NARRATIVE JSON (overview, mermaidArchitecture, conceptCards). \
Base the mermaid diagram on the modules and their dependsOn above so arrows match \
the real dependency direction. Produce the JSON now."
    ),
  );

  // 第 2 步失败不致命：用第 1 步的事实拼出可用产出（模块清单+依赖图可渲染）。
  let narrative = match summary_call(cfg, &narrative_system, &narrative_user).await {
    Ok(raw) => parse_narrative(&raw).unwrap_or_default(),
    Err(e) => {
      eprintln!("[reposensei] narrative step failed ({e}); using facts only");
      Narrative::default()
    }
  };

  Ok(merge_summary(facts, narrative))
}

// ─────────────────────────────────────────────────────────────────────
// 深度分析模式（可选，多视角并行）
//
// 用户在已 ready 的项目上显式点击「深度分析」时触发。并行跑若干专项分析 agent，
// 每个从一个视角审视代码库，各产出一段 markdown。BYOK 下成本敏感，故：
//   - 默认不开，仅显式触发；
//   - 用 buffer_unordered 限制并发度（保护用户 LLM 配额，零额外依赖）；
//   - 单个视角失败按 agent 降级，不影响其他视角。
// ─────────────────────────────────────────────────────────────────────

/// 一个深度分析视角的产出。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeepInsight {
  /// 视角标识（前端据此本地化标题）。
  pub perspective: String,
  /// 该视角的 markdown 分析（失败时为简短错误说明）。
  pub markdown: String,
  /// 该视角是否成功产出（false 表示降级的错误占位）。
  pub ok: bool,
}

/// 并发上限：同时在飞的 LLM 请求数。BYOK 下限流保护用户配额与端点压力。
const DEEP_ANALYSIS_CONCURRENCY: usize = 2;

/// 各视角的 (标识, 分析指令)。指令聚焦单一视角，避免与 summarize 重复。
fn deep_analysis_perspectives() -> &'static [(&'static str, &'static str)] {
  &[
    (
      "dataflow",
      "Focus ONLY on DATA FLOW. Trace how data enters the system, how it is transformed as it moves between modules, and where it exits (UI, storage, network). Identify the main pipelines and any state that is shared across them. Use concrete file/function names from the source. Output GitHub-flavored markdown with short sections and bullet lists. Do not repeat a generic project overview.",
    ),
    (
      "security",
      "Focus ONLY on SECURITY-RELEVANT surface. Identify where the code handles untrusted input, secrets/credentials, authentication, file system or network access, and any subprocess/command execution. For each, note the file/function and whether the handling looks safe or risky. Be concrete and cite real locations. Output GitHub-flavored markdown. If something looks fine, say so briefly; do not invent vulnerabilities.",
    ),
    (
      "testing",
      "Focus ONLY on TESTING & QUALITY. Identify what test frameworks/tooling are used, which areas have tests vs. which look untested, and how the build/lint/test commands are wired. Point at concrete test files and the code they cover. Output GitHub-flavored markdown. Suggest the highest-value missing tests, grounded in what you actually see.",
    ),
  ]
}

/// 深度分析：并行跑多个视角 agent，汇总各自 markdown。
/// 单个视角失败降级为带错误说明的占位，整体永远返回可用结果。
pub async fn deep_analyze(
  packed: &crate::sidecar::PackedProject,
  summary: &ProjectSummary,
  locale: &str,
) -> Result<Vec<DeepInsight>, String> {
  use futures_util::stream::{self, StreamExt};

  let cfg = resolve_config()?;
  let (content, truncated) = budget_content(packed);
  let directive = locale_directive_summary(locale);

  // 共享上下文前缀：项目概述 + 模块清单，喂给每个视角避免重复推导骨架。
  let modules = summary
    .modules
    .iter()
    .map(|m| format!("- {}: {}", m.path, m.purpose))
    .collect::<Vec<_>>()
    .join("\n");
  let shared_context = format!(
    "Project overview: {}\nTech: {}\n\nModules:\n{}",
    summary.overview,
    summary.tech_stack.join(", "),
    modules
  );

  let user_prompt = repository_user_prompt(
    packed,
    content,
    truncated,
    &format!("{shared_context}\n\nProduce your focused markdown analysis now."),
  );

  // 预先构建每个视角的「拥有所有权」的 (id, system, user) 三元组，再 map——
  // 这样并发 async 块只捕获 owned String，规避跨 async 边界借用 &str 引发的
  // 高阶生命周期推断错误（FnOnce is not general enough）。
  let jobs: Vec<(String, String, String)> = deep_analysis_perspectives()
    .iter()
    .map(|(id, instruction)| {
      let system = format!(
        "You are RepoSensei performing a focused deep-dive review.\n{instruction}\n\n{directive}"
      );
      ((*id).to_string(), system, user_prompt.clone())
    })
    .collect();

  // buffer_unordered(N) 天然把并发度限到 N——无需 Semaphore，零额外依赖。
  let cfg = &cfg;
  let insights = stream::iter(jobs)
    .map(|(id, system, user)| async move {
      match summary_call(cfg, &system, &user).await {
        Ok(md) => DeepInsight {
          perspective: id,
          markdown: md.trim().to_string(),
          ok: true,
        },
        Err(e) => {
          eprintln!("[reposensei] deep-analysis perspective '{id}' failed: {e}");
          DeepInsight {
            perspective: id,
            markdown: format!("_This perspective could not be generated: {e}_"),
            ok: false,
          }
        }
      }
    })
    .buffer_unordered(DEEP_ANALYSIS_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

  Ok(insights)
}

/// Tier 1 — 从可能带围栏/夹在散文里的 LLM 输出中定位并解析出 JSON object。
/// 去围栏；失败则从散文中抽取首个配平的 {...}。三个解析器（summary/facts/
/// narrative）共用，避免重复。
fn locate_json_object(raw: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {
  let cleaned = strip_fences(raw);
  let candidate = match serde_json::from_str::<serde_json::Value>(&cleaned) {
    Ok(v) => v,
    Err(_) => {
      let extracted = extract_first_json_object(&cleaned).ok_or_else(|| {
        format!(
          "model returned no parseable JSON object\n--- raw (first 400) ---\n{}",
          cleaned.chars().take(400).collect::<String>()
        )
      })?;
      serde_json::from_str::<serde_json::Value>(&extracted).map_err(|e| {
        format!(
          "extracted JSON still invalid: {e}\n--- (first 400) ---\n{}",
          extracted.chars().take(400).collect::<String>()
        )
      })?
    }
  };
  candidate
    .as_object()
    .cloned()
    .ok_or_else(|| "model JSON root is not an object".to_string())
}

/// 四级容错解析（思想源自 Understand-Anything 的 sanitize→autofix→drop→fatal）：
/// LLM 输出的 JSON 经常带围栏、夹在散文里、缺字段或某个数组项格式错。直接 serde
/// 解析会因任一瑕疵整体失败。这里逐级抢救，最大化「能渲染就渲染」。
/// 用于单步「一把梭」fallback（产出全部 6 字段）。
fn parse_summary_resilient(raw: &str) -> Result<ProjectSummary, String> {
  let obj = locate_json_object(raw)?;
  // Tier 2 + 3 — autofix（缺失字段补默认值）+ drop（坏数组项逐个丢弃）。
  Ok(ProjectSummary {
    tech_stack: string_array(obj.get("techStack")),
    modules: obj
      .get("modules")
      .and_then(|v| v.as_array())
      .map(|arr| arr.iter().filter_map(module_from_value).collect())
      .unwrap_or_default(),
    entry_points: string_array(obj.get("entryPoints")),
    overview: obj
      .get("overview")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
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

/// 第 1 步产出的事实层。
struct Facts {
  tech_stack: Vec<String>,
  modules: Vec<ModuleSummary>,
  entry_points: Vec<String>,
}

/// 第 2 步产出的叙述层。
#[derive(Default)]
struct Narrative {
  overview: String,
  mermaid_architecture: String,
  concept_cards: Vec<ConceptCard>,
}

/// 解析第 1 步事实 JSON（techStack/modules/entryPoints）。复用同套容错助手。
fn parse_facts(raw: &str) -> Result<Facts, String> {
  let obj = locate_json_object(raw)?;
  Ok(Facts {
    tech_stack: string_array(obj.get("techStack")),
    modules: obj
      .get("modules")
      .and_then(|v| v.as_array())
      .map(|arr| arr.iter().filter_map(module_from_value).collect())
      .unwrap_or_default(),
    entry_points: string_array(obj.get("entryPoints")),
  })
}

/// 解析第 2 步叙述 JSON（overview/mermaid/conceptCards）。复用同套容错助手。
fn parse_narrative(raw: &str) -> Result<Narrative, String> {
  let obj = locate_json_object(raw)?;
  Ok(Narrative {
    overview: obj
      .get("overview")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
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

/// 合并事实层 + 叙述层为完整 ProjectSummary。
fn merge_summary(facts: Facts, narrative: Narrative) -> ProjectSummary {
  ProjectSummary {
    tech_stack: facts.tech_stack,
    modules: facts.modules,
    entry_points: facts.entry_points,
    overview: narrative.overview,
    mermaid_architecture: narrative.mermaid_architecture,
    concept_cards: narrative.concept_cards,
  }
}

/// 把任意 JSON 值强制成字符串数组（非数组→空；非字符串元素→丢弃）。
fn string_array(v: Option<&serde_json::Value>) -> Vec<String> {
  v.and_then(|v| v.as_array())
    .map(|arr| {
      arr
        .iter()
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
    purpose: obj
      .get("purpose")
      .and_then(|s| s.as_str())
      .unwrap_or("")
      .to_string(),
    key_files: string_array(obj.get("keyFiles")),
    depends_on: string_array(obj.get("dependsOn")),
  })
}

/// 从一个 concept card 值抢救出 ConceptCard；缺 name 则丢弃。
fn concept_from_value(v: &serde_json::Value) -> Option<ConceptCard> {
  let obj = v.as_object()?;
  let name = obj.get("name").and_then(|n| n.as_str())?.to_string();
  if name.is_empty() {
    return None;
  }
  let llm_url = obj
    .get("learnMore")
    .and_then(|s| s.as_str())
    .unwrap_or("")
    .to_string();
  // 外部知识源：命中本地权威文档映射则覆盖 LLM 链接并标 verified；否则保留 LLM 的。
  let (learn_more, verified) = match crate::concept_docs::lookup(&name) {
    Some(url) => (url.to_string(), true),
    None => (llm_url, false),
  };
  Some(ConceptCard {
    name,
    one_liner: obj
      .get("oneLiner")
      .and_then(|s| s.as_str())
      .unwrap_or("")
      .to_string(),
    evidence: obj
      .get("evidence")
      .and_then(|s| s.as_str())
      .unwrap_or("")
      .to_string(),
    learn_more,
    verified,
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

/// 注入到 prompt 的检索预算（自适应：按问题类型在「省 token」与「足够上下文」间权衡）。
/// 来源：codegraph 的 ExploreOutputBudget 思想 + 按 intent 分配的检索预算。
struct GroundingBudget {
  /// 检索片段条数上限。
  max_hits: u32,
  /// 注入到 prompt 的检索代码总字符上限。
  char_budget: usize,
}

/// 概览类问题：模块清单+overview 已基本够用，少注入即可（省 token、避免信号稀释）。
const GROUNDING_OVERVIEW: GroundingBudget = GroundingBudget {
  max_hits: 3,
  char_budget: 4000,
};
/// 具体实现类问题（默认）：需要看真实代码，放宽条数与字符预算。
const GROUNDING_DETAIL: GroundingBudget = GroundingBudget {
  max_hits: 6,
  char_budget: 8000,
};

/// 轻量关键词启发式：判断问题是否「概览/架构」类（中英双语），据此选检索预算。
/// 零额外 LLM 调用。命中概览词 → 小预算；否则按「需要具体代码」给大预算。
fn grounding_budget_for(question: &str) -> &'static GroundingBudget {
  let q = question.to_ascii_lowercase();
  const OVERVIEW_HINTS: &[&str] = &[
    "overview",
    "architecture",
    "high level",
    "high-level",
    "structure",
    "organized",
    "what does this project",
    "what is this project",
    "tech stack",
    "where do i start",
    "where to start",
    "get started",
    // 中文（无需 lowercase，原样匹配）
    "架构",
    "总体",
    "整体",
    "概览",
    "结构",
    "技术栈",
    "从哪",
    "怎么组织",
    "是做什么",
    "做什么的",
  ];
  if OVERVIEW_HINTS
    .iter()
    .any(|h| q.contains(h) || question.contains(h))
  {
    &GROUNDING_OVERVIEW
  } else {
    &GROUNDING_DETAIL
  }
}

/// 注入 chat system prompt 的画图规约。前端只把 ```mermaid 围栏渲染成图，
/// 故强制模型：① 用且仅用 ```mermaid 围栏；② 写合法 mermaid 语法（流程图用 graph
/// TD/LR）；③ 节点标签避免裸括号/引号，换行用 <br/>——否则前端拦到也会解析失败。
const DIAGRAM_INSTRUCTIONS: &str = "When a diagram (flow, architecture, sequence, \
state) makes the answer clearer, draw it with Mermaid in a fenced code block tagged \
exactly ```mermaid (never ```flowchart, ```graph, or an untagged/ASCII block). Use \
valid Mermaid syntax — `graph TD` or `graph LR` for flow/architecture. Keep node IDs \
short; put human text inside [square brackets]. Avoid raw parentheses, quotes, or \
slashes inside labels (they break the parser) — replace them with words and use <br/> \
for line breaks. Prefer one focused diagram over a sprawling one.";

pub async fn chat_stream(
  window: Window,
  summary: &ProjectSummary,
  history: &[ChatMessage],
  question: &str,
  locale: &str,
  project_root: Option<&str>,
) -> Result<(), String> {
  // 新一轮问答开始，清掉上一轮可能残留的取消标志。
  CHAT_CANCELLED.store(false, Ordering::SeqCst);
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
    Some(root) => build_grounding_block(window.app_handle(), root, question).await,
    None => String::new(),
  };

  // Context 布局顺序：角色/规则 → locale → 项目概述 → 模块清单 → 检索源码（最相关，置底）。
  let mut system = format!(
        "You are RepoSensei. Help the developer understand this codebase.\nGround every claim in the project's actual files. If unsure, say so.\n\n{directive}\n\n{DIAGRAM_INSTRUCTIONS}\n\nProject overview: {}\nTech: {}\n\nModules:\n{}",
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
      openai_chat(
        &cfg,
        true,
        &cfg.chat_model,
        &system,
        question,
        history,
        Some(window),
      )
      .await?;
    }
    Provider::Anthropic => {
      anthropic_chat(
        &cfg,
        true,
        &cfg.chat_model,
        &system,
        question,
        history,
        Some(window),
      )
      .await?;
    }
  }
  Ok(())
}

/// 索引还在后台构建时注入 prompt 的声明：要求模型坦白可能未引用最新源码，
/// 而不是静默退回仅靠 summary 的猜测式回答。
const GROUNDING_INDEX_BUILDING_NOTICE: &str =
  "\n\n[NOTE: The code search index is still building in the background. \
You may not have access to the project's actual source for this answer — if the question \
needs specific implementation details, say the index is still indexing and the answer may \
be incomplete, rather than guessing.]";

/// 检索与问题相关的源码片段，拼成可注入 prompt 的文本块（带自适应预算截断）。
/// 任何错误都吞掉返回空串——grounding 是增强，不该让对话失败。
async fn build_grounding_block(
  app: &tauri::AppHandle,
  project_root: &str,
  question: &str,
) -> String {
  // 按问题类型选检索预算：概览类少注入、具体实现类多注入。
  let budget = grounding_budget_for(question);
  let result = match crate::sidecar::search_code(
    app,
    project_root.to_string(),
    question.to_string(),
    budget.max_hits,
  )
  .await
  {
    Ok(r) => r,
    Err(e) => {
      eprintln!("[reposensei] grounding search failed (non-fatal): {e}");
      return String::new();
    }
  };
  render_grounding(&result, budget.char_budget)
}

/// 纯函数：把检索结果渲染成可注入 prompt 的文本块。拆出来便于单测覆盖三种分支：
/// 索引未就绪（注入声明）、就绪但无命中（空串）、有命中（带 file:line 的源码块）。
fn render_grounding(result: &crate::sidecar::SearchResult, char_budget: usize) -> String {
  // 索引还在后台构建（首次导入项目后短时间内）：search 拿不到真实源码，
  // 不能让模型「装作有据」，注入声明让它坦白不确定。
  if !result.indexed {
    return GROUNDING_INDEX_BUILDING_NOTICE.to_string();
  }
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
    if used + snippet.len() > char_budget {
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

  // 非流式（summarize）一次产出全部 6 字段（含 mermaid + 多张 concept 卡 + 模块清单），
  // 4096 上限对大仓库易截断导致 JSON 不完整。上调到 8192（仍远低于非流式 ~16K 的
  // HTTP 超时阈值，无需切流式）。流式（chat）保持 1024。
  let mut body = serde_json::json!({
      "model": model,
      "max_tokens": if stream { 1024 } else { 8192 },
      "stream": stream,
      "messages": messages,
  });
  // summarize 是结构化 JSON 抽取，低温更确定、更少格式抖动。chat（流式）不设
  // temperature，沿用 API 默认，保持对话现状不变。
  if !stream {
    body["temperature"] = serde_json::json!(0.2);
  }

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
    return Err(format!(
      "LLM error {status}: {}",
      text.chars().take(400).collect::<String>()
    ));
  }

  if !stream {
    #[derive(Deserialize)]
    struct C {
      content: String,
    }
    #[derive(Deserialize)]
    struct Choice {
      message: C,
    }
    #[derive(Deserialize)]
    struct R {
      choices: Vec<Choice>,
    }
    let parsed: R = resp
      .json()
      .await
      .map_err(|e| format!("decode JSON failed: {e}"))?;
    let content = parsed
      .choices
      .into_iter()
      .next()
      .map(|c| c.message.content)
      .unwrap_or_default();
    return Ok(content);
  }

  let mut stream_resp = resp.bytes_stream();
  let mut line_buf = SseLineBuffer::new();
  let mut emitter = DeltaEmitter::new(window.as_ref());
  while let Some(chunk) = stream_resp.next().await {
    // 用户取消：立即收尾（flush 已攒的 delta），返回已累积文本，不作错误处理。
    if CHAT_CANCELLED.load(Ordering::SeqCst) {
      emitter.flush();
      return Ok(accumulated);
    }
    let bytes = chunk.map_err(|e| format!("stream chunk failed: {e}"))?;
    for line in line_buf.push(&bytes) {
      let Some(payload) = line.trim().strip_prefix("data: ") else {
        continue;
      };
      if payload == "[DONE]" {
        emitter.flush();
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
          emitter.push(delta);
        }
      }
    }
  }
  // 循环正常结束：把最后攒的 delta 补 emit。
  emitter.flush();
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

  // 同 openai_chat：summarize（非流式）上调 max_tokens 防截断 + 低温更稳；
  // chat（流式）保持 1024 且不设 temperature，沿用现状。
  // claude-sonnet-4-6 / claude-haiku-4-5 均支持 temperature（非 Opus 4.7+ 那种被移除的模型）。
  let mut body = serde_json::json!({
      "model": model,
      "max_tokens": if stream { 1024 } else { 8192 },
      "stream": stream,
      "system": system,
      "messages": messages,
  });
  if !stream {
    body["temperature"] = serde_json::json!(0.2);
  }

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
    return Err(format!(
      "Anthropic error {status}: {}",
      text.chars().take(400).collect::<String>()
    ));
  }

  if !stream {
    let json: serde_json::Value = resp
      .json()
      .await
      .map_err(|e| format!("decode failed: {e}"))?;
    // 监控 prompt cache 命中：cache_read 持续为 0 说明缓存键漂移（缓存没生效）。
    if let Some(usage) = json.get("usage") {
      let read = usage
        .get("cache_read_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
      let created = usage
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
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
  let mut line_buf = SseLineBuffer::new();
  let mut emitter = DeltaEmitter::new(window.as_ref());
  while let Some(chunk) = stream_resp.next().await {
    // 用户取消：立即收尾（flush 已攒的 delta），返回已累积文本，不作错误处理。
    if CHAT_CANCELLED.load(Ordering::SeqCst) {
      emitter.flush();
      return Ok(accumulated);
    }
    let bytes = chunk.map_err(|e| format!("stream chunk failed: {e}"))?;
    for line in line_buf.push(&bytes) {
      let Some(payload) = line.trim().strip_prefix("data: ") else {
        continue;
      };
      if let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) {
        if let Some(delta) = json
          .get("delta")
          .and_then(|d| d.get("text"))
          .and_then(|s| s.as_str())
        {
          accumulated.push_str(delta);
          emitter.push(delta);
        }
      }
    }
  }
  // 循环正常结束：把最后攒的 delta 补 emit。
  emitter.flush();
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

  use crate::sidecar::{CodeHit, SearchResult};

  fn hit(path: &str, start: u32, end: u32, content: &str) -> CodeHit {
    CodeHit {
      path: path.to_string(),
      score: 1.0,
      content: content.to_string(),
      start_line: start,
      end_line: end,
    }
  }

  #[test]
  fn grounding_index_building_injects_honest_notice() {
    // 索引未就绪：必须注入「索引构建中」声明，让模型坦白而非装作有据。
    let result = SearchResult {
      hits: vec![],
      indexed: false,
      hybrid: false,
    };
    let block = render_grounding(&result, GROUNDING_DETAIL.char_budget);
    assert!(block.contains("still building"));
    assert!(block.contains("still indexing"));
  }

  #[test]
  fn grounding_indexed_but_no_hits_returns_empty() {
    // 索引就绪但无命中：返回空串（既不注入声明，也不伪造源码）。
    let result = SearchResult {
      hits: vec![],
      indexed: true,
      hybrid: false,
    };
    assert_eq!(render_grounding(&result, GROUNDING_DETAIL.char_budget), "");
  }

  #[test]
  fn grounding_budget_overview_vs_detail() {
    // 概览/架构类问题 → 小预算（少注入）；具体实现类 → 大预算（多注入）。
    let overview = grounding_budget_for("Give me a high-level overview of the architecture");
    assert_eq!(overview.max_hits, GROUNDING_OVERVIEW.max_hits);
    let overview_zh = grounding_budget_for("这个项目的整体架构是怎样的？");
    assert_eq!(overview_zh.max_hits, GROUNDING_OVERVIEW.max_hits);
    let detail = grounding_budget_for("How is the chat_stream function implemented?");
    assert_eq!(detail.max_hits, GROUNDING_DETAIL.max_hits);
    assert!(detail.char_budget > overview.char_budget);
  }

  #[test]
  fn grounding_respects_char_budget() {
    // 字符预算应限制注入条数：极小预算下只放得下第一条。
    let result = SearchResult {
      hits: vec![hit("a.rs", 1, 5, "AAAA"), hit("b.rs", 1, 5, "BBBB")],
      indexed: true,
      hybrid: false,
    };
    let tiny = render_grounding(&result, 60);
    assert!(tiny.contains("a.rs"));
    assert!(!tiny.contains("b.rs"));
  }

  #[test]
  fn facts_parse_extracts_structure_only() {
    let raw = r#"{"techStack":["Rust"],"modules":[{"path":"src","purpose":"core","keyFiles":["lib.rs"],"dependsOn":[]}],"entryPoints":["main.rs"]}"#;
    let f = parse_facts(raw).unwrap();
    assert_eq!(f.tech_stack, vec!["Rust"]);
    assert_eq!(f.modules.len(), 1);
    assert_eq!(f.modules[0].path, "src");
    assert_eq!(f.entry_points, vec!["main.rs"]);
  }

  #[test]
  fn narrative_parse_extracts_prose_only() {
    let raw = r#"```json
{"overview":"a tool","mermaidArchitecture":"graph LR\n A-->B","conceptCards":[{"name":"RAG","oneLiner":"x","evidence":"a.rs:1-2","learnMore":"https://x"}]}
```"#;
    let n = parse_narrative(raw).unwrap();
    assert_eq!(n.overview, "a tool");
    assert!(n.mermaid_architecture.contains("graph LR"));
    assert_eq!(n.concept_cards.len(), 1);
    assert_eq!(n.concept_cards[0].name, "RAG");
  }

  #[test]
  fn merge_combines_facts_and_narrative() {
    let facts = Facts {
      tech_stack: vec!["Go".to_string()],
      modules: vec![],
      entry_points: vec!["main.go".to_string()],
    };
    let narrative = Narrative {
      overview: "ov".to_string(),
      mermaid_architecture: "graph LR".to_string(),
      concept_cards: vec![],
    };
    let s = merge_summary(facts, narrative);
    assert_eq!(s.tech_stack, vec!["Go"]);
    assert_eq!(s.entry_points, vec!["main.go"]);
    assert_eq!(s.overview, "ov");
    assert_eq!(s.mermaid_architecture, "graph LR");
  }

  #[test]
  fn merge_with_default_narrative_keeps_facts_renderable() {
    // 第 2 步失败降级：用空叙述合并，模块/技术栈/入口仍可渲染。
    let facts = Facts {
      tech_stack: vec!["TS".to_string()],
      modules: vec![ModuleSummary {
        path: "src".to_string(),
        purpose: "core".to_string(),
        key_files: vec![],
        depends_on: vec![],
      }],
      entry_points: vec![],
    };
    let s = merge_summary(facts, Narrative::default());
    assert_eq!(s.tech_stack, vec!["TS"]);
    assert_eq!(s.modules.len(), 1);
    assert_eq!(s.overview, "");
  }

  #[test]
  fn grounding_with_hits_renders_file_line_blocks() {
    // 有命中：渲染带 file:line 的源码块，且不含「索引构建中」声明。
    let result = SearchResult {
      hits: vec![hit("src/foo.rs", 10, 22, "fn foo() {}")],
      indexed: true,
      hybrid: true,
    };
    let block = render_grounding(&result, GROUNDING_DETAIL.char_budget);
    assert!(block.contains("src/foo.rs:10-22"));
    assert!(block.contains("fn foo() {}"));
    assert!(!block.contains("still building"));
  }

  // ── SseLineBuffer ────────────────────────────────────────────────────

  #[test]
  fn sse_buffer_partial_line_across_chunks() {
    // 一行被拆到两个 chunk：前半不产出行，补齐后才切出完整行。
    let mut b = SseLineBuffer::new();
    assert!(b.push(b"data: hel").is_empty());
    let lines = b.push(b"lo\n");
    assert_eq!(lines, vec!["data: hello".to_string()]);
  }

  #[test]
  fn sse_buffer_multibyte_utf8_split_across_chunks() {
    // 多字节 UTF-8 字符（「你」= E4 BD A0）被 chunk 边界切断：
    // 按行整体解码后必须还原为原字符，而非替换符。
    let ni = "你".as_bytes(); // 3 字节
    let mut b = SseLineBuffer::new();
    assert!(b.push(&ni[..1]).is_empty()); // 第 1 字节
    assert!(b.push(&ni[1..2]).is_empty()); // 第 2 字节
    let lines = b.push(&[&ni[2..], b"\n"].concat()); // 第 3 字节 + 换行
    assert_eq!(lines, vec!["你".to_string()]);
    assert!(!lines[0].contains('\u{FFFD}'));
  }

  #[test]
  fn sse_buffer_multiple_lines_in_one_chunk() {
    // 一个 chunk 含多行：一次全部切出，尾部无换行的半行留在缓冲。
    let mut b = SseLineBuffer::new();
    let lines = b.push(b"line1\nline2\nline3");
    assert_eq!(lines, vec!["line1".to_string(), "line2".to_string()]);
    // "line3" 尚未遇到换行，留在缓冲，下次补换行才产出。
    assert_eq!(b.push(b"\n"), vec!["line3".to_string()]);
  }

  #[test]
  fn sse_buffer_done_passthrough() {
    // [DONE] 哨兵作为普通一行原样切出，由调用方识别。
    let mut b = SseLineBuffer::new();
    let lines = b.push(b"data: [DONE]\n");
    assert_eq!(lines, vec!["data: [DONE]".to_string()]);
  }

  #[test]
  fn sse_buffer_crlf_and_blank_lines() {
    // SSE 事件间常有 \r\n 空行；按 \n 切行后 \r 留在行尾，由调用方 trim。
    let mut b = SseLineBuffer::new();
    let lines = b.push(b"data: a\r\n\r\ndata: b\n");
    assert_eq!(
      lines,
      vec![
        "data: a\r".to_string(),
        "\r".to_string(),
        "data: b".to_string()
      ]
    );
  }
}
