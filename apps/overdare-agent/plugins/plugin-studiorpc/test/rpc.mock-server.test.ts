// @summary Verifies plugin-studiorpc can talk to a local TCP JSON-RPC mock server.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "@diligent/plugin-sdk";
import { type StudioRpcMockServer, startStudioRpcMockServer } from "../../../scripts/mock-studiorpc.ts";
import { createTools } from "../src/index.ts";
import { call } from "../src/rpc.ts";

function createToolContext(): ToolContext {
  return {
    toolCallId: "tool-call-1",
    signal: new AbortController().signal,
    abort: () => {},
    approve: async () => "always",
    ask: async () => null,
  };
}

describe("plugin-studiorpc mock server", () => {
  let server: StudioRpcMockServer;
  const originalStudioHost = process.env.STUDIO_HOST;
  const originalStudioPort = process.env.STUDIO_PORT;

  beforeEach(async () => {
    server = await startStudioRpcMockServer({ port: 0, quiet: true });
    process.env.STUDIO_HOST = server.host;
    process.env.STUDIO_PORT = String(server.port);
  });

  afterEach(async () => {
    await server.stop();
    if (originalStudioHost === undefined) delete process.env.STUDIO_HOST;
    else process.env.STUDIO_HOST = originalStudioHost;
    if (originalStudioPort === undefined) delete process.env.STUDIO_PORT;
    else process.env.STUDIO_PORT = originalStudioPort;
  });

  test("call() exchanges newline-delimited JSON-RPC with the mock server", async () => {
    const result = await call("level.browse", {});

    expect(Array.isArray(result)).toBe(true);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      id: 1,
      jsonrpc: "2.0",
      method: "level.browse",
    });
    expect(server.requests[0]?.params).toBeUndefined();
  });

  test("studiorpc_level_browse returns tree render blocks from the mock response", async () => {
    const tools = await createTools({ cwd: process.cwd() });
    const tool = tools.find((entry) => entry.name === "studiorpc_level_browse");

    expect(tool).toBeDefined();
    if (!tool) throw new Error("studiorpc_level_browse not found");

    const result = await tool.execute({}, createToolContext());

    expect(result.render).toMatchObject({
      inputSummary: "level tree",
      outputSummary: "1 root node",
    });
    expect(result.render?.blocks[0]).toMatchObject({
      type: "tree",
      title: "Level tree",
    });
    const snapshot = server.snapshot();
    expect(snapshot[0]?.guid).toBe("WORKSPACE_GUID");
    expect(snapshot[0]?.children?.[0]?.guid).toBe("SCRIPTS_GUID");
  });

  test("mock server preserves GUID-based state for instance upsert, read, and delete", async () => {
    const created = await call("instance.upsert", {
      items: [{ class: "Folder", parentGuid: "WORKSPACE_GUID", name: "GeneratedFolder", properties: {} }],
    });

    expect(created).toMatchObject({ ok: true });
    const createdGuid = (created as { createdGuids?: string[] }).createdGuids?.[0];
    expect(createdGuid).toMatch(/^MOCK_GUID_/);

    const readBack = await call("instance.read", { guid: createdGuid, recursive: false });
    expect(readBack).toMatchObject({
      guid: createdGuid,
      name: "GeneratedFolder",
      class: "Folder",
    });

    const deleted = await call("instance.delete", { items: [{ targetGuid: createdGuid }] });
    expect(deleted).toMatchObject({ ok: true, deletedGuids: [createdGuid] });

    const postDeleteSnapshot = server.snapshot();
    const found = postDeleteSnapshot.flatMap((node) => node.children ?? []).find((node) => node.guid === createdGuid);
    expect(found).toBeUndefined();
  });
});
