#!/usr/bin/env node
/**
 * 为可分发的 release app 准备运行时资源。
 *
 * 把以下三样组装到 `src-tauri/resources/`，供 Tauri `bundle.resources` 打进 app：
 *   1. Node 24 二进制（从 nodejs.org 下载并校验 SHA256）——让最终用户无需自带 node。
 *   2. sidecar 的 *.mjs 源码（非 test）。
 *   3. repomix 的生产依赖闭包（npm --omit=dev 生成的嵌套 node_modules）——
 *      pack-server.mjs 里 `import("repomix")` 会从脚本目录向上解析到这里。
 *
 * 目录契约（与 src-tauri/src/sidecar.rs 的路径解析一致）：
 *   src-tauri/resources/
 *     node                      ← Rust: resolve("node", Resource)
 *     sidecar/pack-server.mjs   ← Rust: resolve("sidecar/pack-server.mjs", Resource)
 *     sidecar/node_modules/repomix/...
 *
 * 平台：当前仅打包构建机所在平台（起步覆盖 macOS arm64）。脚本按 target triple
 * 选 Node 下载包，结构上可扩展到其它平台。
 *
 * 用法：node scripts/prepare-sidecar.mjs
 * 由 tauri.conf.json 的 beforeBuildCommand 自动调用，也可手动跑。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RESOURCES = path.join(ROOT, "src-tauri", "resources");
const SIDECAR_SRC = path.join(ROOT, "sidecar");
const SIDECAR_DST = path.join(RESOURCES, "sidecar");

// 锁定内嵌的 Node 版本：与构建机解耦、可复现。需 ≥22 才有 node:sqlite，选最新稳定 v24。
const NODE_VERSION = "24.16.0";

// ─────────────────────────────────────────────────────────────────────────────
// 平台 → nodejs.org 下载包名映射
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析目标架构。默认用运行脚本机器的 `process.arch`，但允许环境变量
 * `RS_TARGET_ARCH` 覆盖——CI 在 arm64 的 macOS runner 上交叉构建 x64 包时，
 * runner 架构是 arm64 而 Rust 目标是 x64，必须按目标而非运行机下载对应 Node。
 */
function targetArch() {
  const override = process.env.RS_TARGET_ARCH;
  if (override) return override; // "x64" | "arm64"
  return process.arch;
}

/** 把目标 platform/arch 映射到 nodejs.org 的发行包标识与解包后 node 路径。 */
function nodeDistTarget() {
  const platform = process.platform;
  const arch = targetArch();
  // nodejs.org 命名：node-v<ver>-<os>-<arch>.<ext>
  if (platform === "darwin" && arch === "arm64") {
    return { pkg: `node-v${NODE_VERSION}-darwin-arm64`, ext: "tar.gz", binInArchive: "bin/node" };
  }
  if (platform === "darwin" && arch === "x64") {
    return { pkg: `node-v${NODE_VERSION}-darwin-x64`, ext: "tar.gz", binInArchive: "bin/node" };
  }
  if (platform === "linux" && arch === "x64") {
    return { pkg: `node-v${NODE_VERSION}-linux-x64`, ext: "tar.gz", binInArchive: "bin/node" };
  }
  if (platform === "linux" && arch === "arm64") {
    return { pkg: `node-v${NODE_VERSION}-linux-arm64`, ext: "tar.gz", binInArchive: "bin/node" };
  }
  if (platform === "win32" && arch === "x64") {
    return { pkg: `node-v${NODE_VERSION}-win-x64`, ext: "zip", binInArchive: "node.exe" };
  }
  throw new Error(`unsupported platform for embedded node: ${platform}/${arch}`);
}

/** 从 nodejs.org 拉取 SHASUMS256.txt，取指定文件名的 sha256。 */
async function fetchExpectedSha(fileName) {
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch SHASUMS256 failed: ${res.status}`);
  const text = await res.text();
  for (const line of text.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === fileName) return sha;
  }
  throw new Error(`sha256 not found for ${fileName} in SHASUMS256.txt`);
}

function sha256OfFile(file) {
  const h = createHash("sha256");
  h.update(readFileSync(file));
  return h.digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Node 二进制：下载 + 校验 + 解包，把 node 拷到 resources/node
// ─────────────────────────────────────────────────────────────────────────────

async function prepareNodeBinary() {
  const nodeDst = path.join(RESOURCES, process.platform === "win32" ? "node.exe" : "node");
  if (existsSync(nodeDst)) {
    console.log(`[prepare-sidecar] node binary already present: ${nodeDst}`);
    return;
  }

  const { pkg, ext, binInArchive } = nodeDistTarget();
  const fileName = `${pkg}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${fileName}`;
  console.log(`[prepare-sidecar] downloading ${url}`);

  const work = mkdtempSync(path.join(tmpdir(), "reposensei-node-"));
  try {
    const archivePath = path.join(work, fileName);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download node failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(archivePath, buf);

    // 校验 SHA256 防篡改/损坏。
    const expected = await fetchExpectedSha(fileName);
    const actual = sha256OfFile(archivePath);
    if (expected !== actual) {
      throw new Error(`node sha256 mismatch: expected ${expected}, got ${actual}`);
    }
    console.log("[prepare-sidecar] node sha256 verified");

    // 解包：macOS/Linux 用系统 tar；Windows 用 PowerShell Expand-Archive
    // （Windows 必有，不依赖 unzip——CI runner 上 unzip 不保证存在）。
    if (ext === "tar.gz") {
      execFileSync("tar", ["-xzf", archivePath, "-C", work], { stdio: "inherit" });
    } else {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${work}' -Force`,
        ],
        { stdio: "inherit" },
      );
    }

    const extractedBin = path.join(work, pkg, binInArchive);
    if (!existsSync(extractedBin)) {
      throw new Error(`node binary not found in archive at ${extractedBin}`);
    }

    mkdirSync(RESOURCES, { recursive: true });
    cpSync(extractedBin, nodeDst);
    if (process.platform !== "win32") {
      execFileSync("chmod", ["+x", nodeDst]);
    }
    console.log(`[prepare-sidecar] node binary ready: ${nodeDst}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sidecar 源码 + repomix 生产依赖闭包
// ─────────────────────────────────────────────────────────────────────────────

const SIDECAR_MJS = [
  "pack-server.mjs",
  "code-index.mjs",
  "embeddings.mjs",
  "noise-filter.mjs",
];

function prepareSidecarSources() {
  mkdirSync(SIDECAR_DST, { recursive: true });
  for (const f of SIDECAR_MJS) {
    cpSync(path.join(SIDECAR_SRC, f), path.join(SIDECAR_DST, f));
  }
  console.log(`[prepare-sidecar] copied ${SIDECAR_MJS.length} sidecar source files`);
}

/**
 * 生成 repomix 的生产依赖闭包并拷进 sidecar/node_modules。
 * 用 npm（非 pnpm）在临时目录 install --omit=dev，得到自包含的嵌套 node_modules，
 * 实体文件齐全、无符号链接断链，可整体拷贝。
 */
function prepareRepomixDeps() {
  const repomixVersion = JSON.parse(
    readFileSync(path.join(ROOT, "node_modules", "repomix", "package.json"), "utf8"),
  ).version;
  console.log(`[prepare-sidecar] resolving repomix@${repomixVersion} prod deps via npm`);

  const work = mkdtempSync(path.join(tmpdir(), "reposensei-repomix-"));
  try {
    writeFileSync(
      path.join(work, "package.json"),
      JSON.stringify({ name: "rs-sidecar-deps", private: true, dependencies: { repomix: repomixVersion } }),
    );
    // 显式用官方 registry：脚本在临时目录跑 npm，读不到项目 .npmrc，会落到用户
    // 全局 ~/.npmrc（可能是国内镜像，如 npmmirror）——本机和海外 CI runner 都可能
    // 因此解析失败。写死官方源，环境无关、可复现。
    // Windows 上 npm 是批处理 `npm.cmd`，必须经 shell 解释（execFileSync 直接执行
    // .cmd 会 EINVAL）；参数为写死常量，无注入风险。macOS/Linux 的 `npm` 是真可
    // 执行文件，直接 execFileSync。
    const npmArgs = [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org/",
      "--loglevel=error",
    ];
    if (process.platform === "win32") {
      execFileSync(`npm ${npmArgs.join(" ")}`, { cwd: work, stdio: "inherit", shell: true });
    } else {
      execFileSync("npm", npmArgs, { cwd: work, stdio: "inherit" });
    }

    const srcNm = path.join(work, "node_modules");
    const dstNm = path.join(SIDECAR_DST, "node_modules");
    rmSync(dstNm, { recursive: true, force: true });
    cpSync(srcNm, dstNm, { recursive: true });

    // 删除 .bin 目录：里面是 npm 建的 CLI 符号链接，指向已被清理的临时安装目录
    // （断链）。sidecar 只 `import("repomix")` 作为库使用，不需要任何 .bin CLI，
    // 而 Tauri bundler 会因这些断链报「resource doesn't exist」而构建失败。
    rmSync(path.join(dstNm, ".bin"), { recursive: true, force: true });
    console.log(`[prepare-sidecar] repomix prod deps copied to ${dstNm} (.bin stripped)`);

    trimNonRuntimeFiles(dstNm);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * 删除 node_modules 里运行时绝不加载的文件，缩减 bundle 体积（约省 50MB）。
 *
 * 只删第 1 类「非运行时」内容——零风险，Node 加载模块时永不触碰：
 *   - source map（.map）、TS 类型声明（.d.ts/.d.cts/.d.mts）、TS 源码（.ts，
 *     已编译成 .js）；
 *   - 文档（README/LICENSE/CHANGELOG/*.md）；
 *   - 测试目录（__tests__/test/tests）。
 *
 * 不碰第 2 类「依赖包」（如 @secretlint、@modelcontextprotocol）：repomix 在
 * 顶层静态 import 它们，删任何一个都会让 `import("repomix")` 直接崩溃——已实测。
 */
function trimNonRuntimeFiles(nmDir) {
  // 受保护后缀：运行时会加载，绝不删除。
  const keepExt = new Set([".js", ".cjs", ".mjs", ".json", ".wasm", ".node"]);
  const docNames = /^(readme|license|licence|changelog|history|authors|notice)/i;

  let removed = 0;
  const entries = readdirSync(nmDir, { recursive: true, withFileTypes: true });
  const dirsToRemove = [];

  for (const e of entries) {
    const full = path.join(e.parentPath ?? e.path, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "test" || e.name === "tests") {
        dirsToRemove.push(full);
      }
      continue;
    }
    const lower = e.name.toLowerCase();
    const ext = path.extname(lower);
    const isMap = lower.endsWith(".map");
    const isDecl = /\.d\.(c|m)?ts$/.test(lower);
    const isTsSrc = ext === ".ts" && !isDecl; // .ts 源码（保留 .d.ts 已在 isDecl 单独处理）
    const isDoc = ext === ".md" || docNames.test(lower);
    // 仅删非受保护后缀的目标文件，绝不误删 .js/.json/.wasm 等。
    if (!keepExt.has(ext) && (isMap || isDecl || isTsSrc || isDoc)) {
      rmSync(full, { force: true });
      removed++;
    }
  }
  for (const d of dirsToRemove) {
    rmSync(d, { recursive: true, force: true });
  }
  console.log(`[prepare-sidecar] trimmed ${removed} non-runtime files + test dirs`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[prepare-sidecar] preparing bundled runtime resources…");
  mkdirSync(RESOURCES, { recursive: true });
  await prepareNodeBinary();
  prepareSidecarSources();
  prepareRepomixDeps();
  console.log("[prepare-sidecar] done.");
}

main().catch((e) => {
  console.error("[prepare-sidecar] FAILED:", e.message);
  process.exit(1);
});
