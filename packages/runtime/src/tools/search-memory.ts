// @summary Search project memory files by id and/or content for LM-friendly lookup before update/delete

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { searchMemory } from "../memory/repository";
import { readMemory } from "../memory/store";
import { clipInlineText, createSearchMemoryRenderPayload } from "./render-payload";

const CONTENT_PREVIEW_LENGTH = 300;

const searchMemorySchema = z
  .object({
    id: z.string().optional().describe("Optional exact memory id (the memory file name without '.md')."),
    id_prefix: z
      .string()
      .optional()
      .describe("Optional memory id prefix for finding a group of related ids, such as 'combat-'."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional short keyword query matched against memory names, descriptions, and content using case-insensitive token matching.",
      ),
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
      "Search this project's memory files by exact id, id prefix, and/or keyword query, to recall project context or to find the memory to revise before updating or deleting it. " +
      "Use short keyword queries like 'combat damage' or 'publish' when you do not know the id. " +
      "Each match shows its id, type, description, and the start of its content; read the memory file for the full text. " +
      "If multiple matches appear, narrow the query or use the returned id with update_memory.",
    parameters: searchMemorySchema,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const matches = searchMemory(await readMemory(memoryPath), {
        id: args.id?.trim(),
        idPrefix: args.id_prefix?.trim(),
        query: args.query,
      });

      let output: string;
      if (matches.length === 0) {
        output = "No memory entries found";
      } else {
        output = matches
          .map((entry) => {
            const preview = clipInlineText(entry.content.replace(/\s+/g, " ").trim(), CONTENT_PREVIEW_LENGTH);
            return `${entry.id}\t[${entry.type}] ${entry.description}\n  ${preview}`;
          })
          .join("\n");
      }

      return {
        output,
        render: createSearchMemoryRenderPayload(args, matches, output, false),
        metadata: { matchCount: matches.length, ids: matches.map((entry) => entry.id) },
      };
    },
  };
}
