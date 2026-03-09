// @summary Dynamic plugin package loader — imports npm packages and validates tool exports

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Tool } from "../tool/types";

const GLOBAL_PLUGIN_DIR_SEGMENTS = [".diligent", "plugins"] as const;

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
 * Resolve the home-level global plugin directory.
 *
 * Example:
 *   ~/.diligent/plugins
 */
export function getGlobalPluginRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ...GLOBAL_PLUGIN_DIR_SEGMENTS);
}

/** Resolve a plugin package directory inside the global plugin root. */
export function getGlobalPluginPath(packageName: string): string {
  return join(getGlobalPluginRoot(), packageName);
}

/**
 * Scan the global plugin directory and return the names of all plugin folders found.
 *
 * Only immediate subdirectories are returned (non-recursive).
 * Returns an empty array if the directory does not exist or cannot be read.
 */
export async function discoverGlobalPlugins(): Promise<string[]> {
  const root = getGlobalPluginRoot();
  try {
    const entries = await readdir(root, { withFileTypes: true }) as unknown as Array<{ isDirectory(): boolean; name: string }>;
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Directory doesn't exist or can't be read — no auto-discovered plugins
    return [];
  }
}

/**
 * Load a plugin package by name and extract its tools.
 *
 * Resolution order:
 *   1. Regular package import (installed in the running project/environment)
 *   2. Home-level global plugin directory (~/.diligent/plugins/<packageName>)
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
    mod = await importPluginModule(packageName, cwd);
  } catch (err) {
    return fail(String(err));
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

async function importPluginModule(
  packageName: string,
  cwd?: string,
): Promise<Record<string, unknown>> {
  // Resolution order:
  //   1. Regular package import (installed in the running process's environment)
  //   2. cwd/node_modules/<packageName>  (project-local bun/npm install)
  //   3. ~/.diligent/plugins/<packageName>  (global plugin directory)
  try {
    return (await import(packageName)) as Record<string, unknown>;
  } catch (packageError) {
    // 2. Try project-local node_modules when cwd is provided
    if (cwd) {
      const localPath = join(cwd, "node_modules", packageName);
      try {
        await stat(localPath);
        return (await import(pathToFileURL(localPath).href)) as Record<string, unknown>;
      } catch {
        // not found locally — fall through to global
      }
    }

    // 3. Global plugin directory
    const globalPath = getGlobalPluginPath(packageName);
    const globalImportUrl = pathToFileURL(globalPath).href;

    try {
      await stat(globalPath);
    } catch {
      const triedPaths = [
        ...(cwd ? [`${cwd}/node_modules/${packageName}`] : []),
        globalPath,
      ].join(", ");
      throw new Error(
        `Could not load plugin package '${packageName}'. Tried: ${triedPaths}. ` +
          `Install it in the project ('bun add ${packageName}') or place it under ${getGlobalPluginRoot()}. ` +
          `Package import error: ${packageError instanceof Error ? packageError.message : String(packageError)}`,
      );
    }

    try {
      return (await import(globalImportUrl)) as Record<string, unknown>;
    } catch (globalError) {
      throw new Error(
        `Could not load plugin package '${packageName}'. ` +
          `Package import error: ${packageError instanceof Error ? packageError.message : String(packageError)}. ` +
          `Global import error: ${globalError instanceof Error ? globalError.message : String(globalError)}`,
      );
    }
  }
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
