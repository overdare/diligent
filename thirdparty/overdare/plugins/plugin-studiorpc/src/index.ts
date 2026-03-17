import type { z } from "zod";
import * as actionSequencerApplyJson from "./methods/action-sequencer-service.apply-json.ts";
import * as assetDrawerImport from "./methods/asset-drawer.import.ts";
import * as assetManagerImageImport from "./methods/asset-manager.image.import.ts";
import * as gamePlay from "./methods/game.play.ts";
import * as gameStop from "./methods/game.stop.ts";
import * as instanceAdd from "./methods/instance.add.ts";
import * as instanceDelete from "./methods/instance.delete.ts";
// ── Method modules ────────────────────────────────────────────────────────────
import * as levelBrowse from "./methods/level.browse.ts";
import * as scriptAdd from "./methods/script.add.ts";
import * as scriptDelete from "./methods/script.delete.ts";
import {
  buildActionSequencerApplyJsonRender,
  buildAssetDrawerImportRender,
  buildAssetManagerImageImportRender,
  buildDeleteRender,
  buildGamePlayRender,
  buildGameStopRender,
  buildInstanceAddRender,
  buildLevelBrowseRender,
  buildScriptAddRender,
} from "./render.ts";
import { call } from "./rpc.ts";

type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onUpdate?: (partialResult: string) => void;
}

interface ApprovalRequest {
  permission: "read" | "write" | "execute";
  toolName: string;
  description: string;
  details?: Record<string, unknown>;
}

type ApprovalResponse = "once" | "always" | "reject";

interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;
}

interface MethodModule {
  method: string;
  description: string;
  params: z.ZodType;
  resolveMethod?: (args: Record<string, unknown>) => string;
  normalizeArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

export const manifest = {
  name: "@overdare/plugin-studiorpc",
  apiVersion: "1.0",
  version: "0.1.0",
};

// ── Tool factory ──────────────────────────────────────────────────────────────

const methodModules: MethodModule[] = [
  assetDrawerImport,
  assetManagerImageImport,
  actionSequencerApplyJson,
  levelBrowse,
  scriptAdd,
  scriptDelete,
  instanceDelete,
  instanceAdd,
  gamePlay,
  gameStop,
];

/**
 * Build the tool name from an RPC method string.
 * "level.browse"        → "studiorpc_level_browse"
 * "instance.part.add"  → "studiorpc_instance_part_add"
 */
function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

export async function createTools(_ctx: { cwd: string }): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const mod of methodModules) {
    const { method, description, params } = mod;

    const toolName = toToolName(method);

    tools.push({
      name: toolName,
      description,
      parameters: params,
      async execute(args, ctx) {
        const rpcMethod = mod.resolveMethod ? mod.resolveMethod(args as Record<string, unknown>) : method;

        const approval = await ctx.approve({
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
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        const render =
          toolName === "studiorpc_asset_drawer_import"
            ? buildAssetDrawerImportRender(normalizedArgs, output)
            : toolName === "studiorpc_asset_manager_image_import"
              ? buildAssetManagerImageImportRender(result, normalizedArgs, output)
              : toolName === "studiorpc_action_sequencer_service_apply_json"
                ? buildActionSequencerApplyJsonRender(normalizedArgs, output)
                : toolName === "studiorpc_level_browse"
                  ? buildLevelBrowseRender(result)
                  : toolName === "studiorpc_script_add"
                    ? buildScriptAddRender(normalizedArgs, output)
                    : toolName === "studiorpc_script_delete"
                      ? buildDeleteRender("Studio script delete", String(normalizedArgs.targetGuid ?? ""), output)
                      : toolName === "studiorpc_instance_delete"
                        ? buildDeleteRender("Studio instance delete", String(normalizedArgs.targetGuid ?? ""), output)
                        : toolName === "studiorpc_instance_add"
                          ? buildInstanceAddRender(normalizedArgs, output)
                          : toolName === "studiorpc_game_play"
                            ? buildGamePlayRender(normalizedArgs, output)
                            : toolName === "studiorpc_game_stop"
                              ? buildGameStopRender(output)
                              : undefined;

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
