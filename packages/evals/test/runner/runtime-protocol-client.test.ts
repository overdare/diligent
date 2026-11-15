// @summary Turn completion waits use caller-owned cancellation and preserve terminal notifications

import { describe, expect, test } from "bun:test";
import type { JSONRPCMessage } from "@diligent/protocol";
import type { DiligentAppServer } from "@diligent/runtime";
import { createRuntimeProtocolClient } from "../../src/runner/runtime-protocol-client";

function createClient() {
  let connection!: Parameters<DiligentAppServer["connect"]>[1];
  const server = {
    connect(_id: string, peer: typeof connection) {
      connection = peer;
      return () => {};
    },
  } as unknown as DiligentAppServer;
  return {
    client: createRuntimeProtocolClient(server),
    notify(message: JSONRPCMessage) {
      connection.send(message);
    },
  };
}

describe("runtime protocol turn completion", () => {
  test("rejects a pending wait with the caller's abort reason", async () => {
    const { client } = createClient();
    const controller = new AbortController();
    const reason = new Error("Execution budget exhausted");
    try {
      const waiting = client.waitForTerminal(0, controller.signal);
      controller.abort(reason);
      await expect(waiting).rejects.toBe(reason);
    } finally {
      client.close();
    }
  });

  test("rejects immediately when the caller has already aborted", async () => {
    const { client } = createClient();
    const reason = new Error("Execution budget already exhausted");
    try {
      await expect(client.waitForTerminal(0, AbortSignal.abort(reason))).rejects.toBe(reason);
    } finally {
      client.close();
    }
  });

  test.each([
    "turn/completed",
    "turn/interrupted",
  ] as const)("waits for a new %s notification instead of an earlier turn", async (method) => {
    const { client, notify } = createClient();
    const controller = new AbortController();
    const previous = { method, params: { threadId: "thread-1", turnId: "turn-1" } };
    const current = { method, params: { threadId: "thread-1", turnId: "turn-2" } };
    try {
      notify(previous);
      const waiting = client.waitForTerminal(client.notifications.length, controller.signal);
      notify(current);
      expect(await waiting).toEqual([current]);
      expect(await client.waitForTerminal(0, controller.signal)).toEqual([previous, current]);
    } finally {
      controller.abort();
      client.close();
    }
  });
});
