# CLAUDE.md — RepoSensei

面向 Claude Code 的项目操作手册。第 1 部分是行为规范（源自 Andrej Karpathy 对 LLM 编码陷阱的观察，MIT），第 2 部分是项目架构索引，避免每次会话重新推导。

> **权衡：** 行为规范偏向「谨慎优于速度」。琐碎任务自行判断。

---

## Part 1 · 行为规范

### 1. 先思考再编码

**别假设，别藏困惑，呈现权衡。**

- 显式陈述假设；不确定就问。
- 存在多种理解时全部列出，别静默选一个。
- 有更简方案就说出来，必要时反驳。
- 有不清楚的地方就停下，点明困惑，提问。

### 2. 简单优先

**用解决问题的最少代码，不做投机性设计。**

- 不加需求外的功能。
- 不为单次使用的代码做抽象。
- 不加没要求的「灵活性 / 可配置性」。
- 不为不可能发生的场景写错误处理。
- 200 行能压到 50 行就重写。

自问：「资深工程师会觉得这过度复杂吗？」会，就简化。

### 3. 外科手术式改动

**只动必须动的，只清自己制造的烂摊子。**

- 别「顺手改进」相邻代码、注释、格式。
- 别重构没坏的东西。
- 沿用既有风格，哪怕你有不同偏好。
- 发现无关死代码就指出，别删。
- 你的改动产生的孤儿 import/变量/函数才清理；既有死代码未经要求不删。

检验标准：每一行改动都能直接追溯到用户需求。

### 4. 目标驱动执行

**定义成功判据，循环到验证通过。**

- 「加校验」→「为非法输入写测试，再让它通过」
- 「修 bug」→「写一个复现测试，再让它通过」
- 「重构 X」→「确保重构前后测试都通过」

多步任务先列简短计划（每步带 verify 检查点）。

---

## Part 2 · 项目架构

### 是什么

Tauri 2.0 + Next.js 16 + React 19 桌面应用「代码理解神器」：导入本地 Git 仓库 → Repomix 打包 → LLM 总结 → Mermaid 架构图 + 多轮 Q&A。本地优先、BYOK（自带 key）。

### 数据流

```
项目目录 (Tauri dialog)
  → list_files / pack_project (并行)
  → summarize_project  → ProjectSummary { techStack, modules, mermaidArchitecture, conceptCards }
  → chat_ask (流式 Q&A，emit "chat:delta")
```

### 关键文件

| 层 | 文件 | 职责 |
|---|---|---|
| 前端入口 | `src/app/page.tsx` | 三栏布局（FileTree / CodeViewer+Summary / ChatPanel）+ stage 状态机 |
| 前端组件 | `src/components/*.tsx` | ChatPanel(流式)、CodeViewer(shiki)、FileTree、SummaryView、MermaidView |
| 前端库 | `src/lib/{file-tree,i18n,types}.ts` | 树构建、en/zh i18n、共享类型 |
| Tauri 命令 | `src-tauri/src/lib.rs` | 注册 5 个 command（pack/list/read/summarize/chat） |
| LLM 客户端 | `src-tauri/src/llm.rs` | 裸 reqwest，支持 Anthropic 原生 + OpenAI 兼容代理，SSE 流式，prompt caching |
| sidecar 桥 | `src-tauri/src/sidecar.rs` | 每请求 spawn 一次 node sidecar，收发一行 JSON |
| Node sidecar | `sidecar/pack-server.mjs` | repomix 打包 + list_files + read_file |
| 噪音过滤 | `sidecar/noise-filter.mjs` | 生成文件/依赖目录黑名单，打包与列树共用 |

### 约定与不变量

- **provider 选择**：`OPENAI_BASE_URL` 优先于 `ANTHROPIC_API_KEY`，凭据从 `.env.local` 读取。
- **JSON 字段名保持英文**：i18n 只本地化 *值*（overview/purpose 等），字段名（techStack 等）固定英文，否则 TS 类型断裂。
- **噪音过滤单一真相**：`sidecar/noise-filter.mjs` 同时供 repomix 打包和 `list_files` walk 使用，改规则只改这一处。
- **流式事件**：Rust 端 `window.emit("chat:delta", text)`，前端 `listen("chat:delta")` 累积。

### 命令

```bash
pnpm dev            # tauri dev（启动 Next + 原生窗口）
pnpm test           # vitest run
pnpm e2e <path>     # 无 Tauri 跑完整 pack→summarize→Q&A 链路
pnpm lint           # biome check
```

### 路线图

- **M1**：tree-sitter 符号索引（SQLite FTS5）+ Hybrid 检索（FTS5/BM25 + 向量 + RRF）+ grounding Q&A + 概念桥 + BYOK 面板。
- **M2**：外部知识源（Context7/MDN）+ 学习路径（拓扑 Tour）+ 增量索引（结构指纹）+ Ollama 本地 LLM。
