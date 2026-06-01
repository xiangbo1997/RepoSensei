# RepoSensei

> Your AI repo sensei — drop in any Git project and understand it in 15 minutes.

[![Status](https://img.shields.io/badge/status-M0_prototype-orange)](#roadmap)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24c8db)](https://tauri.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)

---

## What it does

You cloned a GitHub repo. You don't understand it. Existing AI tools optimize
for **writing** code; RepoSensei optimizes for **reading** code.

- 📦 **Import any local Git project** — drag-and-drop or path picker
- 🧭 **Auto-generated architecture** — Mermaid diagrams + module summaries
- 💬 **Code-aware Q&A** — ask questions grounded in the actual source
- 🧠 **Concept bridges** — when the code uses DI / Saga / Server Components,
  you get a short explanation + a link to authoritative docs
- 🔑 **BYOK (Bring Your Own Key)** — Claude / OpenAI / Gemini, no SaaS lock-in
- 🏠 **Local-first** — your code never leaves your machine (M2 will add fully
  offline LLMs via Ollama)

## Why another tool?

| You want… | Existing tools | RepoSensei |
| --- | --- | --- |
| Write code faster | Cursor, Copilot, Claude Code ✅ | Not the goal |
| Understand a repo to use it | DeepWiki (public only), Cody (enterprise) | ✅ any local repo |
| Learn the tech behind the code | Read docs yourself | ✅ auto concept bridges |
| Keep your code private | Most are cloud | ✅ local + BYOK |

## Status — M1 in progress

Working today:

- [x] Tauri 2.0 + Next.js 16 + React 19 scaffold
- [x] Project picker (file-system dialog)
- [x] Repomix sidecar — pack a repo into LLM-friendly text (with noise filtering)
- [x] Claude / OpenAI-compatible integration with prompt caching (BYOK)
- [x] Mermaid architecture diagram rendering
- [x] Multi-turn streaming Q&A interface
- [x] **Grounded Q&A** — FTS5 code index retrieves real source snippets and the
      model cites `file:line`, instead of guessing from the summary
- [x] **Code search panel** — search symbols/code with `path:`/`kind:` filters,
      click a `file:line` hit to jump to it
- [x] Incremental indexing (content-hash; only changed files re-indexed)
- [ ] Hybrid retrieval (FTS5 + vector + RRF)
- [ ] Validation on 3 real projects (React / Next.js / Rust)

See [the roadmap](#roadmap) and [CHANGELOG](CHANGELOG.md) for details, and
[docs/adr/](docs/adr/) for architecture decisions.

## Quick start (dev)

Prerequisites:

- Node.js 20+ (Node 24 recommended)
- pnpm 10+
- Rust 1.80+ (`rustup install stable`)
- macOS / Linux / Windows

```bash
git clone https://github.com/<your-handle>/reposensei.git
cd reposensei
pnpm install
pnpm dev
```

`pnpm dev` boots the Next.js dev server and opens a native Tauri window.

### Verify the core loop without Tauri (M0 smoke test)

Even before the Tauri window is wired up, you can validate the full
"pack → summarize → diagram → Q&A" chain from the terminal:

```bash
# 1. Sidecar should respond to ping
pnpm sidecar:ping

# 2. Run the end-to-end test against any local Git project
export ANTHROPIC_API_KEY=sk-ant-...
pnpm e2e /path/to/some/project

# 3. Optionally ask a follow-up question
RS_ASK="How is authentication handled in this codebase?" \
  pnpm e2e /path/to/some/project
```

The script prints the tech stack, module breakdown, an auto-generated
Mermaid architecture diagram, and concept cards — exactly what the Tauri UI
will surface. This is the M0 verification gate per the PRD.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Tauri 2.0 native window                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Next.js 16 (SSG) + React 19 + Tailwind 4          │  │
│  │  ├─ project picker / file tree / code search       │  │
│  │  ├─ Mermaid renderer · shiki code viewer           │  │
│  │  └─ streaming chat UI                              │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↕ Tauri IPC                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Rust core — commands + LLM client (bare reqwest,  │  │
│  │  Anthropic/OpenAI-compat, SSE stream, grounding)   │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓ spawn sidecar (NDJSON)         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Node sidecar — Repomix packing · noise filter ·   │  │
│  │  FTS5 code index (node:sqlite) · search            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
              │
              ↓ HTTPS (BYOK)
   Claude / OpenAI-compatible / Ollama (M2)
```

## Roadmap

- **M0 (current, ~3 weeks)** — Prototype: import → Repomix → Claude summary →
  Mermaid + single-turn Q&A. Goal: prove the loop works on 3 real projects.
- **M1 (~3-4 weeks)** — MVP: tree-sitter symbol index + LanceDB RAG, multi-turn
  Q&A, concept bridges, BYOK panel, project history.
- **M2 (~4 weeks)** — Public beta: external knowledge sources (Context7 / MDN),
  learning paths, incremental indexing, local LLM via Ollama.
- **M3+** — VS Code extension, project comparison, learning notes export.

## Built on the shoulders of giants

- [Tauri 2.0](https://tauri.app) — small, fast, secure desktop runtime
- [kvnxiao/tauri-nextjs-template](https://github.com/kvnxiao/tauri-nextjs-template)
  — battle-tested scaffolding
- [Repomix](https://github.com/yamadashy/repomix) — repository packing with
  tree-sitter compression
- [Aider's repo-map](https://aider.chat/2023/10/22/repomap.html) — inspiration
  for tree-sitter + PageRank ranking
- [Mermaid](https://mermaid.js.org) — declarative diagrams from text

## License

MIT — see [LICENSE](LICENSE).
