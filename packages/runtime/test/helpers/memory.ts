// @summary Shared synthetic memory entry factory for runtime tests
import type { MemoryEntry } from "@diligent/runtime/memory";

export function makeMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: crypto.randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    type: "pattern",
    content: "Test memory",
    confidence: 0.8,
    ...overrides,
  };
}
