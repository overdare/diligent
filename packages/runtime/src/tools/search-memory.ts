// @summary Search persistent memory entries by stable id and/or content for LM-friendly lookup before update/delete

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { searchMemory } from "../memory/repository";
import { readMemory } from "../memory/store";
import { createSearchMemoryRenderPayload } from "./render-payload";

const searchMemorySchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Optional exact memory entry id. Ids may be caller-defined stable keys or generated UUIDs returned by search_memory.",
      ),
    id_prefix: z
      .string()
      .optional()
      .describe("Optional memory entry id prefix for finding a group of stable ids, such as 'project.decision.'."),
    query: z
      .string()
      .optional()
      .describe("Optional short keyword query to search against memory content using case-insensitive token matching."),
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === "string" && value.id.trim().length > 0;
    const hasIdPrefix = typeof value.id_prefix === "string" && value.id_prefix.trim().length > 0;
    const hasQuery = typeof value.query === "string" && value.query.trim().length > 0;
    if (!hasId && !hasIdPrefix && !hasQuery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Provide at least one of id, id_prefix, or query",
      });
    }
  });

export function createSearchMemoryTool(memoryPath: string): Tool<typeof searchMemorySchema> {
  return {
    name: "search_memory",
    description:
      "Search persistent memory entries by exact id, id prefix, and/or query so you can find the right memory item before updating or deleting it. " +
      "Ids may be caller-defined stable keys like 'project.current_plan' or generated UUIDs returned by search_memory. " +
      "Use id_prefix for groups of stable ids, such as 'project.decision.' or 'project.preference.'. " +
      "Use short keyword queries like 'thread fork', 'draft state', or 'PROJECT_IMPLEMENTATION_MAP' for case-insensitive token matching when you do not know the id. " +
      "If multiple matches appear, narrow the query or use the returned id with update_memory.",
    parameters: searchMemorySchema,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const matches = searchMemory(await readMemory(memoryPath), {
        id: args.id?.trim(),
        idPrefix: args.id_prefix?.trim(),
        query: args.query,
      });

      const output =
        matches.length === 0
          ? "No memory entries found"
          : matches
              .map((entry) => {
                const tags = entry.tags && entry.tags.length > 0 ? ` tags=${entry.tags.join(",")}` : "";
                return `${entry.id}\t[${entry.type}] ${entry.content}${tags}`;
              })
              .join("\n");

      return {
        output,
        render: createSearchMemoryRenderPayload(args, matches, output, false),
        metadata: { matchCount: matches.length, ids: matches.map((entry) => entry.id) },
      };
    },
  };
}
