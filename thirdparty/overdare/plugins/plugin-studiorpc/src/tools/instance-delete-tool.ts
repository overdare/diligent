// @summary Applies batched instance deletions to the level file.
import type { Tool, ToolContext, ToolResult } from "@diligent/plugin-sdk";
import * as instanceDelete from "../methods/instance.delete.ts";
import { serviceClassEnum } from "../methods/instance.params.ts";
import { buildInstanceDeleteRender } from "../render.ts";
import { call } from "../rpc.ts";
import {
  findNodeByActorGuid,
  isRecord,
  type OvdrjmNode,
  readAndWriteOvdrjm,
  removeNodeByActorGuid,
} from "./ovdrjm-utils.ts";

const serviceClasses = new Set<string>(serviceClassEnum.options);

async function executeInstanceDelete(
  args: Record<string, unknown>,
  ctx: ToolContext,
  cwd: string,
): Promise<ToolResult> {
  const toolName = "studiorpc_instance_delete";
  const parsedArgs = instanceDelete.parseArgs(args);

  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs,
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.delete" },
    };
  }

  const fileResult = readAndWriteOvdrjm(cwd, (rootDoc) => {
    const root = rootDoc.Root;
    if (!isRecord(root)) {
      throw new Error("Invalid .ovdrjm format: Root object is missing.");
    }

    const deletedGuids: string[] = [];
    for (const item of parsedArgs.items) {
      const target = findNodeByActorGuid(root as OvdrjmNode, item.targetGuid);
      if (!target) {
        throw new Error(`ActorGuid not found in .ovdrjm: ${item.targetGuid}`);
      }
      const instanceType = typeof target.InstanceType === "string" ? target.InstanceType : undefined;
      if (instanceType && serviceClasses.has(instanceType)) {
        throw new Error(`"${instanceType}" is a Service — it cannot be deleted.`);
      }
      const removed = removeNodeByActorGuid(root as OvdrjmNode, item.targetGuid);
      if (!removed) {
        throw new Error(`Failed to remove ActorGuid from .ovdrjm: ${item.targetGuid}`);
      }
      deletedGuids.push(item.targetGuid);
    }

    return { guids: deletedGuids };
  });

  const executeApproval = await ctx.approve({
    permission: "execute",
    toolName,
    description: "Studio RPC: level.apply",
    details: { method: "level.apply", params: {} },
  });
  if (executeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "level.apply" },
    };
  }

  const result = await call("level.apply", {});
  await call("level.save.file", {});
  const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return {
    output,
    render: buildInstanceDeleteRender(parsedArgs as unknown as Record<string, unknown>, output),
    metadata: {
      method: "instance.delete",
      umapPath: fileResult.umapPath,
      ovdrjmPath: fileResult.ovdrjmPath,
      targetGuids: fileResult.changedGuids,
      deleteCount: parsedArgs.items.length,
      levelApplyResult: result,
    },
  };
}

export function createInstanceDeleteTool(cwd: string): Tool {
  return {
    name: "studiorpc_instance_delete",
    description: instanceDelete.description,
    parameters: instanceDelete.params,
    async execute(args, ctx) {
      return executeInstanceDelete(args, ctx, cwd);
    },
  };
}
