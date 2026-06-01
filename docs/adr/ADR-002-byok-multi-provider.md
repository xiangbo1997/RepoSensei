# ADR-002: LLM 接入 — BYOK 多 provider 策略

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-06-01 |

## Context

RepoSensei 不做 SaaS 托管、不锁定厂商，用户自带 key（BYOK）。需要：

1. 同时支持 **Anthropic 原生 API** 和 **OpenAI 兼容代理**（大量第三方反代/聚合服务走 OpenAI 协议）。
2. 部分反代由 Cloudflare 前置，会按 SDK 指纹做 WAF 拦截——官方 SDK 的固定 header 有时被拒。
3. 凭据本地管理，不外泄。

## Decision

Rust 层 `llm.rs` 用**裸 `reqwest`** 直接拼请求，而非引官方 SDK，规避 WAF 指纹拦截。provider 选择优先级：`OPENAI_BASE_URL`（+`OPENAI_API_KEY`）优先于 `ANTHROPIC_API_KEY`；凭据从项目 `.env.local` 读取。两条路径都支持 SSE 流式（统一 emit `chat:delta` 事件）。Anthropic 路径对大而稳定的前缀（打包仓库内容）启用 prompt caching。

### Why Not

| 选项 | 否决原因 |
|------|---------|
| 仅 Anthropic SDK | 无法走 OpenAI 兼容代理；SDK 指纹易被反代 WAF 拦 |
| 仅 OpenAI SDK | 同上指纹问题；且放弃 Anthropic 原生的 prompt caching 细粒度控制 |
| SaaS 后端代理 key | 违背 BYOK 与本地优先；引入服务端与合规负担 |

## Consequences

- ✅ 一套代码覆盖 Anthropic 原生 + 任意 OpenAI 兼容端点，对反代友好。
- ✅ 凭据不离本机。
- ⚠️ 不用 SDK 意味着要自己维护请求/SSE 解析——已封装在 `openai_chat` / `anthropic_chat` 两函数内，并对畸形响应做容错（见 [ADR-003] 与 `parse_summary_resilient`）。
- ⚠️ provider 差异（字段名、cache 语义）需在两条路径分别处理。
