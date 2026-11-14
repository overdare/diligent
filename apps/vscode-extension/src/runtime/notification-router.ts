// @summary Shared-protocol notification routing policy for the VS Code extension host
import type { AgentEvent, DiligentServerNotification } from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";

export interface NotificationRoute {
  threadId: string | null;
  agentEvent: AgentEvent | null;
  shouldRefreshThreads: boolean;
  shouldReconcileThread: boolean;
}

export function getNotificationThreadId(notification: DiligentServerNotification): string | null {
  const params = notification.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

export function routeNotification(notification: DiligentServerNotification): NotificationRoute {
  const threadId = getNotificationThreadId(notification);

  switch (notification.method) {
    case DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT:
      return {
        threadId: notification.params.threadId,
        agentEvent: notification.params.event,
        shouldRefreshThreads: false,
        shouldReconcileThread: false,
      };
    case DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED:
      return {
        threadId,
        agentEvent: null,
        shouldRefreshThreads: true,
        shouldReconcileThread: false,
      };
    case DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED:
    case DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED:
      return {
        threadId,
        agentEvent: null,
        shouldRefreshThreads: false,
        shouldReconcileThread: true,
      };
    default:
      return {
        threadId,
        agentEvent: null,
        shouldRefreshThreads: false,
        shouldReconcileThread: false,
      };
  }
}
