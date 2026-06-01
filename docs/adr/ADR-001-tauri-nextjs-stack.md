# ADR-001: 桌面运行时选型 — Tauri 2.0 + Next.js

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-06-01 |

## Context

RepoSensei 的核心承诺是「本地优先 + BYOK」：用户导入本地 Git 仓库进行理解，源码**不离开本机**。这对运行时提出三个硬性要求：

1. **访问本地文件系统**——枚举/读取任意本地仓库（纯 Web 应用受沙箱限制做不到）。
2. **调用本地进程**——运行 Repomix 打包、Node sidecar 建索引。
3. **小体积、可分发**——面向开发者的桌面工具，不应为一个理解工具背上百 MB 的运行时。

同时前端要快速迭代富交互 UI（文件树、代码高亮、流式对话、Mermaid 图），团队熟悉 React 生态。

## Decision

采用 **Tauri 2.0**（Rust 后端 + 系统 webview）承载一个 **Next.js 16（SSG）+ React 19 + Tailwind 4** 前端。Rust 层通过 `#[tauri::command]` 暴露能力（文件、打包、索引、LLM 流式），前端用 `invoke` 调用、用 `listen` 接收流式事件。

### Why Not

| 选项 | 否决原因 |
|------|---------|
| Electron | 打包内置 Chromium，体积比 Tauri 大 ~100MB+；无 Rust 集成 |
| 纯 Web / PWA | 无法访问本地文件系统与本地进程，违背「本地优先」 |
| 原生（Swift/GTK/Qt） | 跨平台 UI 需各写一套，且放弃 React 生态与现有组件 |
| VS Code 扩展 | 受编辑器宿主限制，UI 表达力弱；定位是独立工具而非插件（VS Code 扩展列在 M3 路线） |

## Consequences

- ✅ 体积小、跨平台（macOS/Linux/Windows）、能力受 Tauri capability 系统约束（最小权限）。
- ✅ Rust 后端可演进为承载更重的本地逻辑（索引、git、未来本地 LLM）。
- ⚠️ Rust↔前端走 IPC（invoke/event），有类型同步成本——通过约定 JSON 字段名固定英文、Rust struct 用 `#[serde(rename)]` 对齐 TS 类型来管理。
- ⚠️ 需要 Node 运行时跑 sidecar（Repomix、code-index）——已在 README 前置依赖中声明。
