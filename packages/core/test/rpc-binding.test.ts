// @summary Tests for transport-neutral JSON-RPC binding, request correlation, and NDJSON framing

import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type JSONRPCMessage,
} from "@diligent/protocol";
import { z } from "zod";
import { DiligentAppServer } from "../src/app-server";
import { EventStream } from "../src/event-stream";
import { ensureDiligentDir } from "../src/infrastructure/diligent-dir";
import { createNdjsonParser, formatNdjsonMessage, RpcClientSession, type RpcPeer } from "../src/rpc";

class MemoryPeer implements RpcPeer {
  private messageListener: ((message: JSONRPCMessage) => void | Promise<void>) | null = null;
  private closeListener: ((error?: Error) => void) | null = null;
  counterpart: MemoryPeer | null = null;
  sent: JSONRPCMessage[] = [];

  send(message: JSONRPCMessage): void {
    this.sent.push(message);
    void this.counterpart?.messageListener?.(message);
  }

  onMessage(listener: (message: JSONRPCMessage) => void | Promise<void>): void {
    this.messageListener = listener;
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListener = listener;
  }

  close(error?: Error): void {
    this.closeListener?.(error);
  }
}

function createLinkedPeers(): { client: MemoryPeer; server: MemoryPeer } {
  const client = new MemoryPeer();
  const server = new MemoryPeer();
  client.counterpart = server;
  server.counterpart = client;
  return { client, server };
}

describe("RPC binding", () => {
  it("binds a peer to DiligentAppServer and completes initialize/thread/start flow", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-rpc-binding-"));
    const { client: clientPeer, server: serverPeer } = createLinkedPeers();

    const notifications: JSONRPCMessage[] = [];
    const client = new RpcClientSession(clientPeer, {
      onNotification: async (notification) => {
        notifications.push(notification);
      },
    });
    clientPeer.onMessage(async (message) => {
      await client.handleMessage(message);
    });

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

    const { bindAppServer } = await import("../src/rpc/server-binding");
    const stop = bindAppServer(server, serverPeer);

    const init = await client.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
      clientName: "test-client",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });
    expect(init.protocolVersion).toBe(1);
    expect(init.cwd).toBe(projectRoot);
    expect(init.mode).toBe("default");
    expect(init.effort).toBe("medium");
    expect(init.currentModel).toBe("fake-model");

    const started = await client.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, { cwd: projectRoot });
    expect(started.threadId).toMatch(/^\d{20}-[0-9a-f]{6}$/);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      notifications.some(
        (message) => "method" in message && message.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED,
      ),
    ).toBe(true);

    stop();
  });

  it("round-trips server-initiated approval requests through the bound peer", async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "diligent-rpc-binding-"));
    const { client: clientPeer, server: serverPeer } = createLinkedPeers();

    let approvalRequestId: string | number | null = null;
    const client = new RpcClientSession(clientPeer, {
      onServerRequest: async (request) => {
        expect(request.method).toBe(DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST);
        return {
          method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
          result: { decision: "once" },
        };
      },
    });

    clientPeer.onMessage(async (message) => {
      if (
        "method" in message &&
        "id" in message &&
        message.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
      ) {
        approvalRequestId = message.id;
      }
      await client.handleMessage(message);
    });

    const approvalTool = {
      name: "needs_approval",
      description: "Requests approval",
      parameters: z.object({}),
      execute: async (
        _args: Record<string, never>,
        ctx: {
          approve: (request: { permission: "execute"; toolName: string; description: string }) => Promise<string>;
        },
      ) => {
        return await ctx.approve({
          permission: "execute",
          toolName: "needs_approval",
          description: "approval test",
        });
      },
    } as never;

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
        tools: [approvalTool],
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
                    id: "tc-approval",
                    name: "needs_approval",
                    input: {},
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

    const { bindAppServer } = await import("../src/rpc/server-binding");
    const stop = bindAppServer(server, serverPeer);

    const started = await client.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, { cwd: projectRoot });
    const turn = await client.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
      threadId: started.threadId,
      message: "please run",
    });
    expect(turn.accepted).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approvalRequestId).not.toBeNull();

    stop();
  });

  it("parses and formats NDJSON JSON-RPC frames", () => {
    const seen: JSONRPCMessage[] = [];
    const parser = createNdjsonParser((message) => {
      seen.push(message);
    });

    const first = formatNdjsonMessage({ id: 1, method: "initialize", params: { clientName: "cli" } });
    const second = formatNdjsonMessage({ method: "initialized" });

    parser.push(first.slice(0, 10));
    parser.push(first.slice(10) + second);
    parser.end();

    expect(seen).toEqual([{ id: 1, method: "initialize", params: { clientName: "cli" } }, { method: "initialized" }]);
  });
});
