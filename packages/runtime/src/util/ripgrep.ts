// @summary Resolve the ripgrep binary path (env override, bundled asset, PATH) or report that none exists
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve the `rg` executable to invoke.
 *
 * Resolution order:
 * 1. `DILIGENT_RG_PATH` — set by the packaged host (e.g. the overdare Rust
 *    launcher) to the exact bundled binary.
 * 2. A binary bundled next to the running executable at `assets/bin/rg[.exe]`
 *    (mirrors the luau-lsp asset layout), so a compiled sidecar still finds
 *    ripgrep even when the host forgets to export the env var.
 * 3. `rg` found on `PATH`.
 *
 * Returns `null` when none of these exist (e.g. a dev sidecar run via
 * `bun run` on a host without ripgrep); the grep/glob tools then use the
 * in-process fallback in `./search-fallback`.
 */
export function resolveRgBinary(): string | null {
  const fromEnv = process.env.DILIGENT_RG_PATH;
  if (fromEnv) return fromEnv;

  const binName = process.platform === "win32" ? "rg.exe" : "rg";
  const bundled = join(dirname(process.execPath), "assets", "bin", binName);
  if (existsSync(bundled)) return bundled;

  return Bun.which("rg", { PATH: process.env.PATH ?? "" });
}

/** Resolver seam for the grep/glob tools; tests inject `() => null` to force the fallback. */
export type RgBinaryResolver = () => string | null;
