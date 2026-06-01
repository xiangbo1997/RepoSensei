# ADR-003: Q&A grounding — FTS5 代码检索索引

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-06-01 |

## Context

早期 Q&A 只把 LLM 生成的 `ProjectSummary`（概述 + 模块清单）作为上下文喂给模型，**不读真实源码**。后果：模型对具体函数实现的回答靠猜测，无法 grounding，正确性差。这是产品最大的正确性缺口。

需要一种检索机制，给定用户问题，找到最相关的**真实源码片段**注入 prompt。约束：本地优先、最小依赖、对函数名/类名等符号查询要准。

调研 6 个同类项目（codegraph、Understand-Anything 等）后的收敛结论：**符号名精确检索用全文索引（FTS/BM25）优于纯向量**；语义近似才需要向量。

## Decision

新增 `sidecar/code-index.mjs`，用 Node 内置 **`node:sqlite` 的 FTS5** 建代码检索索引：

- **分块**：行级递归窗口（40 行 / 8 行重叠），保留代码可读性。
- **符号加权**：轻量正则提取函数/类/导出名，存入独立 FTS 列，bm25 权重最高（symbols=5, path=2, content=1）。
- **检索增强**：英文词干变体扩展（caching→cache）、字段限定符（`path:` / `kind:`）、多信号重排（路径/整词命中加成）。
- **存储**：索引落磁盘临时目录，按项目路径 hash 命名，跨「无状态 sidecar 进程」复用。
- **增量**：按文件内容 SHA-256 对比，仅重建变更/新增文件，清除已删除文件。
- **注入**：`chat_stream` 提问前检索，把命中源码拼到 system 末尾（紧贴问题，规避 lost-in-the-middle），带字符预算（8000）与条数上限（6），失败降级不阻塞对话。

### Why Not

| 选项 | 否决原因 |
|------|---------|
| 纯向量检索（LanceDB 等） | 对函数名/类名精确查询不如 FTS 准；需 embedding 服务（API 延迟或本地模型依赖），不符合最小依赖。向量留作后续 Hybrid 升级 |
| tree-sitter AST 精确符号 | WASM 内存管理复杂（codegraph 专门警告）；正则符号 + FTS 已能 grounding，AST 留作 Tier3 升级 |
| 整仓 dump 进上下文 | 大仓库爆 context、成本高、信号被稀释 |
| 内存索引 | sidecar 无状态、每请求新进程，内存索引不持久——故落磁盘 |

## Consequences

- ✅ Q&A 能引用真实源码与行号，正确性显著提升。
- ✅ 零额外 npm 依赖（`node:sqlite` 内置），本地运行。
- ✅ 增量索引让重复导入只重建变更文件。
- ⚠️ 符号提取是正则近似，复杂语法可能漏提（后续可升级 tree-sitter）。
- ⚠️ 无语义相似检索（如「鉴权逻辑在哪」未含关键词时召回弱）——后续上向量 + RRF 融合（Hybrid Search）。
- ⚠️ `node:sqlite` 在当前 Node 标记为 experimental，会打印警告——已知可接受。
