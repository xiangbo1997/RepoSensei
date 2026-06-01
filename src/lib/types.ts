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
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatBubble extends ChatMessage {
  id: string;
}
