import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Mock embeddings：用确定性的「词袋」伪向量，避免真实 API。
// 让向量臂能区分语义相近内容，验证 Hybrid + RRF 融合路径。
vi.mock("./embeddings.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  const VOCAB = ["auth", "token", "database", "connect", "user", "login", "query", "verify"];
  const embed = (text) => {
    const low = text.toLowerCase();
    return VOCAB.map((w) => (low.includes(w) ? 1 : 0));
  };
  return {
    ...actual,
    embeddingAvailable: () => true,
    embedBatch: async (texts) => texts.map(embed),
    embedOne: async (text) => embed(text),
  };
});

import { indexProject, searchCode } from "./code-index.mjs";

let dir;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reposensei-hybrid-test-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(
    path.join(dir, "src", "auth.ts"),
    "export function verifyToken(token){ return checkAuth(token); }\nfunction checkAuth(t){ return t.length>0; }\n",
  );
  await writeFile(
    path.join(dir, "src", "db.ts"),
    "export class Database { connect(){ return queryUser(); } }\nfunction queryUser(){ return 'user row'; }\n",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("Hybrid 检索（mock embedding）", () => {
  test("索引时写入向量（embedded 计数 > 0）", async () => {
    const r = await indexProject(dir);
    expect(r.embedded).toBeGreaterThan(0);
  });

  test("检索走 hybrid 路径并融合两臂", async () => {
    await indexProject(dir);
    const r = await searchCode(dir, "verify auth token", 5);
    expect(r.hybrid).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].path).toBe("src/auth.ts");
  });

  test("语义查询命中（database 相关）", async () => {
    await indexProject(dir);
    const r = await searchCode(dir, "database connect user", 5);
    expect(r.hits.some((h) => h.path === "src/db.ts")).toBe(true);
  });
});
