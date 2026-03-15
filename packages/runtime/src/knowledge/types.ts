/** D081: Five knowledge types */
export type KnowledgeType = "pattern" | "discovery" | "preference" | "correction" | "backlog";

export interface KnowledgeEntry {
  id: string;
  timestamp: string; // ISO 8601
  sessionId?: string;
  type: KnowledgeType;
  content: string;
  confidence: number; // 0.0–1.0
  supersedes?: string; // ID of entry this replaces (append-only update)
  tags?: string[];
}

export interface KnowledgeConfig {
  enabled: boolean; // default: true
  injectionBudget: number; // default: 8192 (tokens for system prompt section)
}
