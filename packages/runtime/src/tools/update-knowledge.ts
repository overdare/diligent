// @summary Upsert or delete persistent knowledge entries across sessions

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool/types";
import { z } from "zod";
import { readKnowledge, writeKnowledge } from "../knowledge/store";
import type { KnowledgeEntry, KnowledgeType } from "../knowledge/types";
import { generateEntryId } from "../session/types";

const knowledgeTypeSchema = z.enum(["pattern", "discovery", "preference", "correction", "backlog"]);

const updateKnowledgeSchema = z
  .object({
    action: z
      .enum(["upsert", "delete"])
      .default("upsert")
      .describe("Knowledge operation. Use 'upsert' to create/update, 'delete' to remove by id."),
    id: z.string().optional().describe("Knowledge entry id. Required for delete. Optional for upsert."),
    type: knowledgeTypeSchema.optional().describe("Knowledge category for upsert."),
    content: z.string().optional().describe("Knowledge text to store for upsert."),
    confidence: z.number().min(0).max(1).optional().describe("Confidence score (0.0–1.0) for upsert."),
    tags: z.array(z.string()).optional().describe("Optional tags for upsert."),
  })
  .superRefine((value, ctx) => {
    if (value.action === "delete") {
      if (!value.id || value.id.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["id"],
          message: "id is required when action is delete",
        });
      }
      return;
    }

    if (!value.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "type is required when action is upsert",
      });
    }
    if (!value.content || value.content.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required when action is upsert",
      });
    }
  });

export function createUpdateKnowledgeTool(
  knowledgePath: string,
  sessionId?: string,
): Tool<typeof updateKnowledgeSchema> {
  return {
    name: "update_knowledge",
    description:
      "Create, update, or delete persistent knowledge entries across sessions. " +
      "Use action='upsert' to save/update an entry, or action='delete' with id to remove one.",
    parameters: updateKnowledgeSchema,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const entries = await readKnowledge(knowledgePath);

      if (args.action === "delete") {
        const nextEntries = entries.filter((entry) => entry.id !== args.id);
        const deleted = nextEntries.length !== entries.length;
        if (deleted) {
          await writeKnowledge(knowledgePath, nextEntries);
          return {
            output: `Knowledge deleted: ${args.id}`,
            metadata: { action: "delete", id: args.id, deleted: true },
          };
        }
        return {
          output: `Knowledge not found: ${args.id}`,
          metadata: { action: "delete", id: args.id, deleted: false },
        };
      }

      const now = new Date().toISOString();
      const requestedType = args.type as KnowledgeType;
      const requestedContent = args.content!.trim();

      if (args.id) {
        const index = entries.findIndex((entry) => entry.id === args.id);
        if (index >= 0) {
          const updated: KnowledgeEntry = {
            ...entries[index],
            type: requestedType,
            content: requestedContent,
            confidence: args.confidence ?? entries[index].confidence,
            tags: args.tags ?? entries[index].tags,
            timestamp: now,
          };
          entries[index] = updated;
          await writeKnowledge(knowledgePath, entries);
          return {
            output: `Knowledge updated: [${updated.type}] ${updated.content}`,
            metadata: { action: "upsert", knowledgeId: updated.id, updated: true },
          };
        }
      }

      const entry: KnowledgeEntry = {
        id: args.id?.trim() || generateEntryId(),
        timestamp: now,
        sessionId,
        type: requestedType,
        content: requestedContent,
        confidence: args.confidence ?? 0.8,
        tags: args.tags,
      };
      entries.push(entry);
      await writeKnowledge(knowledgePath, entries);

      return {
        output: `Knowledge saved: [${entry.type}] ${entry.content}`,
        metadata: { action: "upsert", knowledgeId: entry.id, updated: false },
      };
    },
  };
}
