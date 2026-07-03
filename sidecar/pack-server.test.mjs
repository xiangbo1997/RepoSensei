// 离线确定性：spawn 的 sidecar 子进程继承此 env → 纯 FTS5，不发 embedding 请求。
process.env.RS_DISABLE_EMBEDDINGS = "1";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
    for (const key of ["root", "files", "chunks", "reused", "reindexed", "removed", "embedded", "dbPath"]) {
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

describe("read_file 安全边界", () => {
  let root;
  let outside;

  beforeAll(async () => {
    // root 与 sibling 共享路径前缀，用于验证 raw startsWith 的兄弟目录绕过被挡住。
    const uniq = randomUUID();
    root = await mkdtemp(path.join(tmpdir(), `reposensei-sec-${uniq}-`));
    await writeFile(path.join(root, "ok.ts"), "export const ok = 1;\n");
    // 密钥文件：应被 read_file 拒读。
    await writeFile(path.join(root, ".env"), "SECRET_KEY=super-secret\n");

    // 项目外的敏感目标 + 兄弟目录（前缀 = root + "-evil"）。
    outside = path.join(path.dirname(root), `${path.basename(root)}-evil`);
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "TOP SECRET\n");

    // 树内符号链接指向项目外文件。
    try {
      await symlink(path.join(outside, "secret.txt"), path.join(root, "link.ts"));
    } catch {
      // 某些环境无权建 symlink → 该用例会被下方 skip 判断跳过。
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(outside, { recursive: true, force: true }).catch(() => {});
  });

  test("正常读取根内文件成功", async () => {
    const r = await callSidecar("read_file", { root, relative: "ok.ts" });
    expect(r.ok).toBe(true);
    expect(r.data.content).toContain("export const ok");
  });

  test("拒绝 .. 逃逸", async () => {
    const r = await callSidecar("read_file", { root, relative: "../secret.txt" });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });

  test("拒绝兄弟目录前缀绕过（/xxx vs /xxx-evil）", async () => {
    // relative 归一化后是 "../<root>-evil/secret.txt"，join 后落到兄弟目录。
    const evilRel = path.join("..", `${path.basename(root)}-evil`, "secret.txt");
    const r = await callSidecar("read_file", { root, relative: evilRel });
    expect(r.ok).toBe(false);
  });

  test("拒绝绝对路径", async () => {
    const r = await callSidecar("read_file", {
      root,
      relative: path.join(outside, "secret.txt"),
    });
    expect(r.ok).toBe(false);
  });

  test("拒绝密钥文件（.env）", async () => {
    const r = await callSidecar("read_file", { root, relative: ".env" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/secret/i);
  });

  test("拒绝指向项目外的符号链接", async () => {
    const r = await callSidecar("read_file", { root, relative: "link.ts" });
    // symlink 建成功 → 应被拒；建失败（无权限）→ 目标不存在同样报错。
    expect(r.ok).toBe(false);
  });
});
