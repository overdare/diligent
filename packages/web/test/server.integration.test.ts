// @summary Integration-style test for RpcBridge raw JSON-RPC websocket message flow with app-server contract
import { expect, test } from "bun:test";
import type { JSONRPCMessage, JSONRPCResponse } from "@diligent/protocol";
import { RpcBridge } from "../src/server/rpc-bridge";

class FakeAppServer {
  private notificationListener: ((notification: unknown) => void | Promise<void>) | null = null;

  setNotificationListener(listener: ((notification: unknown) => void | Promise<void>) | null): void {
    this.notificationListener = listener;
  }

  setServerRequestHandler(handler: ((request: unknown) => Promise<unknown>) | null): void {
    void handler;
  }

  async handleRequest(raw: unknown): Promise<JSONRPCResponse> {
    const req = raw as { id: number; method: string; params?: Record<string, unknown> };

    if (req.method === "initialize") {
      return {
        id: req.id,
        result: {
          serverName: "fake",
          serverVersion: "0.0.1",
          protocolVersion: 1,
          capabilities: {
            supportsFollowUp: true,
            supportsApprovals: true,
            supportsUserInput: true,
          },
          cwd: process.cwd(),
          mode: "default",
          effort: "medium",
          currentModel: "test-model",
          availableModels: [],
        },
      };
    }

    if (req.method === "thread/start") {
      return {
        id: req.id,
        result: {
          threadId: "thread-test",
        },
      };
    }

    if (req.method === "turn/start") {
      await this.notificationListener?.({
        method: "turn/started",
        params: { threadId: "thread-test", turnId: "turn-test" },
      });
      return {
        id: req.id,
        result: {
          accepted: true,
        },
      };
    }

    if (req.method === "turn/interrupt") {
      return {
        id: req.id,
        result: {
          interrupted: true,
        },
      };
    }

    return {
      id: req.id,
      result: {},
    };
  }

  async handleNotification(): Promise<void> {}
}

test("bridge routes initialize -> thread/start -> turn/start -> turn/interrupt over raw json-rpc", async () => {
  const fakeServer = new FakeAppServer();
  const bridge = new RpcBridge(
    fakeServer as unknown as import("@diligent/core").DiligentAppServer,
    process.cwd(),
    "default",
    { currentModelId: "test-model", allModels: [], getAvailableModels: () => [], onModelChange: () => {} },
  );

  const sent: JSONRPCMessage[] = [];
  const ws = {
    data: { sessionId: "s1" },
    send(payload: string) {
      sent.push(JSON.parse(payload) as JSONRPCMessage);
    },
  };

  const serverWs = ws as unknown as import("bun").ServerWebSocket<import("../src/server/rpc-bridge").RpcWsData>;

  bridge.open(serverWs);

  await bridge.message(
    serverWs,
    JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientName: "test",
        clientVersion: "0.0.1",
        protocolVersion: 1,
      },
    }),
  );

  await bridge.message(
    serverWs,
    JSON.stringify({
      id: 2,
      method: "thread/start",
      params: { cwd: process.cwd(), mode: "default" },
    }),
  );

  await bridge.message(
    serverWs,
    JSON.stringify({
      id: 3,
      method: "turn/start",
      params: { message: "hello" },
    }),
  );

  await bridge.message(
    serverWs,
    JSON.stringify({
      id: 4,
      method: "turn/interrupt",
      params: {},
    }),
  );

  const responses = sent.filter((entry) => "id" in entry && "result" in entry) as Array<{
    id: number;
    result: unknown;
  }>;

  expect(responses.length).toBe(4);
  expect((responses.find((r) => r.id === 1)?.result as { cwd: string }).cwd).toBe(process.cwd());
  expect((responses.find((r) => r.id === 2)?.result as { threadId: string }).threadId).toBe("thread-test");
  expect((responses.find((r) => r.id === 3)?.result as { accepted: boolean }).accepted).toBe(true);
  expect((responses.find((r) => r.id === 4)?.result as { interrupted: boolean }).interrupted).toBe(true);

  const turnStartedNotif = sent.find((entry) => "method" in entry && entry.method === "turn/started") as
    | { method: string }
    | undefined;

  expect(turnStartedNotif?.method).toBe("turn/started");
});
