// @summary Tests for rendering ranked knowledge within configured limits
import { describe, expect, it } from "bun:test";
import { buildKnowledgeSection } from "@diligent/runtime/knowledge";
import { makeKnowledgeEntry } from "../helpers/knowledge";

describe("Knowledge Injector", () => {
  it("builds section from entries", () => {
    const entries = [
      makeKnowledgeEntry({ type: "pattern", content: "Use Bun.spawn for process execution" }),
      makeKnowledgeEntry({ type: "preference", content: "Always use TypeScript strict mode" }),
    ];

    const section = buildKnowledgeSection(entries, 8192);
    expect(section).toContain("[pattern] Use Bun.spawn");
    expect(section).toContain("[preference] Always use TypeScript strict mode");
  });

  it("returns empty string for no entries", () => {
    expect(buildKnowledgeSection([], 8192)).toBe("");
  });

  it("skips oversized entries and applies maxItems to entries that actually fit", () => {
    const entries = [
      makeKnowledgeEntry({ content: "x".repeat(2000), confidence: 0.9 }),
      makeKnowledgeEntry({ content: "Prefer concise responses", confidence: 0.8 }),
      makeKnowledgeEntry({ content: "Prefer detailed responses", confidence: 0.7 }),
    ];

    const section = buildKnowledgeSection(entries, 64, 1);

    expect(section).toContain("Prefer concise responses");
    expect(section).not.toContain("x".repeat(2000));
    expect(section).not.toContain("Prefer detailed responses");
    expect(Math.ceil(section.length / 4)).toBeLessThanOrEqual(64);
  });

  it("returns no section when no entry fits the budget", () => {
    const entries = [makeKnowledgeEntry({ content: "x".repeat(2000) })];

    expect(buildKnowledgeSection(entries, 1)).toBe("");
    expect(buildKnowledgeSection(entries, 64)).toBe("");
    expect(buildKnowledgeSection(entries, 8192, 0)).toBe("");
  });

  it("injects the latest preference when equally confident entries exceed maxItems", () => {
    const entries = [
      makeKnowledgeEntry({ content: "Prefer concise responses", timestamp: "2026-01-01T00:00:00Z" }),
      makeKnowledgeEntry({ content: "Prefer detailed responses", timestamp: "2026-10-26T00:00:00Z" }),
    ];

    const section = buildKnowledgeSection(entries, 8192, 1);

    expect(section).toContain("Prefer detailed responses");
    expect(section).not.toContain("Prefer concise responses");
  });

  it("uses configured maxItems when provided", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeKnowledgeEntry({ id: `m-${i}`, confidence: (10 - i) / 10, content: `Configured item ${i}` }),
    );

    const section = buildKnowledgeSection(entries, 8192, 5);
    const lines = section.split("\n").filter((line) => line.startsWith("- ["));

    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain("Configured item 4");
    expect(section).not.toContain("Configured item 5");
  });
});
