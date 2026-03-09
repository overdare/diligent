// @summary Pure function mapping AgentEvent to DiligentServerNotification for independent testability

import { DILIGENT_SERVER_NOTIFICATION_METHODS, type DiligentServerNotification } from "@diligent/protocol";
import type { AgentEvent } from "../agent/types";

/**
 * Maps an AgentEvent to a DiligentServerNotification to be emitted to clients.
 * Returns null when the event produces no notification.
 */
export function agentEventToNotification(
  threadId: string,
  turnId: string,
  event: AgentEvent,
): DiligentServerNotification | null {
  switch (event.type) {
    case "turn_start":
      if (!event.childThreadId) return null;
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
        params: {
          threadId,
          turnId: event.turnId,
          childThreadId: event.childThreadId,
          nickname: event.nickname,
          turnNumber: event.turnNumber,
        },
      };

    case "turn_end":
      return null;

    case "message_start":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
        params: { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
      };

    case "message_delta":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
        params: {
          threadId,
          turnId,
          itemId: event.itemId,
          delta: {
            type: event.delta.type === "text_delta" ? "messageText" : "messageThinking",
            itemId: event.itemId,
            delta: event.delta.delta,
          },
        },
      };

    case "message_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
        params: { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
      };

    case "tool_start":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
        params: {
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
      };

    case "tool_update":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
        params: {
          threadId,
          turnId,
          itemId: event.itemId,
          delta: { type: "toolOutput", itemId: event.itemId, delta: event.partialResult },
          ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
        },
      };

    case "tool_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
        params: {
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
            render: event.render,
          },
          ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
        },
      };

    case "status_change":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId, status: event.status, retry: event.retry },
      };

    case "knowledge_saved":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.KNOWLEDGE_SAVED,
        params: { threadId, knowledgeId: event.knowledgeId, content: event.content },
      };

    case "loop_detected":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.LOOP_DETECTED,
        params: { threadId, patternLength: event.patternLength, toolName: event.toolName },
      };

    case "error":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
        params: { threadId, error: event.error, fatal: event.fatal },
      };

    case "usage":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.USAGE_UPDATED,
        params: { threadId, usage: event.usage, cost: event.cost },
      };

    case "steering_injected":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED,
        params: { threadId, messageCount: event.messageCount },
      };

    // Collab — sub-agent orchestration boundary events
    case "collab_spawn_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_BEGIN,
        params: { threadId, callId: event.callId, prompt: event.prompt, agentType: event.agentType },
      };

    case "collab_spawn_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_END,
        params: {
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
      };

    case "collab_wait_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_BEGIN,
        params: { threadId, callId: event.callId, agents: event.agents },
      };

    case "collab_wait_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_END,
        params: {
          threadId,
          callId: event.callId,
          agentStatuses: event.agentStatuses,
          timedOut: event.timedOut,
        },
      };

    case "collab_close_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_BEGIN,
        params: { threadId, callId: event.callId, childThreadId: event.childThreadId, nickname: event.nickname },
      };

    case "collab_close_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_END,
        params: {
          threadId,
          callId: event.callId,
          childThreadId: event.childThreadId,
          nickname: event.nickname,
          status: event.status,
          message: event.message,
        },
      };

    case "collab_interaction_begin":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_BEGIN,
        params: {
          threadId,
          callId: event.callId,
          receiverThreadId: event.receiverThreadId,
          receiverNickname: event.receiverNickname,
          prompt: event.prompt,
        },
      };

    case "collab_interaction_end":
      return {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_END,
        params: {
          threadId,
          callId: event.callId,
          receiverThreadId: event.receiverThreadId,
          receiverNickname: event.receiverNickname,
          prompt: event.prompt,
          status: event.status,
        },
      };

    default:
      return null;
  }
}
