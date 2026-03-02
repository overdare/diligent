// @summary Diligent server->client request schemas for approval and user-input callbacks
import { z } from "zod";
import {
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  UserInputRequestSchema,
  UserInputResponseSchema,
} from "./data-model";
import { DILIGENT_SERVER_REQUEST_METHODS } from "./methods";

export const ApprovalRequestParamsSchema = z.object({
  threadId: z.string(),
  request: ApprovalRequestSchema,
});
export type ApprovalRequestParams = z.infer<typeof ApprovalRequestParamsSchema>;

export const ApprovalRequestResultSchema = z.object({
  decision: ApprovalResponseSchema,
});
export type ApprovalRequestResult = z.infer<typeof ApprovalRequestResultSchema>;

export const UserInputRequestParamsSchema = z.object({
  threadId: z.string(),
  request: UserInputRequestSchema,
});
export type UserInputRequestParams = z.infer<typeof UserInputRequestParamsSchema>;

export const UserInputRequestResultSchema = UserInputResponseSchema;
export type UserInputRequestResult = z.infer<typeof UserInputRequestResultSchema>;

export const DiligentServerRequestSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST),
    params: ApprovalRequestParamsSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST),
    params: UserInputRequestParamsSchema,
  }),
]);
export type DiligentServerRequest = z.infer<typeof DiligentServerRequestSchema>;

export const DiligentServerRequestResponseSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST),
    result: ApprovalRequestResultSchema,
  }),
  z.object({
    method: z.literal(DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST),
    result: UserInputRequestResultSchema,
  }),
]);
export type DiligentServerRequestResponse = z.infer<typeof DiligentServerRequestResponseSchema>;
