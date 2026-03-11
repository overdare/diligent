// @summary Executes tool calls with parameter validation and auto-truncation
import { ToolRenderPayloadSchema } from "@diligent/protocol";
import type { ToolCallBlock } from "../types";
import {
  persistFullOutput,
  shouldTruncate,
  TRUNCATION_WARNING,
  truncateHead,
  truncateHeadTail,
  truncateTail,
} from "./truncation";
import type { ToolContext, ToolRegistry, ToolResult } from "./types";

export async function executeTool(
  registry: ToolRegistry,
  toolCall: ToolCallBlock,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(toolCall.name);
  if (!tool) {
    return { output: `Error: Unknown tool "${toolCall.name}"`, metadata: { error: true } };
  }

  const parsed = tool.parameters.safeParse(toolCall.input);
  if (!parsed.success) {
    return {
      output: `Error: Invalid arguments for "${toolCall.name}":\n${parsed.error.format()._errors.join("\n")}`,
      metadata: { error: true },
    };
  }

  let result: ToolResult;
  try {
    result = await tool.execute(parsed.data, ctx);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return {
      output: `Error: Tool "${toolCall.name}" threw an unexpected error: ${message}`,
      metadata: { error: true },
    };
  }

  if (result.render !== undefined) {
    const parsedRender = ToolRenderPayloadSchema.safeParse(result.render);
    if (!parsedRender.success) {
      result = {
        ...result,
        render: undefined,
        metadata: {
          ...result.metadata,
          renderValidationError: parsedRender.error.flatten(),
        },
      };
    } else {
      result = {
        ...result,
        render: parsedRender.data,
      };
    }
  }

  // D025: Auto-truncation safety net
  if (shouldTruncate(result.output)) {
    const direction = result.truncateDirection ?? "tail";
    const truncated =
      direction === "head"
        ? truncateHead(result.output)
        : direction === "head_tail"
          ? truncateHeadTail(result.output)
          : truncateTail(result.output);

    const savedPath = await persistFullOutput(result.output);

    return {
      output:
        truncated.output +
        TRUNCATION_WARNING +
        `\n(truncated from ${truncated.originalLines} lines / ${truncated.originalBytes} bytes. Full output at: ${savedPath})`,
      metadata: {
        ...result.metadata,
        truncated: true,
        truncatedFrom: { bytes: truncated.originalBytes, lines: truncated.originalLines },
        fullOutputPath: savedPath,
      },
      truncateDirection: direction,
    };
  }

  return result;
}
