// @summary Verifies live schema discovery and Editor execution without local schema assets.
import { describe, expect, test } from "bun:test";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as luau from "../../../../src/tools/studiorpc/methods/execute.luau";
import * as schema from "../../../../src/tools/studiorpc/methods/instance.schema.search";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";

const context = { toolCallId: "test", signal: new AbortController().signal, abort() {} };

describe("live Editor tools", () => {
  test("Editor world editing coexists with native ProceduralModel tools", async () => {
    const tools = await createStudioRpcToolProvider().createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("studiorpc_execute_luau");
    expect(names).toContain("studiorpc_instance_schema_search");
    expect(names).not.toContain("studiorpc_procedural_run");
    for (const name of ["api", "validate", "set"]) expect(names).toContain(`studiorpc_proceduralmodel_${name}`);
  });
  test("schema discovery does not request execute permission or save the world", async () => {
    const calls: string[] = [];
    let approvals = 0;
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        return { schemaVersion: "live", classes: [] };
      },
    }).createTools({
      cwd: "/tmp/nonexistent-schema-free-project",
      host: {
        approve: async () => {
          approvals++;
          return "reject";
        },
      },
    });
    const result = await tools
      .find((tool) => tool.name === "studiorpc_instance_schema_search")!
      .execute({ classes: ["FutureClass"] }, context);
    expect(JSON.parse(result.output)).toEqual({ schemaVersion: "live", classes: [] });
    expect(approvals).toBe(0);
    expect(calls).toEqual(["instance.schema.search"]);
  });
  test("Editor description exposes its entry point and automatic save contract", () => {
    expect(luau.description).toContain("workspace");
    expect(luau.description).toContain("game:GetService");
    expect(luau.description).toContain("automatically saves");
    expect(luau.description).toContain("not an asynchronous generation report");
  });
  test("schema filters enforce the Studio contract", () => {
    for (const input of [
      {},
      { query: "" },
      { classes: [] },
      { classes: [""] },
      { classes: Array(21).fill("Part") },
      { query: "a", limit: 1 },
      { query: "a", cursor: "x" },
    ]) {
      expect(schema.params.safeParse(input).success).toBe(false);
    }
    expect(schema.params.parse({ classes: ["FutureClass"], query: "color" })).toEqual({
      classes: ["FutureClass"],
      query: "color",
    });
  });
  test("Editor input rejects unsupported targets, NUL, and oversized UTF-8 source", () => {
    for (const input of [
      { code: "return 1" },
      { target: "Server", code: "" },
      { target: "Editor", code: "\0" },
      { target: "Editor", code: "가".repeat(90000) },
    ]) {
      expect(luau.params.safeParse(input).success).toBe(false);
    }
    expect(luau.params.parse({ target: "Editor", code: "" }).code).toBe("");
  });
  test("forwards combined filters and preserves future classes and optional hints without local assets", async () => {
    const reply = {
      schemaVersion: "future",
      classes: [
        {
          class: "FutureClass",
          creatable: true,
          service: false,
          properties: [
            {
              name: "FutureProperty",
              declaredOn: "FutureBase",
              writeCondition: "Editor only",
              valueSchema: { type: "number" },
            },
          ],
        },
      ],
    };
    const calls: unknown[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method, args) => {
        calls.push({ method, args });
        return reply;
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((t) => t.name === "studiorpc_instance_schema_search")!
      .execute({ classes: ["FutureClass"], query: "FutureProperty" }, context);
    expect(JSON.parse(result.output)).toEqual(reply);
    expect(calls).toEqual([
      { method: "instance.schema.search", args: { classes: ["FutureClass"], query: "FutureProperty" } },
    ]);
  });
  test("keeps the first-return string intact and flushes successful Editor changes", async () => {
    const calls: unknown[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method, args) => {
        calls.push({ method, args });
        return '{"created":1}';
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((t) => t.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: "return {created=1}" }, context);
    expect(result.output).toBe('{"created":1}');
    expect(calls).toEqual([
      { method: "execute.luau", args: { target: "Editor", code: "return {created=1}" } },
      { method: "level.save.file", args: {} },
    ]);
  });
  test("surfaces partial-mutation diagnostics without replaying failed code", async () => {
    const data = { command_id: "command-1", mutation_attempted: true, undo_recorded: false };
    const calls: string[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        throw new StudioRpcError("serialization failed", -32000, data);
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((t) => t.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: "return workspace" }, context);
    expect(result.metadata).toMatchObject({ error: true, data });
    expect(result.output).toContain('"mutation_attempted": true');
    expect(result.output).toContain("Do not automatically retry");
    expect(calls).toEqual(["execute.luau"]);
  });
  test("save failure reports successful execution and never replays code", async () => {
    const calls: string[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        if (method === "level.save.file") throw new Error("save unavailable");
        return "created";
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((t) => t.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: "return 'created'" }, context);
    expect(result.metadata).toMatchObject({ error: true, executionSucceeded: true, result: "created" });
    expect(result.output).toContain("Editor execution succeeded, but saving the level failed.");
    expect(result.output).not.toContain("Mutation outcome is unknown.");
    expect(calls).toEqual(["execute.luau", "level.save.file"]);
  });
  test("an explicit no-mutation failure does not claim partial edits or require world inspection", async () => {
    const data = { command_id: "command-2", mutation_attempted: false, undo_recorded: false };
    const calls: string[] = [];
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        throw new StudioRpcError("Unsupported Editor member: GetService", -32000, data);
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((tool) => tool.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: 'return game:GetService("Workspace")' }, context);
    expect(result.metadata).toMatchObject({ error: true, data, executionSucceeded: false });
    expect(result.output).toContain("Studio reports no mutation was attempted.");
    expect(result.output).not.toContain("partial world changes may remain");
    expect(result.output).not.toContain("Inspect the current world");
    expect(calls).toEqual(["execute.luau"]);
  });
  test("approval rejection sends no Editor command", async () => {
    let calls = 0;
    const tools = await createStudioRpcToolProvider({
      callRpc: async () => {
        calls++;
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project", host: { approve: async () => "reject" } });
    const result = await tools
      .find((t) => t.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: "" }, context);
    expect(result.metadata?.error).toBe(true);
    expect(calls).toBe(0);
  });
  test("serializes Editor execution and its save as one write operation", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const tools = await createStudioRpcToolProvider({
      callRpc: async (method, args) => {
        if (method === "level.save.file") {
          calls.push("save");
          return "saved";
        }
        const code = String(args?.code);
        calls.push(code);
        if (code === "first") {
          started();
          await holdFirst;
        }
        return code;
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const tool = tools.find((tool) => tool.name === "studiorpc_execute_luau")!;
    const first = tool.execute({ target: "Editor", code: "first" }, context);
    await firstStarted;
    const second = tool.execute({ target: "Editor", code: "second" }, context);
    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(["first", "save", "second", "save"]);
  });
  test("forwards cancellation and reports an unknown mutation outcome after a transport failure", async () => {
    const tools = await createStudioRpcToolProvider({
      callRpc: async (_method, _args, options) => {
        expect(options?.signal).toBe(context.signal);
        throw new Error("connection lost");
      },
    }).createTools({ cwd: "/tmp/nonexistent-schema-free-project" });
    const result = await tools
      .find((tool) => tool.name === "studiorpc_execute_luau")!
      .execute({ target: "Editor", code: "" }, context);
    expect(result.metadata).toMatchObject({ error: true, executionSucceeded: false });
    expect(result.output).toContain("Mutation outcome is unknown.");
    expect(result.output).toContain("Do not automatically retry");
  });
});
