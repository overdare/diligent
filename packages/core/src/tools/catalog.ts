// @summary Tool catalog builder — resolution pipeline that merges builtins and plugins with config toggles

import { COLLAB_TOOL_NAMES } from "../collab";
import type { DiligentConfig } from "../config/schema";
import type { Tool } from "../tool/types";
import { isImmutableTool } from "./immutable";
import { discoverGlobalPlugins, loadPlugin } from "./plugin-loader";

export type ToolStateReason =
  | "enabled"
  | "disabled_by_user"
  | "immutable_forced_on"
  | "plugin_disabled"
  | "plugin_load_failed"
  | "conflict_dropped"
  | "invalid_plugin_tool";

export interface ToolStateEntry {
  name: string;
  source: "builtin" | "plugin";
  pluginPackage?: string;
  enabled: boolean;
  immutable: boolean;
  configurable: boolean;
  available: boolean;
  reason: ToolStateReason;
  error?: string;
}

export interface PluginStateEntry {
  package: string;
  configured: boolean;
  enabled: boolean;
  loaded: boolean;
  toolCount: number;
  loadError?: string;
  warnings: string[];
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
  /** Plugin-level metadata for UI display */
  plugins: PluginStateEntry[];
  /** Plugin-level load errors retained for compatibility with existing callers */
  pluginErrors: PluginLoadError[];
}

type ToolMapEntry = {
  tool: Tool;
  source: "builtin" | "plugin";
  pluginPackage?: string;
  order: number;
};

function compareEntries(a: ToolMapEntry, b: ToolMapEntry): number {
  return a.order - b.order || a.tool.name.localeCompare(b.tool.name);
}

/**
 * Build a resolved tool catalog from built-in tools, plugin tools, and config.
 *
 * Resolution pipeline:
 * 1. Build built-in catalog (ordered map by name)
 * 2. Load plugin tools (async, per configured plugin)
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
  const explicitPlugins = config.plugins ?? [];

  // Auto-discover plugins from ~/.diligent/plugins/ and merge with explicit config.
  // Explicit config entries always take precedence (for enable/disable, per-tool toggles, etc.).
  const discoveredNames = await discoverGlobalPlugins();
  const explicitPackageNames = new Set(explicitPlugins.map((p) => p.package));
  const autoPlugins = discoveredNames
    .filter((name) => !explicitPackageNames.has(name))
    .map((name) => ({
      package: name,
      enabled: true as const,
      tools: undefined as Record<string, boolean> | undefined,
    }));

  // Explicit entries first (preserving user-defined order), then auto-discovered ones.
  const pluginConfigs = [...explicitPlugins, ...autoPlugins];

  // 1. Build built-in catalog with stable order and exclude collab tools from configurable state.
  const toolMap = new Map<string, ToolMapEntry>();
  const state = new Map<string, ToolStateEntry>();
  let order = 0;

  for (const tool of builtinTools) {
    if (COLLAB_TOOL_NAMES.has(tool.name)) continue;

    const immutable = isImmutableTool(tool.name);
    const disabledByUser = builtinToggles[tool.name] === false;
    const enabled = immutable ? true : !disabledByUser;

    toolMap.set(tool.name, { tool, source: "builtin", order: order++ });
    state.set(tool.name, {
      name: tool.name,
      source: "builtin",
      enabled,
      immutable,
      configurable: !immutable,
      available: true,
      reason: immutable && disabledByUser ? "immutable_forced_on" : enabled ? "enabled" : "disabled_by_user",
    });
  }

  // 2. Load plugin tools and separate package-level state from tool-level state.
  const pluginErrors: PluginLoadError[] = [];
  const plugins: PluginStateEntry[] = [];
  const pluginOrderStart = order;

  for (const [pluginIndex, pluginConfig] of pluginConfigs.entries()) {
    const pluginEnabled = pluginConfig.enabled ?? true;
    const pluginState: PluginStateEntry = {
      package: pluginConfig.package,
      configured: true,
      enabled: pluginEnabled,
      loaded: false,
      toolCount: 0,
      warnings: [],
    };
    plugins.push(pluginState);

    if (!pluginEnabled) {
      const toolToggles = pluginConfig.tools ?? {};
      for (const toolName of Object.keys(toolToggles)) {
        if (toolToggles[toolName] === false) {
          state.set(`plugin-disabled:${pluginConfig.package}:${toolName}`, {
            name: toolName,
            source: "plugin",
            pluginPackage: pluginConfig.package,
            enabled: false,
            immutable: false,
            configurable: true,
            available: false,
            reason: "plugin_disabled",
          });
        }
      }
      continue;
    }

    const result = await loadPlugin(pluginConfig.package, cwd);
    pluginState.loaded = !result.error;
    pluginState.toolCount = result.tools.length;

    if (result.error) {
      pluginState.loadError = result.error;
      pluginErrors.push({ package: pluginConfig.package, enabled: true, error: result.error });
      for (const invalidTool of result.invalidTools ?? []) {
        state.set(`invalid:${pluginConfig.package}:${invalidTool.name}`, {
          name: invalidTool.name,
          source: "plugin",
          pluginPackage: pluginConfig.package,
          enabled: false,
          immutable: false,
          configurable: true,
          available: false,
          reason: "invalid_plugin_tool",
          error: invalidTool.error,
        });
      }
      continue;
    }

    pluginState.loaded = true;
    pluginState.warnings = result.warnings ?? [];
    if ((result.warnings?.length ?? 0) > 0) {
      for (const warning of result.warnings ?? []) {
        pluginErrors.push({ package: pluginConfig.package, enabled: true, error: warning });
      }
    }
    for (const invalidTool of result.invalidTools ?? []) {
      state.set(`invalid:${pluginConfig.package}:${invalidTool.name}`, {
        name: invalidTool.name,
        source: "plugin",
        pluginPackage: pluginConfig.package,
        enabled: false,
        immutable: false,
        configurable: true,
        available: false,
        reason: "invalid_plugin_tool",
        error: invalidTool.error,
      });
    }

    const pluginToolToggles = pluginConfig.tools ?? {};
    for (const [toolIndex, tool] of result.tools.entries()) {
      const pluginOrder = pluginOrderStart + pluginIndex * 1000 + toolIndex;
      const existing = toolMap.get(tool.name);

      if (existing && existing.source === "builtin") {
        const existingState = state.get(tool.name)!;
        const builtinImmutable = isImmutableTool(tool.name);

        if (builtinImmutable) {
          state.set(`conflict:${pluginConfig.package}:${tool.name}`, {
            name: tool.name,
            source: "plugin",
            pluginPackage: pluginConfig.package,
            enabled: false,
            immutable: false,
            configurable: true,
            available: false,
            reason: "conflict_dropped",
            error: `Plugin tool '${tool.name}' cannot override immutable built-in tool '${tool.name}'.`,
          });
          pluginErrors.push({
            package: pluginConfig.package,
            enabled: true,
            error: `Plugin tool '${tool.name}' cannot override immutable built-in tool '${tool.name}'.`,
          });
          continue;
        }

        if (conflictPolicy === "plugin_wins") {
          const enabled = pluginToolToggles[tool.name] ?? true;
          toolMap.set(tool.name, {
            tool,
            source: "plugin",
            pluginPackage: pluginConfig.package,
            order: pluginOrder,
          });
          state.set(tool.name, {
            name: tool.name,
            source: "plugin",
            pluginPackage: pluginConfig.package,
            enabled,
            immutable: false,
            configurable: true,
            available: true,
            reason: enabled ? "enabled" : "disabled_by_user",
          });
          continue;
        }

        const error =
          conflictPolicy === "error"
            ? `Plugin tool '${tool.name}' conflicts with built-in tool. Using built-in (conflictPolicy: "error").`
            : undefined;

        state.set(`conflict:${pluginConfig.package}:${tool.name}`, {
          name: tool.name,
          source: "plugin",
          pluginPackage: pluginConfig.package,
          enabled: false,
          immutable: false,
          configurable: true,
          available: false,
          reason: "conflict_dropped",
          error,
        });
        if (error) {
          pluginErrors.push({ package: pluginConfig.package, enabled: true, error });
        }
        state.set(tool.name, existingState);
        continue;
      }

      const enabled = pluginToolToggles[tool.name] ?? true;
      toolMap.set(tool.name, {
        tool,
        source: "plugin",
        pluginPackage: pluginConfig.package,
        order: pluginOrder,
      });
      state.set(tool.name, {
        name: tool.name,
        source: "plugin",
        pluginPackage: pluginConfig.package,
        enabled,
        immutable: false,
        configurable: true,
        available: true,
        reason: enabled ? "enabled" : "disabled_by_user",
      });
    }
  }

  // 3. Build final tool list in deterministic order.
  const finalEntries = [...toolMap.values()].sort(compareEntries);
  const tools: Tool[] = [];

  for (const entry of finalEntries) {
    const toolState = state.get(entry.tool.name);
    if (toolState?.enabled) {
      tools.push(entry.tool);
    }
  }

  const orderedState = [...state.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => {
      const aCurrent = toolMap.get(a.value.name);
      const bCurrent = toolMap.get(b.value.name);
      const aOrder = aCurrent?.order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = bCurrent?.order ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.value.name.localeCompare(b.value.name) || a.key.localeCompare(b.key);
    })
    .map((entry) => entry.value);

  return { tools, state: orderedState, plugins, pluginErrors };
}
