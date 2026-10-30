// @summary Code mode tools (exec, exec_wait) and the model-facing tool assembly for tools.codeMode

import type { Tool, ToolOutputFileStore, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { createToolEndRenderPayloadFromInput } from "../render-strategies";
import { TOOL_CAPABILITIES } from "../tool-metadata";
import {
  buildExecDescription,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_YIELD_TIME_MS,
  EXEC_TOOL_NAME,
  EXEC_WAIT_DESCRIPTION,
  EXEC_WAIT_TOOL_NAME,
  toCodeModeIdentifier,
} from "./description";
import type { ToolGate } from "./gate";
import type { CodeModeCellSnapshot, CodeModeSession, CodeModeToolBinding } from "./session";

export type CodeMode = "off" | "on" | "only";

/** Approximate bytes per token for the output budget, matching the provider-agnostic estimate elsewhere. */
const BYTES_PER_TOKEN = 4;

const ExecParams = z.object({
  code: z.string().min(1).describe("Raw JavaScript source, run as the body of an async function. No markdown fences."),
  yield_time_ms: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(`Return early while the script keeps running after this many ms. Defaults to ${DEFAULT_YIELD_TIME_MS}.`),
  max_output_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Token budget for the returned output. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS}.`),
});

const ExecWaitParams = z.object({
  cell_id: z.string().describe("Identifier of the running exec cell."),
  yield_time_ms: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(`Wait before yielding more output. Defaults to ${DEFAULT_YIELD_TIME_MS} ms.`),
  max_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Output token budget for this wait call. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS} tokens.`),
  terminate: z.boolean().optional().describe("True stops the running exec cell; false or omitted waits for output."),
});

/** Result metadata key carrying nested call records; history rebuilds nested tool items from it. */
export const CODE_MODE_METADATA_KEY = "codeMode";

export interface CodeModeResultMetadata {
  cellId: string;
  status: CodeModeCellSnapshot["status"];
  nestedCalls: CodeModeCellSnapshot["nestedCalls"];
}

export interface CodeModeAssemblyOptions {
  codeMode: CodeMode;
  session: CodeModeSession;
  outputStore?: ToolOutputFileStore;
}

/**
 * Applies `tools.codeMode` to the agent's final tool list.
 * - `off`: unchanged.
 * - `on`: every tool stays direct; `exec`/`exec_wait` are added and can call the nested-eligible tools.
 * - `only`: nested-eligible tools are hidden from the model and reachable only through `exec`.
 * Tools flagged `codeModeDirect` and provider-native tools (`modelExposure`) are never nested.
 */
export function applyCodeMode(tools: Tool[], options: CodeModeAssemblyOptions): Tool[] {
  if (options.codeMode === "off") return tools;
  const isNested = (tool: Tool) => !tool.modelExposure && !TOOL_CAPABILITIES[tool.name]?.codeModeDirect;
  const nestedTools = tools.filter(isNested);
  const registry = new Map(nestedTools.map((tool) => [tool.name, tool]));
  const bindings = bindNestedTools(nestedTools);
  // A yielded cell keeps running nested calls while the model issues direct calls; direct calls of the
  // same tools take the session gate so non-parallel tools never overlap across both paths.
  const direct = tools
    .filter(
      (tool) =>
        tool.name !== EXEC_TOOL_NAME &&
        tool.name !== EXEC_WAIT_TOOL_NAME &&
        (options.codeMode === "on" || !isNested(tool)),
    )
    .map((tool) => (isNested(tool) ? gateDirectTool(tool, options.session.gate) : tool));
  const exec: Tool<typeof ExecParams> = {
    name: EXEC_TOOL_NAME,
    description: buildExecDescription(options.codeMode, nestedTools),
    parameters: ExecParams,
    async execute(args, ctx) {
      const snapshot = await options.session.exec(
        args.code,
        bindings,
        { ctx, registry, outputStore: options.outputStore },
        args.yield_time_ms ?? DEFAULT_YIELD_TIME_MS,
      );
      return toToolResult(snapshot, args.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS, EXEC_TOOL_NAME, args);
    },
  };

  const execWait: Tool<typeof ExecWaitParams> = {
    name: EXEC_WAIT_TOOL_NAME,
    description: EXEC_WAIT_DESCRIPTION,
    parameters: ExecWaitParams,
    async execute(args, ctx) {
      const driver = { ctx, registry, outputStore: options.outputStore };
      const snapshot = await options.session.wait(args.cell_id, driver, {
        yieldTimeMs: args.yield_time_ms ?? DEFAULT_YIELD_TIME_MS,
        terminate: args.terminate === true,
      });
      if (!snapshot) {
        return { output: `Unknown or finished exec cell ID ${args.cell_id}`, metadata: { error: true } };
      }
      return toToolResult(snapshot, args.max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS, EXEC_WAIT_TOOL_NAME, args);
    },
  };

  return [...direct, exec, execWait];
}

function gateDirectTool(tool: Tool, gate: ToolGate): Tool {
  return {
    ...tool,
    async execute(args, ctx) {
      const release = await gate.acquire(tool.supportParallel === true, ctx.signal);
      try {
        return await tool.execute(args, ctx);
      } finally {
        release();
      }
    },
  };
}

/** Maps catalog names to guest identifiers; the first tool wins when two names normalize identically. */
function bindNestedTools(tools: Tool[]): CodeModeToolBinding[] {
  const bindings = new Map<string, CodeModeToolBinding>();
  for (const tool of tools) {
    const globalName = toCodeModeIdentifier(tool.name);
    if (!bindings.has(globalName))
      bindings.set(globalName, { globalName, name: tool.name, description: tool.description });
  }
  return [...bindings.values()];
}

function toToolResult(
  snapshot: CodeModeCellSnapshot,
  maxOutputTokens: number,
  toolName: string,
  input: unknown,
): ToolResult {
  const status = {
    running: `Script running with cell ID ${snapshot.cellId}`,
    completed: "Script completed",
    failed: "Script failed",
    terminated: "Script terminated",
  }[snapshot.status];
  const lines = [status, ...snapshot.texts];
  if (snapshot.error !== undefined) lines.push(`Script error:\n${snapshot.error}`);
  const metadata: CodeModeResultMetadata = {
    cellId: snapshot.cellId,
    status: snapshot.status,
    nestedCalls: snapshot.nestedCalls,
  };
  const output = lines.join("\n");
  const isError = snapshot.status === "failed";
  return {
    output,
    ...(snapshot.images.length > 0 ? { outputImages: snapshot.images } : {}),
    render: createToolEndRenderPayloadFromInput({ toolName, input, output, isError }),
    metadata: { [CODE_MODE_METADATA_KEY]: metadata, ...(isError ? { error: true } : {}) },
    truncateDirection: "head_tail",
    maxOutputBytes: maxOutputTokens * BYTES_PER_TOKEN,
  };
}
