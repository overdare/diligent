// @summary Diligent client->server request schemas and typed method/result maps
import { z } from "zod";
import {
  KnowledgeEntrySchema,
  MessageSchema,
  ModeSchema,
  ProtocolCapabilitiesSchema,
  ProtocolVersionSchema,
  SessionSummarySchema,
} from "./data-model";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "./methods";

export const InitializeParamsSchema = z.object({
  clientName: z.string(),
  clientVersion: z.string(),
  protocolVersion: ProtocolVersionSchema.default(1),
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const InitializeResponseSchema = z.object({
  serverName: z.string(),
  serverVersion: z.string(),
  protocolVersion: ProtocolVersionSchema,
  capabilities: ProtocolCapabilitiesSchema,
});
export type InitializeResponse = z.infer<typeof InitializeResponseSchema>;

export const ThreadStartParamsSchema = z.object({
  cwd: z.string(),
  mode: ModeSchema.optional(),
  model: z.string().optional(),
});
export type ThreadStartParams = z.infer<typeof ThreadStartParamsSchema>;

export const ThreadStartResponseSchema = z.object({
  threadId: z.string(),
});
export type ThreadStartResponse = z.infer<typeof ThreadStartResponseSchema>;

export const ThreadResumeParamsSchema = z
  .object({
    threadId: z.string().optional(),
    mostRecent: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.threadId) || v.mostRecent === true, {
    message: "Either threadId or mostRecent=true is required",
  });
export type ThreadResumeParams = z.infer<typeof ThreadResumeParamsSchema>;

export const ThreadResumeResponseSchema = z.object({
  found: z.boolean(),
  threadId: z.string().optional(),
  context: z.array(MessageSchema).optional(),
});
export type ThreadResumeResponse = z.infer<typeof ThreadResumeResponseSchema>;

export const ThreadListParamsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
});
export type ThreadListParams = z.infer<typeof ThreadListParamsSchema>;

export const ThreadListResponseSchema = z.object({
  data: z.array(SessionSummarySchema),
});
export type ThreadListResponse = z.infer<typeof ThreadListResponseSchema>;

export const ThreadReadParamsSchema = z.object({
  threadId: z.string().optional(),
});
export type ThreadReadParams = z.infer<typeof ThreadReadParamsSchema>;

export const ThreadReadResponseSchema = z.object({
  messages: z.array(MessageSchema),
  hasFollowUp: z.boolean(),
  entryCount: z.number().int().nonnegative(),
});
export type ThreadReadResponse = z.infer<typeof ThreadReadResponseSchema>;

export const TurnStartParamsSchema = z.object({
  threadId: z.string().optional(),
  message: z.string(),
});
export type TurnStartParams = z.infer<typeof TurnStartParamsSchema>;

export const TurnStartResponseSchema = z.object({
  accepted: z.literal(true),
});
export type TurnStartResponse = z.infer<typeof TurnStartResponseSchema>;

export const TurnInterruptParamsSchema = z.object({
  threadId: z.string().optional(),
});
export type TurnInterruptParams = z.infer<typeof TurnInterruptParamsSchema>;

export const TurnInterruptResponseSchema = z.object({
  interrupted: z.boolean(),
});
export type TurnInterruptResponse = z.infer<typeof TurnInterruptResponseSchema>;

export const TurnSteerParamsSchema = z.object({
  threadId: z.string().optional(),
  content: z.string(),
  followUp: z.boolean().default(false),
});
export type TurnSteerParams = z.infer<typeof TurnSteerParamsSchema>;

export const TurnSteerResponseSchema = z.object({
  queued: z.literal(true),
});
export type TurnSteerResponse = z.infer<typeof TurnSteerResponseSchema>;

export const ModeSetParamsSchema = z.object({
  threadId: z.string().optional(),
  mode: ModeSchema,
});
export type ModeSetParams = z.infer<typeof ModeSetParamsSchema>;

export const ModeSetResponseSchema = z.object({
  mode: ModeSchema,
});
export type ModeSetResponse = z.infer<typeof ModeSetResponseSchema>;

export const KnowledgeListParamsSchema = z.object({
  threadId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type KnowledgeListParams = z.infer<typeof KnowledgeListParamsSchema>;

export const KnowledgeListResponseSchema = z.object({
  data: z.array(KnowledgeEntrySchema),
});
export type KnowledgeListResponse = z.infer<typeof KnowledgeListResponseSchema>;

export const DiligentClientRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE), params: InitializeParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START), params: ThreadStartParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME), params: ThreadResumeParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST), params: ThreadListParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ), params: ThreadReadParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START), params: TurnStartParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT), params: TurnInterruptParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER), params: TurnSteerParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET), params: ModeSetParamsSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST), params: KnowledgeListParamsSchema }),
]);
export type DiligentClientRequest = z.infer<typeof DiligentClientRequestSchema>;

export const DiligentClientResponseSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE), result: InitializeResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START), result: ThreadStartResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME), result: ThreadResumeResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST), result: ThreadListResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ), result: ThreadReadResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START), result: TurnStartResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT), result: TurnInterruptResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER), result: TurnSteerResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET), result: ModeSetResponseSchema }),
  z.object({ method: z.literal(DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST), result: KnowledgeListResponseSchema }),
]);
export type DiligentClientResponse = z.infer<typeof DiligentClientResponseSchema>;
