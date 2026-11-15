// @summary Tests for session entry and session ID generation
import { describe, expect, it } from "bun:test";
import { generateEntryId, generateSessionId, isSafeSessionId } from "@diligent/runtime/session";

describe("generateEntryId", () => {
  it("returns 8-char hex string", () => {
    const id = generateEntryId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("generateSessionId", () => {
  it("contains timestamp prefix", () => {
    const id = generateSessionId();
    // Format: YYYYMMDDHHmmssSSSCCC-random
    expect(id).toMatch(/^\d{20}-[0-9a-f]{6}$/);
  });

  it("increments the monotonic counter for IDs generated in the same millisecond", () => {
    const originalNow = Date.now;
    Date.now = () => 946_684_800_000;
    try {
      const first = generateSessionId();
      const second = generateSessionId();
      expect(first).toMatch(/^\d{17}000-[0-9a-f]{6}$/);
      expect(second).toMatch(/^\d{17}001-[0-9a-f]{6}$/);
    } finally {
      Date.now = originalNow;
    }
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe("isSafeSessionId", () => {
  it("accepts generated and legacy single-segment IDs", () => {
    expect(isSafeSessionId(generateSessionId())).toBe(true);
    expect(isSafeSessionId("legacy-session_1.2")).toBe(true);
  });

  it("rejects traversal, separators, empty values, and overlong IDs", () => {
    for (const value of ["", "..", "../outside", "nested/session", "nested\\session", `x${"a".repeat(255)}`]) {
      expect(isSafeSessionId(value)).toBe(false);
    }
  });
});
