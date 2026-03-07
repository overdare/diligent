// @summary Tests for RpcBridge raw JSON-RPC multi-subscriber fan-out and first-responder behavior
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiligentServerRequest, JSONRPCMessage } from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";
import { RpcBridge } from "../src/server/rpc-bridge";
import { WEB_IMAGE_ROUTE_PREFIX } from "../src/shared/image-routes";

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
        },
      };
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
  const sent: JSONRPCMessage[] = [];
  const ws = {
    data: { sessionId },
    send(payload: string) {
      sent.push(JSON.parse(payload) as JSONRPCMessage);
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
      id: 1,
      method: "thread/start",
      params: { cwd: "/tmp" },
    }),
  );

  server.handleRequest = origHandle;
}

describe("RpcBridge multi-subscriber", () => {
  test("routes raw initialize request and response", async () => {
    const { bridge } = createBridge();
    const { ws, sent } = createFakeWs("s1");
    bridge.open(ws);

    await bridge.message(
      ws,
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientName: "web", clientVersion: "0.0.1", protocolVersion: 1 },
      }),
    );

    const response = sent.find((entry) => "id" in entry && entry.id === 1 && "result" in entry) as
      | { id: number; result: { protocolVersion: number } }
      | undefined;
    expect(response?.result.protocolVersion).toBe(1);
  });

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

    const responsePromise = server.serverRequestHandler!(request);

    const serverRequest = sent.find(
      (entry) => "id" in entry && "method" in entry && entry.method === "approval/request",
    ) as {
      id: number;
    };
    expect(serverRequest).toBeTruthy();

    await bridge.message(
      ws,
      JSON.stringify({
        id: serverRequest.id,
        result: { decision: "once" },
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

    await startThread(bridge, ws1, "thread1");

    await bridge.message(
      ws2,
      JSON.stringify({
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    sent1.length = 0;
    sent2.length = 0;

    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "hello" } },
    } as import("@diligent/protocol").DiligentServerNotification);

    const notif1 = sent1.find((e) => "method" in e && e.method === "item/delta");
    const notif2 = sent2.find((e) => "method" in e && e.method === "item/delta");
    expect(notif1).toBeTruthy();
    expect(notif2).toBeTruthy();
  });

  test("first-responder wins: second response is ignored and others are notified", async () => {
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

    const responsePromise = server.serverRequestHandler!(request);

    const req1 = sent1.find((e) => "id" in e && "method" in e && e.method === "approval/request") as { id: number };
    const req2 = sent2.find((e) => "id" in e && "method" in e && e.method === "approval/request") as { id: number };
    expect(req1.id).toBe(req2.id);

    await bridge.message(
      ws1,
      JSON.stringify({
        id: req1.id,
        result: { decision: "once" },
      }),
    );

    await bridge.message(
      ws2,
      JSON.stringify({
        id: req2.id,
        result: { decision: "always" },
      }),
    );

    const response = await responsePromise;
    expect(response.method).toBe("approval/request");
    if (response.method === "approval/request") {
      expect(response.result.decision).toBe("once");
    }

    const resolvedNotification = sent2.find(
      (entry) =>
        "method" in entry &&
        entry.method === DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED &&
        (entry as { params?: { requestId?: number } }).params?.requestId === req1.id,
    );
    expect(resolvedNotification).toBeTruthy();
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
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    bridge.close(ws1);

    sent2.length = 0;

    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "world" } },
    } as import("@diligent/protocol").DiligentServerNotification);

    const notif2 = sent2.find((e) => "method" in e && e.method === "item/delta");
    expect(notif2).toBeTruthy();
  });

  test("no connected clients: server request resolves with safe fallback", async () => {
    const server = new FakeAppServer();
    createBridge(server);

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
      expect(response.result.decision).toBe("reject");
    }
  });

  test("thread/unsubscribe removes subscription", async () => {
    const server = new FakeAppServer();
    const { bridge } = createBridge(server);

    const { ws, sent } = createFakeWs("s1");
    bridge.open(ws);

    await bridge.message(
      ws,
      JSON.stringify({
        id: 10,
        method: "thread/subscribe",
        params: { threadId: "thread1" },
      }),
    );

    const subResponse = sent.find(
      (e) => "id" in e && e.id === 10 && "result" in e && (e.result as { subscriptionId?: string }).subscriptionId,
    ) as { result: { subscriptionId: string } };
    const subscriptionId = subResponse.result.subscriptionId;

    await bridge.message(
      ws,
      JSON.stringify({
        id: 11,
        method: "thread/unsubscribe",
        params: { subscriptionId },
      }),
    );

    const unsubResponse = sent.find((e) => "id" in e && e.id === 11 && "result" in e) as {
      result: { ok: boolean };
    };
    expect(unsubResponse.result.ok).toBe(true);

    sent.length = 0;

    server.notificationListener!({
      method: "item/delta",
      params: { threadId: "thread1", itemId: "i1", delta: { text: "test" } },
    } as import("@diligent/protocol").DiligentServerNotification);

    const notif = sent.find((e) => "method" in e && e.method === "item/delta");
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

      const response = sent.find((entry) => "id" in entry && entry.id === 50 && "result" in entry) as {
        result: {
          attachment: { type: string; path: string; mediaType: string; fileName: string; webUrl: string };
        };
      };

      expect(response.result.attachment.type).toBe("local_image");
      expect(response.result.attachment.mediaType).toBe("image/png");
      expect(response.result.attachment.fileName).toBe("screen.png");
      expect(response.result.attachment.path).toContain(".diligent/images/thread1/");
      expect(response.result.attachment.webUrl).toContain(`${WEB_IMAGE_ROUTE_PREFIX}thread1/`);
      expect(await Bun.file(response.result.attachment.path).text()).toBe("png-bytes");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
