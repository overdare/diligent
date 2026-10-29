// @summary Verifies native Studio RPC contracts through the shared provider and MCP execution boundary.
import { describe, expect, test } from "bun:test";
import { executeTool } from "@diligent/core/tool-contract";
import { callRegistryTool, type McpRegistries } from "../../../src/mcp-server";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import type { StudioRpcCallOptions } from "../../../src/tools/studiorpc/rpc";
import { methodModules, mutatingMethods } from "../../../src/tools/studiorpc/tool-registry";

type RecordedCall = { method: string; params?: Record<string, unknown>; options?: StudioRpcCallOptions };

async function setup(reply: unknown = { success: true }, approve = true) {
  const calls: RecordedCall[] = [];
  let approvals = 0;
  const provider = createStudioRpcToolProvider({
    callRpc: async (method, params, options) => {
      calls.push({ method, params, options });
      return typeof reply === "function" ? reply({ method, params, options }) : reply;
    },
  });
  const tools = await provider.createTools({
    cwd: process.cwd(),
    host: {
      approve: async () => {
        approvals++;
        return approve ? "once" : "reject";
      },
    },
  });
  const registries: McpRegistries = { tools: new Map(tools.map((tool) => [tool.name, tool])), prompts: new Map() };
  return {
    calls,
    registries,
    approvals: () => approvals,
    invoke: (name: string, args: unknown) => callRegistryTool(registries, name, args),
  };
}

describe("native Studio method contracts", () => {
  test("texture prepare is read only and apply preserves pending state without an extra save", async () => {
    const ctx = await setup({ success: true, status: "pending", requestId: "request-1" });
    await ctx.invoke("studiorpc_texture_prepare", { targetGuid: "wall" });
    expect(ctx.approvals()).toBe(0);
    const args = { targetGuid: "wall", prepareId: "P", targetRevision: "R", requestId: "request-1" };
    const result = await ctx.invoke("studiorpc_texture_apply", args);
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("pending");
    expect(ctx.calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "texture.prepare", params: { targetGuid: "wall" } },
      { method: "texture.apply", params: args },
    ]);
    expect(ctx.approvals()).toBe(1);
  });

  test("the runtime executor exposes settings patches and propagates native failures to client tool results", async () => {
    const ctx = await setup({ success: false, error: "Native update failed" });
    const result = await executeTool(
      ctx.registries.tools,
      {
        type: "tool_call",
        id: "settings",
        name: "studiorpc_game_settings_update",
        input: { walkSpeed: 100 },
      },
      { toolCallId: "settings", signal: new AbortController().signal, abort: () => {} },
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("Native update failed");
    expect(ctx.calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "game.settings.update", params: { walkSpeed: 100 } },
    ]);
  });

  test("unknown import outcomes are reported without retrying or saving", async () => {
    const ctx = await setup(() => {
      throw new Error("Studio RPC timed out");
    });
    expect((await ctx.invoke("studiorpc_asset_manager_import", { file: "C:/asset.glb" })).isError).toBe(true);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.method).toBe("asset_manager.import");
  });

  test.each(["image.png", "model.glb", "sound.wav"])("unified import forwards %s and saves once", async (file) => {
    const ctx = await setup({ success: true, asset: { assetid: "ovdrassetid://test" } });
    const args = { file: `C:/assets/${file}`, assetName: "Reusable asset" };
    const result = await ctx.invoke("studiorpc_asset_manager_import", args);
    expect(result.isError).not.toBe(true);
    expect(ctx.calls.map(({ method }) => method)).toEqual(["asset_manager.import", "level.save.file"]);
    expect(ctx.calls[0]?.params).toEqual(args);
    expect(ctx.calls[0]?.options?.timeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(ctx.registries.tools.has("studiorpc_asset_manager_model_import")).toBe(false);
    expect(ctx.registries.tools.has("studiorpc_asset_manager_image_import")).toBe(false);
  });

  test("settings read is read-only and does not save", async () => {
    const ctx = await setup({ success: true, settings: { walkSpeed: 500 } });
    const result = await ctx.invoke("studiorpc_game_settings_read", {});
    expect(result.isError).not.toBe(true);
    expect(ctx.calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "game.settings.read", params: {} },
    ]);
    expect(ctx.approvals()).toBe(0);
    expect(JSON.parse(result.content[0]?.text as string).settings.walkSpeed).toBe(500);
  });

  test("legacy image tool calls use unified import without advertising another import tool", async () => {
    const ctx = await setup();
    expect((await ctx.invoke("studiorpc_asset_manager_image_import", { file: "C:/asset.png" })).isError).not.toBe(true);
    expect(ctx.calls[0]?.method).toBe("asset_manager.import");
    expect(ctx.registries.tools.has("studiorpc_asset_manager_image_import")).toBe(false);
  });

  test("settings patch preserves native fields and saves after the update", async () => {
    const ctx = await setup();
    const args = {
      maxPlayers: 12,
      gravity: 980,
      gravityScale: 1,
      jumpHeight: 100,
      jumpPower: 500,
      useJumpPower: false,
      walkSpeed: 500,
      maxSlopeAngle: 45,
      httpEnabled: false,
    };
    const result = await ctx.invoke("studiorpc_game_settings_update", args);
    expect(result.isError).not.toBe(true);
    expect(ctx.calls.map(({ method }) => method)).toEqual(["game.settings.update", "level.save.file"]);
    expect(ctx.calls[0]?.params).toEqual(args);
    expect(ctx.approvals()).toBe(1);
  });

  test.each([
    ["studiorpc_asset_manager_import", { file: "C:/asset.glb" }],
    ["studiorpc_game_settings_update", { walkSpeed: 100 }],
  ] as const)("a failed save preserves the successful %s result and never repeats the operation", async (name, args) => {
    const ctx = await setup(({ method }: RecordedCall) =>
      method === "level.save.file"
        ? { success: false, message: "Disk full" }
        : { success: true, asset: { assetid: "ovdrassetid://created" }, settings: { walkSpeed: 100 } },
    );
    const result = await ctx.invoke(name, args);
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text as string);
    expect(payload.success).toBe(true);
    expect(payload.saved).toBe(false);
    expect(payload.saveError).toContain("Disk full");
    expect(payload.saveError).toContain("Do not repeat");
    expect(ctx.calls.map(({ method }) => method)).toEqual([
      name === "studiorpc_asset_manager_import" ? "asset_manager.import" : "game.settings.update",
      "level.save.file",
    ]);
  });

  test("draft calls sharing an ID are serialized until the previous native execution completes", async () => {
    let releaseFirst!: () => void;
    let reportStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runs = 0;
    const ctx = await setup(async () => {
      if (++runs === 1) {
        reportStarted();
        await firstRun;
      }
      return { success: true };
    });
    const first = ctx.invoke("studiorpc_proceduralmodel_run", { id: "shared", code: "first" });
    await firstStarted;
    const second = ctx.invoke("studiorpc_proceduralmodel_run", { id: "shared", code: "second" });
    await Promise.resolve();
    expect(runs).toBe(1);
    releaseFirst();
    expect((await first).isError).not.toBe(true);
    expect((await second).isError).not.toBe(true);
    expect(ctx.calls.map(({ params }) => params?.code)).toEqual(["first", "second"]);
  });

  test.each([
    {},
    { maxPlayers: 0 },
    { maxPlayers: 21 },
    { maxPlayers: 1.5 },
    { gravity: -1 },
    { gravity: Infinity },
    { maxSlopeAngle: 90 },
    { httpEnabled: "false" },
    { unknown: 1 },
  ])("invalid settings patch never reaches Studio: %j", async (args) => {
    const ctx = await setup();
    expect((await ctx.invoke("studiorpc_game_settings_update", args)).isError).toBe(true);
    expect(ctx.calls).toEqual([]);
  });

  test.each([
    "studiorpc_asset_manager_import",
    "studiorpc_game_settings_update",
    "studiorpc_proceduralmodel_run",
  ])("approval rejection prevents %s and any save", async (name) => {
    const ctx = await setup({ success: true }, false);
    const args = name.includes("asset_manager")
      ? { file: "C:/asset.glb" }
      : name.includes("settings")
        ? { walkSpeed: 100 }
        : { id: "draft", code: "print('draft')" };
    expect((await ctx.invoke(name, args)).isError).toBe(true);
    expect(ctx.approvals()).toBe(1);
    expect(ctx.calls).toEqual([]);
  });

  test("draft recipe forwards its contract with enough time for the native 240-second run", async () => {
    const ctx = await setup();
    const args = {
      id: "draft-1",
      code: "print('draft')",
      parameters: { radius: 3 },
      timeoutSeconds: 240,
      action: "draft",
    };
    expect((await ctx.invoke("studiorpc_proceduralmodel_run", args)).isError).not.toBe(true);
    expect(ctx.calls.map(({ method }) => method)).toEqual(["proceduralmodel.run"]);
    expect(ctx.calls[0]?.params).toEqual(args);
    expect(ctx.calls[0]?.options?.timeoutMs).toBeGreaterThan(240_000);
  });

  test.each([
    { id: "../escape" },
    { id: ".hidden" },
    { id: "x", action: "execute" },
    { id: "x", code: "" },
  ])("invalid draft request never reaches Studio: %j", async (args) => {
    const ctx = await setup();
    expect((await ctx.invoke("studiorpc_proceduralmodel_run", args)).isError).toBe(true);
    expect(ctx.calls).toEqual([]);
  });

  test("addClient survives parsing and never restarts the session", async () => {
    const ctx = await setup({ success: true, action: "addClient", state: "clientStarting" });
    expect((await ctx.invoke("studiorpc_game_play", { addClient: true })).isError).not.toBe(true);
    expect(ctx.calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "game.play", params: { addClient: true } },
    ]);
  });

  test.each([
    { addClient: true, restart: true },
    { addClient: true, numberOfPlayer: 2 },
  ])("conflicting addClient request is rejected before stopping PIE: %j", async (args) => {
    const ctx = await setup();
    expect((await ctx.invoke("studiorpc_game_play", args)).isError).toBe(true);
    expect(ctx.calls).toEqual([]);
  });

  test("observe forwards the explicit PIE client with its sections", async () => {
    const ctx = await setup();
    const args = { character: true, ui: true, pieSessionId: "SESSION", clientId: "CLIENT" };
    expect((await ctx.invoke("studiorpc_game_observe", args)).isError).not.toBe(true);
    expect(ctx.calls[0]?.params).toEqual(args);
  });

  test.each([
    { character: true, clientId: "C" },
    { ui: true, pieSessionId: "S" },
    {},
  ])("invalid observation never reaches Studio: %j", async (args) => {
    const ctx = await setup();
    expect((await ctx.invoke("studiorpc_game_observe", args)).isError).toBe(true);
    expect(ctx.calls).toEqual([]);
  });

  test.each(["rebuild", "bake"])("%s is forwarded with a 30-second RPC deadline", async (operation) => {
    const ctx = await setup();
    const args = { guid: "G", [operation]: true };
    expect((await ctx.invoke("studiorpc_proceduralmodel_set", args)).isError).not.toBe(true);
    expect(ctx.calls[0]?.params).toEqual(args);
    expect(ctx.calls[0]?.options?.timeoutMs).toBe(30_000);
  });

  test.each([
    ["studiorpc_proceduralmodel_set", { guid: "G", rebuild: true }],
    ["studiorpc_game_settings_update", { walkSpeed: 100 }],
    ["studiorpc_asset_manager_import", { file: "C:/asset.png" }],
  ] as const)("native failure in %s becomes an MCP error and skips saving", async (name, args) => {
    const ctx = await setup({ success: false, error: "Native operation failed", run: { success: false } });
    const result = await ctx.invoke(name, args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Native operation failed");
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("Studio RPC approval gate", () => {
  const byMethod = new Map(methodModules.map((mod) => [mod.method, mod]));

  test("read-only declarations exclude mutating, serialized, and secret-bearing methods", () => {
    for (const mod of methodModules.filter((candidate) => candidate.readOnly)) {
      expect({ method: mod.method, mutating: mutatingMethods.has(mod.method) }).toEqual({
        method: mod.method,
        mutating: false,
      });
      expect({ method: mod.method, serialize: mod.serialize === true }).toEqual({
        method: mod.method,
        serialize: false,
      });
    }
    expect(byMethod.get("hub.token.read")?.readOnly).not.toBe(true);
    // Audit regressions: these reads sat behind the approval prompt and were rejected.
    expect(byMethod.get("game.character.read")?.readOnly).toBe(true);
    expect(byMethod.get("game.screenshot")?.readOnly).toBe(true);
  });

  test.each(
    methodModules.map((mod) => [mod.method, mod.readOnly === true] as const),
  )("%s asks for approval only when it is not read-only (readOnly: %p)", async (method, readOnly) => {
    const ctx = await setup({ success: true }, false);
    const tool = ctx.registries.tools.get(`studiorpc_${method.replace(/\./g, "_")}`);
    if (!tool) throw new Error(`No tool registered for ${method}`);

    // Empty arguments bypass schema parsing so every tool reaches the gate; read-only tools may
    // then fail their own argument checks (e.g. a recipe validation with no recipe), which is fine.
    const result = await tool
      .execute({}, { toolCallId: method, signal: new AbortController().signal, abort() {} })
      .catch((error: unknown) => ({ output: String(error) }));

    expect(ctx.approvals()).toBe(readOnly ? 0 : 1);
    if (!readOnly) {
      expect(result.output).toBe("[Rejected by user]");
      expect(ctx.calls).toEqual([]);
    }
  });
});
