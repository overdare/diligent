// @summary Shared default tool assembly used by both CLI and Web server

import type { Tool } from "@diligent/core/tool/types";
import type { AgentRegistry, CollabToolDeps } from "../collab";
import { createCollabTools } from "../collab";
import type { DiligentConfig } from "../config/schema";
import type { DiligentPaths } from "../infrastructure";
import type { SkillMetadata } from "../skills";
import { createUpdateKnowledgeTool } from "./update-knowledge";
import { createBashTool } from "./bash";
import type { RuntimeToolHost } from "./capabilities";
import type { PluginLoadError, PluginStateEntry, ToolStateEntry } from "./catalog";
import { buildToolCatalog } from "./catalog";
import { createEditTool, createMultiEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createPlanTool } from "./plan";
import { createReadTool } from "./read";
import { createRequestUserInputTool } from "./request-user-input";
import { createSkillTool } from "./skill";
import { createWriteAbsoluteTool } from "./write";

export interface BuildDefaultToolsResult {
  tools: Tool[];
  registry?: AgentRegistry;
  toolState: ToolStateEntry[];
  pluginState: PluginStateEntry[];
  pluginErrors: PluginLoadError[];
}

export async function buildDefaultTools(
  cwd: string,
  paths?: DiligentPaths,
  collabDeps?: Omit<CollabToolDeps, "cwd" | "paths" | "parentTools">,
  toolsConfig?: DiligentConfig["tools"],
  skills: SkillMetadata[] = [],
  /**
   * Existing registry to reuse across turns.
   * When provided, the registry's mutable deps are updated but live child-agent
   * entries are preserved so cross-turn spawn→wait works correctly.
   */
  existingRegistry?: AgentRegistry,
  host?: RuntimeToolHost,
): Promise<BuildDefaultToolsResult> {
  // 1. Assemble all built-in tools
  const fileEditTools: Tool[] = [createWriteAbsoluteTool(host), createEditTool(host), createMultiEditTool(host)];

  const builtinTools: Tool[] = [
    createBashTool(cwd, host),
    createSkillTool(skills),
    createReadTool(),
    ...fileEditTools,
    createLsTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createPlanTool(),
    createRequestUserInputTool(host),
  ];

  if (paths) {
    builtinTools.push(createUpdateKnowledgeTool(paths.knowledge));
  }

  // 2. Run catalog resolution (applies config toggles, loads plugins, enforces immutables)
  const catalog = await buildToolCatalog(builtinTools, toolsConfig, cwd);

  // 3. Add collab tools (always enabled, not user-configurable)
  if (paths && collabDeps) {
    const { tools: collabTools, registry } = createCollabTools(
      {
        ...collabDeps,
        cwd,
        paths,
        parentTools: catalog.tools,
      },
      existingRegistry,
    );
    catalog.tools.push(...collabTools);
    return {
      tools: catalog.tools,
      registry,
      toolState: catalog.state,
      pluginState: catalog.plugins,
      pluginErrors: catalog.pluginErrors,
    };
  }

  return {
    tools: catalog.tools,
    toolState: catalog.state,
    pluginState: catalog.plugins,
    pluginErrors: catalog.pluginErrors,
  };
}
