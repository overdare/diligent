// @summary Tests for RpcBridge multi-subscriber model, fan-out, and first-responder behavior
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiligentServerRequest } from "@diligent/protocol";
import { RpcBridge } from "../src/server/rpc-bridge";

type NotificationListener = (notification: import("@diligent/protocol").DiligentServerNotification) => void;
type ServerRequestHandler = (
  request: import("@diligent/protocol").DiligentServerRequest,
) => Promise<import("@diligent/protocol").DiligentServerRequestResponse>;

class FakeAppServer {
  notificationListener: NotificationListener | null = null;
  serverRequestHandler: ServerRequestHandler | null = null;

  setNotificationListener(listener: NotificationListener): void {
    this.notificationListener = listener;
  }
  setServerRequestHandler(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }
  async handleRequest(req: {
    id: number | string;
    method: string;
    params: unknown;
  }): Promise<{ id: number | string; result: unknown }> {
    if (req.method === "thread/start") {
      return { id: req.id, result: { threadId: `t-${Date.now()}` } };
    }
    return { id: req.id, result: {} };
  }
  async handleNotification(): Promise<void> {}
}

function createBridge(fakeServer?: FakeAppServer, cwd = process.cwd()) {
  const server = fakeServer ?? new FakeAppServer();
  const bridge = new RpcBridge(server as unknown as import("@diligent/core").DiligentAppServer, cwd, "default", {
    currentModelId: "test-model",
    allModels: [],
    getAvailableModels: () => [],
    onModelChange: () => {},
  });
  return { bridge, server };
}

function createFakeWs(sessionId: string) {
  const sent: unknown[] = [];
  const ws = {
    data: { sessionId },
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
  };
  return { ws: ws as unknown as import("bun").ServerWebSocket<import("../src/server/rpc-bridge").RpcWsData>, sent };
}

async function startThread(bridge: RpcBridge, ws: ReturnType<typeof createFakeWs>["ws"], threadId: string) {
  const server = (bridge as unknown as { appServer: FakeAppServer }).appServer;
  const origHandle = server.handleRequest.bind(server);
  server.handleRequest = async (req) => {
    if (req.method === "thread/start") {
      return { id: req.id, result: { threadId } };
    }
    return origHandle(req);
  };

  await bridge.message(
    ws,
    JSON.stringify({
      type: "rpc_request",
      id: 1,
      method: "thread/start",
      params: { cwd: "/tmp" },
    }),
  );

  server.handleRequest = origHandle;
}

describe("RpcBridge multi-subscriber", () => {
  test("resolves server request using client response", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);
    const { ws, sent } = createFakeWs("s1");
    bridge.open(ws);

    const request: DiligentServerRequest = {
      method: "approval/request",
      params: {
        threadId: "thread1",
        request: { permission: "execute", toolName: "bash", description: "run command" },
      },
    };

    // Trigger server request through the handler (broadcasts to all clients)
    const responsePromise = server.serverRequestHandler!(request);

    const serverRequest = sent.find((entry) => (entry as { type?: string }).type === "server_request") as {
      id: number;
    };
    expect(serverRequest).toBeTruthy();

    await bridge.message(
      ws,
      JSON.stringify({
        type: "server_request_response",
        id: serverRequest.id,
        response: { method: "approval/request", result: { decision: "once" } },
      }),
    );

    const response = await responsePromise;
    expect(response.method).toBe("approval/request");
    if (response.method === "approval/request") {
      expect(response.result.decision).toBe("once");
    }
  });

  test("fan-out: notifications sent to all subscribers", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);

    const { ws: ws1, sent: sent1 } = createFakeWs("s1");
    const { ws: ws2, sent: sent2 } = createFakeWs("s2");
    bridge.open(ws1);
    bridge.open(ws2);

    // Both subscribe to the same thread
    await startThread(bridge, ws1, "thread1");

    // s2 subscribes via thread/subscribe
    await bridge.message(
      ws2,
      JSON.stringify({
        type: "rpc_request",
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    // Verify subscription response
    const subResponse = sent2.find(
      (entry) =>
        (entry as { type?: string }).type === "rpc_response" &&
        (
          (entry as { response?: { result?: { subscriptionId?: string } } }).response?.result as {
            subscriptionId?: string;
          }
        )?.subscriptionId,
    );
    expect(subResponse).toBeTruthy();

    // Clear sent arrays to only track the notification
    sent1.length = 0;
    sent2.length = 0;

    // Emit a notification for thread1
    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "hello" } },
    });

    // Both should receive it
    const notif1 = sent1.find((e) => (e as { type?: string }).type === "server_notification");
    const notif2 = sent2.find((e) => (e as { type?: string }).type === "server_notification");
    expect(notif1).toBeTruthy();
    expect(notif2).toBeTruthy();
  });

  test("first-responder wins: second response is ignored", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);
    const { ws: ws1, sent: sent1 } = createFakeWs("s1");
    const { ws: ws2, sent: sent2 } = createFakeWs("s2");
    bridge.open(ws1);
    bridge.open(ws2);

    const request: DiligentServerRequest = {
      method: "approval/request",
      params: {
        threadId: "thread1",
        request: { permission: "execute", toolName: "bash", description: "run command" },
      },
    };

    // Broadcast to all clients
    const responsePromise = server.serverRequestHandler!(request);

    // Both sessions should receive the server_request
    const req1 = sent1.find((e) => (e as { type?: string }).type === "server_request") as { id: number };
    const req2 = sent2.find((e) => (e as { type?: string }).type === "server_request") as { id: number };
    expect(req1).toBeTruthy();
    expect(req2).toBeTruthy();
    expect(req1.id).toBe(req2.id); // same requestId

    // s1 responds first
    await bridge.message(
      ws1,
      JSON.stringify({
        type: "server_request_response",
        id: req1.id,
        response: { method: "approval/request", result: { decision: "once" } },
      }),
    );

    // s2 responds late — should be silently ignored
    await bridge.message(
      ws2,
      JSON.stringify({
        type: "server_request_response",
        id: req2.id,
        response: { method: "approval/request", result: { decision: "always" } },
      }),
    );

    const response = await responsePromise;
    expect(response.method).toBe("approval/request");
    if (response.method === "approval/request") {
      expect(response.result.decision).toBe("once"); // first responder wins
    }
  });

  test("disconnect cleanup: remaining subscriber still receives notifications", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);

    const { ws: ws1 } = createFakeWs("s1");
    const { ws: ws2, sent: sent2 } = createFakeWs("s2");
    bridge.open(ws1);
    bridge.open(ws2);

    await startThread(bridge, ws1, "thread1");

    await bridge.message(
      ws2,
      JSON.stringify({
        type: "rpc_request",
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    // s1 disconnects
    bridge.close(ws1);

    sent2.length = 0;

    // Emit notification — only s2 should receive
    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "world" } },
    });

    const notif2 = sent2.find((e) => (e as { type?: string }).type === "server_notification");
    expect(notif2).toBeTruthy();
  });

  test("no connected clients: server request resolves with safe fallback", async () => {
    const server = new FakeAppServer();
    createBridge(server);

    // No clients connected — request should resolve immediately with fallback
    const request: DiligentServerRequest = {
      method: "approval/request",
      params: {
        threadId: "thread1",
        request: { permission: "execute", toolName: "bash", description: "run command" },
      },
    };

    const response = await server.serverRequestHandler!(request);
    expect(response.method).toBe("approval/request");
    if (response.method === "approval/request") {
      expect(response.result.decision).toBe("reject"); // safe fallback
    }
  });

  test("thread/unsubscribe removes subscription", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);

    const { ws, sent } = createFakeWs("s1");
    bridge.open(ws);

    // Subscribe
    await bridge.message(
      ws,
      JSON.stringify({
        type: "rpc_request",
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    // Extract subscriptionId
    const subResponse = sent.find(
      (e) =>
        (e as { type?: string }).type === "rpc_response" &&
        ((e as { response?: { result?: { subscriptionId?: string } } }).response?.result as { subscriptionId?: string })
          ?.subscriptionId,
    ) as { response: { result: { subscriptionId: string } } };
    const subscriptionId = subResponse.response.result.subscriptionId;

    // Unsubscribe
    await bridge.message(
      ws,
      JSON.stringify({
        type: "rpc_request",
        id: 11,
        method: "thread/unsubscribe",
        params: { subscriptionId },
      }),
    );

    // Verify unsubscribe response
    const unsubResponse = sent.find(
      (e) =>
        (e as { type?: string; response?: { id?: number } }).type === "rpc_response" &&
        (e as { response: { id: number } }).response.id === 11,
    ) as { response: { result: { ok: boolean } } };
    expect(unsubResponse.response.result.ok).toBe(true);

    sent.length = 0;

    // Notification should now broadcast (no subscribers)
    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "test" } },
    });

    // Should still receive via broadcast since it's the only session
    const notif = sent.find((e) => (e as { type?: string }).type === "server_notification");
    expect(notif).toBeTruthy();
  });

  test("image/upload persists file and returns local_image attachment", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "diligent-rpc-bridge-"));
    try {
      const server = new FakeAppServer();
      const { bridge } = createBridge(server, projectRoot);
      const { ws, sent } = createFakeWs("s1");
      bridge.open(ws);

      await bridge.message(
        ws,
        JSON.stringify({
          type: "rpc_request",
          id: 50,
          method: "image/upload",
          params: {
            threadId: "thread1",
            fileName: "screen.png",
            mediaType: "image/png",
            dataBase64: Buffer.from("png-bytes").toString("base64"),
          },
        }),
      );

      const response = sent.find(
        (entry) =>
          (entry as { type?: string; response?: { id?: number } }).type === "rpc_response" &&
          (entry as { response: { id: number } }).response.id === 50,
      ) as {
        response: { result: { attachment: { type: string; path: string; mediaType: string; fileName: string } } };
      };

      expect(response.response.result.attachment.type).toBe("local_image");
      expect(response.response.result.attachment.mediaType).toBe("image/png");
      expect(response.response.result.attachment.fileName).toBe("screen.png");
      expect(response.response.result.attachment.path).toContain(".diligent/images/thread1/");
      expect(await Bun.file(response.response.result.attachment.path).text()).toBe("png-bytes");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
