// @summary Public app-server turns deliver child persistence to bundled EntryAppended hooks.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@diligent/runtime";
import { createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

test("bundled entry hooks observe actual child entries under the authenticated parent user", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "child-entry-e2e-"));
  const observed: HookInput[] = [];
  const server = createTestServer({
    cwd,
    runtimeToolsConfig: { codeMode: "off" },
    runtimeConfigOverrides: { diligent: { userId: "synthetic-user", tools: { codeMode: "off" } } },
    streamFunction: createToolUseStream(
      [
        {
          id: "spawn-child",
          name: "spawn_agent",
          input: { message: "child evidence", description: "observe child", agent_type: "general" },
        },
      ],
      "synthetic response",
    ),
    bundledToolProviders: [
      {
        id: "synthetic-entry-observer",
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
    const parentId = await client.initAndStartThread(cwd);
    await client.sendTurnAndWait(parentId, "spawn one child");
    // Observer dispatch is deliberately detached from the write and turn paths.
    const deadline = Date.now() + 1_000;
    while (observed.filter((input) => input.session_id !== parentId).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const child = observed.filter((input) => input.session_id !== parentId);
    expect(child.length).toBeGreaterThanOrEqual(2);
    expect(child.every((input) => input.user_id === "synthetic-user")).toBe(true);
    expect(new Set(child.map((input) => input.session_id)).size).toBe(1);
    const lines = (await readFile(child[0].transcript_path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0].parentSession).toBe(parentId);
    for (const input of child)
      expect(lines.some((entry) => entry.id === (input.entry as { id: string }).id)).toBe(true);
  } finally {
    client.close();
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});
