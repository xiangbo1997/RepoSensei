import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "pack-server.mjs");

/**
 * 启动一次 sidecar，发一条命令，收一行 JSON 响应，再关掉。
 * 复刻 Rust sidecar.rs 的 call_sidecar 协议（一行 NDJSON 请求/响应），
 * 用于守护 Rust↔JS 手写 JSON 契约不漂移。
 */
function callSidecar(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buffer = "";
    const id = randomUUID();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("sidecar timeout"));
    }, 20000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      clearTimeout(timer);
      try {
        const msg = JSON.parse(buffer.slice(0, nl));
        child.kill();
        resolve(msg);
      } catch (e) {
        child.kill();
        reject(e);
      }
    });
    child.on("error", reject);
    child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
  });
}

let projectDir;

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "reposensei-proto-test-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(
    path.join(projectDir, "src", "main.ts"),
    "export function mainEntry(){ return startServer(); }\nfunction startServer(){ return 'up'; }\n",
  );
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true }).catch(() => {});
});

describe("sidecar 协议契约", () => {
  test("ping 返回 ok + pong", async () => {
    const r = await callSidecar("ping", {});
    expect(r.ok).toBe(true);
    expect(r.data.pong).toBe(true);
  });

  test("list_files 返回 {root, files[]}", async () => {
    const r = await callSidecar("list_files", { path: projectDir });
    expect(r.ok).toBe(true);
    expect(typeof r.data.root).toBe("string");
    expect(Array.isArray(r.data.files)).toBe(true);
    expect(r.data.files.some((f) => f.path === "src/main.ts")).toBe(true);
    // 每个 entry 形如 { path, size }
    expect(r.data.files[0]).toHaveProperty("path");
    expect(r.data.files[0]).toHaveProperty("size");
  });

  test("index_project 返回计数字段（Rust IndexResult 契约）", async () => {
    const r = await callSidecar("index_project", { path: projectDir });
    expect(r.ok).toBe(true);
    for (const key of ["root", "files", "chunks", "reused", "reindexed", "removed", "dbPath"]) {
      expect(r.data, `缺字段 ${key}`).toHaveProperty(key);
    }
  });

  test("search_code 返回 {hits[], indexed}，hit 带行号（Rust CodeHit 契约）", async () => {
    await callSidecar("index_project", { path: projectDir });
    const r = await callSidecar("search_code", { path: projectDir, query: "mainEntry", limit: 5 });
    expect(r.ok).toBe(true);
    expect(r.data.indexed).toBe(true);
    expect(Array.isArray(r.data.hits)).toBe(true);
    expect(r.data.hits.length).toBeGreaterThan(0);
    const hit = r.data.hits[0];
    for (const key of ["path", "score", "content", "startLine", "endLine"]) {
      expect(hit, `hit 缺字段 ${key}`).toHaveProperty(key);
    }
    expect(hit.path).toBe("src/main.ts");
  });

  test("未知命令返回 ok=false + error", async () => {
    const r = await callSidecar("bogus_cmd", {});
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });
});
