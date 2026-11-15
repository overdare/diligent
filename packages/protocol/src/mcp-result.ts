// @summary Lossless MCP tool result stored in tool metadata, separate from model-facing output
import { z } from "zod";

/**
 * Stored as `metadata.mcpResult` on tool results and toolCall items. Keep extension
 * fields and future content kinds intact; runtime validates known MCP content.
 * `_meta` is private client data and must never be projected into model text or diagnostics.
 */
export const McpToolResultSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.string() })).default([]),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
export type McpToolResult = z.infer<typeof McpToolResultSchema>;
