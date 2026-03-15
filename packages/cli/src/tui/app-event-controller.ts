// @summary Server notification and request controller for the CLI TUI runtime

import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  RequestId,
} from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS, DILIGENT_SERVER_REQUEST_METHODS } from "@diligent/protocol";
import type {
  AgentEvent,
  ApprovalRequest,
  ApprovalResponse,
  UserInputRequest,
  UserInputResponse,
} from "@diligent/runtime";
import type { AppRuntimeState } from "./app-runtime-state";

export interface AppEventControllerDeps {
  runtime: AppRuntimeState;
  mapNotificationToEvents: (notification: DiligentServerNotification) => AgentEvent[];
  handleAgentEvent: (event: AgentEvent) => void;
  onTurnFinished: () => void;
  onTurnErrored: (message: string) => void;
  onUserInputRequestResolved: () => void;
  onAccountLoginCompleted: (result: { success: boolean; error: string | null }) => void;
  requestApproval: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  requestUserInput: (request: UserInputRequest) => Promise<UserInputResponse>;
}

export class AppEventController {
  constructor(private deps: AppEventControllerDeps) {}

  async handleServerNotification(notification: DiligentServerNotification): Promise<void> {
    const threadId = "threadId" in notification.params ? notification.params.threadId : undefined;
    if (threadId && this.deps.runtime.currentThreadId && threadId !== this.deps.runtime.currentThreadId) {
      return;
    }

    const agentEvents = this.deps.mapNotificationToEvents(notification);
    for (const event of agentEvents) {
      this.deps.handleAgentEvent(event);
    }

    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED &&
      this.deps.runtime.currentThreadId &&
      notification.params.threadId === this.deps.runtime.currentThreadId
    ) {
      this.deps.onTurnFinished();
    }

    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED &&
      this.deps.runtime.currentThreadId &&
      notification.params.threadId === this.deps.runtime.currentThreadId
    ) {
      this.deps.onTurnFinished();
    }

    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR &&
      this.deps.runtime.pendingTurn &&
      (!notification.params.threadId || notification.params.threadId === this.deps.runtime.currentThreadId)
    ) {
      this.deps.onTurnErrored(notification.params.error.message);
    }

    if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED) {
      const requestId = notification.params.requestId;
      if (this.deps.runtime.pendingUserInputRequestIds.has(requestId)) {
        this.deps.runtime.activeUserInputResolved = true;
        this.deps.runtime.pendingUserInputRequestIds.delete(requestId);
        if (this.deps.runtime.activeUserInputRequestId === requestId) {
          this.deps.onUserInputRequestResolved();
        }
      }
    }

    if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED) {
      const { success, error } = notification.params;
      this.deps.onAccountLoginCompleted({ success, error: error ?? null });
    }
  }

  async handleServerRequest(
    requestId: RequestId,
    request: DiligentServerRequest,
  ): Promise<DiligentServerRequestResponse> {
    if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
      const decision = await this.deps.requestApproval(request.params.request);
      return {
        method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
        result: { decision },
      };
    }

    this.deps.runtime.pendingUserInputRequestIds.add(requestId);
    this.deps.runtime.activeUserInputRequestId = requestId;
    this.deps.runtime.activeUserInputResolved = false;
    try {
      const result = await this.deps.requestUserInput(request.params.request);
      return {
        method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
        result,
      };
    } finally {
      this.deps.runtime.pendingUserInputRequestIds.delete(requestId);
      if (this.deps.runtime.activeUserInputRequestId === requestId) {
        this.deps.runtime.activeUserInputRequestId = null;
      }
      this.deps.runtime.activeUserInputResolved = false;
    }
  }
}
