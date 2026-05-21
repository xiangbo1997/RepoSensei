export type LlmProvider = "anthropic" | "openai" | "gemini";

export interface ProjectMeta {
  path: string;
  name: string;
  filesScanned: number;
  totalChars: number;
  totalTokens: number;
}

export interface PackedProject extends ProjectMeta {
  content: string;
  fileTree: string;
}

export interface ProjectSummary {
  techStack: string[];
  modules: ModuleSummary[];
  entryPoints: string[];
  overview: string;
  mermaidArchitecture: string;
  conceptCards: ConceptCard[];
}

export interface ModuleSummary {
  path: string;
  purpose: string;
  keyFiles: string[];
}

export interface ConceptCard {
  name: string;
  oneLiner: string;
  evidence: string;
  learnMore: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}
