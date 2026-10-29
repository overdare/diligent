// @summary Deletes retired first-party plugin copies from the global plugin root and keeps any leftover from loading.

import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@diligent/logging";
import { type BundledToolProvider, getGlobalPluginRoot } from "@diligent/runtime";

const logger = createLogger({ scope: "sidecar/retired-plugins" });

/**
 * First-party plugins that launchers up to v0.4.21 copied into `~/.overdare/plugins/`. Their tools and hooks are stale
 * (for example, the validator's `validatelua` uses outdated Luau definitions). The runtime owns this list because it
 * auto-updates; the launcher does not. Entries are permanent; retire a package by adding it here.
 */
export const RETIRED_PLUGIN_PACKAGES = [
  "@overdare/plugin-analytics",
  "@overdare/plugin-rag",
  "@overdare/plugin-studiorpc",
  "@overdare/plugin-validator",
] as const;

/** Keeps a retired copy that could not be deleted (for example, a locked file on Windows) from loading. */
export function createRetiredPluginProvider(): BundledToolProvider {
  return {
    id: "@overdare/retired-plugins",
    displayName: "OVERDARE retired plugins",
    supersedesPluginPackages: [...RETIRED_PLUGIN_PACKAGES],
    createTools: () => [],
  };
}

/**
 * Deletes retired package directories from the global plugin root. Only listed packages are touched: other packages,
 * including others in the same scope, are user-owned. A linked plugin root or scope is never followed out of global
 * storage, and a linked package is unlinked without touching its target. Failures are logged, never thrown; the provider above still keeps a
 * leftover from loading.
 */
export async function removeRetiredPluginCopies(root: string = getGlobalPluginRoot()): Promise<string[]> {
  const removed: string[] = [];
  if (await isSymlink(root)) return removed;
  for (const packageName of RETIRED_PLUGIN_PACKAGES) {
    const scope = packageName.split("/")[0]!;
    if (await isSymlink(join(root, scope))) continue;
    const target = join(root, packageName);
    try {
      await lstat(target);
    } catch {
      continue;
    }
    try {
      await rm(target, { recursive: true, force: true });
      removed.push(packageName);
      logger.info("retired_plugin.removed", { message: `Removed retired plugin ${packageName}` });
    } catch (error) {
      logger.warn("retired_plugin.remove_failed", { message: `Could not remove retired plugin ${packageName}`, error });
    }
  }
  return removed;
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}
