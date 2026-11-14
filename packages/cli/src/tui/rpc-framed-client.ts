// @summary Helpers for creating child-process-backed stdio RPC clients for the CLI

import {
  DILIGENT_SERVER_REQUEST_METHODS,
  type DiligentServerRequest,
  type DiligentServerRequestResponse,
} from "@diligent/protocol";
import { type SpawnCliAppServerOptions, spawnCliAppServerProcess } from "./app-server-process";
import { type SpawnedAppServer, StdioAppServerRpcClient } from "./rpc-client";

export interface SpawnRpcClientOptions extends SpawnCliAppServerOptions {
  onStderrLine?: (line: string) => void;
}

export async function spawnCliAppServer(options: SpawnRpcClientOptions): Promise<SpawnedAppServer> {
  const child = spawnCliAppServerProcess(options);
  const client = new StdioAppServerRpcClient(child, options.onStderrLine);

  client.setServerRequestHandler(
    async (_requestId, request: DiligentServerRequest): Promise<DiligentServerRequestResponse> => {
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
    },
  );

  return client;
}
