// @summary Deletes a script instance from the Editor level.

import * as scriptDelete from "../methods/script.delete";
import type { Tool, ToolContext, ToolResult } from "../types";
import type { WriteLock } from "../write-lock";
import type { InstanceClient } from "./instance-rpc/client";
import { deleteScriptViaRpc } from "./instance-rpc/script-delete";

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

async function executeScriptDelete(
  args: Record<string, unknown>,
  ctx: ToolContext,
  client: InstanceClient,
  writeLock: WriteLock,
): Promise<ToolResult> {
  const toolName = toToolName(scriptDelete.method);
  const parsed = scriptDelete.params.parse(args);

  const approval = await ctx.approve({
    permission: "write",
    toolName,
    description: `Delete script ${parsed.guid}`,
    details: parsed,
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  const release = await writeLock.acquire();
  try {
    return await deleteScriptViaRpc(client, parsed);
  } catch (err) {
    return {
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { error: true },
    };
  } finally {
    release();
  }
}

export function createScriptDeleteTool(client: InstanceClient, writeLock: WriteLock): Tool {
  return {
    name: toToolName(scriptDelete.method),
    description: scriptDelete.description,
    parameters: scriptDelete.params,
    async execute(args, ctx) {
      return executeScriptDelete(args, ctx, client, writeLock);
    },
  };
}
