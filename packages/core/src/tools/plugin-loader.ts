// @summary Dynamic plugin package loader — imports npm packages and validates tool exports

import type { Tool } from "../tool/types";

export interface PluginManifest {
  name: string;
  apiVersion: string;
  version: string;
}

export interface PluginLoadResult {
  package: string;
  manifest?: PluginManifest;
  tools: Tool[];
  error?: string;
}

/**
 * Load a plugin package by name and extract its tools.
 *
 * Expected plugin module shape:
 *   export const manifest: PluginManifest;
 *   export function createTools(ctx: { cwd: string }): Tool[];
 *
 * Never throws — returns error string on failure.
 */
export async function loadPlugin(packageName: string, cwd: string): Promise<PluginLoadResult> {
  const fail = (error: string): PluginLoadResult => ({
    package: packageName,
    tools: [],
    error,
  });

  let mod: Record<string, unknown>;
  try {
    mod = await import(packageName);
  } catch (err) {
    return fail(
      `Could not load plugin package '${packageName}'. Is it installed? ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate manifest
  const manifest = mod.manifest as PluginManifest | undefined;
  if (!manifest || typeof manifest !== "object") {
    return fail(`Plugin '${packageName}' does not export a 'manifest' object.`);
  }
  if (
    typeof manifest.name !== "string" ||
    typeof manifest.apiVersion !== "string" ||
    typeof manifest.version !== "string"
  ) {
    return fail(`Plugin '${packageName}' manifest is missing required fields (name, apiVersion, version).`);
  }

  // Check API version compatibility (major must be 1)
  const majorVersion = parseInt(manifest.apiVersion.split(".")[0], 10);
  if (Number.isNaN(majorVersion) || majorVersion !== 1) {
    return fail(
      `Plugin '${packageName}' requires API version '${manifest.apiVersion}' but only version 1.x is supported.`,
    );
  }

  // Call createTools
  if (typeof mod.createTools !== "function") {
    return fail(`Plugin '${packageName}' does not export a 'createTools' function.`);
  }

  let rawTools: unknown[];
  try {
    const result = mod.createTools({ cwd });
    rawTools = Array.isArray(result) ? result : [];
  } catch (err) {
    return fail(`Plugin '${packageName}' createTools() threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate each tool shape (duck-typing)
  const validTools: Tool[] = [];
  const errors: string[] = [];

  for (const tool of rawTools) {
    if (!isValidToolShape(tool)) {
      const name = (tool as { name?: string })?.name ?? "unknown";
      errors.push(`Tool '${name}' from '${packageName}' has invalid shape.`);
      continue;
    }
    validTools.push(tool as Tool);
  }

  return {
    package: packageName,
    manifest,
    tools: validTools,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

function isValidToolShape(tool: unknown): boolean {
  if (typeof tool !== "object" || tool === null) return false;
  const t = tool as Record<string, unknown>;
  return (
    typeof t.name === "string" &&
    typeof t.description === "string" &&
    t.parameters != null &&
    typeof (t.parameters as Record<string, unknown>).parse === "function" &&
    typeof t.execute === "function"
  );
}
