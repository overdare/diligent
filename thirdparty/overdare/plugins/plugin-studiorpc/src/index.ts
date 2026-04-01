import type { Tool } from "@diligent/plugin-sdk";
import { call } from "./rpc.ts";
import { methodModules, mutatingMethods, renderBuilders } from "./tool-registry.ts";
import { createInstanceDeleteTool } from "./tools/instance-delete-tool.ts";
import { createInstanceMoveTool } from "./tools/instance-move-tool.ts";
import { createInstanceReadTool } from "./tools/instance-read-tool.ts";
import { createInstanceUpsertTool } from "./tools/instance-upsert-tool.ts";

export const manifest = {
  name: "@overdare/plugin-studiorpc",
  apiVersion: "1.0",
  version: "0.1.0",
};

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

export async function createTools(ctx: { cwd: string }): Promise<Tool[]> {
  const tools: Tool[] = [
    createInstanceReadTool(ctx.cwd),
    createInstanceUpsertTool(ctx.cwd),
    createInstanceDeleteTool(ctx.cwd),
    createInstanceMoveTool(ctx.cwd),
  ];

  for (const mod of methodModules) {
    const { method, description, params } = mod;
    const toolName = toToolName(method);

    tools.push({
      name: toolName,
      description,
      parameters: params,
      async execute(args, toolCtx) {
        const rpcMethod = mod.resolveMethod ? mod.resolveMethod(args as Record<string, unknown>) : method;

        const approval = await toolCtx.approve({
          permission: "execute",
          toolName,
          description: `Studio RPC: ${rpcMethod}`,
          details: { method: rpcMethod, params: args },
        });

        if (approval === "reject") {
          return {
            output: "[Rejected by user]",
            metadata: { error: true, method: rpcMethod },
          };
        }

        const normalizedArgs = mod.normalizeArgs
          ? mod.normalizeArgs(args as Record<string, unknown>)
          : (args as Record<string, unknown>);
        const result = await call(rpcMethod, normalizedArgs);
        if (mutatingMethods.has(method)) {
          await call("level.save.file", {});
        }
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        const renderBuilder = renderBuilders[toolName];
        const render = renderBuilder?.({ normalizedArgs, output, result });

        return {
          output,
          render,
          metadata: { method: rpcMethod, result },
        };
      },
    });
  }

  return tools;
}
