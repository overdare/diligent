// @summary In-process DiligentAppServer + RpcClientSession adapter for CLI unit tests
import type { DiligentPaths } from "@diligent/core";
import { DiligentAppServer, RpcClientSession } from "@diligent/core";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCMessage,
} from "@diligent/protocol";
import { DILIGENT_SERVER_REQUEST_METHODS } from "@diligent/protocol";
import type { AppConfig } from "../../src/config";
import type { SpawnedAppServer } from "../../src/tui/rpc-client";
import type { SpawnRpcClientOptions } from "../../src/tui/rpc-framed-client";

/**
 * Creates a factory that produces an in-process SpawnedAppServer backed by a
 * real DiligentAppServer wired via RpcClientSession — no child process needed.
 */
export function createInProcessRpcClientFactory(
  config: AppConfig,
  paths: DiligentPaths,
): (options: SpawnRpcClientOptions) => Promise<SpawnedAppServer> {
  return async (_options: SpawnRpcClientOptions): Promise<SpawnedAppServer> => {
    const server = new DiligentAppServer({
      cwd: process.cwd(),
      resolvePaths: async () => paths,
      buildAgentConfig: ({ mode, signal, approve, ask }) => ({
        model: config.model,
        systemPrompt: config.systemPrompt,
        tools: [],
        mode,
        signal,
        approve,
        ask,
        streamFunction: config.streamFunction,
      }),
    });

    let notificationListener: ((notification: DiligentServerNotification) => void | Promise<void>) | null = null;
    let serverRequestHandler:
      | ((requestId: number | string, request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>)
      | null = null;

    // Server-side message listener — captured during connect()
    let serverMessageListener: ((msg: JSONRPCMessage) => void | Promise<void>) | null = null;

    const rpcClient = new RpcClientSession(
      {
        send(message: JSONRPCMessage) {
          // Client → server
          if (serverMessageListener) {
            void serverMessageListener(message);
          }
        },
      },
      {
        onNotification(notification: DiligentServerNotification) {
          void notificationListener?.(notification);
        },
        async onServerRequest(request: DiligentServerRequest) {
          if (serverRequestHandler) {
            return serverRequestHandler(0, request);
          }
          if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
            return {
              method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
              result: { decision: "once" as const },
            };
          }
          return {
            method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
            result: { answers: {} },
          } as DiligentServerRequestResponse;
        },
      },
    );

    const disconnect = server.connect("test-cli", {
      send(message: JSONRPCMessage) {
        // Server → client
        void rpcClient.handleMessage(message);
      },
      onMessage(listener) {
        serverMessageListener = listener;
      },
      onClose() {
        // no-op for tests
      },
    });

    const adapter: SpawnedAppServer = {
      async request(method, params) {
        return rpcClient.request(method as never, params as never) as never;
      },
      notify(method, params) {
        return rpcClient.notify(method, params);
      },
      setNotificationListener(listener) {
        notificationListener = listener;
      },
      setServerRequestHandler(handler) {
        serverRequestHandler = handler;
      },
      async dispose() {
        rpcClient.close();
        disconnect();
      },
    };

    return adapter;
  };
}
