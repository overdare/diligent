// @summary Tests for DiligentAppServer JSON-RPC request handling and event notifications

import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { DiligentServerNotification } from "@diligent/protocol";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type JSONRPCResponse,
} from "@diligent/protocol";
import { DiligentAppServer } from "../src/app-server";
import { EventStream } from "../src/event-stream";
import { ensureDiligentDir } from "../src/infrastructure/diligent-dir";
import { requestUserInputTool } from "../src/tools/request-user-input";

function readResult(response: JSONRPCResponse): unknown {
  if ("error" in response) {
    throw new Error(response.error.message);
  }
  return response.result;
}

describe("DiligentAppServer", () => {
  it("handles initialize/thread/start/turn/start and emits codex-like notifications", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ mode, signal, approve, ask }) => ({
        model: {
          id: "fake-model",
          provider: "fake",
          contextWindow: 128_000,
          maxOutputTokens: 4096,
        },
        systemPrompt: [{ label: "base", content: "test" }],
        tools: [],
        mode,
        signal,
        approve,
        ask,
        streamFunction: () => {
          const stream = new EventStream(
            (event) => event.type === "done",
            (event) => ({ message: (event as { message: unknown }).message }),
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
                model: "fake-model",
                usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
                stopReason: "end_turn",
                timestamp: Date.now(),
              },
            });
          });

          return stream as never;
        },
      }),
    });

    const notifications: DiligentServerNotification[] = [];
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });

    server.setNotificationListener((notification) => {
      notifications.push(notification);
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    const init = await server.handleRequest({
      id: 1,
      method: "initialize",
      params: { clientName: "tui", clientVersion: "0.0.1", protocolVersion: 1 },
    });
    const initResult = readResult(init) as { protocolVersion: number };
    expect(initResult.protocolVersion).toBe(1);

    const start = await server.handleRequest({
      id: 2,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };
    // sessionId format: YYYYMMDDHHMMSS-xxxxxx (timestamp + 6-char random)
    expect(startResult.threadId).toMatch(/^\d{14}-[0-9a-f]{6}$/);

    const turnStart = await server.handleRequest({
      id: 3,
      method: "turn/start",
      params: { threadId: startResult.threadId, message: "hi" },
    });
    const turnStartResult = readResult(turnStart) as { accepted: boolean };
    expect(turnStartResult.accepted).toBe(true);

    await turnCompleted;

    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED)).toBe(true);
  });

  it("treats empty user-input response as aborted turn", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ mode, signal, approve, ask }) => ({
        model: {
          id: "fake-model",
          provider: "fake",
          contextWindow: 128_000,
          maxOutputTokens: 4096,
        },
        systemPrompt: [{ label: "base", content: "test" }],
        tools: [requestUserInputTool as never],
        mode,
        signal,
        approve,
        ask,
        streamFunction: () => {
          const stream = new EventStream(
            (event) => event.type === "done",
            (event) => ({ message: (event as { message: unknown }).message }),
          );

          queueMicrotask(() => {
            stream.push({ type: "start" });
            stream.push({
              type: "done",
              stopReason: "tool_use",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "tool_call",
                    id: "tc-1",
                    name: "request_user_input",
                    input: {
                      questions: [
                        {
                          id: "q1",
                          header: "scope",
                          question: "Pick one",
                          options: [
                            { label: "A (Recommended)", description: "Preferred" },
                            { label: "B", description: "Alternative" },
                          ],
                        },
                      ],
                    },
                  },
                ],
                model: "fake-model",
                usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
                stopReason: "tool_use",
                timestamp: Date.now(),
              },
            });
          });

          return stream as never;
        },
      }),
    });

    const notifications: DiligentServerNotification[] = [];
    let resolveTurnInterrupted: (() => void) | null = null;
    const turnInterrupted = new Promise<void>((resolve) => {
      resolveTurnInterrupted = resolve;
    });

    server.setNotificationListener((notification) => {
      notifications.push(notification);
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED) {
        resolveTurnInterrupted?.();
      }
    });

    server.setServerRequestHandler(async (request) => {
      if (request.method === DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST) {
        return {
          method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
          result: { answers: {} },
        };
      }
      return {
        method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
        result: { decision: "once" },
      };
    });

    const start = await server.handleRequest({
      id: 20,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    const turnStart = await server.handleRequest({
      id: 21,
      method: "turn/start",
      params: { threadId: startResult.threadId, message: "hi" },
    });
    const turnStartResult = readResult(turnStart) as { accepted: boolean };
    expect(turnStartResult.accepted).toBe(true);

    await turnInterrupted;

    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED)).toBe(false);
  });
});
