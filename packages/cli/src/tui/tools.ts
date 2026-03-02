// @summary Builds the set of tools available to the agent in the TUI
import type { DiligentPaths, TaskToolDeps, Tool } from "@diligent/core";
import {
  bashTool,
  createAddKnowledgeTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createTaskTool,
  createWriteTool,
} from "@diligent/core";

export function buildTools(
  cwd: string,
  paths?: DiligentPaths,
  taskDeps?: Omit<TaskToolDeps, "cwd" | "paths" | "parentTools">,
): Tool[] {
  const tools: Tool[] = [
    bashTool,
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createLsTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
  ];

  if (paths) {
    tools.push(createAddKnowledgeTool(paths.knowledge));
  }

  if (paths && taskDeps) {
    tools.push(
      createTaskTool({
        ...taskDeps,
        cwd,
        paths,
        parentTools: tools,
      }),
    );
  }

  return tools;
}
