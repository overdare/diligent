// @summary Canonical MCP results survive live notifications, history, restart and model replay
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@diligent/core/message-contract";
import { type AgentEvent, McpToolResultSchema, type ThreadReadResponse } from "@diligent/protocol";
import type { StreamFunction } from "@diligent/runtime";
import { applyCodeMode, CodeModeSession, McpConnectionManager, mcpToolToDiligentTool } from "@diligent/runtime/tools";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let cwd = "";
let client: ProtocolTestClient | undefined;
let manager: McpConnectionManager | undefined;
let session: CodeModeSession | undefined;
afterEach(async () => {
  client?.close();
  session?.dispose();
  await manager?.disposeAll();
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

test.each([
  ["direct", false],
  ["direct", true],
  ["exec", false],
  ["exec", true],
] as const)("MCP payloads remain recoverable after %s calls and restart (isError=%s)", async (mode, isError) => {
  cwd = await mkdtemp(join(tmpdir(), "diligent-mcp-results-"));
  const raw = {
    content: [
      { type: "text", text: "  result text  " },
      {
        type: "resource_link",
        name: "report.csv",
        uri: "https://example.test/report.csv",
        mimeType: "text/csv",
        description: "Generated report",
      },
      { type: "audio", mimeType: "audio/wav", data: "YXVkaW8=", _meta: { private: "block-private" } },
      {
        type: "resource",
        resource: { uri: "file:///report.bin", mimeType: "application/octet-stream", blob: "YmluYXJ5" },
      },
      { type: "video", uri: "file:///clip", data: "future-payload" },
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    ],
    structuredContent: { count: 2 },
    _meta: { private: "result-private" },
    isError,
  };
  const fixture = join(cwd, "result.json");
  await Bun.write(fixture, JSON.stringify(raw));
  manager = new McpConnectionManager();
  await manager.sync({
    fixture: { command: process.execPath, args: [join(import.meta.dir, "../fixtures/mcp-result-server.ts"), fixture] },
  });
  const tool = mcpToolToDiligentTool({
    serverName: "fixture",
    def: { name: "result", inputSchema: { type: "object" } },
    manager,
  });
  session = new CodeModeSession();
  const tools = mode === "exec" ? applyCodeMode([tool], { codeMode: "only", session }) : [tool];
  const streamFunction = createToolUseStream(
    [
      {
        id: "call",
        name: mode === "exec" ? "exec" : tool.name,
        input: mode === "exec" ? { code: `text(await tools.${tool.name}({}));` } : {},
      },
    ],
    "done",
  );
  client = createProtocolClient(createTestServer({ cwd, tools, streamFunction }));
  const threadId = await client.initAndStartThread(cwd);
  const notifications = await client.sendTurnAndWait(threadId, "Get the result");
  const live = notifications
    .map((notification) => (notification.params as { event?: AgentEvent }).event)
    .find((event) => event?.type === "tool_end" && event.toolName === tool.name);
  expect(live?.type).toBe("tool_end");
  if (live?.type !== "tool_end") throw new Error("Missing tool result");
  expect(McpToolResultSchema.parse(live.metadata?.mcpResult)).toEqual(raw);
  expect(live.isError).toBe(isError);
  expect(live.outputImages).toMatchObject([{ source: { media_type: "image/png", data: raw.content.at(-1)!.data } }]);
  for (const value of [
    "report.csv",
    "https://example.test/report.csv",
    "text/csv",
    "Generated report",
    "playback unavailable",
    "file:///report.bin",
    "unsupported MCP content: video",
    "Structured output:",
  ])
    expect(live.output).toContain(value);
  for (const value of ["block-private", "result-private", "YXVkaW8=", "YmluYXJ5", "future-payload"])
    expect(live.output).not.toContain(value);
  const before = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
  expect(
    before.items.find((item) => item.type === "toolCall" && item.toolName === tool.name && item.output !== undefined),
  ).toMatchObject({ metadata: { mcpResult: raw }, output: live.output });

  client.close();
  await manager.disposeAll();
  // The new server has no MCP tools or connection: replay must use the saved result.
  let replay: Message[] = [];
  const simple = createSimpleStream("replayed");
  const replayStream: StreamFunction = (model, context, options) => {
    replay = [...context.messages];
    return simple(model, context, options);
  };
  client = createProtocolClient(createTestServer({ cwd, streamFunction: replayStream }));
  await client.request("initialize", { clientName: "test", clientVersion: "0", protocolVersion: 1 });
  await client.request("thread/resume", { threadId });
  const after = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
  const restored = after.items.find(
    (item) => item.type === "toolCall" && item.toolName === tool.name && item.output !== undefined,
  );
  expect(restored).toMatchObject({ output: live.output, isError, metadata: { mcpResult: raw } });
  if (mode === "direct")
    expect(restored?.type === "toolCall" ? restored.outputImages : undefined).toEqual(live.outputImages);
  expect(restored?.type === "toolCall" ? restored.render : undefined).toBeDefined();
  await client.sendTurnAndWait(threadId, "Use the saved result");
  const result = replay.find((message) => message.role === "tool_result");
  expect(result?.role).toBe("tool_result");
  if (result?.role !== "tool_result") throw new Error("Missing replayed tool result");
  if (mode === "direct") expect(result.metadata?.mcpResult).toEqual(raw);
  else expect(result.metadata?.codeMode).toMatchObject({ nestedCalls: [{ metadata: { mcpResult: raw } }] });
  expect(result.output).toContain("https://example.test/report.csv");
  expect(result.output).not.toContain("result-private");
});
