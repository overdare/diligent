// @summary Search persistent knowledge entries by stable id and/or content for LM-friendly lookup before update/delete

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { searchKnowledge } from "../knowledge/repository";
import { readKnowledge } from "../knowledge/store";
import { createSearchKnowledgeRenderPayload } from "./render-payload";

const searchKnowledgeSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Optional exact knowledge entry id. Ids may be caller-defined stable keys or generated UUIDs returned by search_knowledge.",
      ),
    id_prefix: z
      .string()
      .optional()
      .describe("Optional knowledge entry id prefix for finding a group of stable ids, such as 'overdare.decision.'."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional short keyword query to search against knowledge content using case-insensitive token matching.",
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

export function createSearchKnowledgeTool(knowledgePath: string): Tool<typeof searchKnowledgeSchema> {
  return {
    name: "search_knowledge",
    description:
      "Search persistent knowledge entries by exact id, id prefix, and/or query so you can find the right knowledge item before updating or deleting it. " +
      "Ids may be caller-defined stable keys like 'overdare.current_plan' or generated UUIDs returned by search_knowledge. " +
      "Use id_prefix for groups of stable ids, such as 'overdare.decision.' or 'overdare.preference.'. " +
      "Use short keyword queries like 'thread fork', 'draft state', or 'OVERDARE_IMPLEMENTATION_MAP' for case-insensitive token matching when you do not know the id. " +
      "If multiple matches appear, narrow the query or use the returned id with update_knowledge.",
    parameters: searchKnowledgeSchema,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const matches = searchKnowledge(await readKnowledge(knowledgePath), {
        id: args.id?.trim(),
        idPrefix: args.id_prefix?.trim(),
        query: args.query,
      });

      const output =
        matches.length === 0
          ? "No knowledge entries found"
          : matches
              .map((entry) => {
                const tags = entry.tags && entry.tags.length > 0 ? ` tags=${entry.tags.join(",")}` : "";
                return `${entry.id}\t[${entry.type}] ${entry.content}${tags}`;
              })
              .join("\n");

      return {
        output,
        render: createSearchKnowledgeRenderPayload(args, matches, output, false),
        metadata: { matchCount: matches.length, ids: matches.map((entry) => entry.id) },
      };
    },
  };
}
