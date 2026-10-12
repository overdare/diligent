// @summary Tests for app-server server-request broadcast timeout behavior

import { describe, expect, it } from "bun:test";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type JSONRPCMessage,
} from "@diligent/protocol";
import {
  broadcastServerRequest,
  handleServerResponseMessage,
  requestApprovalFromConnections,
} from "@diligent/runtime/app-server/server-requests";

describe("broadcastServerRequest", () => {
  it("goal approval rejects missing and unanswered consumers instead of granting once", async () => {
    let paused = 0;
    const pending = new Map();
    const args = {
      threadId: "thread",
      request: { permission: "execute" as const, toolName: "bash", description: "Run tests" },
      connections: new Map(),
      pendingServerRequests: pending,
      allocateServerRequestId: () => 4,
      onUnavailable: async () => {
        paused++;
      },
    };
    expect(await requestApprovalFromConnections(args)).toBe("reject");
    const connections = new Map([["c", { id: "c", peer: { async send() {}, onMessage() {} } }]]);
    const response = requestApprovalFromConnections({ ...args, connections });
    pending.get(4).resolve(null);
    clearTimeout(pending.get(4).timeoutId);
    pending.delete(4);
    expect(await response).toBe("reject");
    expect(paused).toBe(2);
  });
  it("cancels durable requests without resolving a permissive null response", async () => {
    const received: JSONRPCMessage[] = [];
    const connections = new Map([
      [
        "c",
        {
          id: "c",
          peer: {
            async send(message: JSONRPCMessage) {
              received.push(message);
            },
            onMessage() {},
          },
        },
      ],
    ]);
    const pending = new Map();
    const controller = new AbortController();
    const response = broadcastServerRequest({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: {},
      connections,
      pendingServerRequests: pending,
      allocateServerRequestId: () => 1,
      timeoutMs: null,
      signal: controller.signal,
    });
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    expect(pending.size).toBe(0);
    expect(received).toContainEqual({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED,
      params: { requestId: 1 },
    });
  });
  it("emits server_request_resolved to recipients when request times out", async () => {
    const received: JSONRPCMessage[] = [];
    const connections = new Map([
      [
        "conn-1",
        {
          id: "conn-1",
          peer: {
            async send(message: JSONRPCMessage) {
              received.push(message);
            },
            onMessage() {},
          },
        },
      ],
    ]);

    const pending = new Map();
    let nextId = 1;

    const response = await broadcastServerRequest({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: { threadId: "thread-1", request: { questions: [] } },
      connections,
      pendingServerRequests: pending,
      allocateServerRequestId: () => nextId++,
      timeoutMs: 20,
    });

    expect(response).toBeNull();

    const request = received.find((m) => "id" in m && "method" in m);
    expect(request).toBeDefined();

    const resolvedNotification = received.find(
      (m) => "method" in m && !("id" in m) && m.method === DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED,
    );
    expect(resolvedNotification).toBeDefined();
    expect((resolvedNotification as { params?: { requestId?: number } }).params?.requestId).toBe(1);
    expect(pending.size).toBe(0);
  });

  it("can wait without a timeout and resolves the responding client", async () => {
    const received: JSONRPCMessage[] = [];
    const connections = new Map([
      [
        "conn-1",
        {
          id: "conn-1",
          peer: {
            async send(message: JSONRPCMessage) {
              received.push(message);
            },
            onMessage() {},
          },
        },
      ],
    ]);
    const pending = new Map();

    const responsePromise = broadcastServerRequest({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: { threadId: "thread-1", request: { questions: [] } },
      connections,
      pendingServerRequests: pending,
      allocateServerRequestId: () => 7,
      timeoutMs: null,
    });

    expect(pending.size).toBe(1);

    await handleServerResponseMessage({
      connectionId: "conn-1",
      message: { id: 7, result: { answers: { q1: "yes" } } },
      pendingServerRequests: pending,
      getConnectionById: (id) => connections.get(id),
    });

    await expect(responsePromise).resolves.toEqual({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      result: { answers: { q1: "yes" } },
    });
    expect(received).toContainEqual({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED,
      params: { requestId: 7 },
    });
    expect(pending.size).toBe(0);
  });

  it("marks no-timeout requests durable and records threadId + params for re-delivery", () => {
    const connections = new Map([["conn-1", { id: "conn-1", peer: { async send() {}, onMessage() {} } }]]);
    const pending = new Map();
    const params = { threadId: "thread-1", request: { questions: [] } };

    void broadcastServerRequest({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params,
      connections,
      pendingServerRequests: pending,
      allocateServerRequestId: () => 9,
      timeoutMs: null,
      threadId: "thread-1",
    });

    const entry = pending.get(9);
    expect(entry?.durable).toBe(true);
    expect(entry?.threadId).toBe("thread-1");
    expect(entry?.params).toEqual(params);
    expect(entry?.timeoutId).toBeNull();
  });

  it("resolves a durable request from a different (reconnected) connection id", async () => {
    const connections = new Map([["conn-old", { id: "conn-old", peer: { async send() {}, onMessage() {} } }]]);
    const pending = new Map();

    const responsePromise = broadcastServerRequest({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: { threadId: "thread-1", request: { questions: [] } },
      connections,
      pendingServerRequests: pending,
      allocateServerRequestId: () => 11,
      timeoutMs: null,
      threadId: "thread-1",
    });

    // Original connection dropped; a brand-new connection delivers the answer with the same id.
    await handleServerResponseMessage({
      connectionId: "conn-new",
      message: { id: 11, result: { answers: { q1: "late" } } },
      pendingServerRequests: pending,
      getConnectionById: (id) => connections.get(id),
    });

    await expect(responsePromise).resolves.toEqual({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      result: { answers: { q1: "late" } },
    });
    expect(pending.size).toBe(0);
  });
});
