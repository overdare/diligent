// @summary Diligent server->client notification schemas aligned to codex-like thread/turn/item flow
import { z } from "zod";
import {
  CollabAgentRefSchema,
  CollabAgentStatusEntrySchema,
  CollabAgentStatusSchema,
  ProviderAuthStatusSchema,
  SerializableErrorSchema,
  ThreadItemDeltaSchema,
  ThreadItemSchema,
  ThreadStatusRetrySchema,
  ThreadStatusSchema,
  UsageSchema,
} from "./data-model";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "./methods";

export const ThreadStartedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED),
  params: z.object({
    threadId: z.string(),
  }),
});
export type ThreadStartedNotification = z.infer<typeof ThreadStartedNotificationSchema>;

export const ThreadResumedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED),
  params: z.object({
    threadId: z.string(),
    restoredMessages: z.number().int().nonnegative(),
  }),
});
export type ThreadResumedNotification = z.infer<typeof ThreadResumedNotificationSchema>;

export const ThreadStatusChangedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED),
  params: z.object({
    threadId: z.string(),
    status: ThreadStatusSchema,
    retry: ThreadStatusRetrySchema.optional(),
  }),
});
export type ThreadStatusChangedNotification = z.infer<typeof ThreadStatusChangedNotificationSchema>;

export const TurnStartedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
    turnNumber: z.number().int().positive().optional(),
  }),
});
export type TurnStartedNotification = z.infer<typeof TurnStartedNotificationSchema>;

export const ItemStartedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    item: ThreadItemSchema,
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
});
export type ItemStartedNotification = z.infer<typeof ItemStartedNotificationSchema>;

export const ItemDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: ThreadItemDeltaSchema,
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
});
export type ItemDeltaNotification = z.infer<typeof ItemDeltaNotificationSchema>;

export const ItemCompletedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    item: ThreadItemSchema,
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
});
export type ItemCompletedNotification = z.infer<typeof ItemCompletedNotificationSchema>;

export const TurnCompletedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
  }),
});
export type TurnCompletedNotification = z.infer<typeof TurnCompletedNotificationSchema>;

export const TurnInterruptedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
  }),
});
export type TurnInterruptedNotification = z.infer<typeof TurnInterruptedNotificationSchema>;

export const KnowledgeSavedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.KNOWLEDGE_SAVED),
  params: z.object({
    threadId: z.string(),
    knowledgeId: z.string(),
    content: z.string(),
  }),
});
export type KnowledgeSavedNotification = z.infer<typeof KnowledgeSavedNotificationSchema>;

export const LoopDetectedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.LOOP_DETECTED),
  params: z.object({
    threadId: z.string(),
    patternLength: z.number().int().positive(),
    toolName: z.string(),
  }),
});
export type LoopDetectedNotification = z.infer<typeof LoopDetectedNotificationSchema>;

export const ErrorNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR),
  params: z.object({
    threadId: z.string().optional(),
    error: SerializableErrorSchema,
    fatal: z.boolean().default(false),
  }),
});
export type ErrorNotification = z.infer<typeof ErrorNotificationSchema>;

export const UsageUpdatedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.USAGE_UPDATED),
  params: z.object({
    threadId: z.string(),
    usage: UsageSchema,
    cost: z.number(),
  }),
});
export type UsageUpdatedNotification = z.infer<typeof UsageUpdatedNotificationSchema>;

export const AccountLoginCompletedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED),
  params: z.object({
    loginId: z.string().nullable(),
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});
export type AccountLoginCompletedNotification = z.infer<typeof AccountLoginCompletedNotificationSchema>;

export const AccountUpdatedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED),
  params: z.object({
    providers: z.array(ProviderAuthStatusSchema),
  }),
});
export type AccountUpdatedNotification = z.infer<typeof AccountUpdatedNotificationSchema>;

export const SteeringInjectedNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED),
  params: z.object({ threadId: z.string(), messageCount: z.number().int() }),
});
export type SteeringInjectedNotification = z.infer<typeof SteeringInjectedNotificationSchema>;

// Collab — sub-agent orchestration boundary notifications (3 begin/end pairs)

export const CollabSpawnBeginNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_BEGIN),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    prompt: z.string(),
  }),
});
export type CollabSpawnBeginNotification = z.infer<typeof CollabSpawnBeginNotificationSchema>;

export const CollabSpawnEndNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_END),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string(),
    status: CollabAgentStatusSchema,
    message: z.string().optional(),
  }),
});
export type CollabSpawnEndNotification = z.infer<typeof CollabSpawnEndNotificationSchema>;

export const CollabWaitBeginNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_BEGIN),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    agents: z.array(CollabAgentRefSchema),
  }),
});
export type CollabWaitBeginNotification = z.infer<typeof CollabWaitBeginNotificationSchema>;

export const CollabWaitEndNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_END),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    agentStatuses: z.array(CollabAgentStatusEntrySchema),
    timedOut: z.boolean(),
  }),
});
export type CollabWaitEndNotification = z.infer<typeof CollabWaitEndNotificationSchema>;

export const CollabCloseBeginNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_BEGIN),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
  }),
});
export type CollabCloseBeginNotification = z.infer<typeof CollabCloseBeginNotificationSchema>;

export const CollabCloseEndNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_END),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
    status: CollabAgentStatusSchema,
    message: z.string().optional(),
  }),
});
export type CollabCloseEndNotification = z.infer<typeof CollabCloseEndNotificationSchema>;

export const CollabInteractionBeginNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_BEGIN),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
  }),
});
export type CollabInteractionBeginNotification = z.infer<typeof CollabInteractionBeginNotificationSchema>;

export const CollabInteractionEndNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_END),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
    status: CollabAgentStatusSchema,
  }),
});
export type CollabInteractionEndNotification = z.infer<typeof CollabInteractionEndNotificationSchema>;

export const DiligentServerNotificationSchema = z.union([
  ThreadStartedNotificationSchema,
  ThreadResumedNotificationSchema,
  ThreadStatusChangedNotificationSchema,
  TurnStartedNotificationSchema,
  ItemStartedNotificationSchema,
  ItemDeltaNotificationSchema,
  ItemCompletedNotificationSchema,
  TurnCompletedNotificationSchema,
  TurnInterruptedNotificationSchema,
  KnowledgeSavedNotificationSchema,
  LoopDetectedNotificationSchema,
  ErrorNotificationSchema,
  UsageUpdatedNotificationSchema,
  AccountLoginCompletedNotificationSchema,
  AccountUpdatedNotificationSchema,
  SteeringInjectedNotificationSchema,
  CollabSpawnBeginNotificationSchema,
  CollabSpawnEndNotificationSchema,
  CollabWaitBeginNotificationSchema,
  CollabWaitEndNotificationSchema,
  CollabCloseBeginNotificationSchema,
  CollabCloseEndNotificationSchema,
  CollabInteractionBeginNotificationSchema,
  CollabInteractionEndNotificationSchema,
]);
export type DiligentServerNotification = z.infer<typeof DiligentServerNotificationSchema>;
