// @summary Runs an Editor command and saves its changes, retaining phase-specific failure diagnostics.
import * as executeLuau from "../methods/execute.luau";
import { type call, StudioRpcError } from "../rpc";
import type { Tool, ToolResult } from "../types";
import type { WriteLock } from "../write-lock";

const TOOL_NAME = "studiorpc_execute_luau";

function failureResult(error: unknown, phase: "execute" | "save"): ToolResult {
  const data = error instanceof StudioRpcError ? error.data : undefined;
  const lines = [
    `Error: ${error instanceof Error ? error.message : String(error)}`,
    phase === "save"
      ? "Editor execution succeeded, but saving the level failed."
      : "Editor execution failed; partial world changes may remain.",
  ];
  if (data !== undefined) {
    lines.push(JSON.stringify(data, null, 2));
  } else if (phase === "execute") {
    lines.push("Mutation outcome is unknown.");
  }
  lines.push("Do not automatically retry. Inspect the current world and Undo status before deciding how to recover.");
  return {
    output: lines.join("\n"),
    metadata: {
      error: true,
      method: executeLuau.method,
      code: error instanceof StudioRpcError ? error.code : undefined,
      data,
      executionSucceeded: phase === "save",
    },
  };
}

export function createExecuteLuauTool(callRpc: typeof call, writeLock: WriteLock): Tool {
  return {
    name: TOOL_NAME,
    description: executeLuau.description,
    parameters: executeLuau.params,
    async execute(args, ctx) {
      const parsed = executeLuau.params.parse(args);
      const approval = await ctx.approve({
        permission: "execute",
        toolName: TOOL_NAME,
        description: `Studio RPC: ${executeLuau.method}`,
        details: { method: executeLuau.method, params: parsed },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, method: executeLuau.method } };
      }

      const release = await writeLock.acquire();
      try {
        let result: unknown;
        try {
          result = await callRpc(executeLuau.method, parsed, { signal: ctx.signal });
        } catch (error) {
          return failureResult(error, "execute");
        }
        try {
          await callRpc("level.save.file", {}, { signal: ctx.signal });
        } catch (error) {
          return failureResult(error, "save");
        }
        return {
          output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          metadata: { method: executeLuau.method, result },
        };
      } finally {
        release();
      }
    },
  };
}
