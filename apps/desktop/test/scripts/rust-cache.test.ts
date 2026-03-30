// @summary Unit tests for Rust build hash fingerprint behavior.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRustHash } from "../../scripts/lib/rust-cache";

function createMinimalTauriTree(): string {
  const tauriDir = mkdtempSync(join(tmpdir(), "desktop-rust-cache-"));
  mkdirSync(join(tauriDir, "src"), { recursive: true });
  writeFileSync(join(tauriDir, "Cargo.toml"), "[package]\nname='desktop'\nversion='0.1.0'\n");
  writeFileSync(join(tauriDir, "src", "lib.rs"), "pub fn hello() {}\n");
  return tauriDir;
}

test("computeRustHash changes when build fingerprint changes", () => {
  const tauriDir = createMinimalTauriTree();

  try {
    const hashA = computeRustHash(tauriDir, { buildFingerprint: "runtimeVersion=1.0.0;updateUrl=" });
    const hashB = computeRustHash(tauriDir, {
      buildFingerprint: "runtimeVersion=1.0.0;updateUrl=https://example.com/update-manifest.json",
    });

    expect(hashA).not.toBe(hashB);
  } finally {
    rmSync(tauriDir, { recursive: true, force: true });
  }
});

test("computeRustHash stays the same with identical fingerprint", () => {
  const tauriDir = createMinimalTauriTree();

  try {
    const fingerprint = "runtimeVersion=1.0.0;updateUrl=https://example.com/update-manifest.json";
    const hashA = computeRustHash(tauriDir, { buildFingerprint: fingerprint });
    const hashB = computeRustHash(tauriDir, { buildFingerprint: fingerprint });

    expect(hashA).toBe(hashB);
  } finally {
    rmSync(tauriDir, { recursive: true, force: true });
  }
});
