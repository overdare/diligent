// @summary Point source-checkout sidecar runs at the repository's pinned ripgrep binary
import { existsSync } from "node:fs";
import { join } from "node:path";

// The binaries scripts/build-overdare-runtime-bundle.ts stages into packaged runtimes.
const REPO_RG_BINARIES: Partial<Record<string, string>> = {
  "darwin-arm64": "rg-aarch64-apple-darwin",
  "win32-x64": "rg-x86_64-pc-windows-msvc.exe",
};

/**
 * Packaged runtimes get `DILIGENT_RG_PATH` from the Rust launcher. A sidecar started with `bun run` from a
 * checkout has no launcher, so point it at `thirdparty/rg` to search with the same binary instead of
 * depending on a PATH `rg`. A launcher- or user-provided value still wins, and a compiled sidecar has no
 * checkout beside it, so nothing is set there.
 */
export function applyRepoRipgrep(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DILIGENT_RG_PATH) return;
  const binary = REPO_RG_BINARIES[`${process.platform}-${process.arch}`];
  if (!binary) return;
  const path = join(import.meta.dir, "../../../../thirdparty/rg", binary);
  if (existsSync(path)) env.DILIGENT_RG_PATH = path;
}
