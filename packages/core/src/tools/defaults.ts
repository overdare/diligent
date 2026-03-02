// @summary Shared default tool assembly used by both CLI and Web server
import type { AgentRegistry, CollabToolDeps } from "../collab";
import type { DiligentPaths } from "../infrastructure";
import type { Tool } from "../tool/types";
import type { TaskToolDeps } from "./task";
import { createCollabTools } from "../collab";
import { bashTool } from "./bash";
import { createAddKnowledgeTool } from "./add-knowledge";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createPlanTool } from "./plan";
import { createReadTool } from "./read";
import { requestUserInputTool } from "./request-user-input";
import { createTaskTool } from "./task";
import { createWriteTool } from "./write";

export function buildDefaultTools(
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
