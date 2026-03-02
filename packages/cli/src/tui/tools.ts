// @summary Builds the set of tools available to the agent in the TUI
import type { AgentRegistry, CollabToolDeps, DiligentPaths, TaskToolDeps, Tool } from "@diligent/core";
import {
  bashTool,
  createAddKnowledgeTool,
  createCollabTools,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createLsTool,
  createPlanTool,
  createReadTool,
  createTaskTool,
  createWriteTool,
  requestUserInputTool,
} from "@diligent/core";

export function buildTools(
  cwd: string,
  paths?: DiligentPaths,
  taskDeps?: Omit<TaskToolDeps, "cwd" | "paths" | "parentTools">,
  collabDeps?: Omit<CollabToolDeps, "cwd" | "paths" | "parentTools">,
): { tools: Tool[]; registry?: AgentRegistry } {
  const tools: Tool[] = [
    bashTool,
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createLsTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createPlanTool(),
    requestUserInputTool,
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

  if (paths && collabDeps) {
    const { tools: collabTools, registry } = createCollabTools({
      ...collabDeps,
      cwd,
      paths,
      parentTools: tools,
    });
    tools.push(...collabTools);
    return { tools, registry };
  }

  return { tools };
}
