/**
 * 检索质量回归 eval（离线，零 LLM 依赖）。
 *
 * 思路（来源 ai-eng evaluation）：维护一组 golden 用例（自然语言/符号查询 → 期望命中
 * 的文件），跑真实 FTS5 索引，断言 recall@k 达标。任何让检索召回退化的改动（改分块、
 * 改打分、改符号提取）都会在此失败，把「检索质量」钉成可回归的指标。
 *
 * 这里用一个自包含的小型「多语言仓库」fixture 保证确定性；扩展时往 GOLDEN 加用例即可。
 */
// 离线确定性：强制纯 FTS5，不发 embedding 请求（须在 import 前设置）。
process.env.RS_DISABLE_EMBEDDINGS = "1";

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { indexProject, searchCode } from "./code-index.mjs";

// fixture 文件：覆盖多语言 + 典型「想理解一个仓库」的查询场景。
const FILES = {
  "src/auth/login.ts":
    "export async function authenticateUser(email: string, pw: string) {\n" +
    "  const user = await findUserByEmail(email);\n" +
    "  return user && verifyPassword(pw, user.hash);\n" +
    "}\n",
  "src/auth/password.ts":
    "import bcrypt from 'bcrypt';\n" +
    "export function verifyPassword(plain: string, hash: string) {\n" +
    "  return bcrypt.compareSync(plain, hash);\n" +
    "}\n",
  "src/db/connection.ts":
    "export class DatabasePool {\n" +
    "  connect() { return openPostgresConnection(this.url); }\n" +
    "  query(sql: string) { return this.pool.query(sql); }\n" +
    "}\n",
  "src/api/server.ts":
    "import { createServer } from 'http';\n" +
    "export function startServer(port: number) {\n" +
    "  const server = createServer(handleRequest);\n" +
    "  server.listen(port);\n" +
    "}\n",
  "src/cache/redis.ts":
    "export class RedisCache {\n" +
    "  get(key: string) { return this.client.get(key); }\n" +
    "  set(key: string, val: string) { return this.client.set(key, val); }\n" +
    "}\n",
  "worker/queue.py":
    "def process_job(job):\n    return run_task(job.payload)\n\ndef run_task(payload):\n    return {'status': 'done'}\n",
  "core/parser.rs":
    "pub fn parse_tokens(input: &str) -> Vec<Token> {\n    tokenize(input)\n}\n\nfn tokenize(s: &str) -> Vec<Token> { vec![] }\n",
};

// query → 期望出现在 top-k 命中里的文件。
const GOLDEN = [
  { query: "authenticateUser", expect: "src/auth/login.ts" },
  { query: "how is the password verified", expect: "src/auth/password.ts" },
  { query: "verifyPassword bcrypt", expect: "src/auth/password.ts" },
  { query: "database connection pool", expect: "src/db/connection.ts" },
  { query: "DatabasePool connect query", expect: "src/db/connection.ts" },
  { query: "startServer http", expect: "src/api/server.ts" },
  { query: "RedisCache get set", expect: "src/cache/redis.ts" },
  { query: "process_job run_task", expect: "worker/queue.py" },
  { query: "parse_tokens tokenize", expect: "core/parser.rs" },
  { query: "path:auth verify", expect: "src/auth/password.ts" },
];

const K = 5;
const MIN_RECALL = 0.8; // 至少 80% golden 用例的期望文件出现在 top-K

let dir;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reposensei-eval-"));
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  await indexProject(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("检索质量 eval（recall@k）", () => {
  test(`recall@${K} >= ${MIN_RECALL}`, async () => {
    let hitCount = 0;
    const misses = [];
    for (const g of GOLDEN) {
      const { hits } = await searchCode(dir, g.query, K);
      const paths = hits.map((h) => h.path);
      if (paths.includes(g.expect)) hitCount++;
      else misses.push(`"${g.query}" 期望 ${g.expect}，实得 [${paths.join(", ")}]`);
    }
    const recall = hitCount / GOLDEN.length;
    // 失败时打印缺漏用例，便于定位回退。
    expect(recall, `recall=${recall.toFixed(2)}; misses:\n${misses.join("\n")}`).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  test("精确符号查询应命中正确文件 top-1", async () => {
    const { hits } = await searchCode(dir, "authenticateUser", K);
    expect(hits[0]?.path).toBe("src/auth/login.ts");
  });
});
