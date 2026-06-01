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
}

export interface ProjectSummary {
  techStack: string[];
  modules: ModuleSummary[];
  entryPoints: string[];
  overview: string;
  mermaidArchitecture: string;
  conceptCards: ConceptCard[];
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
