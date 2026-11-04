// @summary Tests OVERDARE Studio bundled Studio RPC tool provider assembly.

import { describe, expect, test } from "bun:test";
import type { Tool } from "@diligent/core/tool-contract";
import { createStudioBundledToolProviders } from "../../src/tools";
import { createStudioRpcToolProvider } from "../../src/tools/studiorpc";
import * as levelBrowse from "../../src/tools/studiorpc/methods/level.browse";

async function loadStudioTools(
  cwd: string,
  rpcCalls: Array<{ method: string; params?: Record<string, unknown>; timeoutMs?: number }> = [],
): Promise<Map<string, Tool>> {
  const provider = createStudioRpcToolProvider({
    callRpc: async (method, params, options) => {
      rpcCalls.push({ method, params, timeoutMs: options?.timeoutMs });
      return { ok: true };
    },
  });
  const tools = await provider.createTools({
    cwd,
    host: { approve: async () => "once" },
  });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function toolContext() {
  return { toolCallId: "test", signal: new AbortController().signal, abort: () => {} };
}

describe("createStudioRpcToolProvider", () => {
  test("creates bundled Studio RPC tools with Zod schemas", async () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    const provider = providers.find((candidate) => candidate.id === "@overdare/studiorpc-tools");

    expect(provider).toBeDefined();

    const tools = await provider!.createTools({ cwd: "/tmp/project" });
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("studiorpc_instance_read");
    expect(toolNames).not.toContain("studiorpc_instance_upsert");
    expect(toolNames).not.toContain("studiorpc_instance_move");
    expect(toolNames).not.toContain("studiorpc_instance_delete");
    expect(toolNames).toContain("studiorpc_script_edit");
    expect(toolNames).toContain("get_collision_channels");
    expect(toolNames).toContain("create_collision_profile");
    expect(toolNames).toContain("edit_collision_profile");
    expect(toolNames).toContain("hub_world_categories_list");
    expect(toolNames).toContain("studiorpc_level_save_file");
    expect(toolNames).toContain("studiorpc_game_play");

    const saveTool = tools.find((tool) => tool.name === "studiorpc_level_save_file")!;

    expect(() => saveTool.parameters.parse({})).not.toThrow();
    expect(() => tools.find((tool) => tool.name === "get_collision_profiles")!.parameters.parse({})).not.toThrow();
  });

  test("accepts maxDepth 0 as unlimited for level browsing", async () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    const provider = providers.find((candidate) => candidate.id === "@overdare/studiorpc-tools")!;
    const tools = await provider.createTools({ cwd: "/tmp/project" });
    const browseTool = tools.find((tool) => tool.name === "studiorpc_level_browse")!;

    expect(() => browseTool.parameters.parse({ maxDepth: 0 })).not.toThrow();
    expect(browseTool.parameters.parse({ maxDepth: 0 })).toMatchObject({ maxDepth: 0 });
  });

  test("treats maxDepth 0 and omitted maxDepth as unlimited after level browsing", () => {
    const tree = [
      {
        guid: "root",
        class: "Folder",
        children: [
          {
            guid: "part",
            class: "Part",
            children: [{ guid: "script", class: "Script" }],
          },
        ],
      },
    ];

    expect(levelBrowse.postProcess({ level: tree }, { maxDepth: 0 })).toEqual(tree);
    expect(levelBrowse.postProcess({ level: tree }, {})).toEqual(tree);
    expect(levelBrowse.postProcess({ level: tree }, { maxDepth: 1 })).toEqual([{ guid: "root", class: "Folder" }]);
  });

  test("preserves generic RPC approval rejection behavior without calling Studio", async () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    const provider = providers.find((candidate) => candidate.id === "@overdare/studiorpc-tools")!;
    const tools = await provider.createTools({
      cwd: "/tmp/project",
      host: {
        approve: async () => "reject",
      },
    });
    const saveTool = tools.find((tool) => tool.name === "studiorpc_level_save_file")!;

    const result = await saveTool.execute(
      {},
      { toolCallId: "test", signal: new AbortController().signal, abort: () => {} },
    );

    expect(result).toEqual({
      output: "[Rejected by user]",
      metadata: { error: true, method: "level.save.file" },
    });
  });

  test("does not save the Studio level at turn boundaries (Studio saves on Send itself)", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method, params) => {
        calls.push({ method, params });
        return {};
      },
    });

    const studioRpcProvider = provider as typeof provider & {
      onUserPromptSubmit: NonNullable<typeof provider.onUserPromptSubmit>;
    };

    expect(studioRpcProvider.onUserPromptSubmit.mode).toBe("sync");

    await studioRpcProvider.onUserPromptSubmit({
      session_id: "session-1",
      transcript_path: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    });
    await provider.onStop?.({
      session_id: "session-1",
      transcript_path: "",
      cwd: "/tmp/project",
      hook_event_name: "Stop",
    });

    await provider.onStop?.({
      session_id: "session-1",
      transcript_path: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      hook_event_name: "Stop",
    });

    expect(calls).toEqual([]);
  });

  test("saves the level to file after a mutating asset-import tool call", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown>; timeoutMs?: number }> = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method, params, options) => {
        calls.push({ method, params, timeoutMs: options?.timeoutMs });
        return "imported";
      },
    });
    const tools = await provider.createTools({
      cwd: "/tmp/project",
      host: { approve: async () => "once" },
    });
    const importTool = tools.find((tool) => tool.name === "studiorpc_asset_drawer_import")!;

    await importTool.execute(
      { assetid: "ovdrassetid://123", assetName: "Tree", assetType: "MODEL" },
      { toolCallId: "test", signal: new AbortController().signal, abort: () => {} },
    );

    expect(calls).toEqual([
      {
        method: "asset_drawer.import",
        params: { assetid: "ovdrassetid://123", assetName: "Tree", assetType: "MODEL" },
        timeoutMs: undefined,
      },
      { method: "level.save.file", params: {}, timeoutMs: undefined },
    ]);
  });

  test("always returns the publish result and uses skipCreatorHubLaunch only for browser control", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown>; timeoutMs?: number }> = [];
    const tools = await loadStudioTools("/tmp/project", calls);
    const publishTool = tools.get("studiorpc_level_publish")!;

    const defaultResult = await publishTool.execute({ worldName: "My World" }, toolContext());
    await publishTool.execute({ skipCreatorHubLaunch: false }, toolContext());
    const headlessResult = await publishTool.execute({ skipCreatorHubLaunch: true }, toolContext());

    expect(defaultResult.render).toMatchObject({
      outputSummary: "Publish result ready.",
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: "summary",
          text: "Studio returned a publish result and opened Creator Hub for approval.",
        }),
      ]),
    });
    expect(headlessResult.render).toMatchObject({
      outputSummary: "Publish result ready.",
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: "summary",
          text: "Studio returned a publish result without opening Creator Hub.",
        }),
      ]),
    });

    expect(calls).toEqual([
      {
        method: "level.publish",
        params: { worldName: "My World" },
        timeoutMs: 300_000,
      },
      {
        method: "level.publish",
        params: { skipCreatorHubLaunch: false },
        timeoutMs: 300_000,
      },
      {
        method: "level.publish",
        params: { skipCreatorHubLaunch: true },
        timeoutMs: 300_000,
      },
    ]);
  });
});
