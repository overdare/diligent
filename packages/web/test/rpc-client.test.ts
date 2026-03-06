// @summary Tests for WebRpcClient request handling and reconnect delay policy
import { afterEach, expect, test } from "bun:test";
import { getReconnectAttemptLimit, getReconnectDelay, WebRpcClient } from "../src/client/lib/rpc-client";

const OriginalWebSocket = globalThis.WebSocket;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sent: string[] = [];

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
      this.onmessage?.({
        data: JSON.stringify({
          type: "connected",
          cwd: process.cwd(),
          mode: "default",
          effort: "medium",
          serverVersion: "test",
        }),
      });
    });
  }

  send(payload: string) {
    this.sent.push(payload);
    const parsed = JSON.parse(payload) as { type: string; id?: number };
    if (parsed.type === "rpc_request" && typeof parsed.id === "number") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "rpc_response",
            response: {
              id: parsed.id,
              result: { accepted: true },
            },
          }),
        });
      });
    }
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
  FakeWebSocket.instances = [];
});

test("sends rpc request and resolves rpc response", async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  const client = new WebRpcClient("ws://example.test/rpc");
  await client.connect();

  const result = await client.request("turn/start", {
    threadId: "t1",
    message: "hi",
  });

  expect((result as { accepted: boolean }).accepted).toBe(true);
  client.disconnect();
});

test("returns expected reconnect delays", () => {
  expect(getReconnectDelay(0)).toBe(1000);
  expect(getReconnectDelay(1)).toBe(2000);
  expect(getReconnectDelay(2)).toBe(5000);
  expect(getReconnectDelay(10)).toBe(5000);
  expect(getReconnectAttemptLimit()).toBe(5);
});

test("retries when initial websocket open fails", async () => {
  class FlakyWebSocket {
    static OPEN = 1;
    static attempts = 0;

    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public readonly url: string) {
      FlakyWebSocket.attempts += 1;
      const attempt = FlakyWebSocket.attempts;
      queueMicrotask(() => {
        if (attempt === 1) {
          this.onerror?.();
          return;
        }
        this.readyState = FlakyWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({
          data: JSON.stringify({
            type: "connected",
            cwd: process.cwd(),
            mode: "default",
            effort: "medium",
            serverVersion: "test",
          }),
        });
      });
    }

    send(_: string) {}

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  globalThis.WebSocket = FlakyWebSocket as unknown as typeof WebSocket;
  const states: string[] = [];
  const client = new WebRpcClient("ws://example.test/rpc");
  client.onConnectionChange((state) => states.push(state));

  await client.connect();
  expect(FlakyWebSocket.attempts).toBe(2);
  expect(states).toContain("reconnecting");
  expect(states.at(-1)).toBe("connected");

  client.disconnect();
});
