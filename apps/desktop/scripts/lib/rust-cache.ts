// @summary Rust build cache — skip recompilation when sources are unchanged

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HASH_FILE = ".rust-build-hash";

/** Recursively collect all files under a directory. */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Compute a combined SHA256 hash of all Rust-related source files.
 *
 * Covers:
 *   - src-tauri/src/**  (Rust source)
 *   - src-tauri/Cargo.toml / Cargo.lock
 *   - src-tauri/build.rs
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/capabilities/**  (Tauri capability JSON files)
 */
export function computeRustHash(tauriDir: string): string {
  const candidates: string[] = [
    join(tauriDir, "Cargo.toml"),
    join(tauriDir, "Cargo.lock"),
    join(tauriDir, "build.rs"),
    join(tauriDir, "tauri.conf.json"),
  ];

  for (const sub of ["src", "capabilities"]) {
    const dir = join(tauriDir, sub);
    if (existsSync(dir)) candidates.push(...collectFiles(dir));
  }

  const hash = createHash("sha256");
  for (const file of candidates.sort()) {
    if (!existsSync(file)) continue;
    // Include the relative path so renames are detected
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Returns true if the Rust sources have changed since the last recorded build.
 * Also returns true if no hash file exists yet.
 */
export function rustSourcesChanged(tauriDir: string): boolean {
  const hashFile = join(tauriDir, HASH_FILE);
  const current = computeRustHash(tauriDir);
  try {
    const stored = readFileSync(hashFile, "utf-8").trim();
    return current !== stored;
  } catch {
    return true;
  }
}

/** Persist the current hash after a successful Rust build. */
export function saveRustHash(tauriDir: string): void {
  const hashFile = join(tauriDir, HASH_FILE);
  writeFileSync(hashFile, `${computeRustHash(tauriDir)}\n`);
}
