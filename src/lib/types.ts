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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatBubble extends ChatMessage {
  id: string;
}
