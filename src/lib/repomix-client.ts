import path from "node:path";
import type { PackedProject } from "./types";

/**
 * 用 Repomix 把一个本地项目打包成 LLM 友好的纯文本。
 *
 * 重要：repomix 是 Node-only 包（用了 fs/path/child_process），
 * 必须通过 Tauri sidecar 或 Next.js Route Handler 调用，不能在浏览器/WebView 跑。
 * M0 阶段我们走 sidecar 模式（暂未接入），先暴露纯函数。
 */
export async function packProject(projectPath: string): Promise<PackedProject> {
  const { runCli } = await import("repomix");

  const result = await runCli(["."], projectPath, {
    output: undefined,
    style: "xml",
    compress: true,
    quiet: true,
    stdout: true,
  } as Parameters<typeof runCli>[2]);

  const pack = result.packResult;
  if (!pack) {
    throw new Error("Repomix pack returned empty result");
  }

  return {
    path: projectPath,
    name: path.basename(projectPath),
    filesScanned: pack.totalFiles,
    totalChars: pack.totalCharacters,
    totalTokens: pack.totalTokens,
    content: pack.output ?? "",
    fileTree: extractFileTree(pack.output ?? ""),
  };
}

function extractFileTree(packedOutput: string): string {
  const match = packedOutput.match(
    /<directory_structure>([\s\S]*?)<\/directory_structure>/,
  );
  return match?.[1]?.trim() ?? "";
}
