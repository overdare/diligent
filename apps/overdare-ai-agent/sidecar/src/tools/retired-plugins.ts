// @summary Keeps retired first-party plugin copies in the global plugin root from loading at runtime.

import type { BundledToolProvider } from "@diligent/runtime";

/**
 * First-party plugins that launchers up to v0.4.21 copied into `~/.overdare/plugins/`. Nothing deletes those copies, so
 * the runtime must never load them: their tools and hooks are stale (for example, the validator's `validatelua` uses
 * outdated Luau definitions). Entries are permanent; retire a package by adding it here.
 */
export const RETIRED_PLUGIN_PACKAGES = [
  "@overdare/plugin-analytics",
  "@overdare/plugin-rag",
  "@overdare/plugin-studiorpc",
  "@overdare/plugin-validator",
] as const;

export function createRetiredPluginProvider(): BundledToolProvider {
  return {
    id: "@overdare/retired-plugins",
    displayName: "OVERDARE retired plugins",
    supersedesPluginPackages: [...RETIRED_PLUGIN_PACKAGES],
    createTools: () => [],
  };
}
