// @summary Suppresses retired first-party plugin copies listed in bootstrap/plugins-manifest.json at runtime.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BundledToolProvider } from "@diligent/runtime";

const PLUGIN_MANIFEST = "plugins-manifest.json";

/**
 * Older launchers copied first-party plugins into the global plugin root. The launcher's `init` deletes the packages
 * revoked in `plugins-manifest.json`, but the launcher is not updated with the runtime bundle, so an old launcher never
 * runs that cleanup. This provider makes the auto-updated runtime skip the same packages during plugin discovery.
 */
export function createRetiredPluginProvider(bootstrapDir: string | undefined): BundledToolProvider {
  return {
    id: "@overdare/retired-plugins",
    displayName: "OVERDARE retired plugins",
    supersedesPluginPackages: bootstrapDir ? readRevokedPluginPackages(bootstrapDir) : [],
    createTools: () => [],
  };
}

function readRevokedPluginPackages(bootstrapDir: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(bootstrapDir, PLUGIN_MANIFEST), "utf8");
  } catch {
    return [];
  }
  try {
    const manifest: unknown = JSON.parse(raw);
    if (manifest === null || typeof manifest !== "object" || !("revoked" in manifest)) return [];
    const { revoked } = manifest;
    return Array.isArray(revoked) ? revoked.filter((name): name is string => typeof name === "string") : [];
  } catch (error) {
    console.warn(`[retired-plugins] Ignoring unreadable ${PLUGIN_MANIFEST}: ${String(error)}`);
    return [];
  }
}
