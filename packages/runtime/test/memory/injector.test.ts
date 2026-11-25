// @summary Tests for rendering ranked memory within configured limits
import { describe, expect, it } from "bun:test";
import { buildMemorySection } from "@diligent/runtime/memory";
import { makeMemoryEntry } from "../helpers/memory";

describe("Memory Injector", () => {
  it("builds section from entries", () => {
    const entries = [
      makeMemoryEntry({ type: "pattern", content: "Use Bun.spawn for process execution" }),
      makeMemoryEntry({ type: "preference", content: "Always use TypeScript strict mode" }),
    ];

    const section = buildMemorySection(entries, 8192);
    expect(section).toContain("[pattern] Use Bun.spawn");
    expect(section).toContain("[preference] Always use TypeScript strict mode");
  });

  it("returns empty string for no entries", () => {
    expect(buildMemorySection([], 8192)).toBe("");
  });

  it("skips oversized entries and applies maxItems to entries that actually fit", () => {
    const entries = [
      makeMemoryEntry({ content: "x".repeat(2000), confidence: 0.9 }),
      makeMemoryEntry({ content: "Prefer concise responses", confidence: 0.8 }),
      makeMemoryEntry({ content: "Prefer detailed responses", confidence: 0.7 }),
    ];

    const section = buildMemorySection(entries, 64, 1);

    expect(section).toContain("Prefer concise responses");
    expect(section).not.toContain("x".repeat(2000));
    expect(section).not.toContain("Prefer detailed responses");
    expect(Math.ceil(section.length / 4)).toBeLessThanOrEqual(64);
  });

  it("returns no section when no entry fits the budget", () => {
    const entries = [makeMemoryEntry({ content: "x".repeat(2000) })];

    expect(buildMemorySection(entries, 1)).toBe("");
    expect(buildMemorySection(entries, 64)).toBe("");
    expect(buildMemorySection(entries, 8192, 0)).toBe("");
  });

  it("injects the latest preference when equally confident entries exceed maxItems", () => {
    const entries = [
      makeMemoryEntry({ content: "Prefer concise responses", timestamp: "2026-01-01T00:00:00Z" }),
      makeMemoryEntry({ content: "Prefer detailed responses", timestamp: "2026-10-26T00:00:00Z" }),
    ];

    const section = buildMemorySection(entries, 8192, 1);

    expect(section).toContain("Prefer detailed responses");
    expect(section).not.toContain("Prefer concise responses");
  });

  it("uses configured maxItems when provided", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeMemoryEntry({ id: `m-${i}`, confidence: (10 - i) / 10, content: `Configured item ${i}` }),
    );

    const section = buildMemorySection(entries, 8192, 5);
    const lines = section.split("\n").filter((line) => line.startsWith("- ["));

    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain("Configured item 4");
    expect(section).not.toContain("Configured item 5");
  });
});
