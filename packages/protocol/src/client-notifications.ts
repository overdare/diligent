// @summary Diligent client->server notification schemas
import { z } from "zod";
import { DILIGENT_CLIENT_NOTIFICATION_METHODS } from "./methods";

export const InitializedNotificationSchema = z.object({
  method: z.literal(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED),
  params: z.object({
    ready: z.literal(true),
  }),
});
export type InitializedNotification = z.infer<typeof InitializedNotificationSchema>;

export const DiligentClientNotificationSchema = InitializedNotificationSchema;
export type DiligentClientNotification = z.infer<typeof DiligentClientNotificationSchema>;
