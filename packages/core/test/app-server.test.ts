// @summary Tests for DiligentAppServer JSON-RPC request handling and event notifications

import { describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCMessage,
} from "@diligent/protocol";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type JSONRPCResponse,
} from "@diligent/protocol";
import { z } from "zod";
import { createAppServerConfig, DiligentAppServer } from "../src/app-server";
import { createCollabTools } from "../src/collab";
import { EventStream } from "../src/event-stream";
import { ensureDiligentDir } from "../src/infrastructure/diligent-dir";
import { ProviderManager } from "../src/provider/provider-manager";
import type { Model } from "../src/provider/types";
import { SessionWriter } from "../src/session/persistence";
import { requestUserInputTool } from "../src/tools/request-user-input";

function readResult(response: JSONRPCResponse): unknown {
  if ("error" in response) {
    throw new Error(response.error.message);
  }
  return response.result;
}

const TEST_CONNECTION_ID = "test";

interface TestPeer {
  send(message: JSONRPCMessage): void;
  onMessage(listener: (message: JSONRPCMessage) => void | Promise<void>): void;
  onClose?(listener: (error?: Error) => void): void;
}

interface ConnectedTestServer {
  peer: TestPeer;
  notifications: DiligentServerNotification[];
  setNotificationListener: (
    listener: ((notification: DiligentServerNotification) => void | Promise<void>) | null,
  ) => void;
  setServerRequestHandler: (
    handler: ((request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null,
  ) => void;
  disconnect: () => void;
}

function connectTestPeer(server: DiligentAppServer, connectionId = TEST_CONNECTION_ID): ConnectedTestServer {
  const notifications: DiligentServerNotification[] = [];
  let notificationListener: ((notification: DiligentServerNotification) => void | Promise<void>) | null = null;
  let serverRequestHandler: ((request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null = null;
  let serverMessageListener: ((message: JSONRPCMessage) => void | Promise<void>) | null = null;

  const peer: TestPeer = {
    async send(message: JSONRPCMessage) {
      if (!("method" in message)) return;
      if (!("id" in message)) {
        const notification = message as DiligentServerNotification;
        notifications.push(notification);
        await notificationListener?.(notification);
        return;
      }
      if (typeof message.id !== "number") return;

      const request = {
        method: message.method as DiligentServerRequest["method"],
        params: message.params,
      } as DiligentServerRequest;

      const response = serverRequestHandler
        ? await serverRequestHandler(request)
        : defaultServerRequestResponse(message.method);
      await serverMessageListener?.({ id: message.id, result: response.result });
    },
    onMessage(listener) {
      serverMessageListener = listener;
    },
  };

  const disconnect = server.connect(connectionId, peer);

  return {
    peer,
    notifications,
    setNotificationListener(listener) {
      notificationListener = listener;
    },
    setServerRequestHandler(handler) {
      serverRequestHandler = handler;
    },
    disconnect,
  };
}

function defaultServerRequestResponse(method: DiligentServerRequest["method"]): DiligentServerRequestResponse {
  if (method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
    return {
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      result: { decision: "once" },
    };
  }

  return {
    method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
    result: { answers: {} },
  };
}

function makeFactoryRuntimeConfig(overrides?: { tools?: Record<string, unknown> }) {
  const providerManager = new ProviderManager({});
  providerManager.setApiKey("anthropic", "test-key");
  providerManager.setApiKey("openai", "test-key");
  const model: Model = {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
  };

  return {
    model,
    mode: "default" as const,
    systemPrompt: [{ label: "base", content: "test" }],
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
            model: model.id,
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: Date.now(),
          },
        });
      });
      return stream as never;
    },
    diligent: {
      ...(overrides?.tools ? { tools: overrides.tools as never } : {}),
    },
    sources: [],
    skills: [],
    compaction: { enabled: true, reservePercent: 16, keepRecentTokens: 20000 },
    permissionEngine: {
      check: async () => ({ decision: "allow" as const }),
    },
    providerManager,
  };
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

    const connection = connectTestPeer(server);
    const notifications: DiligentServerNotification[] = [];
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });

    connection.setNotificationListener((notification) => {
      notifications.push(notification);
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    const init = await server.handleRequest(TEST_CONNECTION_ID, {
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

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 2,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };
    // sessionId format: YYYYMMDDHHMMSSSSSCCC-xxxxxx (timestamp + counter + 6-char random)
    expect(startResult.threadId).toMatch(/^\d{20}-[0-9a-f]{6}$/);

    const turnStart = await server.handleRequest(TEST_CONNECTION_ID, {
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
      cwd: projectRoot,
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

    const connection = connectTestPeer(server, "observer");

    const notifications: DiligentServerNotification[] = [];
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });

    connection.setNotificationListener((notification) => {
      notifications.push(notification);
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 100,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    const turnStart = await server.handleRequest(TEST_CONNECTION_ID, {
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
      cwd: projectRoot,
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

    const connection = connectTestPeer(server);

    const started = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 120,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const originalThreadId = (readResult(started) as { threadId: string }).threadId;

    const initialRead = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 121,
      method: "thread/read",
      params: { threadId: originalThreadId },
    });
    expect((readResult(initialRead) as { currentEffort: string }).currentEffort).toBe("medium");

    await server.handleRequest(TEST_CONNECTION_ID, {
      id: 122,
      method: "effort/set",
      params: { threadId: originalThreadId, effort: "max" },
    });

    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    connection.setNotificationListener((notification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    await server.handleRequest(TEST_CONNECTION_ID, {
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

    const resumed = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 124,
      method: "thread/resume",
      params: { threadId: originalThreadId },
    });
    expect((readResult(resumed) as { found: boolean }).found).toBe(true);

    const resumedRead = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 125,
      method: "thread/read",
      params: { threadId: originalThreadId },
    });
    expect((readResult(resumedRead) as { currentEffort: string }).currentEffort).toBe("max");

    const newThread = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 126,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const newThreadId = (readResult(newThread) as { threadId: string }).threadId;
    const newThreadRead = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 127,
      method: "thread/read",
      params: { threadId: newThreadId },
    });
    expect((readResult(newThreadRead) as { currentEffort: string }).currentEffort).toBe("max");
  });

  it("keeps model changes thread-scoped and restores them on resume", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer(
      createAppServerConfig({
        cwd: projectRoot,
        runtimeConfig: makeFactoryRuntimeConfig(),
      }),
    );

    connectTestPeer(server);

    const startedA = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 600,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadA = (readResult(startedA) as { threadId: string }).threadId;

    const startedB = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 601,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadB = (readResult(startedB) as { threadId: string }).threadId;

    await server.handleRequest(TEST_CONNECTION_ID, {
      id: 602,
      method: "config/set",
      params: { threadId: threadA, model: "gpt-5.4" },
    });

    const readA = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 603,
      method: "thread/read",
      params: { threadId: threadA },
    });
    expect((readResult(readA) as { currentModel?: string }).currentModel).toBe("gpt-5.4");

    const readB = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 604,
      method: "thread/read",
      params: { threadId: threadB },
    });
    expect((readResult(readB) as { currentModel?: string }).currentModel).toBe("claude-sonnet-4-6");

    const resumedServer = new DiligentAppServer(
      createAppServerConfig({
        cwd: projectRoot,
        runtimeConfig: makeFactoryRuntimeConfig(),
      }),
    );
    connectTestPeer(resumedServer);

    const resumed = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 605,
      method: "thread/resume",
      params: { threadId: threadA },
    });
    expect((readResult(resumed) as { found: boolean }).found).toBe(true);

    const resumedRead = await resumedServer.handleRequest(TEST_CONNECTION_ID, {
      id: 606,
      method: "thread/read",
      params: { threadId: threadA },
    });
    expect((readResult(resumedRead) as { currentModel?: string }).currentModel).toBe("gpt-5.4");
  });

  it("lists a newly started thread before the first turn", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      cwd: projectRoot,
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

    connectTestPeer(server);

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 110,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadId = (readResult(start) as { threadId: string }).threadId;

    const list = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 111,
      method: "thread/list",
      params: { limit: 10 },
    });
    const result = readResult(list) as { data: Array<{ id: string; messageCount: number }> };
    expect(result.data.find((item) => item.id === threadId)).toMatchObject({ id: threadId, messageCount: 0 });
  });

  it("reconciles idle thread/read from disk when runtime memory is stale", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      cwd: projectRoot,
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
                content: [{ type: "text", text: "original" }],
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

    const connection = connectTestPeer(server);
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    connection.setNotificationListener((notification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 901,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadId = (readResult(start) as { threadId: string }).threadId;

    await server.handleRequest(TEST_CONNECTION_ID, {
      id: 902,
      method: "turn/start",
      params: { threadId, message: "hello" },
    });
    await turnCompleted;

    const paths = await ensureDiligentDir(projectRoot);
    const sessionPath = join(paths.sessions, `${threadId}.jsonl`);
    const fileText = await readFile(sessionPath, "utf8");
    const lines = fileText.trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]) as {
      type: string;
      message?: {
        role?: string;
        content?: unknown[];
        model?: string;
        usage?: unknown;
        stopReason?: string;
        timestamp?: number;
      };
      timestamp?: string;
      id?: string;
      parentId?: string | null;
    };
    expect(last.type).toBe("message");
    expect(last.message?.role).toBe("assistant");

    const appendedEntry = {
      type: "message",
      id: "deadbeef",
      parentId: last.id ?? null,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "from-disk" }],
        model: last.message?.model ?? "fake-model",
        usage: last.message?.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: last.message?.stopReason ?? "end_turn",
        timestamp: Date.now(),
      },
    };

    await writeFile(sessionPath, `${fileText}${JSON.stringify(appendedEntry)}\n`, "utf8");

    const read = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 903,
      method: "thread/read",
      params: { threadId },
    });
    const result = readResult(read) as { messages: Array<{ role: string; content: unknown[] }> };
    const lastMessage = result.messages[result.messages.length - 1] as {
      role: string;
      content: Array<{ type: string; text?: string }>;
    };
    expect(lastMessage.role).toBe("assistant");
    expect(lastMessage.content.find((b) => b.type === "text")?.text).toBe("from-disk");

    // Also validate equal-count/equal-leaf fingerprints are present and stable on next read.
    const secondRead = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 904,
      method: "thread/read",
      params: { threadId },
    });
    const second = readResult(secondRead) as { messages: Array<{ role: string; content: unknown[] }> };
    const secondLast = second.messages[second.messages.length - 1] as {
      role: string;
      content: Array<{ type: string; text?: string }>;
    };
    expect(secondLast.content.find((b) => b.type === "text")?.text).toBe("from-disk");
  });

  it("reads image fallback preview from persisted thread list data when first turn is image-only", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      cwd: projectRoot,
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

    const connection = connectTestPeer(server);

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 110,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadId = (readResult(start) as { threadId: string }).threadId;
    let resolveTurnCompleted: (() => void) | null = null;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    connection.setNotificationListener((notification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        resolveTurnCompleted?.();
      }
    });

    await server.handleRequest(TEST_CONNECTION_ID, {
      id: 111,
      method: "turn/start",
      params: {
        threadId,
        message: "",
        attachments: [{ type: "local_image", path: "/tmp/a.png", mediaType: "image/png", fileName: "a.png" }],
      },
    });

    await turnCompleted;

    const list = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 112,
      method: "thread/list",
      params: { limit: 10 },
    });
    const result = readResult(list) as { data: Array<{ id: string; firstUserMessage?: string }> };
    expect(result.data.find((item) => item.id === threadId)?.firstUserMessage).toBe("[image]");
  });

  it("treats empty user-input response as aborted turn", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const server = new DiligentAppServer({
      cwd: projectRoot,
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

    const connection = connectTestPeer(server);

    const notifications: DiligentServerNotification[] = [];
    let resolveTurnDone: (() => void) | null = null;
    const turnDone = new Promise<void>((resolve) => {
      resolveTurnDone = resolve;
    });

    connection.setNotificationListener((notification) => {
      notifications.push(notification);
      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED ||
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED
      ) {
        resolveTurnDone?.();
      }
    });

    connection.setServerRequestHandler(async (request) => {
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

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 20,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    const turnStart = await server.handleRequest(TEST_CONNECTION_ID, {
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
        cwd: projectRoot,
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

      const connection = connectTestPeer(server);

      let completedTurnId: string | undefined;
      const turnDone = new Promise<void>((resolve) => {
        connection.setNotificationListener((notification) => {
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED) {
            completedTurnId = notification.params.turnId;
          }
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
            resolve();
          }
        });
      });

      const start = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 30,
        method: "thread/start",
        params: { cwd: projectRoot },
      });
      const startResult = readResult(start) as { threadId: string };

      await server.handleRequest(TEST_CONNECTION_ID, {
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

  it("logs iterator drain before final turn completion", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));

    const originalLog = console.log;
    const logSpy = mock(() => {});
    console.log = logSpy as typeof console.log;

    try {
      const server = new DiligentAppServer({
        cwd: projectRoot,
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

      const connection = connectTestPeer(server);

      let completedTurnId: string | undefined;
      const turnDone = new Promise<void>((resolve) => {
        connection.setNotificationListener((notification) => {
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED) {
            completedTurnId = notification.params.turnId;
          }
          if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
            resolve();
          }
        });
      });

      const start = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 300,
        method: "thread/start",
        params: { cwd: projectRoot },
      });
      const startResult = readResult(start) as { threadId: string };

      await server.handleRequest(TEST_CONNECTION_ID, {
        id: 301,
        method: "turn/start",
        params: { threadId: startResult.threadId, message: "hi" },
      });

      await turnDone;

      const iteratorDrainCall = logSpy.mock.calls.find(
        (args) =>
          args[0] === "[AppServer] consumeStream: iterator drained for turn %s thread %s; awaiting final result",
      );
      expect(iteratorDrainCall).toBeDefined();
      expect(iteratorDrainCall?.slice(1)).toEqual([completedTurnId, startResult.threadId]);
    } finally {
      console.log = originalLog;
    }
  });

  it("persists turn-ending errors to thread history and emits error notification", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));
    const notifications: DiligentServerNotification[] = [];

    const server = new DiligentAppServer({
      cwd: projectRoot,
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
          throw new Error("invalid model for provider");
        },
      }),
    });

    const connection = connectTestPeer(server);
    connection.setNotificationListener((notification) => {
      notifications.push(notification);
    });

    const started = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 700,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const threadId = (readResult(started) as { threadId: string }).threadId;

    await server.handleRequest(TEST_CONNECTION_ID, {
      id: 701,
      method: "turn/start",
      params: { threadId, message: "hi" },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const errorNotification = notifications.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR);
    expect(errorNotification).toBeDefined();
    expect(errorNotification?.params.error.message).toContain("invalid model for provider");

    const read = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 702,
      method: "thread/read",
      params: { threadId },
    });
    const result = readResult(read) as {
      errors?: Array<{ error: { message: string; name: string }; fatal: boolean; turnId?: string }>;
    };
    expect(result.errors?.length).toBe(1);
    expect(result.errors?.[0]?.error.message).toContain("invalid model for provider");
    expect(result.errors?.[0]?.fatal).toBe(true);
    expect(result.errors?.[0]?.turnId).toBeDefined();
  });

  it("emits turn/completed only after session writes are flushed", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));
    const paths = await ensureDiligentDir(projectRoot);

    const originalWrite = SessionWriter.prototype.write;
    SessionWriter.prototype.write = async function delayedWrite(entry) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await originalWrite.call(this, entry);
    };

    try {
      const server = new DiligentAppServer({
        cwd: projectRoot,
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
              stream.push({ type: "text_delta", delta: "persist-check" });
              stream.push({
                type: "done",
                stopReason: "end_turn",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "persist-check" }],
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

      const connection = connectTestPeer(server);
      const start = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 970,
        method: "thread/start",
        params: { cwd: projectRoot },
      });
      const threadId = (readResult(start) as { threadId: string }).threadId;
      const sessionPath = join(paths.sessions, `${threadId}.jsonl`);

      const turnCompleted = new Promise<void>((resolve, reject) => {
        connection.setNotificationListener(async (notification) => {
          if (notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) return;
          try {
            const text = await readFile(sessionPath, "utf8");
            expect(text).toContain("persist-check");
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });

      await server.handleRequest(TEST_CONNECTION_ID, {
        id: 971,
        method: "turn/start",
        params: { threadId, message: "hi" },
      });

      await turnCompleted;
    } finally {
      SessionWriter.prototype.write = originalWrite;
    }
  });

  it("lists effective tool state and persists tool settings for next turns", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "diligent-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const runtimeConfig = makeFactoryRuntimeConfig({
        tools: {
          builtin: { bash: false },
        },
      });

      const config = createAppServerConfig({ cwd: projectRoot, runtimeConfig: runtimeConfig as never });
      const server = new DiligentAppServer({
        ...config,
        cwd: projectRoot,
        resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      });

      connectTestPeer(server);

      const listed = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 200,
        method: "tools/list",
        params: {},
      });
      const listedResult = readResult(listed) as {
        configPath: string;
        appliesOnNextTurn: boolean;
        trustMode: string;
        conflictPolicy: string;
        tools: Array<{ name: string; enabled: boolean; immutable: boolean; reason: string }>;
        plugins: Array<{ package: string }>;
      };

      const expectedGlobalPath = join(fakeHome, ".config", "diligent", "diligent.jsonc");
      expect(listedResult.configPath).toBe(expectedGlobalPath);
      expect(listedResult.appliesOnNextTurn).toBe(true);
      expect(listedResult.trustMode).toBe("full_trust");
      expect(listedResult.conflictPolicy).toBe("error");
      expect(listedResult.plugins).toEqual([]);
      expect(listedResult.tools.find((tool) => tool.name === "bash")).toMatchObject({
        enabled: false,
        immutable: false,
        reason: "disabled_by_user",
      });
      expect(listedResult.tools.find((tool) => tool.name === "plan")).toMatchObject({
        enabled: true,
        immutable: true,
      });
      expect(listedResult.tools.find((tool) => tool.name === "skill")).toMatchObject({
        enabled: true,
        immutable: true,
      });

      const setResult = readResult(
        await server.handleRequest(TEST_CONNECTION_ID, {
          id: 201,
          method: "tools/set",
          params: {
            builtin: { bash: true, read: false },
            plugins: [{ package: "@acme/diligent-tools", enabled: false, tools: { jira_comment: false } }],
            conflictPolicy: "plugin_wins",
          },
        }),
      ) as {
        conflictPolicy: string;
        tools: Array<{ name: string; enabled: boolean }>;
        plugins: Array<{ package: string; enabled: boolean; loaded: boolean }>;
      };

      expect(setResult.conflictPolicy).toBe("plugin_wins");
      expect(setResult.tools.find((tool) => tool.name === "bash")).toMatchObject({ enabled: true });
      expect(setResult.tools.find((tool) => tool.name === "read")).toMatchObject({ enabled: false });
      expect(setResult.plugins).toEqual([
        {
          package: "@acme/diligent-tools",
          configured: true,
          enabled: false,
          loaded: false,
          toolCount: 0,
          warnings: [],
        },
      ]);
      expect(runtimeConfig.diligent.tools).toEqual({
        builtin: { read: false },
        plugins: [{ package: "@acme/diligent-tools", enabled: false, tools: { jira_comment: false } }],
        conflictPolicy: "plugin_wins",
      });

      const configText = await Bun.file(expectedGlobalPath).text();
      expect(configText).toContain('"read": false');
      expect(configText).not.toContain('"bash": true');
      expect(configText).toContain('"package": "@acme/diligent-tools"');
      expect(configText).toContain('"conflictPolicy": "plugin_wins"');

      const threadStart = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 202,
        method: "thread/start",
        params: { cwd: projectRoot },
      });
      const threadId = (readResult(threadStart) as { threadId: string }).threadId;
      const turnStart = await server.handleRequest(TEST_CONNECTION_ID, {
        id: 203,
        method: "turn/start",
        params: { threadId, message: "hi" },
      });
      expect((readResult(turnStart) as { accepted: boolean }).accepted).toBe(true);
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      else delete process.env.HOME;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("tools/set writes to global config path", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-app-server-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "diligent-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const runtimeConfig = makeFactoryRuntimeConfig();
      const config = createAppServerConfig({ cwd: projectRoot, runtimeConfig: runtimeConfig as never });
      const server = new DiligentAppServer({
        ...config,
        cwd: projectRoot,
        resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      });

      connectTestPeer(server);

      const setResult = readResult(
        await server.handleRequest(TEST_CONNECTION_ID, {
          id: 204,
          method: "tools/set",
          params: {
            plugins: [{ package: "@acme/diligent-tools", tools: { jira_comment: false } }],
          },
        }),
      ) as {
        configPath: string;
      };

      const expectedGlobalPath = join(fakeHome, ".config", "diligent", "diligent.jsonc");
      expect(setResult.configPath).toBe(expectedGlobalPath);
      const configText = await Bun.file(expectedGlobalPath).text();
      expect(configText).toContain('"jira_comment": false');
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      else delete process.env.HOME;
      await rm(fakeHome, { recursive: true, force: true });
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
      cwd: projectRoot,
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

    const connection = connectTestPeer(server);

    const notifications: DiligentServerNotification[] = [];
    const turnDone = new Promise<void>((resolve) => {
      connection.setNotificationListener((notification) => {
        notifications.push(notification);
        if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
          resolve();
        }
      });
    });

    const start = await server.handleRequest(TEST_CONNECTION_ID, {
      id: 30,
      method: "thread/start",
      params: { cwd: projectRoot },
    });
    const startResult = readResult(start) as { threadId: string };

    await server.handleRequest(TEST_CONNECTION_ID, {
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
