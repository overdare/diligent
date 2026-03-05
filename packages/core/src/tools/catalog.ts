// @summary Tool catalog builder — resolution pipeline that merges builtins and plugins with config toggles

import type { DiligentConfig } from "../config/schema";
import type { Tool } from "../tool/types";
import { isImmutableTool } from "./immutable";
import { loadPlugin } from "./plugin-loader";

export interface ToolStateEntry {
  name: string;
  source: "builtin" | "plugin";
  pluginPackage?: string;
  enabled: boolean;
  immutable: boolean;
  error?: string;
}

export interface PluginLoadError {
  package: string;
  enabled: boolean;
  error: string;
}

export interface ToolCatalogResult {
  /** Final enabled tools for agent loop */
  tools: Tool[];
  /** Full metadata for UI display */
  state: ToolStateEntry[];
  /** Plugin-level load errors */
  pluginErrors: PluginLoadError[];
}

/**
 * Build a resolved tool catalog from built-in tools, plugin tools, and config.
 *
 * Resolution pipeline:
 * 1. Build built-in catalog (map by name)
 * 2. Load plugin tools (async, per enabled plugin)
 * 3. Resolve name conflicts (by conflictPolicy)
 * 4. Apply immutable enforcement (force-enable immutable tools)
 * 5. Apply enable/disable state from config
 * 6. Return enabled tools + full state metadata + plugin errors
 */
export async function buildToolCatalog(
  builtinTools: Tool[],
  toolsConfig: DiligentConfig["tools"],
  cwd: string,
): Promise<ToolCatalogResult> {
  const config = toolsConfig ?? {};
  const conflictPolicy = config.conflictPolicy ?? "error";
  const builtinToggles = config.builtin ?? {};
  const pluginConfigs = config.plugins ?? [];

  // 1. Build built-in catalog
  const toolMap = new Map<string, { tool: Tool; source: "builtin" | "plugin"; pluginPackage?: string }>();
  for (const tool of builtinTools) {
    toolMap.set(tool.name, { tool, source: "builtin" });
  }

  // 2. Load plugin tools
  const pluginErrors: PluginLoadError[] = [];

  for (const pluginConfig of pluginConfigs) {
    const pluginEnabled = pluginConfig.enabled ?? true;
    if (!pluginEnabled) {
      pluginErrors.push({ package: pluginConfig.package, enabled: false, error: "" });
      continue;
    }

    const result = await loadPlugin(pluginConfig.package, cwd);

    if (result.error && result.tools.length === 0) {
      pluginErrors.push({ package: pluginConfig.package, enabled: true, error: result.error });
      continue;
    }
    if (result.error) {
      // Partial error (some tools valid, some not)
      pluginErrors.push({ package: pluginConfig.package, enabled: true, error: result.error });
    }

    // 3. Resolve name conflicts for each plugin tool
    const _pluginToolToggles = pluginConfig.tools ?? {};
    for (const tool of result.tools) {
      const existing = toolMap.get(tool.name);
      if (existing && existing.source === "builtin") {
        // Name conflict with built-in
        switch (conflictPolicy) {
          case "error":
            pluginErrors.push({
              package: pluginConfig.package,
              enabled: true,
              error: `Plugin tool '${tool.name}' conflicts with built-in tool. Using built-in (conflictPolicy: "error").`,
            });
            continue; // skip plugin tool
          case "builtin_wins":
            continue; // skip plugin tool silently
          case "plugin_wins":
            // Replace built-in with plugin tool
            break;
        }
      }

      toolMap.set(tool.name, { tool, source: "plugin", pluginPackage: pluginConfig.package });
    }
  }

  // 4 & 5. Apply immutable enforcement + enable/disable state
  const state: ToolStateEntry[] = [];
  const enabledTools: Tool[] = [];

  for (const [name, entry] of toolMap) {
    const immutable = isImmutableTool(name);
    let enabled: boolean;

    if (immutable) {
      // Immutable tools are always enabled regardless of config
      enabled = true;
    } else if (entry.source === "builtin") {
      // Built-in toggle: default enabled, config can disable
      enabled = builtinToggles[name] ?? true;
    } else {
      // Plugin tool toggle: check per-plugin config
      const pluginConfig = pluginConfigs.find((p) => p.package === entry.pluginPackage);
      const pluginToolToggles = pluginConfig?.tools ?? {};
      enabled = pluginToolToggles[name] ?? true;
    }

    state.push({
      name,
      source: entry.source,
      pluginPackage: entry.pluginPackage,
      enabled,
      immutable,
    });

    if (enabled) {
      enabledTools.push(entry.tool);
    }
  }

  return { tools: enabledTools, state, pluginErrors };
}
