// @summary Applies batched add or update instance changes to the level file.
import { readFileSync, writeFileSync } from "node:fs";
import type { Tool, ToolContext, ToolResult } from "@diligent/plugin-sdk";
import * as instanceUpsert from "../methods/instance.upsert.ts";
import { call } from "../rpc.ts";
import { findNodeByActorGuid, isRecord, type OvdrjmNode, resolveOvdrjmPathFromUmap } from "./ovdrjm-utils.ts";

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

function makeActorGuid(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16)
      .toString(16)
      .toUpperCase(),
  ).join("");
}

function nextObjectKey(rootDoc: Record<string, unknown>): number {
  const current = rootDoc.MapObjectKeyIndex;
  const numeric = typeof current === "number" && Number.isFinite(current) ? Math.floor(current) : 0;
  const next = numeric + 1;
  rootDoc.MapObjectKeyIndex = next;
  return next;
}

function applyLevelChangesByFileEdit(params: {
  cwd: string;
  update: (rootDoc: Record<string, unknown>) => { guids: string[] };
}): { umapPath: string; ovdrjmPath: string; changedGuids: string[] } {
  const { umapPath, ovdrjmPath } = resolveOvdrjmPathFromUmap(params.cwd);
  const raw = readFileSync(ovdrjmPath, "utf-8");
  const parsedJson = JSON.parse(raw) as Record<string, unknown>;
  const outcome = params.update(parsedJson);
  writeFileSync(ovdrjmPath, `${JSON.stringify(parsedJson, null, 2)}\n`, "utf-8");
  return {
    umapPath,
    ovdrjmPath,
    changedGuids: outcome.guids,
  };
}

async function executeInstanceUpsert(
  args: Record<string, unknown>,
  ctx: ToolContext,
  cwd: string,
): Promise<ToolResult> {
  const toolName = "studiorpc_instance_upsert";
  const parsedArgs = instanceUpsert.parseArgs(args);

  const writeApproval = await ctx.approve({
    permission: "write",
    toolName,
    description: "Update .ovdrjm world file",
    details: parsedArgs,
  });
  if (writeApproval === "reject") {
    return {
      output: "[Rejected by user]",
      metadata: { error: true, method: "instance.upsert" },
    };
  }

  const fileResult = applyLevelChangesByFileEdit({
    cwd,
    update: (rootDoc) => {
      const root = rootDoc.Root;
      if (!isRecord(root)) {
        throw new Error("Invalid .ovdrjm format: Root object is missing.");
      }

      const changedGuids: string[] = [];
      for (const item of parsedArgs.items) {
        if (instanceUpsert.isUpdateItem(item)) {
          const target = findNodeByActorGuid(root as OvdrjmNode, item.guid);
          if (!target) {
            throw new Error(`ActorGuid not found in .ovdrjm: ${item.guid}`);
          }
          Object.assign(target, item.properties);
          if (typeof item.name === "string") {
            target.Name = item.name;
          }
          changedGuids.push(item.guid);
          continue;
        }

        const parent = findNodeByActorGuid(root as OvdrjmNode, item.parentGuid);
        if (!parent) {
          throw new Error(`Parent ActorGuid not found in .ovdrjm: ${item.parentGuid}`);
        }

        const childList = Array.isArray(parent.LuaChildren) ? parent.LuaChildren : [];
        parent.LuaChildren = childList;

        const newGuid = makeActorGuid();
        const newNode: Record<string, unknown> = {
          InstanceType: item.class,
          ActorGuid: newGuid,
          ObjectKey: nextObjectKey(rootDoc),
          Name: item.name,
          ...(item.properties as Record<string, unknown>),
        };
        childList.push(newNode);
        changedGuids.push(newGuid);
      }

      return { guids: changedGuids };
    },
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
  const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  return {
    output,
    metadata: {
      method: "instance.upsert",
      umapPath: fileResult.umapPath,
      ovdrjmPath: fileResult.ovdrjmPath,
      targetGuids: fileResult.changedGuids,
      addCount: parsedArgs.items.filter((item) => !instanceUpsert.isUpdateItem(item)).length,
      updateCount: parsedArgs.items.filter((item) => instanceUpsert.isUpdateItem(item)).length,
      levelApplyResult: result,
    },
  };
}

export function createInstanceUpsertTool(cwd: string): Tool {
  return {
    name: toToolName(instanceUpsert.method),
    description: instanceUpsert.description,
    parameters: instanceUpsert.params,
    async execute(args, ctx) {
      return executeInstanceUpsert(args, ctx, cwd);
    },
  };
}
