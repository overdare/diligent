// @summary Tests for DiligentAppServer JSON-RPC request handling and event notifications

import { describe, expect, it, mock } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { DiligentServerNotification } from "@diligent/protocol";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type JSONRPCResponse,
} from "@diligent/protocol";
import { z } from "zod";
import { DiligentAppServer } from "../src/app-server";
import { createCollabTools } from "../src/collab";
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
      getInitializeResult: async () => ({
        cwd: projectRoot,
        mode: "default",
        effort: "medium",
        currentModel: "fake-model",
        availableModels: [],
      }),
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
    const initResult = readResult(init) as {
      protocolVersion: number;
      cwd?: string;
      mode?: string;
      effort?: string;
      currentModel?: string;
    };
    expect(initResult.protocolVersion).toBe(1);
    expect(initResult.cwd).toBe(projectRoot);
    expect(initResult.mode).toBe("default");
    expect(initResult.effort).toBe("medium");
    expect(initResult.currentModel).toBe("fake-model");

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

  it("accepts image-only turn content and emits userMessage item", async () => {
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
            stream.push({
              type: "done",
              stopReason: "end_turn",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "ok" }],
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

    const start = await server.handleRequest({
      id: 100,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    const turnStart = await server.handleRequest({
      id: 101,
      method: "turn/start",
      params: {
        threadId: startResult.threadId,
        message: "",
        attachments: [
          {
            type: "local_image",
            path: "/tmp/example.png",
            mediaType: "image/png",
            fileName: "example.png",
          },
        ],
      },
    });
    expect((readResult(turnStart) as { accepted: boolean }).accepted).toBe(true);

    await turnCompleted;

    const userStarted = notifications.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED);
    expect(userStarted).toBeDefined();
    const userItem = (userStarted as { params: { item: { type: string; message: { content: unknown } } } }).params.item;
    expect(userItem.type).toBe("userMessage");
    expect(userItem.message.content).toEqual([
      {
        type: "local_image",
        path: "/tmp/example.png",
        mediaType: "image/png",
        fileName: "example.png",
      },
    ]);
  });

  it("restores thread effort from resumed sessions and uses it for new threads", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ mode, effort, signal, approve, ask }) => ({
        model: {
          id: "fake-model",
          provider: "fake",
          contextWindow: 128_000,
          maxOutputTokens: 4096,
        },
        systemPrompt: [{ label: "base", content: "test" }],
        tools: [],
        mode,
        effort,
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
              stopReason: "end_turn",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "ok" }],
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

    const started = await server.handleRequest({ id: 120, method: "thread/start", params: { cwd: projectRoot } });
    const originalThreadId = (readResult(started) as { threadId: string }).threadId;

    const initialRead = await server.handleRequest({
      id: 121,
      method: "thread/read",
      params: { threadId: originalThreadId },
    });
    expect((readResult(initialRead) as { currentEffort: string }).currentEffort).toBe("medium");

    await server.handleRequest({
      id: 122,
      method: "effort/set",
      params: { threadId: originalThreadId, effort: "max" },
    });

    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    server.setNotificationListener((notification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    await server.handleRequest({
      id: 123,
      method: "turn/start",
      params: { threadId: originalThreadId, message: "remember this effort" },
    });
    await turnCompleted;

    const resumedServer = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      cwd: projectRoot,
      buildAgentConfig: ({ mode, effort, signal, approve, ask }) => ({
        model: {
          id: "fake-model",
          provider: "fake",
          contextWindow: 128_000,
          maxOutputTokens: 4096,
        },
        systemPrompt: [{ label: "base", content: "test" }],
        tools: [],
        mode,
        effort,
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
              stopReason: "end_turn",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "ok" }],
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

    const resumed = await resumedServer.handleRequest({
      id: 124,
      method: "thread/resume",
      params: { threadId: originalThreadId },
    });
    expect((readResult(resumed) as { found: boolean }).found).toBe(true);

    const resumedRead = await resumedServer.handleRequest({
      id: 125,
      method: "thread/read",
      params: { threadId: originalThreadId },
    });
    expect((readResult(resumedRead) as { currentEffort: string }).currentEffort).toBe("max");

    const newThread = await resumedServer.handleRequest({
      id: 126,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const newThreadId = (readResult(newThread) as { threadId: string }).threadId;
    const newThreadRead = await resumedServer.handleRequest({
      id: 127,
      method: "thread/read",
      params: { threadId: newThreadId },
    });
    expect((readResult(newThreadRead) as { currentEffort: string }).currentEffort).toBe("max");
  });

  it("uses image fallback preview in thread list cache when first turn is image-only", async () => {
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
            stream.push({
              type: "done",
              stopReason: "end_turn",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "ok" }],
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

    const start = await server.handleRequest({ id: 110, method: "thread/start", params: { cwd: projectRoot } });
    const threadId = (readResult(start) as { threadId: string }).threadId;
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    server.setNotificationListener((notification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    await server.handleRequest({
      id: 111,
      method: "turn/start",
      params: {
        threadId,
        message: "",
        attachments: [{ type: "local_image", path: "/tmp/a.png", mediaType: "image/png", fileName: "a.png" }],
      },
    });

    await turnCompleted;

    const list = await server.handleRequest({ id: 112, method: "thread/list", params: { limit: 10 } });
    const result = readResult(list) as { data: Array<{ id: string; firstUserMessage?: string }> };
    expect(result.data.find((item) => item.id === threadId)?.firstUserMessage).toBe("[image]");
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
    let resolveTurnDone: (() => void) | null = null;
    const turnDone = new Promise<void>((resolve) => {
      resolveTurnDone = resolve;
    });

    server.setNotificationListener((notification) => {
      notifications.push(notification);
      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED ||
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED
      ) {
        resolveTurnDone?.();
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

    await turnDone;

    // abortRequested causes a normal (non-throwing) loop exit → TURN_COMPLETED, not TURN_INTERRUPTED
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED)).toBe(false);
  });

  it("adds thread, turn, effort, and response summary to AgentLoop debug logs", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const originalLog = console.log;
    const logSpy = mock(() => {});
    console.log = logSpy as typeof console.log;

    try {
      const server = new DiligentAppServer({
        resolvePaths: async (cwd) => ensureDiligentDir(cwd),
        buildAgentConfig: ({ mode, effort, signal, approve, ask }) => ({
          model: {
            id: "fake-model",
            provider: "fake",
            contextWindow: 128_000,
            maxOutputTokens: 4096,
          },
          systemPrompt: [{ label: "base", content: "test" }],
          tools: [],
          mode,
          effort,
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

      let completedTurnId: string | undefined;
      const turnDone = new Promise<void>((resolve) => {
        server.setNotificationListener((notification) => {
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED) {
            completedTurnId = notification.params.turnId;
          }
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
            resolve();
          }
        });
      });

      const start = await server.handleRequest({
        id: 30,
        method: "thread/start",
        params: { cwd: projectRoot },
      });
      const startResult = readResult(start) as { threadId: string };

      await server.handleRequest({
        id: 31,
        method: "turn/start",
        params: { threadId: startResult.threadId, message: "hi" },
      });

      await turnDone;

      const requestCall = logSpy.mock.calls.find(
        (args) => args[0] === "[AgentLoop]%s Sending %d messages to %s, last 5: %s",
      );
      expect(requestCall).toBeDefined();
      expect(requestCall?.[1]).toBe(` thread=${startResult.threadId} turn=${completedTurnId} effort=medium`);

      const responseCall = logSpy.mock.calls.find(
        (args) =>
          args[0] === "[AgentLoop]%s Response summary: stop=%s elapsed=%dms text=%d thinking=%d toolCalls=%d tools=%s",
      );
      expect(responseCall).toBeDefined();
      expect(responseCall?.[1]).toBe(` thread=${startResult.threadId} turn=${completedTurnId} effort=medium`);
      expect(responseCall?.[2]).toBe("end_turn");
      expect(typeof responseCall?.[3]).toBe("number");
      expect((responseCall?.[3] as number) >= 0).toBe(true);
      expect(responseCall?.slice(4)).toEqual([5, 0, 0, "-"]);
    } finally {
      console.log = originalLog;
    }
  });

  it("rebinds collab handler when registry instance changes between turns", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));
    const paths = await ensureDiligentDir(projectRoot);

    let llmCallCount = 0;
    let childSessionCount = 0;

    const streamFunction = () => {
      const callNumber = ++llmCallCount;
      const stream = new EventStream(
        (event) => event.type === "done",
        (event) => ({ message: (event as { message: unknown }).message }),
      );

      const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const assistantByCall = () => {
        if (callNumber === 1) {
          return {
            role: "assistant" as const,
            content: [{ type: "tool_call" as const, id: "tc-noop", name: "noop", input: {} }],
            model: "fake-model",
            usage,
            stopReason: "tool_use" as const,
            timestamp: Date.now(),
          };
        }
        if (callNumber === 2) {
          return {
            role: "assistant" as const,
            content: [
              {
                type: "tool_call" as const,
                id: "tc-spawn",
                name: "spawn_agent",
                input: {
                  message: "Read any markdown file",
                  description: "spawn test",
                  agent_type: "general",
                },
              },
            ],
            model: "fake-model",
            usage,
            stopReason: "tool_use" as const,
            timestamp: Date.now(),
          };
        }
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "done" }],
          model: "fake-model",
          usage,
          stopReason: "end_turn" as const,
          timestamp: Date.now(),
        };
      };

      queueMicrotask(() => {
        stream.push({ type: "start" });
        stream.push({ type: "done", stopReason: assistantByCall().stopReason, message: assistantByCall() });
      });

      return stream as never;
    };

    const noopTool = {
      name: "noop",
      description: "No-op tool for turn progression",
      parameters: z.object({}),
      execute: async () => ({ output: "ok" }),
    };

    const server = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ mode, signal, approve, ask, getSessionId }) => {
        const { tools: collabTools, registry } = createCollabTools({
          cwd: projectRoot,
          paths,
          model: {
            id: "fake-model",
            provider: "fake",
            contextWindow: 128_000,
            maxOutputTokens: 4096,
          },
          systemPrompt: [{ label: "base", content: "test" }],
          streamFunction,
          parentTools: [noopTool],
          getParentSessionId: getSessionId,
          ask,
          sessionManagerFactory: () => {
            const childSessionId = `child-${++childSessionCount}`;
            return {
              entries: [],
              leafId: null,
              create: async () => {},
              resume: async () => false,
              list: async () => [],
              getContext: () => [],
              run: () => {
                const childStream = new EventStream(
                  (event) => event.type === "agent_end",
                  () => [],
                );
                queueMicrotask(() => {
                  childStream.push({ type: "agent_start" });
                  childStream.push({ type: "turn_start", turnId: `turn-${childSessionId}` });
                  childStream.push({
                    type: "tool_start",
                    itemId: `item-${childSessionId}`,
                    toolCallId: `call-${childSessionId}`,
                    toolName: "read",
                    input: { file_path: "README.md" },
                  });
                  childStream.push({
                    type: "tool_update",
                    itemId: `item-${childSessionId}`,
                    toolCallId: `call-${childSessionId}`,
                    toolName: "read",
                    partialResult: "partial",
                  });
                  childStream.push({
                    type: "tool_end",
                    itemId: `item-${childSessionId}`,
                    toolCallId: `call-${childSessionId}`,
                    toolName: "read",
                    output: "done",
                    isError: false,
                  });
                  childStream.push({
                    type: "message_end",
                    itemId: `msg-${childSessionId}`,
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text: "child done" }],
                      model: "fake-model",
                      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
                      stopReason: "end_turn",
                      timestamp: Date.now(),
                    },
                  });
                  childStream.push({ type: "agent_end", messages: [] });
                  childStream.end([]);
                });
                return childStream;
              },
              waitForWrites: async () => {},
              steer: () => {},
              hasPendingMessages: () => false,
              popPendingMessages: () => null,
              appendModeChange: () => {},
              get sessionPath() {
                return null;
              },
              get sessionId() {
                return childSessionId;
              },
              get entryCount() {
                return 0;
              },
            } as never;
          },
        });

        return {
          model: {
            id: "fake-model",
            provider: "fake",
            contextWindow: 128_000,
            maxOutputTokens: 4096,
          },
          systemPrompt: [{ label: "base", content: "test" }],
          tools: [noopTool, ...collabTools],
          mode,
          signal,
          approve,
          ask,
          streamFunction,
          registry,
        };
      },
    });

    const notifications: DiligentServerNotification[] = [];
    const turnDone = new Promise<void>((resolve) => {
      server.setNotificationListener((notification) => {
        notifications.push(notification);
        if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
          resolve();
        }
      });
    });

    const start = await server.handleRequest({
      id: 30,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    await server.handleRequest({
      id: 31,
      method: "turn/start",
      params: { threadId: startResult.threadId, message: "hi" },
    });

    await turnDone;

    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_BEGIN)).toBe(true);
    expect(notifications.some((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_END)).toBe(true);
    expect(
      notifications.some(
        (n) =>
          n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED &&
          "childThreadId" in n.params &&
          typeof n.params.childThreadId === "string",
      ),
    ).toBe(true);
  });
});
