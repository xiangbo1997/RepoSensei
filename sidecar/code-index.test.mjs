// 离线确定性：强制纯 FTS5，不触发真实 embedding 网络请求（须在 import 前设置）。
process.env.RS_DISABLE_EMBEDDINGS = "1";

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { indexProject, searchCode } from "./code-index.mjs";

let projectDir;

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "reposensei-idx-test-"));
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await mkdir(path.join(projectDir, "node_modules", "dep"), { recursive: true });

  await writeFile(
    path.join(projectDir, "src", "auth.ts"),
    `export function authenticateUser(token: string): boolean {
  // 校验 JWT token 并返回是否通过
  if (!token) return false;
  return verifyJwt(token);
}

function verifyJwt(token: string): boolean {
  return token.startsWith("eyJ");
}
`,
  );
  await writeFile(
    path.join(projectDir, "src", "db.ts"),
    `export class Database {
  connect() {
    return "connected to postgres";
  }
}
`,
  );
  // 噪音文件：应被过滤，不进索引
  await writeFile(
    path.join(projectDir, "node_modules", "dep", "index.js"),
    "module.exports = function authenticateUser(){ return 'FAKE from node_modules' }",
  );
  // 生成文件：应被过滤
  await writeFile(
    path.join(projectDir, "src", "schema.generated.ts"),
    "export const authenticateUser = 'generated stub';",
  );
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true }).catch(() => {});
});

describe("indexProject", () => {
  test("索引真实源码，过滤噪音/生成文件", async () => {
    const result = await indexProject(projectDir);
    expect(result.files).toBe(2); // auth.ts + db.ts，排除 node_modules 与 generated
    expect(result.chunks).toBeGreaterThan(0);
  });
});

describe("searchCode", () => {
  test("按符号名检索命中真实源码（非 node_modules 伪实现）", async () => {
    await indexProject(projectDir);
    const { hits, indexed } = await searchCode(projectDir, "authenticateUser 怎么实现", 5);
    expect(indexed).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.path).toBe("src/auth.ts");
    expect(top.content).toContain("verifyJwt");
    // 确认没有把 node_modules 的伪实现检索出来
    expect(hits.every((h) => !h.content.includes("FAKE from node_modules"))).toBe(true);
    expect(hits.every((h) => !h.content.includes("generated stub"))).toBe(true);
  });

  test("无索引时优雅返回空", async () => {
    const empty = await searchCode(path.join(tmpdir(), "reposensei-never-indexed-xyz"), "anything");
    expect(empty.hits).toEqual([]);
    expect(empty.indexed).toBe(false);
  });

  test("检索数据库类", async () => {
    await indexProject(projectDir);
    const { hits } = await searchCode(projectDir, "Database connect", 5);
    expect(hits.some((h) => h.path === "src/db.ts")).toBe(true);
  });

  test("path: 限定符聚焦到指定路径", async () => {
    await indexProject(projectDir);
    const { hits } = await searchCode(projectDir, "function path:auth", 5);
    expect(hits.length).toBeGreaterThan(0);
    // 所有结果都应来自 auth 路径
    expect(hits.every((h) => h.path.toLowerCase().includes("auth"))).toBe(true);
  });

  test("词干变体提升召回（authenticate 命中 authenticateUser）", async () => {
    await indexProject(projectDir);
    const { hits } = await searchCode(projectDir, "authenticating users", 5);
    expect(hits.some((h) => h.path === "src/auth.ts")).toBe(true);
  });

  test("多信号重排：路径/符号命中的片段排更前", async () => {
    await indexProject(projectDir);
    const { hits } = await searchCode(projectDir, "authenticateUser", 5);
    expect(hits[0].path).toBe("src/auth.ts");
  });

  test("检索结果带行号（可溯源）", async () => {
    await indexProject(projectDir);
    const { hits } = await searchCode(projectDir, "authenticateUser", 5);
    expect(hits[0].startLine).toBeGreaterThanOrEqual(1);
    expect(hits[0].endLine).toBeGreaterThanOrEqual(hits[0].startLine);
  });
});

describe("增量索引", () => {
  // 独立 temp 目录，避免与上面的检索测试共享状态导致计数不确定。
  let incDir;
  beforeAll(async () => {
    incDir = await mkdtemp(path.join(tmpdir(), "reposensei-inc-test-"));
    await writeFile(path.join(incDir, "a.ts"), "export function alpha(){ return 1; }\n");
    await writeFile(path.join(incDir, "b.ts"), "export function beta(){ return 2; }\n");
  });
  afterAll(async () => {
    await rm(incDir, { recursive: true, force: true }).catch(() => {});
  });

  test("未变文件复用，仅变更文件重建", async () => {
    const first = await indexProject(incDir);
    expect(first.reindexed).toBe(2);
    expect(first.reused).toBe(0);

    const second = await indexProject(incDir);
    expect(second.reused).toBe(2);
    expect(second.reindexed).toBe(0);

    await writeFile(path.join(incDir, "b.ts"), "export function beta(){ return 99; }\nexport function gamma(){ return 3; }\n");
    const third = await indexProject(incDir);
    expect(third.reindexed).toBe(1);
    expect(third.reused).toBe(1);

    const { hits } = await searchCode(incDir, "gamma", 5);
    expect(hits.some((h) => h.content.includes("gamma"))).toBe(true);
  });

  test("删除的文件从索引清除", async () => {
    await indexProject(incDir);
    const extra = path.join(incDir, "temp.ts");
    await writeFile(extra, "export function tempThing(){ return 42; }\n");
    await indexProject(incDir);
    let found = await searchCode(incDir, "tempThing", 5);
    expect(found.hits.some((h) => h.content.includes("tempThing"))).toBe(true);

    await rm(extra, { force: true });
    const afterDel = await indexProject(incDir);
    expect(afterDel.removed).toBe(1);
    found = await searchCode(incDir, "tempThing", 5);
    expect(found.hits.some((h) => h.content.includes("tempThing"))).toBe(false);
  });
});
