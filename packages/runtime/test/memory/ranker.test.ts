// @summary Tests for confidence priority, recency tie-breaking, and supersession
import { describe, expect, it } from "bun:test";
import { rankMemory } from "@diligent/runtime/memory";
import { makeMemoryEntry } from "../helpers/memory";

describe("Memory Ranker", () => {
  it("filters superseded entries", () => {
    const old = makeMemoryEntry({ id: "old1", content: "old rule" });
    const replacement = makeMemoryEntry({ id: "new1", content: "new rule", supersedes: "old1" });

    const ranked = rankMemory([old, replacement]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("new1");
  });

  it("prioritizes confidence over recency", () => {
    const low = makeMemoryEntry({ id: "low", confidence: 0.2, timestamp: "2026-10-26T00:00:00Z" });
    const high = makeMemoryEntry({ id: "high", confidence: 0.9, timestamp: "2026-01-01T00:00:00Z" });

    const ranked = rankMemory([low, high]);
    expect(ranked[0].id).toBe("high");
  });

  it("prefers recent entries when confidence is equal", () => {
    const recent = makeMemoryEntry({ id: "recent", confidence: 0.8, timestamp: "2026-10-26T00:00:00Z" });
    const old = makeMemoryEntry({ id: "old", confidence: 0.8, timestamp: "2026-01-01T00:00:00Z" });

    expect(rankMemory([old, recent]).map((entry) => entry.id)).toEqual(["recent", "old"]);
  });

  it("returns empty for empty input", () => {
    expect(rankMemory([])).toEqual([]);
  });
});
