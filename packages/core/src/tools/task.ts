// @summary Task tool for spawning sub-agent sessions (D062–D065)
import { basename } from "node:path";
import { z } from "zod";
import { BUILTIN_AGENT_TYPES } from "../agent/agent-types";
import { PLAN_MODE_ALLOWED_TOOLS } from "../agent/types";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import type { ModelClass } from "../provider/models";
import { agentTypeToModelClass, resolveModelForClass } from "../provider/models";
import type { Model, StreamFunction, SystemSection } from "../provider/types";
import { SessionManager } from "../session/manager";
import type { Tool, ToolContext, ToolResult } from "../tool/types";
import type { Message, TextBlock } from "../types";

export interface TaskToolDeps {
  cwd: string;
  paths: DiligentPaths;
  model: Model;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  parentTools: Tool[];
}

const TaskParams = z.object({
  description: z.string().describe("Brief description of the task for status reporting"),
  prompt: z.string().describe("The full prompt/instruction to send to the sub-agent"),
  subagent_type: z.enum(["general", "explore"]).default("general"),
  task_id: z.string().optional().describe("Session ID to resume a previous sub-agent session"),
  model_class: z
    .enum(["pro", "general", "lite"])
    .optional()
    .describe(
      "Override the model class for this sub-agent. " +
        "'pro' for complex reasoning, 'general' for balanced tasks, 'lite' for simple/read-only. " +
        "Defaults based on subagent_type: explore→lite, general→same as parent.",
    ),
});

/**
 * Creates the `task` tool (D062).
 * Spawns a sub-agent via SessionManager; filters tools per D064; wraps output per D065.
 */
export function createTaskTool(deps: TaskToolDeps): Tool<typeof TaskParams> {
  return {
    name: "task",
    description:
      "Spawn a sub-agent to work on a task. The sub-agent runs independently with its own session. " +
      "Use 'general' for tasks requiring file writes/edits. " +
      "Use 'explore' for read-only research. " +
      "Returns the sub-agent's final response wrapped in <task_result>.",
    parameters: TaskParams,
    execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
      const agentType = BUILTIN_AGENT_TYPES[args.subagent_type];

      // D064: Filter tools by strategy
      let childTools: Tool[];
      if (agentType.toolFilter === "readonly") {
        // explore: PLAN_MODE_ALLOWED_TOOLS only
        childTools = deps.parentTools.filter((t) => PLAN_MODE_ALLOWED_TOOLS.has(t.name));
      } else {
        // general: all tools except "task" (prevent infinite nesting)
        childTools = deps.parentTools.filter((t) => t.name !== "task");
      }

      // Build child system prompt
      const childSystemPrompt = agentType.systemPromptPrefix
        ? [{ label: "agent_role", content: agentType.systemPromptPrefix }, ...deps.systemPrompt]
        : [...deps.systemPrompt];

      // Resolve model class: explicit override > agent_type-based default
      const targetClass: ModelClass = args.model_class ?? agentTypeToModelClass(args.subagent_type, deps.model);
      const childModel = resolveModelForClass(deps.model, targetClass);

      // Create child SessionManager (shared paths — same .diligent dir)
      const childManager = new SessionManager({
        cwd: deps.cwd,
        paths: deps.paths,
        agentConfig: {
          model: childModel,
          systemPrompt: childSystemPrompt,
          tools: childTools,
          streamFunction: deps.streamFunction,
          maxTurns: agentType.maxTurns,
        },
        compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      });

      // Create or resume session (D062: task_id → resume)
      if (args.task_id) {
        const resumed = await childManager.resume({ sessionId: args.task_id });
        if (!resumed) {
          await childManager.create();
        }
      } else {
        await childManager.create();
      }

      const userMessage: Message = {
        role: "user",
        content: args.prompt,
        timestamp: Date.now(),
      };

      const stream = childManager.run(userMessage);

      // Consume stream, forward progress updates, capture final assistant text
      let finalAssistantText = "";
      let turnCount = 0;

      for await (const event of stream) {
        if (event.type === "turn_start") {
          turnCount++;
          ctx.onUpdate?.(`turn ${turnCount}`);
        } else if (event.type === "message_end") {
          const textBlocks = event.message.content.filter((b): b is TextBlock => b.type === "text");
          finalAssistantText = textBlocks.map((b) => b.text).join("\n");
        } else if (event.type === "tool_start") {
          ctx.onUpdate?.(event.toolName);
        } else if (event.type === "error" && event.fatal) {
          await childManager.waitForWrites();
          return {
            output: `<task_result error="true">\nSub-agent failed: ${event.error.message}\n</task_result>`,
            metadata: { error: true },
          };
        }
      }

      await childManager.waitForWrites();

      // D065: Extract session ID from path for <task_result sessionId="...">
      const sessionPath = childManager.sessionPath;
      const sessionId = sessionPath ? basename(sessionPath, ".jsonl") : "";

      return {
        output: `<task_result sessionId="${sessionId}">\n${finalAssistantText}\n</task_result>`,
        metadata: { sessionId },
      };
    },
  };
}
