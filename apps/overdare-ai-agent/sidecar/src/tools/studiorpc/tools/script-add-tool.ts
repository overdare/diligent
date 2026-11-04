// @summary Adds a script instance to the Editor level.

import * as scriptAdd from "../methods/script.add";
import type { Tool, ToolContext, ToolResult } from "../types";
import type { WriteLock } from "../write-lock";
import type { InstanceClient } from "./instance-rpc/client";
import { addScriptViaRpc } from "./instance-rpc/script-add";

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

async function executeScriptAdd(
  args: Record<string, unknown>,
  ctx: ToolContext,
  client: InstanceClient,
  writeLock: WriteLock,
): Promise<ToolResult> {
  const toolName = toToolName(scriptAdd.method);
  const parsed = scriptAdd.params.parse(args);

  const approval = await ctx.approve({
    permission: "write",
    toolName,
    description: `Add ${parsed.class} "${parsed.name}" under ${parsed.parentGuid}`,
    details: parsed,
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  const release = await writeLock.acquire();
  try {
    return await addScriptViaRpc(client, parsed);
  } catch (err) {
    return {
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { error: true },
    };
  } finally {
    release();
  }
}

export function createScriptAddTool(client: InstanceClient, writeLock: WriteLock): Tool {
  return {
    name: toToolName(scriptAdd.method),
    description: scriptAdd.description,
    parameters: scriptAdd.params,
    async execute(args, ctx) {
      return executeScriptAdd(args, ctx, client, writeLock);
    },
  };
}
