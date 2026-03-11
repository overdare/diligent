// @summary Pure function mapping AgentEvent to DiligentServerNotification for independent testability

import { DILIGENT_SERVER_NOTIFICATION_METHODS, type DiligentServerNotification } from "@diligent/protocol";
import type { AgentEvent } from "../agent/types";

interface NotificationContext {
  threadStatus?: "idle" | "busy" | "retry";
  threadStatusRetry?: { attempt: number; delayMs: number };
}

type ThreadStatusSnapshot = {
  threadStatus?: "idle" | "busy" | "retry";
  threadStatusRetry?: { attempt: number; delayMs: number };
};

function withThreadStatus<T extends { threadId: string }>(
  params: T,
  context?: NotificationContext,
): T & ThreadStatusSnapshot {
  return {
    ...params,
    ...(context?.threadStatus ? { threadStatus: context.threadStatus } : {}),
    ...(context?.threadStatusRetry ? { threadStatusRetry: context.threadStatusRetry } : {}),
  };
}

/**
 * Maps an AgentEvent to a DiligentServerNotification to be emitted to clients.
 * Returns null when the event produces no notification.
 */
export function agentEventToNotification(
  threadId: string,
  turnId: string,
  event: AgentEvent,
  context?: NotificationContext,
): DiligentServerNotification | null {
  switch (event.type) {
    case "turn_start":
      if (!event.childThreadId) return null;
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
        params: withThreadStatus(
          {
            threadId,
            turnId: event.turnId,
            childThreadId: event.childThreadId,
            nickname: event.nickname,
            turnNumber: event.turnNumber,
          },
          context,
        ),
      };

    case "turn_end":
      return null;

    case "message_start":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
        params: withThreadStatus(
          { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
          context,
        ),
      };

    case "message_delta":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
        params: withThreadStatus(
          {
            threadId,
            turnId,
            itemId: event.itemId,
            delta: {
              type: event.delta.type === "text_delta" ? "messageText" : "messageThinking",
              itemId: event.itemId,
              delta: event.delta.delta,
            },
          },
          context,
        ),
      };

    case "message_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
        params: withThreadStatus(
          { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
          context,
        ),
      };

    case "tool_start":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
        params: withThreadStatus(
          {
            threadId,
            turnId,
            item: {
              type: "toolCall",
              itemId: event.itemId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
            },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
          context,
        ),
      };

    case "tool_update":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
        params: withThreadStatus(
          {
            threadId,
            turnId,
            itemId: event.itemId,
            delta: { type: "toolOutput", itemId: event.itemId, delta: event.partialResult },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
          context,
        ),
      };

    case "tool_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
        params: withThreadStatus(
          {
            threadId,
            turnId,
            item: {
              type: "toolCall",
              itemId: event.itemId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: {},
              output: event.output,
              isError: event.isError,
            },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
          context,
        ),
      };

    case "status_change":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId, status: event.status, retry: event.retry },
      };

    case "knowledge_saved":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.KNOWLEDGE_SAVED,
        params: withThreadStatus({ threadId, knowledgeId: event.knowledgeId, content: event.content }, context),
      };

    case "loop_detected":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.LOOP_DETECTED,
        params: withThreadStatus({ threadId, patternLength: event.patternLength, toolName: event.toolName }, context),
      };

    case "error":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
        params: { threadId, error: event.error, fatal: event.fatal },
      };

    case "usage":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.USAGE_UPDATED,
        params: withThreadStatus({ threadId, usage: event.usage, cost: event.cost }, context),
      };

    case "steering_injected":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED,
        params: withThreadStatus({ threadId, messageCount: event.messageCount }, context),
      };

    // Collab — sub-agent orchestration boundary events
    case "collab_spawn_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_BEGIN,
        params: withThreadStatus(
          { threadId, callId: event.callId, prompt: event.prompt, agentType: event.agentType },
          context,
        ),
      };

    case "collab_spawn_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_END,
        params: withThreadStatus(
          {
            threadId,
            callId: event.callId,
            childThreadId: event.childThreadId,
            nickname: event.nickname,
            agentType: event.agentType,
            description: event.description,
            prompt: event.prompt,
            status: event.status,
            message: event.message,
          },
          context,
        ),
      };

    case "collab_wait_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_BEGIN,
        params: withThreadStatus({ threadId, callId: event.callId, agents: event.agents }, context),
      };

    case "collab_wait_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_END,
        params: withThreadStatus(
          {
            threadId,
            callId: event.callId,
            agentStatuses: event.agentStatuses,
            timedOut: event.timedOut,
          },
          context,
        ),
      };

    case "collab_close_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_BEGIN,
        params: withThreadStatus(
          { threadId, callId: event.callId, childThreadId: event.childThreadId, nickname: event.nickname },
          context,
        ),
      };

    case "collab_close_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_END,
        params: withThreadStatus(
          {
            threadId,
            callId: event.callId,
            childThreadId: event.childThreadId,
            nickname: event.nickname,
            status: event.status,
            message: event.message,
          },
          context,
        ),
      };

    case "collab_interaction_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_BEGIN,
        params: withThreadStatus(
          {
            threadId,
            callId: event.callId,
            receiverThreadId: event.receiverThreadId,
            receiverNickname: event.receiverNickname,
            prompt: event.prompt,
          },
          context,
        ),
      };

    case "collab_interaction_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_END,
        params: withThreadStatus(
          {
            threadId,
            callId: event.callId,
            receiverThreadId: event.receiverThreadId,
            receiverNickname: event.receiverNickname,
            prompt: event.prompt,
            status: event.status,
          },
          context,
        ),
      };

    default:
      return null;
  }
}
