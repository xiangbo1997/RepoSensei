#!/usr/bin/env node
/**
 * RepoSensei pack sidecar.
 *
 * Spawned by Tauri (or invoked directly for testing). Reads newline-delimited
 * JSON commands from stdin, writes JSON responses to stdout.
 *
 * Request:  { "id": "<uuid>", "cmd": "ping"|"pack"|"list_files"|"read_file", "args": {...} }
 * Response: { "id": "<uuid>", "ok": true,  "data": {...} }
 *        |  { "id": "<uuid>", "ok": false, "error": "..." }
 */
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  isGeneratedFile,
  isNoiseDir,
  isSecretFile,
  repomixIgnoreGlobs,
} from "./noise-filter.mjs";
import { indexProject, searchCode } from "./code-index.mjs";

const rl = readline.createInterface({ input: process.stdin });

const respond = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

rl.on("line", async (raw) => {
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    respond({ id: null, ok: false, error: "invalid JSON" });
    return;
  }
  try {
    const data = await handle(req);
    respond({ id: req.id, ok: true, data });
  } catch (e) {
    respond({
      id: req.id ?? null,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

async function handle(req) {
  if (req.cmd === "ping") {
    return { pong: true, node: process.version };
  }
  if (req.cmd === "pack") {
    return packProject(req.args.path);
  }
  if (req.cmd === "list_files") {
    return listFiles(req.args.path);
  }
  if (req.cmd === "read_file") {
    return readSingleFile(req.args.root, req.args.relative);
  }
  if (req.cmd === "index_project") {
    return indexProject(req.args.path);
  }
  if (req.cmd === "search_code") {
    return searchCode(req.args.path, req.args.query, req.args.limit ?? 6);
  }
  throw new Error(`unknown cmd: ${req.cmd}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// pack (compressed): for LLM summarization
// ─────────────────────────────────────────────────────────────────────────────

async function packProject(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("path is required");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "reposensei-pack-"));
  const outFile = path.join(workDir, `${randomUUID()}.xml`);

  try {
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};

    try {
      const { runCli } = await import("repomix");
      // 注入噪音过滤：依赖/构建目录 + 生成文件，避免 protobuf stub / mock /
      // codegen 输出稀释送给 LLM 的代码信号。与 list_files 的 walk 共用同一份规则。
      const result = await runCli(["."], projectPath, {
        output: outFile,
        style: "xml",
        compress: true,
        quiet: true,
        ignore: repomixIgnoreGlobs().join(","),
      });

      const pack = result?.packResult;
      if (!pack) {
        throw new Error("repomix returned empty packResult");
      }

      const content = await readFile(outFile, "utf8");

      return {
        name: path.basename(projectPath),
        path: projectPath,
        filesScanned: pack.totalFiles,
        totalChars: pack.totalCharacters,
        totalTokens: pack.totalTokens,
        content,
      };
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// list_files: enumerate the project file tree (skip .gitignore-style noise)
// ─────────────────────────────────────────────────────────────────────────────

const IGNORE_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".env.local",
  ".env",
]);

const MAX_FILES = 2000; // safety cap so a giant repo doesn't melt the UI

async function listFiles(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("path is required");
  }
  const collected = [];
  await walk(projectPath, "", collected);
  // sort: directories implicit; flat list sorted alphabetically by path
  collected.sort((a, b) => a.path.localeCompare(b.path));
  return { root: projectPath, files: collected };
}

async function walk(absDir, relDir, out) {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  // 先收集本层待 stat 的文件，再并行 stat，避免逐个 await 串行拖慢大目录。
  const pendingFiles = [];
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const name = entry.name;
    if (entry.isDirectory()) {
      if (isNoiseDir(name) || name.startsWith(".")) {
        // allow some dot dirs that are useful (e.g. .github)
        if (name !== ".github") continue;
      }
      await walk(
        path.join(absDir, name),
        relDir ? `${relDir}/${name}` : name,
        out,
      );
      continue;
    }
    if (entry.isFile()) {
      if (IGNORE_FILES.has(name)) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      // 生成文件（protobuf/codegen/mock）不进文件树——它们无手写逻辑，
      // 只会让用户在树里翻到一堆 stub。与 repomix 打包过滤保持一致。
      if (isGeneratedFile(rel)) continue;
      // 密钥/凭据文件绝不进树（与打包/索引共用 noise-filter 单一真相源）。
      if (isSecretFile(rel)) continue;
      pendingFiles.push({ name, rel });
    }
  }
  const stats = await Promise.all(
    pendingFiles.map((f) =>
      stat(path.join(absDir, f.name)).then(
        (s) => ({ f, s }),
        () => null, // unreadable, skip
      ),
    ),
  );
  for (const res of stats) {
    if (out.length >= MAX_FILES) return;
    if (!res) continue;
    if (res.s.size > 1024 * 1024) continue; // skip files > 1MB
    out.push({ path: res.f.rel, size: res.s.size });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// read_file: read one file's content; refuses binaries
// ─────────────────────────────────────────────────────────────────────────────

async function readSingleFile(root, relative) {
  if (!root || !relative) {
    throw new Error("root and relative are required");
  }
  // 拒绝路径穿越：先规范化，挡掉显式 .. 与绝对路径。
  const safeRel = path.normalize(relative);
  if (safeRel === ".." || safeRel.startsWith(`..${path.sep}`) || path.isAbsolute(safeRel)) {
    throw new Error("invalid relative path");
  }
  // 用 resolve 后的绝对路径 + 分隔符边界判定包含关系，
  // 避免 raw startsWith 让 /proj 命中兄弟目录 /proj-secret。
  const resolvedRoot = path.resolve(root);
  const abs = path.resolve(resolvedRoot, safeRel);
  if (abs !== resolvedRoot && !abs.startsWith(resolvedRoot + path.sep)) {
    throw new Error("path escapes project root");
  }
  // 密钥/凭据文件拒读（与打包/索引共用 noise-filter 单一真相源）。
  if (isSecretFile(safeRel)) {
    throw new Error("refusing to read secret file");
  }
  // lstat 不跟随符号链接：树内指向外部的 symlink 会被识别并拒绝，
  // 防止「相对路径合法但实际目标在项目外」的逃逸。
  const info = await lstat(abs);
  if (info.isSymbolicLink()) {
    throw new Error("symlinks are not allowed");
  }
  const s = await stat(abs);
  if (s.size > 1024 * 1024) {
    throw new Error(`file too large: ${s.size} bytes`);
  }
  const buf = await readFile(abs);
  // Detect binary by checking for NUL bytes in the first 8KB.
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) {
    throw new Error("binary file not supported");
  }
  return {
    path: safeRel,
    size: s.size,
    content: buf.toString("utf8"),
  };
}
