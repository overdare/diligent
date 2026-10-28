// @summary Nested collaboration retains the same durable-entry observer and captured user.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput, StreamFunction } from "@diligent/runtime";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

test("nested children emit independently attributed durable entries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nested-entry-e2e-"));
  const observed: HookInput[] = [];
  const streams = new Map<string, StreamFunction>();
  const streamFunction: StreamFunction = (model, context, options) => {
    const id = options.sessionId ?? "root";
    let stream = streams.get(id);
    if (!stream) {
      const last = context.messages.at(-1);
      const text = last?.role === "user" && typeof last.content === "string" ? last.content : "";
      stream =
        text === "root task"
          ? createToolUseStream(
              [
                {
                  id: "first-child",
                  name: "spawn_agent",
                  input: { message: "nested task", agent_type: "general", allow_nested_agents: true },
                },
              ],
              "root done",
            )
          : text === "nested task"
            ? createToolUseStream(
                [{ id: "grandchild", name: "spawn_agent", input: { message: "leaf task", agent_type: "general" } }],
                "child done",
              )
            : createSimpleStream("leaf done");
      streams.set(id, stream);
    }
    return stream(model, context, options);
  };
  const server = createTestServer({
    cwd,
    streamFunction,
    runtimeToolsConfig: { codeMode: "off" },
    runtimeConfigOverrides: { diligent: { userId: "synthetic-owner", tools: { codeMode: "off" } } },
    bundledToolProviders: [
      {
        id: "nested-observer",
        createTools: () => [],
        onEntryAppended: async (input) => {
          observed.push(input);
          return { blocked: false };
        },
      },
    ],
  });
  const client = createProtocolClient(server);
  try {
    const rootId = await client.initAndStartThread(cwd);
    await client.sendTurnAndWait(rootId, "root task");
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const ids = new Set(observed.filter((input) => input.session_id !== rootId).map((input) => input.session_id));
      if (ids.size === 2 && [...ids].every((id) => observed.filter((input) => input.session_id === id).length >= 2))
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const children = observed.filter((input) => input.session_id !== rootId);
    const ids = [...new Set(children.map((input) => input.session_id))];
    expect(ids).toHaveLength(2);
    expect(children.every((input) => input.user_id === "synthetic-owner")).toBe(true);
    const parentIds = await Promise.all(
      ids.map(async (id) => {
        const input = children.find((entry) => entry.session_id === id)!;
        return JSON.parse((await readFile(input.transcript_path, "utf8")).split("\n")[0]).parentSession;
      }),
    );
    expect(parentIds).toContain(rootId);
    expect(parentIds.some((id) => ids.includes(id))).toBe(true);
  } finally {
    client.close();
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});
