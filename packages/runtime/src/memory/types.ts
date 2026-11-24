/** D081: Five memory types */
export type MemoryType = "pattern" | "discovery" | "preference" | "correction" | "backlog";

export interface MemoryEntry {
  id: string;
  timestamp: string; // ISO 8601
  sessionId?: string;
  type: MemoryType;
  content: string;
  confidence: number; // 0.0–1.0
  supersedes?: string; // ID of entry this replaces (append-only update)
  tags?: string[];
}

export interface MemoryConfig {
  enabled: boolean; // default: true
  injectionBudget: number; // default: 8192 (tokens for system prompt section)
}
