// @summary Validates the consumed subset of the official Codex App Server protocol.

import { z } from "zod";

export const accountSchema = z.object({ account: z.object({ type: z.string() }).nullable() });
export const capabilitiesSchema = z.object({ imageGeneration: z.boolean() });
export const threadSchema = z.object({ thread: z.object({ id: z.string().min(1) }) });
export const notificationScopeSchema = z.object({ threadId: z.string() });
export const itemTypeSchema = z.object({ item: z.object({ type: z.string() }) });

const imageSchema = z.object({
  savedPath: z.string().optional(),
  revisedPrompt: z.string().nullable().optional(),
});
export type CodexImageItem = z.infer<typeof imageSchema>;
export const imageNotificationSchema = z.object({ item: imageSchema });

const turnStatusSchema = z.enum(["completed", "interrupted", "failed", "inProgress"]);
export const completedNotificationSchema = z.object({
  turn: z.object({
    status: turnStatusSchema,
    error: z.object({ message: z.string() }).nullable().optional(),
  }),
});

export function parseCodexPayload<T>(method: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`Codex App Server returned an invalid ${method} payload.`);
  return parsed.data;
}
