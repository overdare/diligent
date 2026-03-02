// @summary Tests for RpcBridge server-request roundtrip and fallback behavior
import { expect, test } from "bun:test";
import type { DiligentServerRequest } from "@diligent/protocol";
import { RpcBridge } from "../src/server/rpc-bridge";

class FakeAppServer {
  setNotificationListener(): void {}
  setServerRequestHandler(): void {}
  async handleRequest(): Promise<{ id: number; result: unknown }> {
    return { id: 1, result: {} };
  }
  async handleNotification(): Promise<void> {}
}

test("resolves server request using client response", async () => {
  const bridge = new RpcBridge(
    new FakeAppServer() as unknown as import("@diligent/core").DiligentAppServer,
    process.cwd(),
    "default",
    { currentModelId: "test-model", availableModels: [], onModelChange: () => {} },
  );

  const sent: unknown[] = [];
  const ws = {
    data: { sessionId: "s1" },
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
  };

  bridge.open(ws as unknown as import("bun").ServerWebSocket<import("../src/server/rpc-bridge").RpcWsData>);

  const request: DiligentServerRequest = {
    method: "approval/request",
    params: {
      threadId: "thread1",
      request: {
        permission: "execute",
        toolName: "bash",
        description: "run command",
      },
    },
  };

  const responsePromise = bridge.requestFromClient("s1", request);

  const serverRequest = sent.find((entry) => (entry as { type?: string }).type === "server_request") as {
    id: number;
  };

  await bridge.message(
    ws as unknown as import("bun").ServerWebSocket<import("../src/server/rpc-bridge").RpcWsData>,
    JSON.stringify({
      type: "server_request_response",
      id: serverRequest.id,
      response: {
        method: "approval/request",
        result: { decision: "once" },
      },
    }),
  );

  const response = await responsePromise;
  expect(response.method).toBe("approval/request");
  if (response.method === "approval/request") {
    expect(response.result.decision).toBe("once");
  }
});
