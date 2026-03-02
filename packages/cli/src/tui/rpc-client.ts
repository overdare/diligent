// @summary In-process JSON-RPC client and protocol-notification adapter for TUI/app-server communication
import type { AgentEvent, AssistantMessage, DiligentAppServer } from "@diligent/core";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type DiligentClientRequest,
  type DiligentClientResponse,
  DiligentClientResponseSchema,
  type DiligentServerNotification,
  type DiligentServerRequest,
  type DiligentServerRequestResponse,
} from "@diligent/protocol";

type RequestMethod = DiligentClientRequest["method"];
type RequestParams<M extends RequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type RequestResult<M extends RequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

function createEmptyAssistantMessage(model = "unknown"): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

export class LocalAppServerRpcClient {
  private nextRequestId = 0;
  private notificationListener: ((notification: DiligentServerNotification) => void | Promise<void>) | null = null;
  private serverRequestHandler: ((request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null =
    null;

  constructor(private readonly server: DiligentAppServer) {
    this.server.setNotificationListener(async (notification) => {
      if (this.notificationListener) {
        await this.notificationListener(notification);
      }
    });

    this.server.setServerRequestHandler(async (request) => {
      if (this.serverRequestHandler) {
        return this.serverRequestHandler(request);
      }

      if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
        return {
          method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
          result: { decision: "once" },
        };
      }

      return {
        method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
        result: { answers: {} },
      };
    });
  }

  setNotificationListener(listener: ((notification: DiligentServerNotification) => void | Promise<void>) | null): void {
    this.notificationListener = listener;
  }

  setServerRequestHandler(
    handler: ((request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null,
  ): void {
    this.serverRequestHandler = handler;
  }

  async request<M extends RequestMethod>(method: M, params: RequestParams<M>): Promise<RequestResult<M>> {
    const response = await this.server.handleRequest({
      id: ++this.nextRequestId,
      method,
      params,
    });

    if ("error" in response) {
      throw new Error(response.error.message);
    }

    const parsed = DiligentClientResponseSchema.safeParse({ method, result: response.result });
    if (!parsed.success) {
      throw new Error(`Invalid response for method ${method}: ${parsed.error.message}`);
    }

    return parsed.data.result as RequestResult<M>;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.server.handleNotification({ method, params });
  }
}

export class ProtocolNotificationAdapter {
  private agentMessageByItemId = new Map<string, AssistantMessage>();
  private toolCallByItemId = new Map<string, { toolCallId: string; toolName: string; input: unknown }>();

  toAgentEvents(notification: DiligentServerNotification): AgentEvent[] {
    switch (notification.method) {
      case DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED:
        return [
          {
            type: "status_change",
            status: notification.params.status,
            retry: notification.params.retry,
          },
        ];

      case DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED:
        return [{ type: "turn_start", turnId: notification.params.turnId }];

      case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED:
        return this.handleItemStarted(notification);

      case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA:
        return this.handleItemDelta(notification);

      case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED:
        return this.handleItemCompleted(notification);

      case DILIGENT_SERVER_NOTIFICATION_METHODS.KNOWLEDGE_SAVED:
        return [
          {
            type: "knowledge_saved",
            knowledgeId: notification.params.knowledgeId,
            content: notification.params.content,
          },
        ];

      case DILIGENT_SERVER_NOTIFICATION_METHODS.LOOP_DETECTED:
        return [
          {
            type: "loop_detected",
            patternLength: notification.params.patternLength,
            toolName: notification.params.toolName,
          },
        ];

      case DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR:
        return [
          {
            type: "error",
            error: notification.params.error,
            fatal: notification.params.fatal,
          },
        ];

      default:
        return [];
    }
  }

  private handleItemStarted(
    notification: Extract<
      DiligentServerNotification,
      { method: typeof DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED }
    >,
  ): AgentEvent[] {
    const { item } = notification.params;

    if (item.type === "agentMessage") {
      this.agentMessageByItemId.set(item.itemId, item.message);
      return [{ type: "message_start", itemId: item.itemId, message: item.message }];
    }

    if (item.type === "toolCall") {
      this.toolCallByItemId.set(item.itemId, {
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        input: item.input,
      });
      return [
        {
          type: "tool_start",
          itemId: item.itemId,
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          input: item.input,
        },
      ];
    }

    return [];
  }

  private handleItemDelta(
    notification: Extract<
      DiligentServerNotification,
      { method: typeof DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA }
    >,
  ): AgentEvent[] {
    const { itemId, delta } = notification.params;

    if (delta.type === "messageText" || delta.type === "messageThinking") {
      const message = this.agentMessageByItemId.get(itemId) ?? createEmptyAssistantMessage();
      return [
        {
          type: "message_delta",
          itemId,
          message,
          delta: {
            type: delta.type === "messageText" ? "text_delta" : "thinking_delta",
            delta: delta.delta,
          },
        },
      ];
    }

    if (delta.type === "toolOutput") {
      const tool = this.toolCallByItemId.get(itemId);
      if (!tool) return [];

      return [
        {
          type: "tool_update",
          itemId,
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          partialResult: delta.delta,
        },
      ];
    }

    return [];
  }

  private handleItemCompleted(
    notification: Extract<
      DiligentServerNotification,
      { method: typeof DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED }
    >,
  ): AgentEvent[] {
    const { item } = notification.params;

    if (item.type === "agentMessage") {
      const message = this.agentMessageByItemId.get(item.itemId) ?? item.message;
      this.agentMessageByItemId.delete(item.itemId);
      return [{ type: "message_end", itemId: item.itemId, message }];
    }

    if (item.type === "toolCall") {
      const started = this.toolCallByItemId.get(item.itemId);
      this.toolCallByItemId.delete(item.itemId);

      return [
        {
          type: "tool_end",
          itemId: item.itemId,
          toolCallId: started?.toolCallId ?? item.toolCallId,
          toolName: started?.toolName ?? item.toolName,
          output: item.output ?? "",
          isError: item.isError ?? false,
        },
      ];
    }

    return [];
  }
}
