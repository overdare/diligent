// @summary Zod schemas for web-only RPC methods (auth & config)
import { z } from "zod";
import { ProviderAuthStatusSchema, ProviderNameSchema } from "./data-model";
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

// --- Discriminated unions (parallel to DiligentClientRequestSchema) ---
export const DiligentWebRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.CONFIG_SET), params: ConfigSetParamsSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_LIST), params: AuthListParamsSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_SET), params: AuthSetParamsSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_REMOVE), params: AuthRemoveParamsSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_OAUTH_START), params: AuthOAuthStartParamsSchema }),
]);
export type DiligentWebRequest = z.infer<typeof DiligentWebRequestSchema>;

export const DiligentWebResponseSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.CONFIG_SET), result: ConfigSetResponseSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_LIST), result: AuthListResponseSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_SET), result: AuthSetResponseSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_REMOVE), result: AuthRemoveResponseSchema }),
  z.object({ method: z.literal(DILIGENT_WEB_REQUEST_METHODS.AUTH_OAUTH_START), result: AuthOAuthStartResponseSchema }),
]);
export type DiligentWebResponse = z.infer<typeof DiligentWebResponseSchema>;
