// @summary Transport-level e2e test: exercises real WebSocket serialization path (connect → initialize → thread/start → notifications → disconnect)

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DILIGENT_VERSION, type DiligentServerNotification, type JSONRPCMessage } from "@diligent/protocol";
import { RpcClientSession } from "@diligent/runtime";
import { createTestServer } from "./helpers/server-factory";
import { createWsTestServer, type WsTestServer } from "./helpers/ws-server-factory";

let tmpDir: string;
let wsServer: WsTestServer;

async function setup() {
  tmpDir = await mkdtemp(join(tmpdir(), "diligent-ws-e2e-"));
  const appServer = createTestServer({ cwd: tmpDir });
  wsServer = createWsTestServer(appServer);
  return { appServer };
}

afterEach(async () => {
  wsServer?.stop();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

/**
 * Connects a real WebSocket to the test server and returns an RpcClientSession
 * backed by that transport. Messages flow through actual JSON serialization.
 */
async function connectWsClient(url: string): Promise<{
  client: RpcClientSession;
  notifications: DiligentServerNotification[];
  waitFor: (method: string, timeout?: number) => Promise<DiligentServerNotification>;
  close: () => void;
}> {
  const notifications: DiligentServerNotification[] = [];
  const notificationWaiters: Array<{
    method: string;
    resolve: (n: DiligentServerNotification) => void;
  }> = [];

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), 3000);

    ws.onopen = () => {
      clearTimeout(timer);

      const client = new RpcClientSession(
        {
          send(message: JSONRPCMessage): void {
            ws.send(JSON.stringify(message));
          },
        },
        {
          onNotification(notification: DiligentServerNotification) {
            notifications.push(notification);
            for (let i = notificationWaiters.length - 1; i >= 0; i--) {
              if (notificationWaiters[i].method === notification.method) {
                notificationWaiters[i].resolve(notification);
                notificationWaiters.splice(i, 1);
              }
            }
          },
        },
      );

      ws.onmessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : event.data.toString();
        void client.handleMessage(JSON.parse(raw) as JSONRPCMessage);
      };

      const waitFor = (method: string, timeout = 3000): Promise<DiligentServerNotification> => {
        const existing = notifications.find((n) => n.method === method);
        if (existing) return Promise.resolve(existing);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`Timeout waiting for notification: ${method}`)), timeout);
          notificationWaiters.push({
            method,
            resolve: (n) => {
              clearTimeout(t);
              res(n);
            },
          });
        });
      };

      resolve({ client, notifications, waitFor, close: () => ws.close() });
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection error"));
    };
  });
}

describe("websocket-transport", () => {
  test("connect, initialize, and disconnect over real WebSocket", async () => {
    await setup();
    const { client, close } = await connectWsClient(wsServer.url);

    const result = (await client.request("initialize", {
      clientName: "ws-test",
      clientVersion: DILIGENT_VERSION,
      protocolVersion: 1,
    })) as Record<string, unknown>;

    expect(result.serverName).toBe("diligent-app-server");
    expect(result.protocolVersion).toBe(1);

    close();
  });

  test("thread/start returns threadId and emits THREAD_STARTED notification over WebSocket", async () => {
    await setup();
    const { client, waitFor, close } = await connectWsClient(wsServer.url);

    await client.request("initialize", {
      clientName: "ws-test",
      clientVersion: DILIGENT_VERSION,
      protocolVersion: 1,
    });

    const result = (await client.request("thread/start", {
      cwd: tmpDir,
      mode: "default",
    })) as { threadId: string };

    expect(result.threadId).toMatch(/^\d{20}-[0-9a-f]{6}$/);

    const notification = await waitFor("thread/started");
    expect((notification.params as Record<string, unknown>).threadId).toBe(result.threadId);

    close();
  });

  test("turn/start triggers turn notifications over real WebSocket transport", async () => {
    await setup();
    const { client, waitFor, close } = await connectWsClient(wsServer.url);

    await client.request("initialize", {
      clientName: "ws-test",
      clientVersion: DILIGENT_VERSION,
      protocolVersion: 1,
    });

    const { threadId } = (await client.request("thread/start", {
      cwd: tmpDir,
      mode: "default",
    })) as { threadId: string };

    await client.request("thread/subscribe", { threadId });

    // Start a turn — the fake stream produces an immediate response
    await client.request("turn/start", { threadId, message: "hello" });

    // turn/completed must arrive via the real WebSocket channel, proving
    // that notifications survive JSON serialization through the transport layer
    const completed = await waitFor("turn/completed", 5000);
    expect((completed.params as Record<string, unknown>).threadId).toBe(threadId);

    close();
  });
});
