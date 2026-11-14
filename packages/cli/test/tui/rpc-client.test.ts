// @summary Tests spawned stdio RPC client request correlation and server-request handling

import { describe, expect, it } from "bun:test";
import type { JSONRPCMessage } from "@diligent/protocol";
import { StdioAppServerRpcClient } from "../../src/tui/rpc-client";

function createMockProcess() {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller;
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      stderrController = controller;
    },
  });

  const writes: string[] = [];
  let exitResolve: ((code: number) => void) | null = null;
  const exited = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });

  return {
    process: {
      stdin: {
        write(chunk: string) {
          writes.push(chunk);
          return chunk.length;
        },
        end() {},
      },
      stdout,
      stderr,
      exited,
      kill() {
        exitResolve?.(0);
      },
    },
    writes,
    pushStdout(message: JSONRPCMessage) {
      stdoutController?.enqueue(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
    },
    pushStderr(line: string) {
      stderrController?.enqueue(new TextEncoder().encode(`${line}\n`));
    },
    closeStdout() {
      stdoutController?.close();
    },
    closeStderr() {
      stderrController?.close();
    },
    exit: (code: number) => exitResolve?.(code),
  };
}

describe("StdioAppServerRpcClient", () => {
  it("sends NDJSON request frames", async () => {
    const mock = createMockProcess();
    const client = new StdioAppServerRpcClient(mock.process as never);

    const pending = client.request("initialize", {
      clientName: "cli",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });

    expect(wireFrames(mock.writes)).toEqual([
      {
        id: 1,
        method: "initialize",
        params: { clientName: "cli", clientVersion: "0.0.1", protocolVersion: 1 },
      },
    ]);

    mock.pushStdout({
      id: 1,
      result: {
        serverName: "diligent-app-server",
        serverVersion: "0.0.1",
        protocolVersion: 1,
        capabilities: {
          supportsFollowUp: true,
          supportsApprovals: true,
          supportsUserInput: true,
        },
      },
    });

    const response = await pending;
    expect(response.serverName).toBe("diligent-app-server");

    mock.closeStdout();
    mock.closeStderr();
    mock.exit(0);
    await client.dispose();
  });

  it("returns fallback once/empty answers when no server-request handler is installed", async () => {
    const mock = createMockProcess();
    const client = new StdioAppServerRpcClient(mock.process as never);

    mock.pushStdout({
      id: 9,
      method: "approval/request",
      params: { threadId: "t1", request: { permission: "execute", toolName: "bash", description: "Run bash" } },
    });
    mock.pushStdout({
      id: 10,
      method: "userInput/request",
      params: { threadId: "t1", request: { questions: [] } },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wireFrames(mock.writes)).toEqual([
      { id: 9, result: { decision: "once" } },
      { id: 10, result: { answers: {} } },
    ]);

    mock.closeStdout();
    mock.closeStderr();
    mock.exit(0);
    await client.dispose();
  });
});

function wireFrames(chunks: string[]): JSONRPCMessage[] {
  return chunks.map((chunk) => JSON.parse(chunk.trim()) as JSONRPCMessage);
}
