// @summary Reads instance properties through Studio, preserving Studio JSON properties without a class whitelist.

import * as instanceRead from "../methods/instance.read";
import { pickInstanceProperties } from "../methods/instance-properties";
import type { Tool, ToolResult } from "../types";
import type { InstanceClient } from "./instance-rpc/client";
import { readInstanceViaRpc } from "./instance-rpc/instance-read";
import { isRecord, type OvdrjmNode } from "./ovdrjm-utils";

type ReadableNode = {
  guid: string;
  name: string;
  class: string;
  properties: Record<string, unknown>;
  children?: ReadableNode[];
};

function toReadableNode(node: OvdrjmNode, recursive: boolean): ReadableNode | undefined {
  const instanceType = typeof node.InstanceType === "string" ? node.InstanceType : undefined;
  if (!instanceType) return undefined;

  const result: ReadableNode = {
    guid: typeof node.ActorGuid === "string" ? node.ActorGuid : "",
    name: typeof node.Name === "string" ? node.Name : "",
    class: instanceType,
    properties: pickInstanceProperties(node),
  };

  if (recursive && Array.isArray(node.LuaChildren)) {
    const children: ReadableNode[] = [];
    for (const child of node.LuaChildren) {
      if (!isRecord(child)) continue;
      const readable = toReadableNode(child as OvdrjmNode, true);
      if (readable) children.push(readable);
    }
    if (children.length > 0) result.children = children;
  }

  return result;
}

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

async function executeInstanceRead(client: InstanceClient, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = instanceRead.params.parse(instanceRead.normalizeArgs(args));
  if (!parsed.guid) {
    throw new Error(
      "studiorpc_instance_read needs a guid — it reads one instance from the Editor level and has no " +
        "listing mode. To list the running game's instances, call studiorpc_game_observe with " +
        "{ instances: true }; that is the live counterpart and the one with the listing.",
    );
  }
  return await readInstanceViaRpc(client, { ...parsed, guid: parsed.guid });
}

export function createInstanceReadTool(client: InstanceClient): Tool {
  return {
    name: toToolName(instanceRead.method),
    description: instanceRead.description,
    parameters: instanceRead.params,
    async execute(args) {
      return executeInstanceRead(client, args);
    },
  };
}

export { toReadableNode };
