import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, PackedProject, ProjectSummary } from "./types";

const SUMMARY_MODEL = "claude-sonnet-4-6";
const CHAT_MODEL = "claude-haiku-4-5-20251001";

export function buildClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

const SUMMARY_SYSTEM = `You are RepoSensei, an expert software archaeologist
helping developers understand unfamiliar codebases. Given a packed repository,
produce a JSON object that strictly matches the schema in the user message.

Rules:
- Be concrete: cite file paths and module names that actually exist in the code.
- For the Mermaid diagram: use \`graph LR\` syntax, max 12 nodes, group by module.
- For concept cards: only flag patterns/libs actually used in the code. Never
  invent. Include 1 authoritative learn-more URL per card.
- Output must be a single JSON object. No prose, no markdown fences.`;

const CHAT_SYSTEM_TEMPLATE = (summary: ProjectSummary) => `You are RepoSensei,
helping a developer learn this codebase:

Tech stack: ${summary.techStack.join(", ")}
Overview: ${summary.overview}

Modules:
${summary.modules.map((m) => `- ${m.path}: ${m.purpose}`).join("\n")}

Answer the user's questions grounded in the project's actual code. If you cite
a file, use the exact path. If you don't know, say so — never invent.`;

export async function summarizeProject(
  client: Anthropic,
  packed: PackedProject,
): Promise<ProjectSummary> {
  const message = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SUMMARY_SYSTEM,
      },
      {
        type: "text",
        text: `<repository name="${packed.name}" files="${packed.filesScanned}">\n${packed.content}\n</repository>`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Analyze this repository and produce a JSON object with this shape:
{
  "techStack": string[],
  "modules": [{ "path": string, "purpose": string, "keyFiles": string[] }],
  "entryPoints": string[],
  "overview": string,
  "mermaidArchitecture": string,
  "conceptCards": [{ "name": string, "oneLiner": string, "evidence": string, "learnMore": string }]
}

Return ONLY the JSON, nothing else.`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const cleaned = stripJsonFences(textBlock.text);
  try {
    return JSON.parse(cleaned) as ProjectSummary;
  } catch (e) {
    throw new Error(
      `Failed to parse Claude JSON: ${e instanceof Error ? e.message : e}\nRaw: ${cleaned.slice(0, 300)}`,
    );
  }
}

export async function* streamAnswer(
  client: Anthropic,
  summary: ProjectSummary,
  history: ChatMessage[],
  question: string,
): AsyncGenerator<string> {
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: CHAT_SYSTEM_TEMPLATE(summary),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: question },
    ],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    return lines.slice(1, -1).join("\n");
  }
  return trimmed;
}
