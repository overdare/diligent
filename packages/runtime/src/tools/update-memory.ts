// @summary Upsert or delete project memory files across sessions

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { deleteMemory, type MemoryUpsertStatus, upsertMemory } from "../memory/repository";
import { MemoryTypeSchema } from "../protocol/index";
import { createUpdateMemoryRenderPayload } from "./render-payload";

const UPSERT_OUTPUT_PREFIX: Record<MemoryUpsertStatus, string> = {
  created: "Memory saved",
  updated: "Memory updated",
  duplicate: "Memory already saved; refreshed existing entry",
};

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
        "Memory id: the memory file name without '.md', such as 'combat-damage-model'. Required for delete. For upsert, pass the id of the memory being revised; omit it to create one with a generated id.",
      ),
    type: MemoryTypeSchema.optional().describe(
      "Required for upsert. 'project': decisions with their reasons, constraints, and remaining work. 'reference': where external or long-form material lives. 'feedback': how the user wants work done, including corrections. 'user': facts about the user.",
    ),
    name: z.string().optional().describe("Short title shown in the MEMORY.md index."),
    description: z
      .string()
      .optional()
      .describe("One-line summary for the MEMORY.md index that tells a future session when to read this memory."),
    content: z
      .string()
      .optional()
      .describe("Required for upsert. Full Markdown text of the memory; it replaces the previous text."),
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
      "Create, update, or delete a project memory: one Markdown file in this project's memory directory plus its line in MEMORY.md, which later sessions in this project load at start. " +
      "Record what a later session would otherwise have to rediscover: decisions and why they were made, remaining work, where references live (link a path such as a docs/ file instead of copying it), and the user's durable preferences and corrections. " +
      "When a decision or the remaining work changes, update the existing memory by its id instead of adding another. " +
      "Do not store the current request, step-by-step plans for this turn, or anything readable from the code, project docs, or git history. " +
      "Use action='delete' with id to remove a memory that is no longer true.",
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
        type: args.type!,
        name: args.name,
        description: args.description,
        content: args.content!,
        sessionId,
      });
      const output = `${UPSERT_OUTPUT_PREFIX[status]}: ${entry.id} [${entry.type}] ${entry.description}`;
      return {
        output,
        render: createUpdateMemoryRenderPayload(args, output, false),
        metadata: { action: "upsert", memoryId: entry.id, updated: status !== "created", status },
      };
    },
  };
}
