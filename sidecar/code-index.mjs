/**
 * 代码检索索引：让 Q&A 真正 grounding 在源码上，而不是只看 summary 文本。
 *
 * 设计（综合调研结论）：
 *   - 存储用 Node 内置 `node:sqlite` 的 FTS5 全文索引（零额外依赖，对函数名/类名等
 *     精确符号检索远优于纯向量；来源：codegraph `db/schema.sql`+`queries.ts`）。
 *   - 分块用 recursive 行级窗口（来源：ai-eng「recursive 512 起步」结论；代码按行切
 *     更利于人类阅读与回贴）。
 *   - 检索打分 = FTS5 bm25(符号列权重高) + 符号精确命中加成（codegraph 多信号重排思想）。
 *   - 索引按项目路径 hash 落到磁盘临时目录，跨「无状态 sidecar 进程」复用。
 *
 * 注意：这是 Tier2 Step A（正则符号 + 行级 chunk），后续可升级为 tree-sitter AST。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isGeneratedFile, isNoiseDir } from "./noise-filter.mjs";

const CHUNK_LINES = 40; // 每块行数
const CHUNK_OVERLAP = 8; // 相邻块重叠行数，避免边界切断逻辑
const MAX_FILE_BYTES = 512 * 1024; // 单文件上限，超出跳过
const MAX_INDEX_FILES = 4000; // 安全上限

// 只索引这些扩展名（源码 + 配置 + 文档），跳过二进制/媒体。
const INDEXABLE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "kt",
  "rb", "php", "c", "h", "cpp", "cc", "hpp", "cs", "swift", "scala", "sh",
  "bash", "zsh", "lua", "dart", "vue", "svelte", "sql", "graphql", "proto",
  "json", "yaml", "yml", "toml", "md", "mdx", "css", "scss", "html",
]);

/** 把项目路径映射到磁盘上的索引 db 文件位置。 */
function indexDbPath(projectPath) {
  const h = createHash("sha256").update(path.resolve(projectPath)).digest("hex").slice(0, 16);
  return path.join(tmpdir(), "reposensei-index", `${h}.db`);
}

/** 轻量符号提取：从一段代码里抓函数/类/导出等标识符，用于检索加权。 */
function extractSymbols(text) {
  const symbols = new Set();
  const patterns = [
    // function foo / fn foo / def foo / func foo
    /\b(?:function|fn|def|func)\s+([A-Za-z_$][\w$]*)/g,
    // class / struct / interface / enum / trait Foo
    /\b(?:class|struct|interface|enum|trait|type)\s+([A-Za-z_$][\w$]*)/g,
    // export const/let/var Foo  |  const Foo = (=> 箭头函数)
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    // method 形式：foo( 出现在行首缩进后
    /^\s*(?:public|private|protected|async|static|\s)*([A-Za-z_$][\w$]*)\s*\(/gm,
    // impl Foo / pub fn foo
    /\bimpl\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      // 过滤过短/关键字噪音
      if (name && name.length >= 2 && !KEYWORDS.has(name)) symbols.add(name);
    }
  }
  return [...symbols].join(" ");
}

const KEYWORDS = new Set([
  "if", "for", "while", "return", "const", "let", "var", "function", "class",
  "else", "switch", "case", "new", "this", "self", "true", "false", "null",
  "async", "await", "import", "export", "from", "type", "interface", "enum",
]);

/** 把单个文件内容切成带重叠的行级块。 */
function chunkFile(relPath, content) {
  const lines = content.split("\n");
  const chunks = [];
  const step = CHUNK_LINES - CHUNK_OVERLAP;
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const slice = lines.slice(start, end).join("\n");
    if (slice.trim().length === 0) {
      if (end >= lines.length) break;
      continue;
    }
    chunks.push({
      path: relPath,
      startLine: start + 1,
      endLine: end,
      content: slice,
      symbols: extractSymbols(slice),
    });
    if (end >= lines.length) break;
  }
  return chunks;
}

/** 递归收集可索引文件（复用 noise-filter 的目录/生成文件过滤）。 */
async function collectFiles(root) {
  const out = [];
  async function walk(absDir, relDir) {
    if (out.length >= MAX_INDEX_FILES) return;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_INDEX_FILES) return;
      const name = entry.name;
      if (entry.isDirectory()) {
        if (isNoiseDir(name) || (name.startsWith(".") && name !== ".github")) continue;
        await walk(path.join(absDir, name), relDir ? `${relDir}/${name}` : name);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (isGeneratedFile(rel)) continue;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      if (!INDEXABLE_EXT.has(ext)) continue;
      out.push(rel);
    }
  }
  await walk(root, "");
  return out;
}

/** 打开（或新建）索引 db，建表。 */
function openDb(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      path, symbols, content,
      tokenize = 'unicode61'
    );
  `);
  return db;
}

/**
 * 增量建立/更新项目代码索引。
 * 按文件内容 hash 对比：未变的文件保留旧 chunks，变更/新增的重建，已删除的清除。
 * （来源：Understand-Anything fingerprint.ts 的内容 hash 快速通路；检索用途无需
 *  区分 cosmetic/structural，故简化为纯内容 hash。）
 * @param {string} projectPath
 * @returns {Promise<{root:string, files:number, chunks:number, reused:number, reindexed:number, removed:number, dbPath:string}>}
 */
export async function indexProject(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("path is required");
  }
  const dbFile = indexDbPath(projectPath);
  await mkdir(path.dirname(dbFile), { recursive: true });

  const db = openDb(dbFile);
  try {
    // 读取上次索引的 path→hash 快照。
    const prevHashes = new Map();
    for (const row of db.prepare("SELECT path, hash FROM files").all()) {
      prevHashes.set(row.path, row.hash);
    }

    const files = await collectFiles(projectPath);
    const seen = new Set();

    const insertChunk = db.prepare(
      "INSERT INTO chunks (path, symbols, content) VALUES (?, ?, ?)",
    );
    const deleteChunks = db.prepare("DELETE FROM chunks WHERE path = ?");
    const upsertFile = db.prepare(
      "INSERT OR REPLACE INTO files (path, hash) VALUES (?, ?)",
    );
    const deleteFile = db.prepare("DELETE FROM files WHERE path = ?");

    let chunkCount = 0;
    let indexedFiles = 0;
    let reused = 0;
    let reindexed = 0;
    let removed = 0;

    db.exec("BEGIN");
    try {
      for (const rel of files) {
        const abs = path.join(projectPath, rel);
        let s;
        try {
          s = await stat(abs);
        } catch {
          continue;
        }
        if (s.size > MAX_FILE_BYTES) continue;
        let buf;
        try {
          buf = await readFile(abs);
        } catch {
          continue;
        }
        const sample = buf.subarray(0, Math.min(buf.length, 8192));
        if (sample.includes(0)) continue;

        seen.add(rel);
        const hash = createHash("sha256").update(buf).digest("hex");

        // 内容未变 → 跳过重建，保留旧 chunks。
        if (prevHashes.get(rel) === hash) {
          reused++;
          indexedFiles++;
          continue;
        }

        // 变更/新增 → 删旧块、重建。
        deleteChunks.run(rel);
        const content = buf.toString("utf8");
        for (const c of chunkFile(rel, content)) {
          insertChunk.run(c.path, c.symbols, c.content);
          chunkCount++;
        }
        upsertFile.run(rel, hash);
        reindexed++;
        indexedFiles++;
      }

      // 已从磁盘删除的文件 → 清理其 chunks 与记录。
      for (const oldPath of prevHashes.keys()) {
        if (!seen.has(oldPath)) {
          deleteChunks.run(oldPath);
          deleteFile.run(oldPath);
          removed++;
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    setMeta.run("root", path.resolve(projectPath));
    setMeta.run("indexedAt", new Date().toISOString());

    return {
      root: projectPath,
      files: indexedFiles,
      chunks: chunkCount,
      reused,
      reindexed,
      removed,
      dbPath: dbFile,
    };
  } finally {
    db.close();
  }
}

/**
 * 英文词干变体扩展：把常见词形归并，提升召回。
 * 来源：codegraph query-utils.ts 的 getStemVariants 思想（caching→cache 等）。
 */
function stemVariants(word) {
  const w = word.toLowerCase();
  const out = new Set([word]);
  // 复数/第三人称：foos→foo
  if (w.endsWith("s") && w.length > 3) out.add(word.slice(0, -1));
  // 进行时：caching→cache / running→run
  if (w.endsWith("ing") && w.length > 5) {
    out.add(word.slice(0, -3)); // cach
    out.add(`${word.slice(0, -3)}e`); // cache
  }
  // 过去式：evicted→evict
  if (w.endsWith("ed") && w.length > 4) {
    out.add(word.slice(0, -2));
    out.add(word.slice(0, -1));
  }
  // 名词化：builder→build / eviction→evict
  if (w.endsWith("er") && w.length > 4) out.add(word.slice(0, -2));
  if (w.endsWith("tion") && w.length > 6) out.add(word.slice(0, -4));
  return [...out];
}

/**
 * 解析用户问题：抽取字段限定符（path:/kind:）与自由文本 token。
 * 来源：codegraph query-parser.ts 的字段限定搜索语言。
 * @returns {{tokens:string[], pathFilters:string[], kinds:string[]}}
 */
function parseQuery(question) {
  const pathFilters = [];
  const kinds = [];
  const textParts = [];
  for (const tok of question.split(/\s+/)) {
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const key = tok.slice(0, colon).toLowerCase();
      const val = tok.slice(colon + 1);
      if (key === "path" && val) {
        pathFilters.push(val);
        continue;
      }
      if ((key === "kind" || key === "lang" || key === "language") && val) {
        kinds.push(val.toLowerCase());
        continue;
      }
    }
    textParts.push(tok);
  }
  const tokens = (textParts.join(" ").match(/[A-Za-z_$][\w$]*/g) ?? [])
    .filter((t) => t.length >= 2 && !KEYWORDS.has(t.toLowerCase()))
    .slice(0, 12);
  return { tokens, pathFilters, kinds };
}

/** 把 token（含词干变体）转成 FTS5 安全查询：前缀匹配，跨列 OR。 */
function buildFtsQuery(tokens) {
  if (tokens.length === 0) return null;
  const expanded = new Set();
  for (const t of tokens) {
    for (const v of stemVariants(t)) {
      if (v.length >= 2) expanded.add(v);
    }
  }
  return [...expanded].map((t) => `"${t}"*`).join(" OR ");
}

/**
 * 检索与问题最相关的代码片段。
 * @param {string} projectPath
 * @param {string} question
 * @param {number} limit
 * @returns {Promise<{hits:Array<{path:string,score:number,content:string}>}>}
 */
export async function searchCode(projectPath, question, limit = 6) {
  const dbFile = indexDbPath(projectPath);
  if (!existsSync(dbFile)) {
    return { hits: [], indexed: false };
  }
  const { tokens, pathFilters, kinds } = parseQuery(question);
  let ftsQuery = buildFtsQuery(tokens);
  // 仅有 path: 限定符（无可用自由文本 token）时，退化为对 path 列做前缀匹配，
  // 让 "path:auth" 这类纯限定查询也能返回结果。
  if (!ftsQuery && pathFilters.length > 0) {
    ftsQuery = pathFilters.map((p) => `path:"${p}"*`).join(" OR ");
  }
  if (!ftsQuery) return { hits: [], indexed: true };

  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    // bm25 列权重：symbols 列最高（5），path 次之（2），content（1）。
    // 先用 FTS 取较宽候选集（limit*4），再用多信号重排，最后截断。
    const stmt = db.prepare(`
      SELECT path, content, bm25(chunks, 2.0, 5.0, 1.0) AS rank
      FROM chunks
      WHERE chunks MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const candidates = stmt.all(ftsQuery, Math.max(limit * 4, 24));

    const lowTokens = tokens.map((t) => t.toLowerCase());
    const reranked = candidates
      .map((r) => {
        let score = -Number(r.rank); // bm25 基础分（越大越相关）
        const pathLow = r.path.toLowerCase();
        const contentLow = r.content.toLowerCase();
        // 多信号加成（来源：codegraph 多信号重排）：
        for (const t of lowTokens) {
          // 文件名/路径含 token → 强相关
          if (pathLow.includes(t)) score += 8;
          // 内容里整词出现（非前缀）→ 比模糊前缀更可信
          if (new RegExp(`\\b${escapeRegex(t)}\\b`).test(contentLow)) score += 4;
        }
        // path: 限定符：命中则大幅提权，未命中则排除
        let pathFilterPass = true;
        for (const pf of pathFilters) {
          if (pathLow.includes(pf.toLowerCase())) score += 15;
          else pathFilterPass = false;
        }
        // kind:/lang: 限定符：按扩展名近似匹配
        let kindPass = true;
        if (kinds.length > 0) {
          const ext = r.path.split(".").pop()?.toLowerCase() ?? "";
          kindPass = kinds.some((k) => ext === k || langAlias(k) === ext);
        }
        return { hit: { path: r.path, score, content: r.content }, pathFilterPass, kindPass };
      })
      .filter((x) => x.pathFilterPass && x.kindPass)
      .map((x) => x.hit)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { hits: reranked, indexed: true };
  } finally {
    db.close();
  }
}

/** 转义正则元字符，安全地用 token 构造 \b 边界匹配。 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** kind/lang 别名 → 文件扩展名（typescript→ts 等）。 */
function langAlias(k) {
  const map = {
    typescript: "ts", javascript: "js", python: "py", rust: "rs",
    golang: "go", csharp: "cs", markdown: "md",
  };
  return map[k] ?? k;
}
