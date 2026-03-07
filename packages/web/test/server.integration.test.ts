// @summary Integration-style test for DiligentAppServer JSON-RPC flow via connect() peer API
import { expect, test } from "bun:test";
import { DiligentAppServer, EventStream, ensureDiligentDir } from "@diligent/core";
import type { JSONRPCMessage } from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";

function createFakePeer() {
  const sent: JSONRPCMessage[] = [];
  const messageListeners: Array<(msg: JSONRPCMessage) => void | Promise<void>> = [];

  return {
    sent,
    receive(msg: JSONRPCMessage) {
      for (const l of messageListeners) void l(msg);
    },
    peer: {
      send(message: JSONRPCMessage) {
        sent.push(message);
      },
      onMessage(listener: (msg: JSONRPCMessage) => void | Promise<void>) {
        messageListeners.push(listener);
      },
    } as import("@diligent/core").RpcPeer,
  };
}

test("connect() peer: initialize -> thread/start -> turn/start emits turn notifications", async () => {
  const server = new DiligentAppServer({
    cwd: process.cwd(),
    resolvePaths: async (cwd) => ensureDiligentDir(cwd),
    buildAgentConfig: ({ mode, signal, approve, ask }) => ({
      model: { id: "fake", provider: "fake", contextWindow: 8192, maxOutputTokens: 4096 },
      systemPrompt: [],
      tools: [],
      mode,
      signal,
      approve,
      ask,
      streamFunction: () => {
        const stream = new EventStream(
          (e) => e.type === "done",
          (e) => ({ message: (e as { message: unknown }).message }),
        );
        queueMicrotask(() => {
          stream.push({ type: "start" });
          stream.push({ type: "text_delta", delta: "hello" });
          stream.push({
            type: "done",
            stopReason: "end_turn",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              model: "fake",
              usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
              stopReason: "end_turn",
              timestamp: Date.now(),
            },
          });
        });
        return stream as never;
      },
    }),
    getInitializeResult: async () => ({
      cwd: process.cwd(),
      mode: "default",
      effort: "medium",
      currentModel: "fake",
      availableModels: [],
    }),
  });

  const p = createFakePeer();
  server.connect("c1", p.peer);

  const sendAndWait = (msg: object) => {
    return new Promise<JSONRPCMessage>((resolve, reject) => {
      const id = (msg as { id: number }).id;
      p.receive(msg as JSONRPCMessage);
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for response to id=${id}`)), 2000);
      const interval = setInterval(() => {
        const found = p.sent.find(
          (m) => "id" in m && (m as { id: unknown }).id === id && ("result" in m || "error" in m),
        );
        if (found) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(found);
        }
      }, 10);
    });
  };

  // initialize
  const initResp = (await sendAndWait({
    id: 1,
    method: "initialize",
    params: { clientName: "test", clientVersion: "0.0.1", protocolVersion: 1 },
  })) as { result: { protocolVersion: number; cwd: string } };
  expect(initResp.result.protocolVersion).toBe(1);
  expect(initResp.result.cwd).toBe(process.cwd());

  // thread/start
  const startResp = (await sendAndWait({
    id: 2,
    method: "thread/start",
    params: { cwd: process.cwd(), mode: "default" },
  })) as { result: { threadId: string } };
  const threadId = startResp.result.threadId;
  expect(typeof threadId).toBe("string");
  expect(threadId.length).toBeGreaterThan(0);

  // Wait for THREAD_STARTED notification
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for THREAD_STARTED")), 2000);
    const interval = setInterval(() => {
      if (p.sent.find((m) => "method" in m && m.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED)) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 10);
  });

  // thread/subscribe
  await sendAndWait({ id: 3, method: "thread/subscribe", params: { threadId } });

  p.sent.length = 0;

  // turn/start
  const turnResp = (await sendAndWait({ id: 4, method: "turn/start", params: { threadId, message: "hello" } })) as {
    result: { accepted: boolean };
  };
  expect(turnResp.result.accepted).toBe(true);

  // Wait for turn/completed
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for TURN_COMPLETED")), 3000);
    const interval = setInterval(() => {
      if (p.sent.find((m) => "method" in m && m.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED)) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 10);
  });

  // Check that turn notifications were received
  const hasStarted = p.sent.some(
    (m) => "method" in m && m.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
  );
  const hasCompleted = p.sent.some(
    (m) => "method" in m && m.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED,
  );
  expect(hasStarted).toBe(true);
  expect(hasCompleted).toBe(true);
});
