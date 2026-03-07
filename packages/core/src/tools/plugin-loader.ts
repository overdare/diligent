// @summary Dynamic plugin package loader — imports npm packages and validates tool exports

import type { Tool } from "../tool/types";

export interface PluginManifest {
  name: string;
  apiVersion: string;
  version: string;
}

export interface InvalidPluginTool {
  name: string;
  error: string;
}

export interface PluginLoadResult {
  package: string;
  manifest?: PluginManifest;
  tools: Tool[];
  error?: string;
  warnings?: string[];
  invalidTools?: InvalidPluginTool[];
}

/**
 * Load a plugin package by name and extract its tools.
 *
 * Expected plugin module shape:
 *   export const manifest: PluginManifest;
 *   export async function createTools(ctx: { cwd: string }): Tool[];
 *
 * Never throws — returns error string on fatal failure and warnings for partial validation issues.
 */
export async function loadPlugin(packageName: string, cwd: string): Promise<PluginLoadResult> {
  const fail = (error: string): PluginLoadResult => ({
    package: packageName,
    tools: [],
    error,
    warnings: [],
    invalidTools: [],
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
  if (manifest.name !== packageName) {
    return fail(`Plugin '${packageName}' manifest.name '${manifest.name}' does not match the configured package name.`);
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
    const result = await Promise.resolve(mod.createTools({ cwd }));
    if (!Array.isArray(result)) {
      return fail(`Plugin '${packageName}' createTools() must return an array of tools.`);
    }
    rawTools = result;
  } catch (err) {
    return fail(`Plugin '${packageName}' createTools() threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate each tool shape (duck-typing) and reject duplicates.
  const validTools: Tool[] = [];
  const invalidTools: InvalidPluginTool[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();

  for (const tool of rawTools) {
    if (!isValidToolShape(tool)) {
      const name = (tool as { name?: string })?.name ?? "unknown";
      const error = `Tool '${name}' from '${packageName}' has invalid shape.`;
      invalidTools.push({ name, error });
      warnings.push(error);
      continue;
    }

    const typedTool = tool as Tool;
    if (seenNames.has(typedTool.name)) {
      const error = `Plugin '${packageName}' exports duplicate tool name '${typedTool.name}'. Later duplicates are ignored.`;
      invalidTools.push({ name: typedTool.name, error });
      warnings.push(error);
      continue;
    }

    seenNames.add(typedTool.name);
    validTools.push(typedTool);
  }

  return {
    package: packageName,
    manifest,
    tools: validTools,
    warnings,
    invalidTools,
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
