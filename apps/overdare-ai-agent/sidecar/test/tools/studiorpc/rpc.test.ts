// @summary Tests Studio RPC transport cancellation.

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import { call, StudioRpcTransportError } from "../../../src/tools/studiorpc/rpc";

let server: Server | undefined;
let accepted: Socket | undefined;
const previousHost = process.env.STUDIO_HOST;
const previousPort = process.env.STUDIO_PORT;

afterEach(async () => {
  accepted?.destroy();
  accepted = undefined;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (previousHost === undefined) delete process.env.STUDIO_HOST;
  else process.env.STUDIO_HOST = previousHost;
  if (previousPort === undefined) delete process.env.STUDIO_PORT;
  else process.env.STUDIO_PORT = previousPort;
});

describe("Studio RPC cancellation", () => {
  test("a silent connected peer reports unknown execution with the request identity", async () => {
    server = createServer((socket) => {
      accepted = socket;
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    try {
      await call("execute.luau", {}, { timeoutMs: 30 });
      throw new Error("expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(StudioRpcTransportError);
      expect(error).toMatchObject({
        data: {
          reason: "timeout",
          phase: "awaitingResponse",
          method: "execute.luau",
          host: "127.0.0.1",
          port: address.port,
          executionOutcome: "unknown",
          requestId: expect.any(Number),
          elapsedMs: expect.any(Number),
        },
      });
      expect((error as Error).message).toContain("Do not replay");
    }
  });

  test("a peer closing without a response fails immediately instead of waiting for timeout", async () => {
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", () => socket.end());
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    await expect(call("game.pie.status", {}, { timeoutMs: 10_000 })).rejects.toMatchObject({
      data: { reason: "connectionClosed", phase: "awaitingResponse", executionOutcome: "unknown" },
    });
  }, 1_000);

  test("an unavailable listener is distinguished from a connected but stalled Studio", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    await expect(call("level.browse")).rejects.toMatchObject({
      data: { reason: "socketError", phase: "connecting", executionOutcome: "notSent", socketCode: "ECONNREFUSED" },
    });
  });

  test("a response with another request id is rejected instead of accepted", async () => {
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", (bytes) => {
        const request = JSON.parse(bytes.toString());
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id + 1, result: { success: true } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    await expect(call("game.stop")).rejects.toMatchObject({ data: { reason: "invalidResponse" } });
  });
  test("malformed RPC errors fail the request without crashing the response handler", async () => {
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", (bytes) => {
        const request = JSON.parse(bytes.toString());
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: 123 } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    await expect(call("game.stop", {}, { timeoutMs: 100 })).rejects.toMatchObject({
      data: { reason: "invalidResponse" },
    });
  });

  test("session metadata remains stable across separate TCP calls", async () => {
    const sessions: string[] = [];
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", (bytes) => {
        const request = JSON.parse(bytes.toString());
        sessions.push(request.meta.sessionId);
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} })}\n`);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    await call("level.browse", {}, { sessionId: "agent-session" });
    await call("level.browse", {}, { sessionId: "agent-session" });
    expect(sessions).toEqual(["agent-session", "agent-session"]);
  });
  test("aborting a tool call closes its pending Studio socket", async () => {
    server = createServer((socket) => {
      accepted = socket;
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);

    const controller = new AbortController();
    const connected = new Promise<void>((resolve) => server!.once("connection", () => resolve()));
    const pending = call("game.input.inject", {}, { timeoutMs: 10_000, signal: controller.signal });
    await connected;
    controller.abort(new DOMException("turn interrupted", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(accepted?.destroyed).toBe(true);
  });

  test("surfaces a structured Studio rejection reason without dropping its data", async () => {
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", (requestBytes) => {
        const request = JSON.parse(requestBytes.toString()) as { id: number };
        socket.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32111,
              message: "Move rejected",
              data: { name: "moveRejected", reason: "navigationSystemUnavailable" },
            },
          })}\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);

    const rejected = call("game.character.moveTo", {}, { timeoutMs: 1_000 });

    await expect(rejected).rejects.toMatchObject({
      code: -32111,
      data: { name: "moveRejected", reason: "navigationSystemUnavailable" },
      message: expect.stringContaining("Reason: navigationSystemUnavailable"),
    });
  });
  test("Editor error data survives the wire and reaches shared tool output without retry", async () => {
    const data = { command_id: "cmd-wire", mutation_attempted: true, undo_recorded: true };
    let requests = 0;
    server = createServer((socket) => {
      accepted = socket;
      socket.once("data", (bytes) => {
        requests++;
        const request = JSON.parse(bytes.toString());
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "runtime failure", data } })}\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no TCP port");
    process.env.STUDIO_HOST = "127.0.0.1";
    process.env.STUDIO_PORT = String(address.port);
    const tools = await createStudioRpcToolProvider().createTools({ cwd: "/tmp/schema-free-project" });
    const result = await tools
      .find((tool) => tool.name === "studiorpc_execute_luau")!
      .execute(
        { target: "Editor", code: "error('stop')" },
        { toolCallId: "wire", signal: new AbortController().signal, abort() {} },
      );
    expect(result.metadata).toMatchObject({ error: true, code: -32000, data });
    expect(result.output).toContain('"command_id": "cmd-wire"');
    expect(result.output).toContain("Do not automatically retry");
    expect(requests).toBe(1);
  });
});
