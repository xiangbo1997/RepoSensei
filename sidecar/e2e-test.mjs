#!/usr/bin/env node
/**
 * End-to-end smoke test for the M0 RepoSensei loop, no Tauri needed.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node sidecar/e2e-test.mjs /path/to/some/repo
 *
 * What it does:
 *   1. Spawn the pack-server sidecar
 *   2. Send a "pack" command with the target project path
 *   3. Receive the packed XML + token count
 *   4. Send the packed content to Claude Sonnet 4.6 (prompt-cached)
 *   5. Parse the JSON summary
 *   6. Print: tech stack, modules, the Mermaid diagram, and the first concept card
 *   7. Optionally ask a follow-up question
 *
 * Exit code:
 *   0 — full loop succeeded
 *   1 — sidecar/pack failed
 *   2 — Claude/parse failed
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("usage: node e2e-test.mjs <project-path>");
  process.exit(64);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY env var is required");
  process.exit(64);
}

const SUMMARY_MODEL = process.env.RS_SUMMARY_MODEL ?? "claude-sonnet-4-6";
const CHAT_MODEL =
  process.env.RS_CHAT_MODEL ?? "claude-haiku-4-5-20251001";

console.log(`📦 Step 1/3: packing ${projectPath} via sidecar…`);
const packed = await callSidecar("pack", { path: path.resolve(projectPath) });
console.log(
  `   ✓ ${packed.filesScanned} files, ${packed.totalChars.toLocaleString()} chars, ${packed.totalTokens.toLocaleString()} tokens`,
);

console.log("🤖 Step 2/3: asking Claude to summarize…");
const summary = await summarize(packed);
console.log(`   ✓ tech stack: ${summary.techStack.join(", ")}`);
console.log(`   ✓ ${summary.modules.length} modules, ${summary.conceptCards.length} concept cards\n`);

console.log("═══════════════════════════════════════════════");
console.log("  PROJECT SUMMARY");
console.log("═══════════════════════════════════════════════");
console.log(`\nOverview: ${summary.overview}\n`);
console.log("Entry points:");
for (const ep of summary.entryPoints) console.log(`  - ${ep}`);
console.log("\nModules:");
for (const m of summary.modules) {
  console.log(`  ${m.path}`);
  console.log(`    purpose: ${m.purpose}`);
  console.log(`    files: ${m.keyFiles.join(", ")}`);
}
console.log("\nMermaid architecture:");
console.log("```mermaid");
console.log(summary.mermaidArchitecture);
console.log("```\n");
console.log("Concept cards:");
for (const c of summary.conceptCards) {
  console.log(`  • ${c.name} — ${c.oneLiner}`);
  console.log(`    found in: ${c.evidence}`);
  console.log(`    learn more: ${c.learnMore}`);
}

if (process.env.RS_ASK) {
  console.log("\n═══════════════════════════════════════════════");
  console.log(`  Q&A: ${process.env.RS_ASK}`);
  console.log("═══════════════════════════════════════════════\n");
  await chat(summary, process.env.RS_ASK);
  console.log("\n");
}

console.log("✅ End-to-end loop succeeded.");
process.exit(0);

// ────────────────────────────────────────────────────────────────────────────

function callSidecar(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "pack-server.mjs")],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    let buffer = "";
    const id = randomUUID();
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx);
      try {
        const msg = JSON.parse(line);
        if (msg.id !== id) return;
        child.kill();
        if (msg.ok) resolve(msg.data);
        else reject(new Error(`sidecar error: ${msg.error}`));
      } catch (e) {
        reject(e);
      }
    });
    child.on("error", reject);
    child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
  });
}

async function summarize(packed) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const resp = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: `You are RepoSensei. Analyze the given repository and return a single JSON object matching exactly this shape:
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
- Mermaid: use \`graph LR\`, max 12 nodes.
- Concept cards: only patterns/libs actually used. Authoritative learnMore URL.
- Return ONLY the JSON, no prose, no fences.`,
      },
      {
        type: "text",
        text: `<repository name="${packed.name}" files="${packed.filesScanned}">\n${packed.content}\n</repository>`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: "Produce the JSON now." }],
  });

  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text");
  }
  const trimmed = textBlock.text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.error("\nRaw response:\n", trimmed.slice(0, 800));
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

async function chat(summary, question) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: `You are RepoSensei. Help the developer understand this codebase.
Tech: ${summary.techStack.join(", ")}
Overview: ${summary.overview}
Modules:
${summary.modules.map((m) => `- ${m.path}: ${m.purpose}`).join("\n")}

Ground every claim in the project's actual files. If unsure, say so.`,
    messages: [{ role: "user", content: question }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      process.stdout.write(ev.delta.text);
    }
  }
}
