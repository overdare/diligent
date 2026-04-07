// @summary Tests package mode helpers for skip-desktop-binary vs full desktop packaging.

import { describe, expect, test } from "bun:test";
import { shouldBuildDesktopBinary } from "../../scripts/lib/package-mode";

describe("shouldBuildDesktopBinary", () => {
  test("returns false when skip-desktop-binary mode is enabled", () => {
    expect(shouldBuildDesktopBinary(true)).toBe(false);
  });

  test("returns true when skip-desktop-binary mode is disabled", () => {
    expect(shouldBuildDesktopBinary(false)).toBe(true);
  });
});
