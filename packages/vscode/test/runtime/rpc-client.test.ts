import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { DiligentRpcClient } from "../../src/runtime/rpc-client";

function createTransport() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let killed = false;
  let resolveExit: (code: number | null) => void = () => undefined;
  const exit = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });
  const writes: string[] = [];
  stdin.on("data", (chunk) => writes.push(String(chunk)));
  return {
    transport: {
      stdin,
      stdout,
      stderr,
      kill() {
        killed = true;
        resolveExit(0);
      },
      exit,
    },
    stdin,
    stdout,
    stderr,
    wasKilled: () => killed,
    getWrites: () => writes.join(""),
  };
}

const clients: DiligentRpcClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.dispose().catch(() => undefined)));
  clients.length = 0;
});

describe("DiligentRpcClient", () => {
  test("correlates request/response across NDJSON chunks", async () => {
    const { transport, stdout, getWrites } = createTransport();
    const client = new DiligentRpcClient();
    clients.push(client);
    await client.start(transport);

    const pending = client.request("initialize", {
      clientName: "test",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const requestFrame = getWrites();
    expect(requestFrame).toContain('"method":"initialize"');

    stdout.write(
      '{"id":1,"result":{"serverName":"diligent","serverVersion":"0.0.1","protocolVersion":1,"capabilities":',
    );
    stdout.write('{"supportsFollowUp":true,"supportsApprovals":true,"supportsUserInput":true}}}\n');

    const response = await pending;
    expect(response.serverName).toBe("diligent");
  });

  test("dispatches server requests and writes response frames", async () => {
    const { transport, stdout, getWrites } = createTransport();
    const client = new DiligentRpcClient();
    clients.push(client);
    await client.start(transport);

    client.onServerRequest(async (_id, request) => {
      expect(request.method).toBe("approval/request");
      return {
        method: "approval/request",
        result: { decision: "once" },
      };
    });

    stdout.write(
      `${JSON.stringify({
        id: 99,
        method: "approval/request",
        params: {
          threadId: "thread-1",
          request: {
            permission: "read",
            toolName: "read",
            description: "Need read access",
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const written = getWrites();
    expect(written).toContain('"id":99');
    expect(written).toContain('"decision":"once"');
  });

  test("surfaces stderr lines to listeners", async () => {
    const { transport, stderr } = createTransport();
    const client = new DiligentRpcClient();
    clients.push(client);
    await client.start(transport);

    const lines: string[] = [];
    client.onStderr((line) => lines.push(line));
    stderr.write("first\nsecond\n");
    stderr.end();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toEqual(["first", "second"]);
  });
});
