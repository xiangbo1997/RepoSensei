import type { ModuleSummary } from "@/lib/types";

/**
 * 拓扑学习路径（Tour）：按依赖顺序排列模块，让人「从底层依赖往上读」地理解陌生仓库。
 * 算法用 Kahn 拓扑排序（来源：Understand-Anything tour-generator.ts 的思路）。
 *
 * 边方向约定：module.dependsOn = [被依赖的模块]。学习应先读「被依赖的、入度低的」，
 * 故按「依赖者指向被依赖者」反向排序——先出现没有依赖的基础模块，再到依赖它们的上层。
 */

export interface TourStep {
  /** 第几层（同层模块互不依赖，可并行理解）。 */
  layer: number;
  module: ModuleSummary;
}

/**
 * 生成拓扑学习路径。无依赖信息时退化为按 path 字母序的单层列表。
 * 含环时（依赖无法完全拓扑化）把剩余模块追加到最后一层，保证不丢模块。
 */
export function buildTour(modules: ModuleSummary[]): TourStep[] {
  if (modules.length === 0) return [];

  const byPath = new Map(modules.map((m) => [m.path, m]));
  // 只保留指向「存在的模块」的依赖边，过滤 LLM 可能给出的无效引用。
  const deps = new Map<string, Set<string>>();
  for (const m of modules) {
    const valid = (m.dependsOn ?? []).filter(
      (d) => d !== m.path && byPath.has(d),
    );
    deps.set(m.path, new Set(valid));
  }

  // 入度 = 该模块依赖的（仍未学习的）模块数。入度 0 = 不依赖任何未学模块，先学。
  const inDegree = new Map<string, number>();
  for (const [p, d] of deps) inDegree.set(p, d.size);

  // 没有任何依赖信息时，按字母序单层返回（稳定、可预期）。
  const anyEdge = [...deps.values()].some((s) => s.size > 0);
  if (!anyEdge) {
    return [...modules]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((m) => ({ layer: 0, module: m }));
  }

  // 「被谁依赖」反向边：某模块学完后，依赖它的模块入度 -1。
  const dependents = new Map<string, string[]>();
  for (const [p, d] of deps) {
    for (const target of d) {
      const arr = dependents.get(target) ?? [];
      arr.push(p);
      dependents.set(target, arr);
    }
  }

  const steps: TourStep[] = [];
  const learned = new Set<string>();
  let layer = 0;

  // Kahn 分层：每轮取出当前入度为 0 的全部模块作为一层。
  let frontier = modules
    .filter((m) => (inDegree.get(m.path) ?? 0) === 0)
    .map((m) => m.path)
    .sort((a, b) => a.localeCompare(b));

  while (frontier.length > 0) {
    for (const p of frontier) {
      const m = byPath.get(p);
      if (m) steps.push({ layer, module: m });
      learned.add(p);
    }
    const next = new Set<string>();
    for (const p of frontier) {
      for (const dep of dependents.get(p) ?? []) {
        if (learned.has(dep)) continue;
        inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
        if ((inDegree.get(dep) ?? 0) <= 0) next.add(dep);
      }
    }
    frontier = [...next].sort((a, b) => a.localeCompare(b));
    layer++;
  }

  // 含环：剩余未学模块按字母序追加到最后一层，保证完整。
  const remaining = modules
    .filter((m) => !learned.has(m.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const m of remaining) {
    steps.push({ layer, module: m });
  }

  return steps;
}
