// @summary Zod schemas for web-only RPC methods (auth & config)
import { z } from "zod";
import { LocalImageBlockSchema, ProviderAuthStatusSchema, ProviderNameSchema } from "./data-model";
import { DILIGENT_WEB_REQUEST_METHODS } from "./methods";

// --- config/set ---
export const ConfigSetParamsSchema = z.object({
  model: z.string().optional(),
});
export type ConfigSetParams = z.infer<typeof ConfigSetParamsSchema>;

export const ConfigSetResponseSchema = z.object({
  model: z.string().optional(),
});
export type ConfigSetResponse = z.infer<typeof ConfigSetResponseSchema>;

// --- auth/list ---
export const AuthListParamsSchema = z.object({});
export type AuthListParams = z.infer<typeof AuthListParamsSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  provider: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  inputCostPer1M: z.number().optional(),
  outputCostPer1M: z.number().optional(),
  supportsThinking: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const AuthListResponseSchema = z.object({
  providers: z.array(ProviderAuthStatusSchema),
  availableModels: z.array(ModelInfoSchema),
});
export type AuthListResponse = z.infer<typeof AuthListResponseSchema>;

// --- auth/set ---
export const AuthSetParamsSchema = z.object({
  provider: ProviderNameSchema,
  apiKey: z.string().min(1),
});
export type AuthSetParams = z.infer<typeof AuthSetParamsSchema>;

export const AuthSetResponseSchema = z.object({
  ok: z.literal(true),
});
export type AuthSetResponse = z.infer<typeof AuthSetResponseSchema>;

// --- auth/remove ---
export const AuthRemoveParamsSchema = z.object({
  provider: ProviderNameSchema,
});
export type AuthRemoveParams = z.infer<typeof AuthRemoveParamsSchema>;

export const AuthRemoveResponseSchema = z.object({
  ok: z.literal(true),
});
export type AuthRemoveResponse = z.infer<typeof AuthRemoveResponseSchema>;

// --- auth/oauth/start ---
export const AuthOAuthStartParamsSchema = z.object({});
export type AuthOAuthStartParams = z.infer<typeof AuthOAuthStartParamsSchema>;

export const AuthOAuthStartResponseSchema = z.object({
  authUrl: z.string().url(),
});
export type AuthOAuthStartResponse = z.infer<typeof AuthOAuthStartResponseSchema>;

// --- thread/subscribe ---
export const ThreadSubscribeParamsSchema = z.object({
  threadId: z.string(),
});
export type ThreadSubscribeParams = z.infer<typeof ThreadSubscribeParamsSchema>;

export const ThreadSubscribeResponseSchema = z.object({
  subscriptionId: z.string(),
});
export type ThreadSubscribeResponse = z.infer<typeof ThreadSubscribeResponseSchema>;

// --- thread/unsubscribe ---
export const ThreadUnsubscribeParamsSchema = z.object({
  subscriptionId: z.string(),
});
export type ThreadUnsubscribeParams = z.infer<typeof ThreadUnsubscribeParamsSchema>;

export const ThreadUnsubscribeResponseSchema = z.object({
  ok: z.boolean(),
});
export type ThreadUnsubscribeResponse = z.infer<typeof ThreadUnsubscribeResponseSchema>;

// --- image/upload ---
export const ImageUploadParamsSchema = z.object({
  threadId: z.string().optional(),
  fileName: z.string().min(1),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  dataBase64: z.string().min(1),
});
export type ImageUploadParams = z.infer<typeof ImageUploadParamsSchema>;

export const ImageUploadAttachmentSchema = LocalImageBlockSchema.extend({
  webUrl: z.string(),
});
export type ImageUploadAttachment = z.infer<typeof ImageUploadAttachmentSchema>;

export const ImageUploadResponseSchema = z.object({
  attachment: ImageUploadAttachmentSchema,
});
export type ImageUploadResponse = z.infer<typeof ImageUploadResponseSchema>;

// --- Discriminated unions (parallel to DiligentClientRequestSchema) ---
export const DiligentWebRequestSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.CONFIG_SET),
    params: ConfigSetParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_LIST),
    params: AuthListParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_SET),
    params: AuthSetParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_REMOVE),
    params: AuthRemoveParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_OAUTH_START),
    params: AuthOAuthStartParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.THREAD_SUBSCRIBE),
    params: ThreadSubscribeParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.THREAD_UNSUBSCRIBE),
    params: ThreadUnsubscribeParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.IMAGE_UPLOAD),
    params: ImageUploadParamsSchema,
  }),
]);
export type DiligentWebRequest = z.infer<typeof DiligentWebRequestSchema>;

export const DiligentWebResponseSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.CONFIG_SET),
    result: ConfigSetResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_LIST),
    result: AuthListResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_SET),
    result: AuthSetResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_REMOVE),
    result: AuthRemoveResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_OAUTH_START),
    result: AuthOAuthStartResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.THREAD_SUBSCRIBE),
    result: ThreadSubscribeResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.THREAD_UNSUBSCRIBE),
    result: ThreadUnsubscribeResponseSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_WEB_REQUEST_METHODS.IMAGE_UPLOAD),
    result: ImageUploadResponseSchema,
  }),
]);
export type DiligentWebResponse = z.infer<typeof DiligentWebResponseSchema>;
