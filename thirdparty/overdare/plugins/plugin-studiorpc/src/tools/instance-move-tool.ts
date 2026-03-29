// @summary Moves instances to a new parent in the level file.
import type { Tool, ToolContext, ToolResult } from "@diligent/plugin-sdk";
import * as instanceMove from "../methods/instance.move.ts";
import { serviceClassEnum } from "../methods/instance.params.ts";
import { call } from "../rpc.ts";
import {
  findNodeByActorGuid,
  isRecord,
  type OvdrjmNode,
  readAndWriteOvdrjm,
  removeNodeByActorGuid,
} from "./ovdrjm-utils.ts";

const serviceClasses = new Set<string>(serviceClassEnum.options);

async function executeInstanceMove(args: Record<string, unknown>, ctx: ToolContext, cwd: string): Promise<ToolResult> {
  const toolName = "studiorpc_instance_move";
  const parsedArgs = instanceMove.parseArgs(args);

  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs,
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.move" },
    };
  }

  const fileResult = readAndWriteOvdrjm(cwd, (rootDoc) => {
    const root = rootDoc.Root;
    if (!isRecord(root)) {
      throw new Error("Invalid .ovdrjm format: Root object is missing.");
    }

    const movedGuids: string[] = [];
    for (const item of parsedArgs.items) {
      const target = findNodeByActorGuid(root as OvdrjmNode, item.guid);
      if (!target) {
        throw new Error(`ActorGuid not found in .ovdrjm: ${item.guid}`);
      }
      const instanceType = typeof target.InstanceType === "string" ? target.InstanceType : undefined;
      if (instanceType && serviceClasses.has(instanceType)) {
        throw new Error(`"${instanceType}" is a Service — it cannot be moved.`);
      }

      const newParent = findNodeByActorGuid(root as OvdrjmNode, item.parentGuid);
      if (!newParent) {
        throw new Error(`New parent ActorGuid not found in .ovdrjm: ${item.parentGuid}`);
      }

      const removed = removeNodeByActorGuid(root as OvdrjmNode, item.guid);
      if (!removed) {
        throw new Error(`Failed to detach ActorGuid from .ovdrjm: ${item.guid}`);
      }

      const childList = Array.isArray(newParent.LuaChildren) ? newParent.LuaChildren : [];
      newParent.LuaChildren = childList;
      childList.push(target);
      movedGuids.push(item.guid);
    }

    return { added: movedGuids.map((g) => ({ guid: g, name: "", class: "" })) };
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
    metadata: {
      method: "instance.move",
      umapPath: fileResult.umapPath,
      ovdrjmPath: fileResult.ovdrjmPath,
      targetGuids: fileResult.added.map((a) => a.guid),
      moveCount: parsedArgs.items.length,
      levelApplyResult: result,
    },
  };
}

export function createInstanceMoveTool(cwd: string): Tool {
  return {
    name: "studiorpc_instance_move",
    description: instanceMove.description,
    parameters: instanceMove.params,
    async execute(args, ctx) {
      return executeInstanceMove(args, ctx, cwd);
    },
  };
}
