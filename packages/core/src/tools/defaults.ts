// @summary Shared default tool assembly used by both CLI and Web server
import type { AgentRegistry, CollabToolDeps } from "../collab";
import { createCollabTools } from "../collab";
import type { DiligentConfig } from "../config/schema";
import type { DiligentPaths } from "../infrastructure";
import type { SkillMetadata } from "../skills";
import type { Tool } from "../tool/types";
import { createAddKnowledgeTool } from "./add-knowledge";
import { createApplyPatchTool } from "./apply-patch";
import { createBashTool } from "./bash";
import type { PluginLoadError, PluginStateEntry, ToolStateEntry } from "./catalog";
import { buildToolCatalog } from "./catalog";
import { createEditTool, createMultiEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createPlanTool } from "./plan";
import { createReadTool } from "./read";
import { requestUserInputTool } from "./request-user-input";
import { createSkillTool } from "./skill";
import { createWriteAbsoluteTool } from "./write";

export interface BuildDefaultToolsResult {
  tools: Tool[];
  registry?: AgentRegistry;
  toolState: ToolStateEntry[];
  pluginState: PluginStateEntry[];
  pluginErrors: PluginLoadError[];
}

/**
 * Returns true when the model's provider is OpenAI.
 * OpenAI models use `apply_patch` only;
 * all other providers use `edit` + `multi_edit` + absolute-path `write`.
 */
function isOpenAIProvider(provider?: string): boolean {
  return provider === "openai";
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
  /** Provider name of the resolved model (e.g. "openai", "anthropic", "gemini"). */
  provider?: string,
): Promise<BuildDefaultToolsResult> {
  // 1. Assemble all built-in tools — file-editing tools vary by provider
  const fileEditTools: Tool[] = isOpenAIProvider(provider)
    ? [createApplyPatchTool(cwd)]
    : [createWriteAbsoluteTool(), createEditTool(), createMultiEditTool()];

  const builtinTools: Tool[] = [
    createBashTool(cwd),
    createSkillTool(skills),
    createReadTool(),
    ...fileEditTools,
    createLsTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createPlanTool(),
    requestUserInputTool,
  ];

  if (paths) {
    builtinTools.push(createAddKnowledgeTool(paths.knowledge));
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
