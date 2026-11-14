// @summary Tests for confidence priority, recency tie-breaking, and supersession
import { describe, expect, it } from "bun:test";
import { rankKnowledge } from "@diligent/runtime/knowledge";
import { makeKnowledgeEntry } from "../helpers/knowledge";

describe("Knowledge Ranker", () => {
  it("filters superseded entries", () => {
    const old = makeKnowledgeEntry({ id: "old1", content: "old rule" });
    const replacement = makeKnowledgeEntry({ id: "new1", content: "new rule", supersedes: "old1" });

    const ranked = rankKnowledge([old, replacement]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("new1");
  });

  it("prioritizes confidence over recency", () => {
    const low = makeKnowledgeEntry({ id: "low", confidence: 0.2, timestamp: "2026-10-26T00:00:00Z" });
    const high = makeKnowledgeEntry({ id: "high", confidence: 0.9, timestamp: "2026-01-01T00:00:00Z" });

    const ranked = rankKnowledge([low, high]);
    expect(ranked[0].id).toBe("high");
  });

  it("prefers recent entries when confidence is equal", () => {
    const recent = makeKnowledgeEntry({ id: "recent", confidence: 0.8, timestamp: "2026-10-26T00:00:00Z" });
    const old = makeKnowledgeEntry({ id: "old", confidence: 0.8, timestamp: "2026-01-01T00:00:00Z" });

    expect(rankKnowledge([old, recent]).map((entry) => entry.id)).toEqual(["recent", "old"]);
  });

  it("returns empty for empty input", () => {
    expect(rankKnowledge([])).toEqual([]);
  });
});
