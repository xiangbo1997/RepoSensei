import { describe, expect, test } from "vitest";
import { buildTour } from "@/lib/tour";
import type { ModuleSummary } from "@/lib/types";

const mod = (path: string, dependsOn?: string[]): ModuleSummary => ({
  path,
  purpose: `purpose of ${path}`,
  keyFiles: [],
  dependsOn,
});

describe("buildTour", () => {
  test("空输入返回空", () => {
    expect(buildTour([])).toEqual([]);
  });

  test("无依赖信息 → 单层按字母序", () => {
    const steps = buildTour([mod("src/b"), mod("src/a"), mod("src/c")]);
    expect(steps.map((s) => s.module.path)).toEqual([
      "src/a",
      "src/b",
      "src/c",
    ]);
    expect(steps.every((s) => s.layer === 0)).toBe(true);
  });

  test("按依赖拓扑分层：被依赖的基础模块在前", () => {
    // api 依赖 service，service 依赖 db → 学习顺序 db → service → api
    const steps = buildTour([
      mod("src/api", ["src/service"]),
      mod("src/service", ["src/db"]),
      mod("src/db"),
    ]);
    const order = steps.map((s) => s.module.path);
    expect(order.indexOf("src/db")).toBeLessThan(order.indexOf("src/service"));
    expect(order.indexOf("src/service")).toBeLessThan(order.indexOf("src/api"));
    // 分层：db=0, service=1, api=2
    const layerOf = (p: string) =>
      steps.find((s) => s.module.path === p)?.layer;
    expect(layerOf("src/db")).toBe(0);
    expect(layerOf("src/service")).toBe(1);
    expect(layerOf("src/api")).toBe(2);
  });

  test("同层互不依赖的模块在同一层", () => {
    // utils 与 config 都无依赖；app 依赖两者
    const steps = buildTour([
      mod("src/app", ["src/utils", "src/config"]),
      mod("src/utils"),
      mod("src/config"),
    ]);
    const layerOf = (p: string) =>
      steps.find((s) => s.module.path === p)?.layer;
    expect(layerOf("src/utils")).toBe(0);
    expect(layerOf("src/config")).toBe(0);
    expect(layerOf("src/app")).toBe(1);
  });

  test("过滤无效依赖引用（指向不存在的模块）", () => {
    const steps = buildTour([mod("src/a", ["does/not/exist"]), mod("src/b")]);
    // 无效边被忽略 → 视为无边 → 单层
    expect(steps.length).toBe(2);
    expect(steps.every((s) => s.layer === 0)).toBe(true);
  });

  test("含环也不丢模块", () => {
    // a→b→a 成环
    const steps = buildTour([mod("src/a", ["src/b"]), mod("src/b", ["src/a"])]);
    expect(steps.length).toBe(2);
    expect(new Set(steps.map((s) => s.module.path))).toEqual(
      new Set(["src/a", "src/b"]),
    );
  });
});
