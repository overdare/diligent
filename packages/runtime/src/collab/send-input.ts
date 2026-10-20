// @summary send_input tool — inject a steering message into a running sub-agent, optionally interrupting its tools

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import type { AgentRegistry } from "./registry";
import { isFinal } from "./types";

const SendInputParams = z.object({
  id: z.string().describe("Thread ID of the agent to send input to"),
  message: z.string().describe("Steering message to inject into the running agent"),
  interrupt: z
    .boolean()
    .optional()
    .describe(
      "True aborts the agent's running tool calls so it reads the message right away; the aborted calls return an aborted result. Default false: the message is read after the current tool calls finish.",
    ),
});

export function createSendInputTool(registry: AgentRegistry): Tool<typeof SendInputParams> {
  return {
    name: "send_input",
    description:
      "Send a steering message to a running sub-agent. By default the agent reads it after its current tool calls finish; " +
      "set interrupt to abort those calls and deliver it immediately. " +
      "A finished agent cannot receive input: continue it with spawn_agent and resume_id instead.",
    parameters: SendInputParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const nickname = registry.getNickname(args.id) ?? args.id;
      const status = registry.getStatus(args.id);
      if (isFinal(status)) {
        return {
          output: JSON.stringify({
            ok: false,
            nickname,
            status: status.kind,
            error: `${nickname} is not running (${status.kind}) and cannot receive input.`,
            resume_with: { tool: "spawn_agent", resume_id: args.id, message: args.message },
          }),
          metadata: { error: true },
        };
      }
      await registry.sendInput(args.id, args.message, { interrupt: args.interrupt === true });
      return {
        output: JSON.stringify({
          ok: true,
          nickname,
          message: args.message,
          ...(args.interrupt ? { interrupt_requested: true } : {}),
        }),
      };
    },
  };
}
