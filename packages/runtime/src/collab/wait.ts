// @summary wait tool — block until specified agents finish or timeout, returning final statuses or progress

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { type AgentProgress, formatAgentProgress } from "./progress";
import type { AgentRegistry } from "./registry";
import type { AgentStatus } from "./types";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MIN_TIMEOUT_MS = 1 * 60 * 1000; // 1 minute
const MAX_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

const WaitParams = z.object({
  ids: z.array(z.string()).min(1).describe("Thread IDs of agents to wait for"),
  timeout_ms: z
    .number()
    .optional()
    .describe(`Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, min ${MIN_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
});

function summarizeStatus(status: AgentStatus, nickname: string, progress: AgentProgress | undefined): string {
  switch (status.kind) {
    case "completed": {
      const preview = status.output ? status.output.split("\n")[0] : "(no output)";
      return `${nickname}: Completed — ${preview}`;
    }
    case "errored":
      return `${nickname}: Error — ${status.error}`;
    case "running":
      return progress ? `${nickname}: Still running — ${formatAgentProgress(progress)}` : `${nickname}: Still running`;
    case "pending":
      return `${nickname}: Pending`;
    case "shutdown":
      return `${nickname}: Shutdown`;
  }
}

export function createWaitTool(registry: AgentRegistry): Tool<typeof WaitParams> {
  return {
    name: "wait",
    description:
      "Wait for spawned agents to finish. Returns their final status and output. " +
      "Blocks until all specified agents complete or timeout expires. " +
      "On timeout, each still-running agent reports progress: turns, tool calls, the current or last tool, " +
      "and its last message.",
    parameters: WaitParams,
    execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
      const timeoutMs = Math.min(Math.max(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);

      const onUpdate = (summary: string) => ctx.onUpdate?.(summary);

      const { status, timedOut } = await registry.wait(args.ids, timeoutMs, onUpdate, ctx.signal);

      // Build human-readable summary
      const lines: string[] = [];
      const progressById: Record<string, AgentProgress> = {};
      for (const id of args.ids) {
        const s = status[id]!;
        const nickname = registry.getNickname(id) ?? id;
        const progress = s.kind === "running" ? registry.getProgress(id) : undefined;
        if (progress) progressById[id] = progress;
        lines.push(summarizeStatus(s, nickname, progress));
      }

      const output = JSON.stringify({
        status,
        timed_out: timedOut,
        ...(Object.keys(progressById).length > 0 ? { progress: progressById } : {}),
        summary: lines,
      });

      return { output };
    },
  };
}
