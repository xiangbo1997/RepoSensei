import { describe, expect, test } from "vitest";
import { isMermaidBlock } from "@/lib/mermaid-detect";

describe("isMermaidBlock", () => {
  test("显式 language-mermaid → 命中", () => {
    expect(isMermaidBlock("language-mermaid", "graph TD\n A-->B")).toBe(true);
  });

  test("未标语言但内容以 graph 开头（多行）→ 命中", () => {
    expect(isMermaidBlock(undefined, "graph TD\n  A[x] --> B[y]")).toBe(true);
  });

  test("标成 language-graph（LLM 漏标 mermaid）→ 仍命中", () => {
    expect(isMermaidBlock("language-graph", "graph LR\n A-->B")).toBe(true);
  });

  test("flowchart / sequenceDiagram 等其它图类型 → 命中", () => {
    expect(isMermaidBlock(undefined, "flowchart TD\n A-->B")).toBe(true);
    expect(
      isMermaidBlock(undefined, "sequenceDiagram\n  Alice->>Bob: hi"),
    ).toBe(true);
  });

  test("普通代码块（python）→ 不命中", () => {
    expect(isMermaidBlock("language-python", "def f():\n  return 1")).toBe(
      false,
    );
  });

  test("行内单行代码即便内容是 graph → 不误判", () => {
    expect(isMermaidBlock(undefined, "graph")).toBe(false);
  });

  test("首词只是以关键字为前缀的普通标识符 → 不误判", () => {
    expect(isMermaidBlock(undefined, "graphqlClient.query()\n  .run()")).toBe(
      false,
    );
  });
});
