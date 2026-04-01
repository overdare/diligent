// @summary Tests package mode helpers for runtime-only vs full desktop packaging.

import { describe, expect, test } from "bun:test";
import { shouldBuildDesktopBinary } from "../../scripts/lib/package-mode";

describe("shouldBuildDesktopBinary", () => {
  test("returns false when runtime-only mode is enabled", () => {
    expect(shouldBuildDesktopBinary(true)).toBe(false);
  });

  test("returns true when runtime-only mode is disabled", () => {
    expect(shouldBuildDesktopBinary(false)).toBe(true);
  });
});
