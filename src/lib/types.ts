export interface PackedProject {
  name: string;
  path: string;
  filesScanned: number;
  totalChars: number;
  totalTokens: number;
  content: string;
}

export interface ModuleSummary {
  path: string;
  purpose: string;
  keyFiles: string[];
  /** 该模块依赖的其他模块 path（用于生成拓扑学习路径）。可选，旧 summary 无此字段。 */
  dependsOn?: string[];
}

export interface ConceptCard {
  name: string;
  oneLiner: string;
  evidence: string;
  learnMore: string;
  /** learnMore 来自本地权威文档映射（非 LLM 生成）→ UI 显示「官方」徽章。 */
  verified?: boolean;
}

export interface ProjectSummary {
  techStack: string[];
  modules: ModuleSummary[];
  entryPoints: string[];
  overview: string;
  mermaidArchitecture: string;
  conceptCards: ConceptCard[];
}

/** 深度分析的单个视角产出（dataflow / security / testing 等）。 */
export interface DeepInsight {
  perspective: string;
  markdown: string;
  ok: boolean;
}

export interface CodeHit {
  path: string;
  score: number;
  content: string;
  startLine: number;
  endLine: number;
}

export interface SearchResult {
  hits: CodeHit[];
  indexed: boolean;
  hybrid?: boolean;
}

export interface RecentProject {
  path: string;
  name: string;
  techStack: string[];
  summary: ProjectSummary;
  openedAt: string;
}

export type LlmProvider = "anthropic" | "openai";

export interface SettingsView {
  provider: LlmProvider | "";
  baseUrl: string;
  summaryModel: string;
  chatModel: string;
  hasKey: boolean;
  keyHint: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatBubble extends ChatMessage {
  id: string;
}
