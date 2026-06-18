/** mermaid 各图类型的声明关键字——代码块首词命中即视为 mermaid 图。 */
const MERMAID_KEYWORDS =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|gitGraph|timeline|quadrantChart|requirementDiagram|C4Context)\b/;

/**
 * 判断一个 markdown 代码块是否是 mermaid 图。双重识别，规避 LLM 围栏标注不统一：
 *   1) 显式标了 ```mermaid（className 含 language-mermaid）；
 *   2) 或正文首词是 mermaid 图类型关键字（LLM 常标成 ```graph / 纯 ``` 而漏掉 mermaid）。
 * 行内代码（无 className 的单行）即便内容像 graph 也不误判——要求含换行（多行块）。
 */
export function isMermaidBlock(
  className: string | undefined,
  code: string,
): boolean {
  if (/language-mermaid\b/.test(className ?? "")) return true;
  const trimmed = code.trim();
  const looksMultiline = trimmed.includes("\n");
  return looksMultiline && MERMAID_KEYWORDS.test(trimmed);
}
