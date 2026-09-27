// @summary Applies a normalized temporary ActionSequence JSON file without changing the author's source.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as applyJson from "../methods/action-sequencer-service.apply-json";
import { buildActionSequencerApplyJsonRender } from "../render";
import { type call, StudioRpcError } from "../rpc";
import type { Tool } from "../types";
import type { WriteLock } from "../write-lock";
import { normalizeActionSequenceJson } from "./action-sequence-json";

const TOOL_NAME = "studiorpc_action_sequencer_service_apply_json";

export function createActionSequencerApplyJsonTool(callRpc: typeof call, writeLock: WriteLock): Tool {
  return {
    name: TOOL_NAME,
    description: applyJson.description,
    parameters: applyJson.params,
    async execute(args, ctx) {
      const parsed = applyJson.params.parse(args);
      const approval = await ctx.approve({
        permission: "execute",
        toolName: TOOL_NAME,
        description: `Studio RPC: ${applyJson.method}`,
        details: { method: applyJson.method, params: parsed },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, method: applyJson.method } };
      }
      ctx.signal.throwIfAborted();
      const release = await writeLock.acquire();
      let temporaryDir: string | undefined;
      try {
        ctx.signal.throwIfAborted();
        const json = normalizeActionSequenceJson(readFileSync(parsed.jsonFilePath, "utf8"));
        temporaryDir = mkdtempSync(join(tmpdir(), "overdare-action-sequence-"));
        const jsonFilePath = join(temporaryDir, "sequence.json");
        writeFileSync(jsonFilePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
        let result: unknown;
        try {
          result = await callRpc(applyJson.method, { ...parsed, jsonFilePath }, { signal: ctx.signal });
        } catch (error) {
          if (
            error instanceof StudioRpcError &&
            error.code === -32005 &&
            error.message.includes("Invalid ActionSequence JSON structure")
          ) {
            throw new StudioRpcError(
              `${error.message}\n\nCommon fields were validated and compatibility fields filled. ` +
                "Studio also rejects missing properties logged as optional warnings. " +
                "Inspect [IsValidActionSequenceJson] entries in the active Studio's Sandbox.log " +
                "(typically %LOCALAPPDATA%\\Sandbox\\Saved\\Logs\\Sandbox.log) for the exact track and property. " +
                "Compare class-specific properties with JSON saved by the current Studio version.",
              error.code,
              error.data,
            );
          }
          throw error;
        }
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return {
          output,
          render: buildActionSequencerApplyJsonRender(parsed, output),
          metadata: { method: applyJson.method, result },
        };
      } finally {
        try {
          if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true });
        } finally {
          release();
        }
      }
    },
  };
}
