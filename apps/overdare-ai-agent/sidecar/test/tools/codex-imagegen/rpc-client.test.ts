// @summary Verifies request correlation and lossless notifications independently of Codex image policy.

import { expect, test } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import { CodexRpcClient } from "../../../src/tools/codex-imagegen/rpc-client";

function connection() {
  const incoming = new EventStream<string, void>(
    () => false,
    () => {},
  );
  const reader = incoming[Symbol.asyncIterator]();
  const sent: Array<{ id?: number | string; method?: string; error?: { code: number } }> = [];
  let closes = 0;
  const client = new CodexRpcClient({
    writeLine: (line) => sent.push(JSON.parse(line)),
    async readLine() {
      const line = await reader.next();
      if (line.done) throw new Error("connection ended");
      return line.value;
    },
    async close() {
      closes += 1;
      incoming.end();
    },
  });
  return {
    client,
    sent,
    incoming,
    closes: () => closes,
    receive: (message: unknown) => incoming.push(JSON.stringify(message)),
  };
}

test("correlates out-of-order responses without requiring notifications to be consumed", async () => {
  const wire = connection();
  try {
    const first = wire.client.request("first", {});
    const second = wire.client.request("second", {});
    wire.receive({ method: "progress", params: { step: 1 } });
    wire.receive({ id: wire.sent[1]!.id, result: "second result" });
    wire.receive({ method: "progress", params: { step: 2 } });
    wire.receive({ id: wire.sent[0]!.id, result: "first result" });
    expect(await Promise.all([first, second])).toEqual(["first result", "second result"]);
    const notifications = wire.client.notifications()[Symbol.asyncIterator]();
    expect((await notifications.next()).value).toEqual({ method: "progress", params: { step: 1 } });
    expect((await notifications.next()).value).toEqual({ method: "progress", params: { step: 2 } });
  } finally {
    await wire.client.close();
  }
});

test("rejects unsupported server requests while continuing to deliver responses", async () => {
  const wire = connection();
  try {
    const response = wire.client.request("first", {});
    wire.receive({ id: "server-1", method: "approval/request", params: {} });
    wire.receive({ id: wire.sent[0]!.id, result: "accepted" });
    expect(await response).toBe("accepted");
    expect(wire.sent[1]).toMatchObject({ id: "server-1", error: { code: -32601 } });
  } finally {
    await wire.client.close();
  }
});

test("a remote request error does not fail unrelated requests", async () => {
  const wire = connection();
  try {
    const first = wire.client.request("first", {}).catch((error: Error) => error.message);
    const second = wire.client.request("second", {});
    wire.receive({ id: wire.sent[0]!.id, error: { code: -1, message: "permission denied" } });
    wire.receive({ id: wire.sent[1]!.id, result: "second result" });
    expect(await first).toContain("permission denied");
    expect(await second).toBe("second result");
  } finally {
    await wire.client.close();
  }
});

test.each(["EOF", "invalid JSON"])("%s rejects pending requests and the notification consumer", async (failure) => {
  const wire = connection();
  const first = wire.client.request("first", {}).catch((error: Error) => error.message);
  const second = wire.client.request("second", {}).catch((error: Error) => error.message);
  const next = wire.client
    .notifications()
    [Symbol.asyncIterator]()
    .next()
    .catch((error: Error) => error.message);
  if (failure === "EOF") wire.incoming.end();
  else wire.incoming.push("{invalid json");
  const expected = failure === "EOF" ? "connection ended" : "invalid JSON";
  for (const result of await Promise.all([first, second, next])) expect(result).toContain(expected);
  await expect(wire.client.request("after failure", {})).rejects.toThrow(expected);
  await wire.client.close();
});

test("close rejects pending work and is safe to call more than once", async () => {
  const wire = connection();
  const pending = wire.client.request("first", {}).catch((error: Error) => error.message);
  await Promise.all([wire.client.close(), wire.client.close()]);
  expect(await pending).toContain("closed");
  expect(wire.closes()).toBe(1);
  await expect(wire.client.request("after close", {})).rejects.toThrow("closed");
});
