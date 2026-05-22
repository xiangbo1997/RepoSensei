#!/usr/bin/env node
/**
 * End-to-end smoke test for the M0 RepoSensei loop (no Tauri).
 *
 * Usage:
 *   # Anthropic direct (native API):
 *   ANTHROPIC_API_KEY=sk-ant-... node sidecar/e2e-test.mjs /path/to/repo
 *
 *   # OpenAI-compatible proxy (e.g. third-party Claude/GPT reverse proxies):
 *   OPENAI_API_KEY=... \
 *   OPENAI_BASE_URL=https://proxy.example.com/v1 \
 *   RS_SUMMARY_MODEL=claude-sonnet-4-6 \
 *   RS_CHAT_MODEL=gpt-5.4-mini \
 *   node sidecar/e2e-test.mjs /path/to/repo
 *
 * What it does:
 *   1. Spawn the pack-server sidecar
 *   2. Send a "pack" command with the target project path
 *   3. Receive the packed XML + token count
 *   4. Send the packed content to the chosen LLM
 *   5. Parse the JSON summary
 *   6. Print: tech stack, modules, the Mermaid diagram, concept cards
 *   7. Optionally ask a follow-up question via RS_ASK
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

// Pick provider: prefer explicit OPENAI_BASE_URL (proxy) > ANTHROPIC_API_KEY (native).
const useOpenAIProtocol = !!process.env.OPENAI_BASE_URL;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!useOpenAIProtocol && !anthropicKey) {
  console.error(
    "Provide either ANTHROPIC_API_KEY (native) or OPENAI_BASE_URL+OPENAI_API_KEY (proxy)",
  );
  process.exit(64);
}
if (useOpenAIProtocol && !openaiKey) {
  console.error("OPENAI_BASE_URL set but OPENAI_API_KEY missing");
  process.exit(64);
}

const SUMMARY_MODEL = process.env.RS_SUMMARY_MODEL ?? "claude-sonnet-4-6";
const CHAT_MODEL = process.env.RS_CHAT_MODEL ?? SUMMARY_MODEL;

const SUMMARY_INSTRUCTIONS = `You are RepoSensei. Analyze the given repository and return a single JSON object matching exactly this shape:
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
- Mermaid: use \`graph LR\`, max 12 nodes, group by module.
- Concept cards: only patterns/libs actually used. Authoritative learnMore URL.
- Return ONLY the JSON object, no prose, no fences.`;

console.log(
  `📡 Provider: ${useOpenAIProtocol ? `OpenAI-compatible @ ${process.env.OPENAI_BASE_URL}` : "Anthropic native"}`,
);
console.log(`   summary model: ${SUMMARY_MODEL}`);
console.log(`   chat model:    ${CHAT_MODEL}\n`);

console.log(`📦 Step 1/3: packing ${projectPath} via sidecar…`);
const packed = await callSidecar("pack", { path: path.resolve(projectPath) });
console.log(
  `   ✓ ${packed.filesScanned} files, ${packed.totalChars.toLocaleString()} chars, ${packed.totalTokens.toLocaleString()} tokens`,
);

console.log("🤖 Step 2/3: asking the model to summarize…");
const summary = await summarize(packed);
console.log(`   ✓ tech stack: ${summary.techStack.join(", ")}`);
console.log(
  `   ✓ ${summary.modules.length} modules, ${summary.conceptCards.length} concept cards\n`,
);

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
  console.log(`    files:   ${m.keyFiles.join(", ")}`);
}
console.log("\nMermaid architecture:");
console.log("```mermaid");
console.log(summary.mermaidArchitecture);
console.log("```\n");
console.log("Concept cards:");
for (const c of summary.conceptCards) {
  console.log(`  • ${c.name} — ${c.oneLiner}`);
  console.log(`    found in:   ${c.evidence}`);
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
  const userPrompt = `<repository name="${packed.name}" files="${packed.filesScanned}">
${packed.content}
</repository>

Produce the JSON now.`;

  if (useOpenAIProtocol) {
    return summarizeViaOpenAI(userPrompt);
  }
  return summarizeViaAnthropic(packed, userPrompt);
}

async function summarizeViaOpenAI(userPrompt) {
  // Some reverse proxies WAF-block the OpenAI SDK's fingerprint headers.
  // Use bare fetch with minimal headers instead.
  const url = `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTIONS },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `LLM request failed: ${resp.status} ${resp.statusText} — ${body.slice(0, 300)}`,
    );
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseJsonResponse(text);
}

async function summarizeViaAnthropic(packed, _userPrompt) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: anthropicKey });
  const resp = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4096,
    system: [
      { type: "text", text: SUMMARY_INSTRUCTIONS },
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
    throw new Error("Anthropic returned no text");
  }
  return parseJsonResponse(textBlock.text);
}

function parseJsonResponse(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.error("\nRaw response (first 800 chars):\n", trimmed.slice(0, 800));
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

async function chat(summary, question) {
  const systemPrompt = `You are RepoSensei. Help the developer understand this codebase.
Tech: ${summary.techStack.join(", ")}
Overview: ${summary.overview}
Modules:
${summary.modules.map((m) => `- ${m.path}: ${m.purpose}`).join("\n")}

Ground every claim in the project's actual files. If unsure, say so.`;

  if (useOpenAIProtocol) {
    // Stream via plain fetch (SSE) to dodge SDK fingerprinting.
    const url = `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1024,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Chat request failed: ${resp.status} — ${body.slice(0, 300)}`,
      );
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) process.stdout.write(delta);
        } catch {
          // ignore non-JSON SSE keep-alives
        }
      }
    }
    return;
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: anthropicKey });
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      process.stdout.write(ev.delta.text);
    }
  }
}
