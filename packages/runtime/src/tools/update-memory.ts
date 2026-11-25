// @summary Upsert or delete persistent memory entries across sessions

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { deleteMemory, type MemoryUpsertStatus, upsertMemory } from "../memory/repository";
import type { MemoryType } from "../memory/types";
import { createUpdateMemoryRenderPayload } from "./render-payload";

const UPSERT_OUTPUT_PREFIX: Record<MemoryUpsertStatus, string> = {
  created: "Memory saved",
  updated: "Memory updated",
  duplicate: "Memory already saved; refreshed existing entry",
};

const memoryTypeSchema = z.enum(["pattern", "discovery", "preference", "correction", "backlog"]);

const updateMemorySchema = z
  .object({
    action: z
      .enum(["upsert", "delete"])
      .default("upsert")
      .describe("Memory operation. Use 'upsert' to create/update, 'delete' to remove by id."),
    id: z
      .string()
      .optional()
      .describe(
        "Memory entry id. May be a caller-defined stable key or generated UUID. Required for delete. Optional for upsert; if provided for a new entry, that id is used.",
      ),
    type: memoryTypeSchema.optional().describe("Memory category for upsert."),
    content: z.string().optional().describe("Memory text to store for upsert."),
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

export function createUpdateMemoryTool(memoryPath: string, sessionId?: string): Tool<typeof updateMemorySchema> {
  return {
    name: "update_memory",
    description:
      "Create, update, or delete persistent memory entries across sessions. " +
      "Store only durable user preferences and use type='preference' for upserts. " +
      "Do not create entries for patterns, discoveries, corrections, or backlog items. " +
      "When the user says they want to do or build something, think carefully about whether it expresses a durable preference or is simply the work to do right now; in most cases it is immediate task intent, not memory. " +
      "Do not store transient current-turn intent or immediate implementation plans. " +
      "Use action='upsert' to save/update an entry, optionally with a stable caller-defined id, or action='delete' with id to remove one.",
    parameters: updateMemorySchema,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      if (args.action === "delete") {
        const deleted = await deleteMemory(memoryPath, args.id!);
        if (deleted) {
          const output = `Memory deleted: ${args.id}`;
          return {
            output,
            render: createUpdateMemoryRenderPayload(args, output, false),
            metadata: { action: "delete", id: args.id, deleted: true },
          };
        }
        const output = `Memory not found: ${args.id}`;
        return {
          output,
          render: createUpdateMemoryRenderPayload(args, output, false),
          metadata: { action: "delete", id: args.id, deleted: false },
        };
      }

      const { entry, status } = await upsertMemory(memoryPath, {
        id: args.id,
        type: args.type as MemoryType,
        content: args.content!,
        tags: args.tags,
        sessionId,
      });
      const output = `${UPSERT_OUTPUT_PREFIX[status]}: [${entry.type}] ${entry.content}`;
      return {
        output,
        render: createUpdateMemoryRenderPayload(args, output, false),
        metadata: { action: "upsert", memoryId: entry.id, updated: status !== "created", status },
      };
    },
  };
}
