// @summary In-process JSON-RPC client for TUI/app-server communication
import type { DiligentAppServer } from "@diligent/core";
import {
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
