# 架构决策记录（ADR）

本目录记录 RepoSensei 的关键架构决策，便于人和 AI 协作者重建决策上下文，避免重复讨论与「AI 代码漂移」（重新发明已有模式、违背早先决策）。

格式参考 [Michael Nygard 的 ADR 模板](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)。每条 ADR 含状态、上下文、决策、后果三节，及一张「Why Not」对比表。

## 状态说明

- **Proposed** — 讨论中，尚未落地
- **Accepted** — 已采纳并落地
- **Superseded** — 被后续 ADR 替代（注明替代者）

## 索引

| ADR | 标题 | 状态 |
|-----|------|------|
| [ADR-001](ADR-001-tauri-nextjs-stack.md) | 桌面运行时选型：Tauri 2.0 + Next.js | Accepted |
| [ADR-002](ADR-002-byok-multi-provider.md) | LLM 接入：BYOK 多 provider 策略 | Accepted |
| [ADR-003](ADR-003-fts5-grounding-retrieval.md) | Q&A grounding：FTS5 代码检索索引 | Accepted |
