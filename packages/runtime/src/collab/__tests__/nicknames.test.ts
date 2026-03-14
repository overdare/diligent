// @summary Tests for NicknamePool: uniqueness within a pass, exhaustion reset
import { describe, expect, it } from "bun:test";
import { NicknamePool } from "@diligent/runtime/collab";

describe("NicknamePool", () => {
  it("returns strings", () => {
    const pool = new NicknamePool();
    const name = pool.reserve();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("returns unique names within the 87-name pool", () => {
    const pool = new NicknamePool();
    const seen = new Set<string>();
    // Reserve all 87 names — each should be unique
    for (let i = 0; i < 87; i++) {
      const name = pool.reserve();
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
    expect(seen.size).toBe(87);
  });

  it("resets and continues after exhaustion", () => {
    const pool = new NicknamePool();
    // Drain the pool
    for (let i = 0; i < 87; i++) {
      pool.reserve();
    }
    // 88th should work (pool resets)
    const name = pool.reserve();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
