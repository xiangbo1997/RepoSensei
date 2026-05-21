#!/usr/bin/env node
/**
 * RepoSensei pack sidecar.
 *
 * Spawned by Tauri (or invoked directly for testing). Reads newline-delimited
 * JSON commands from stdin, writes JSON responses to stdout.
 *
 * Request:  { "id": "<uuid>", "cmd": "pack" | "ping", "args": {...} }
 * Response: { "id": "<uuid>", "ok": true,  "data": {...} }
 *        |  { "id": "<uuid>", "ok": false, "error": "..." }
 *
 * Note: repomix writes verbose logs to stdout when stdout=true is set, which
 * would corrupt our JSON protocol. So we write to a temp file and read back.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  throw new Error(`unknown cmd: ${req.cmd}`);
}

async function packProject(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("path is required");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "reposensei-pack-"));
  const outFile = path.join(workDir, `${randomUUID()}.xml`);

  try {
    // Suppress repomix's chatty stdout output by redirecting console temporarily.
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
