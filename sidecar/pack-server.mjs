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
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

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
      const result = await runCli(["."], projectPath, {
        output: outFile,
        style: "xml",
        compress: true,
        quiet: true,
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

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "target",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".DS_Store",
]);

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
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const name = entry.name;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(name) || name.startsWith(".")) {
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
      try {
        const s = await stat(path.join(absDir, name));
        if (s.size > 1024 * 1024) continue; // skip files > 1MB
        out.push({ path: rel, size: s.size });
      } catch {
        // unreadable, skip
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// read_file: read one file's content; refuses binaries
// ─────────────────────────────────────────────────────────────────────────────

async function readSingleFile(root, relative) {
  if (!root || !relative) {
    throw new Error("root and relative are required");
  }
  // Reject path traversal.
  const safeRel = path.normalize(relative);
  if (safeRel.startsWith("..") || path.isAbsolute(safeRel)) {
    throw new Error("invalid relative path");
  }
  const abs = path.join(root, safeRel);
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error("path escapes project root");
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
