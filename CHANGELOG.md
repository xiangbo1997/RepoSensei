# Changelog

本项目所有重要变更记录于此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **外部知识源（M2 · 概念桥兑现）**：`concept_docs.rs` 维护常见概念/模式（DI/Saga/
  React Server Components/Hooks/Middleware/gRPC/Tauri 等 40+）→ 官方文档映射。概念卡
  解析后命中映射则用**权威链接**覆盖 LLM 生成的 URL 并标 `verified`，UI 显示「✓ 官方」
  徽章；未命中保留 LLM 链接。空链接不再渲染死链。确定性、离线、降级安全。
- **项目历史（最近项目）**：导入成功后把项目存进本地 `history.json`（与 settings 分离），
  idle 界面展示最近列表，**一键秒级恢复**——复用已存的 summary（跳过打包/总结，省 LLM
  调用）+ 磁盘上按路径 hash 持久的检索索引，仅重跑 list_files 并后台增量重建索引以捕获
  变更。失效目录点击时校验并自动从历史移除。`history.rs`：save/get/remove_recent +
  path_exists 命令。
- **三栏可折叠 + 可拖拽布局**：`ResizablePanels` 组件（VS Code 风格 split-pane）。
  左(文件树)/右(聊天)可折叠成窄条、可拖拽分隔条改宽；中间(代码)弹性主区——任一侧
  收起空间自动归中间，两侧都收起时中间独占全部。宽度+折叠态持久化 localStorage。
- **`RS_DISABLE_EMBEDDINGS` 开关**：强制纯本地 FTS5、不发任何 embedding 请求
  （离线确定性测试 + 给「绝不外发」用户的硬开关）。

### Fixed

- **聊天代码块溢出被裁切**：markdown `pre`/`code` 与气泡加 `min-width:0`/`max-width:100%`，
  长代码块/URL 不再撑破气泡被裁，改为横向滚动或换行。
- **测试隔离**：sidecar 离线测试设 `RS_DISABLE_EMBEDDINGS=1`，避免索引测试触发真实
  embedding 网络请求导致超时（本地有 .env.local key 时）。

### Added (earlier)

- **BYOK 设置面板**：用 `tauri-plugin-store` 持久化 provider/key/baseUrl/model 到本地
  app 数据目录；前端齿轮入口打开设置面板（选 provider、填 key、测试连接）；启动时与
  保存后把设置写进进程 env，`resolve_config` 无需改动即读到（优先级 store/env >
  .env.local）。key 脱敏不回传前端、不写日志。非技术用户也能配置，无需手改 .env.local。
- **拓扑学习路径（Tour）**：summary 新增 `modules[].dependsOn`（LLM 给出模块依赖），
  前端 `lib/tour.ts` 用 Kahn 拓扑排序生成「按依赖顺序」的建议阅读路径，SummaryView
  以时间线展示（仅当存在依赖分层时显示）。来源 Understand-Anything tour-generator。
- **检索质量回归 eval**：`sidecar/retrieval-eval.test.mjs` 用多语言 fixture +
  golden 用例（query→期望文件）跑真实索引，断言 recall@5 ≥ 0.8。离线、零 LLM 依赖，
  防止改分块/打分/符号提取导致检索召回静默退化。
- **Hybrid 检索（FTS5 + 向量语义 + RRF）**：embedding 复用 BYOK 的 OpenAI 兼容
  `/embeddings` 端点（`text-embedding-3-small`），索引时为 chunk 算向量存 SQLite
  BLOB，检索时 query 向量化算余弦，与 FTS5 BM25 排名用 RRF 融合。无 embedding 端点
  （如 Anthropic-only）时自动降级纯 FTS5。新增 `sidecar/embeddings.mjs`。
- **代码搜索面板**：`search_code` 暴露为 Tauri command，左栏新增搜索框（防抖），
  结果按 `path:line` 展示并可点击跳转到 CodeViewer。让已建的 FTS5 索引直接服务
  用户检索，不再只隐式服务 Q&A。Q&A 系统提示新增显式 `file:line` 引用要求。
- **检索结果带行号溯源**：FTS5 索引存 `start_line`/`end_line`（UNINDEXED），检索
  返回行号，grounding 注入按 `file:line` 标注，Q&A 回答可给出可溯源引用。索引加
  schema 版本守卫，升级时自动重建旧索引。
- **代码检索 grounding Q&A**：新增 `sidecar/code-index.mjs`，用 `node:sqlite`
  FTS5 建代码检索索引（行级分块 + 正则符号加权）。Q&A 提问前检索真实源码片段
  注入 prompt，回答从「仅靠 summary 猜测」升级为「引用真实源码」。见
  [ADR-003](docs/adr/ADR-003-fts5-grounding-retrieval.md)。
- **检索召回增强**：英文词干变体扩展、字段限定符（`path:` / `kind:`）、多信号重排。
- **增量索引**：按文件内容 SHA-256 对比，仅重建变更/新增文件，清除已删除文件。
- **噪音过滤**：新增 `sidecar/noise-filter.mjs`，统一过滤生成文件（protobuf/codegen/
  mock）与依赖/构建目录，打包与文件树共用同一份规则。
- **项目文档**：新增根 `CLAUDE.md`（行为规范 + 架构索引）、`docs/adr/` 架构决策记录、
  本 CHANGELOG、`scripts/verify.sh` 一键验证、`Makefile`。

### Changed

- **summarize 内容预算**：超大仓库的打包内容截断到 ~400K 字符（约 100K token）并
  标注，避免溢出 context window。
- **LLM JSON 解析容错**：`summarize` 改用四级容错解析
  （`parse_summary_resilient`：去围栏 → 散文中抽取 JSON → 缺字段补默认 → 坏数组项
  逐个丢弃），畸形输出不再整体崩溃。
- **Context 布局**：chat 的 prompt 把最相关上下文（模块清单、检索源码）置于末尾、
  紧贴用户问题，规避 lost-in-the-middle。
- **Prompt caching**：Anthropic summarize 路径对大而稳定的仓库内容启用
  `cache_control: ephemeral`，并输出 cache 命中日志便于监控。

### Fixed

- 修复 `page.test.tsx` 未包 `<LocaleProvider>` 导致 `useT()` 抛错的测试失败。

## [0.1.0] - 2026-05

### Added

- M0 原型：Tauri 2.0 + Next.js 16 脚手架；项目选择器；Repomix 打包 sidecar；
  Claude/OpenAI 兼容 LLM 集成；Mermaid 架构图；单轮/多轮流式 Q&A；en/zh 双语。
  技术栈选型见 [ADR-001](docs/adr/ADR-001-tauri-nextjs-stack.md)、
  BYOK 策略见 [ADR-002](docs/adr/ADR-002-byok-multi-provider.md)。

[Unreleased]: https://github.com/your-handle/reposensei/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-handle/reposensei/releases/tag/v0.1.0
