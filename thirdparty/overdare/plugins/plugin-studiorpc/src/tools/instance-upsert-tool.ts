// @summary Applies batched add or update instance changes to the level file.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as instanceUpsert from "../methods/instance.upsert.ts";
import { call } from "../rpc.ts";
import type { Tool, ToolContext, ToolResult } from "../tool-types.ts";

type OvdrjmNode = Record<string, unknown> & {
  ActorGuid?: unknown;
  LuaChildren?: unknown;
};

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

function findFilesByExtension(cwd: string, extension: string): string[] {
  const entries = readdirSync(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => join(cwd, entry.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findNodeByActorGuid(node: OvdrjmNode, targetGuid: string): OvdrjmNode | undefined {
  if (typeof node.ActorGuid === "string" && node.ActorGuid === targetGuid) {
    return node;
  }
  if (!Array.isArray(node.LuaChildren)) {
    return undefined;
  }
  for (const child of node.LuaChildren) {
    if (!isRecord(child)) continue;
    const found = findNodeByActorGuid(child as OvdrjmNode, targetGuid);
    if (found) return found;
  }
  return undefined;
}

function resolveOvdrjmPathFromUmap(cwd: string): { umapPath: string; ovdrjmPath: string } {
  const umapFiles = findFilesByExtension(cwd, ".umap");
  if (umapFiles.length === 0) {
    throw new Error("No .umap file found in current working directory.");
  }
  if (umapFiles.length > 1) {
    throw new Error(
      `Multiple .umap files found (${umapFiles.map((file) => file.split("/").pop()).join(", ")}). Keep one world file in cwd.`,
    );
  }

  const umapPath = umapFiles[0];
  const ovdrjmPath = umapPath.replace(/\.umap$/i, ".ovdrjm");

  const ovdrjmFiles = findFilesByExtension(cwd, ".ovdrjm");
  if (!ovdrjmFiles.includes(ovdrjmPath)) {
    throw new Error(
      `Matching .ovdrjm file not found for ${umapPath.split("/").pop()}. Expected ${ovdrjmPath.split("/").pop()}.`,
    );
  }

  return { umapPath, ovdrjmPath };
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
  const parsedArgs = instanceUpsert.normalizeArgsToBatch(instanceUpsert.parseArgs(args));

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

  let fileResult: { umapPath: string; ovdrjmPath: string; changedGuids: string[] };
  if (parsedArgs.mode === "update") {
    fileResult = applyLevelChangesByFileEdit({
      cwd,
      update: (rootDoc) => {
        const root = rootDoc.Root;
        if (!isRecord(root)) {
          throw new Error("Invalid .ovdrjm format: Root object is missing.");
        }

        for (const item of parsedArgs.items) {
          const target = findNodeByActorGuid(root as OvdrjmNode, item.guid);
          if (!target) {
            throw new Error(`ActorGuid not found in .ovdrjm: ${item.guid}`);
          }
          Object.assign(target, item.properties);
        }

        return { guids: parsedArgs.items.map((item) => item.guid) };
      },
    });
  } else {
    fileResult = applyLevelChangesByFileEdit({
      cwd,
      update: (rootDoc) => {
        const root = rootDoc.Root;
        if (!isRecord(root)) {
          throw new Error("Invalid .ovdrjm format: Root object is missing.");
        }

        const createdGuids: string[] = [];
        for (const item of parsedArgs.items) {
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
            ...item.properties,
          };
          childList.push(newNode);
          createdGuids.push(newGuid);
        }

        return { guids: createdGuids };
      },
    });
  }

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
      mode: parsedArgs.mode,
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
