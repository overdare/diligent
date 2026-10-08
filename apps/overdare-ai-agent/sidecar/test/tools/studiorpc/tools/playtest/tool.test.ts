// @summary Tests Diligent's editable Studio playtest harness installation and source ownership.
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlaytestTools } from "../../../../../src/tools/studiorpc/tools/playtest";
import { luaString } from "../../../../../src/tools/studiorpc/tools/playtest/harness";

const context = {
  toolCallId: "call",
  signal: new AbortController().signal,
  abort() {},
  approve: async () => "once" as const,
};
const tree = {
  level: [
    {
      Name: "ReplicatedStorage",
      ActorGuid: "rs",
      LuaChildren: [
        {
          Name: "DiligentPlaytestHarnesses",
          ActorGuid: "folder",
          LuaChildren: [{ Name: "sample", ActorGuid: "adapter", LuaChildren: [] }],
        },
      ],
    },
    {
      Name: "StarterPlayer",
      ActorGuid: "starter",
      LuaChildren: [
        {
          Name: "StarterPlayerScripts",
          ActorGuid: "scripts",
          LuaChildren: [{ Name: "DiligentPlaytestDriver_sample", ActorGuid: "driver", LuaChildren: [] }],
        },
      ],
    },
  ],
};

describe("editable playtest tools", () => {
  test("list discovers installed names without reading or mutating their source", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      return tree;
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" })[0]!;
    const result = await tool.execute({ operation: "list" } as never, context);
    expect(JSON.parse(result.output).harnesses).toEqual([
      expect.objectContaining({ name: "sample", moduleGuid: "adapter", driverGuid: "driver" }),
    ]);
    expect(calls).toEqual(["level.browse"]);
  });
  test("a missing read is a recoverable authoring branch and includes actual installed names", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      return tree;
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" })[0]!;
    const result = await tool.execute({ operation: "read", name: "unknown" } as never, context);
    expect(result.metadata?.error).not.toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      found: false,
      availableHarnesses: ["sample"],
      nextAction: "inspect_game_and_install",
    });
    expect(calls).toEqual(["level.browse"]);
  });
  test("a failed Studio lookup is not reported as an absent harness", async () => {
    const rpc = async () => {
      throw Error("Studio RPC timed out");
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" })[0]!;
    await expect(tool.execute({ operation: "read", name: "unknown" } as never, context)).rejects.toThrow("timed out");
  });
  test("read returns current Studio source and hash so Diligent can improve it", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      if (method === "level.browse") return tree;
      if (method === "instance.read")
        return { instance: { Name: "sample", Source: "return {observe=function() return {state={},actions={}} end}" } };
      throw Error(method);
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" }).find(
      (t) => t.name === "studiorpc_game_playtest_harness",
    )!;
    const result = await tool.execute({ operation: "read", name: "sample" } as never, context);
    expect(result.output).toContain("observe=function");
    expect(result.metadata?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual(["level.browse", "instance.read"]);
  });
  test("source updates require the hash of the currently read version", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      if (method === "game.pie.status") return { running: false };
      if (method === "level.browse") return tree;
      if (method === "instance.read") return { instance: { Name: "sample", Source: "changed by someone else" } };
      throw Error(method);
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" }).find(
      (t) => t.name === "studiorpc_game_playtest_harness",
    )!;
    await expect(
      tool.execute(
        { operation: "update", name: "sample", source: "return {}", expectedSourceHash: "0".repeat(64) } as never,
        context,
      ),
    ).rejects.toThrow(/changed|hash/i);
    expect(calls).not.toContain("instance.update");
    expect(calls).not.toContain("execute.luau");
  });
  test("install cannot rewrite a harness while PIE runs", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      return { running: true };
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" }).find(
      (t) => t.name === "studiorpc_game_playtest_harness",
    )!;
    await expect(
      tool.execute({ operation: "install", name: "sample", source: "return {}" } as never, context),
    ).rejects.toThrow(/PIE|running/i);
    expect(calls).toEqual(["game.pie.status"]);
  });
  test("update saves the edited source, verifies readback and reports both scripts' validation", async () => {
    let source = "return {observe=function() return {state={},actions={}} end}";
    const next = `${source}\n-- Improved game observation`;
    const calls: string[] = [];
    const rpc = async (method: string, args?: Record<string, unknown>) => {
      calls.push(method);
      if (method === "game.pie.status") return { running: false };
      if (method === "level.browse") return tree;
      if (method === "instance.read") return { instance: { Name: "sample", Source: source } };
      if (method === "execute.luau") {
        expect(args?.code).toContain(`module.Source~=${luaString(source)}`);
        expect(args?.code).toContain(`module.Source=${luaString(next)}`);
        source = next;
        return { updated: true };
      }
      if (method === "level.save.file") return {};
      if (method === "lua.validate") {
        expect(args?.targetGuids).toEqual(["adapter", "driver"]);
        return { output: "SUMMARY scripts=2 errors=0 warnings=0" };
      }
      throw Error(method);
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" })[0];
    const current = await tool!.execute({ operation: "read", name: "sample" }, context);
    const result = await tool!.execute(
      { operation: "update", name: "sample", source: next, expectedSourceHash: current.metadata?.sourceHash },
      context,
    );
    expect(result.metadata?.valid).toBe(true);
    expect(result.metadata?.sourceHash).not.toBe(current.metadata?.sourceHash);
    expect(calls.indexOf("level.save.file")).toBeGreaterThan(calls.indexOf("execute.luau"));
    expect(calls.at(-1)).toBe("lua.validate");
  });
  test("save failure reports the successful edit without retrying its mutation", async () => {
    let source = "return {}";
    let mutations = 0;
    const rpc = async (method: string) => {
      if (method === "game.pie.status") return { running: false };
      if (method === "level.browse") return tree;
      if (method === "instance.read") return { instance: { Name: "sample", Source: source } };
      if (method === "execute.luau") {
        mutations++;
        source = "return {observe=function() end}";
        return {};
      }
      if (method === "level.save.file") throw Error("disk full");
      throw Error(method);
    };
    const tool = createPlaytestTools({ callRpc: rpc as never, cwd: "/tmp" })[0]!;
    const current = await tool.execute({ operation: "read", name: "sample" }, context);
    await expect(
      tool.execute(
        {
          operation: "update",
          name: "sample",
          source: "return {observe=function() end}",
          expectedSourceHash: current.metadata?.sourceHash,
        },
        context,
      ),
    ).rejects.toThrow(/edit succeeded.*saving failed.*do not replay/);
    expect(mutations).toBe(1);
  });
});

test("playtest exposes the caller's stuck timeout while refusing out-of-range values", () => {
  const tool = createPlaytestTools({
    callRpc: (() => {
      throw Error("Unexpected RPC");
    }) as never,
    cwd: "/tmp",
  })[1]!;
  const request = { harnessName: "sample", goal: "Survive", stuckTimeoutMs: 2300 };
  expect(tool.parameters.parse(request)).toMatchObject({ stuckTimeoutMs: 2300 });
  expect(tool.parameters.parse({ ...request, stuckTimeoutMs: 0 })).toMatchObject({ stuckTimeoutMs: 0 });
  expect(() => tool.parameters.parse({ ...request, stuckTimeoutMs: -1 })).toThrow();
  expect(() => tool.parameters.parse({ ...request, stuckTimeoutMs: 180001 })).toThrow();
});

test("missing OpenAI credentials and unsupported visual provider fail before Studio calls", async () => {
  let calls = 0;
  const tool = createPlaytestTools({
    cwd: "/tmp",
    callRpc: async () => {
      calls++;
      throw Error("unexpected RPC");
    },
    decisionOptions: { resolveApiKey: async () => undefined },
  })[1]!;
  await expect(
    tool.execute({ harnessName: "sample", goal: "inspect", decisionProvider: "openai-decisions" }, context),
  ).rejects.toThrow(/OPENAI_API_KEY/);
  await expect(
    tool.execute(
      { harnessName: "sample", goal: "inspect", decisionProvider: "laya", observationMode: "structured+image" },
      context,
    ),
  ).rejects.toThrow(/visual|image/i);
  expect(calls).toBe(0);
});

test("shared playtest tool switches to Decisions with pixels and persists provider and capture evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "playtest-provider-"));
  try {
    const file = join(dir, "shot.png");
    await writeFile(
      file,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    let running = false,
      injected = false,
      revision = 0,
      requests = 0;
    const rpc = async (method: string, params?: Record<string, unknown>) => {
      if (method === "level.browse") return tree;
      if (method === "instance.read") return { instance: { Name: "sample", Source: "return {}" } };
      if (method === "lua.validate") return { output: "SUMMARY scripts=2 errors=0 warnings=0" };
      if (method === "game.pie.status")
        return {
          running,
          pieSessionId: running ? "owned" : undefined,
          clients: running ? [{ clientId: "client", injectable: true, targeted: true }] : [],
        };
      if (method === "game.play") {
        running = true;
        return { started: true };
      }
      if (method === "game.stop") {
        running = false;
        return { stopped: true };
      }
      if (method === "game.screenshot") return { success: true, path: file, image: { width: 1, height: 1 } };
      if (method === "game.input.inject") {
        injected = true;
        return { status: "completed" };
      }
      if (method === "game.observe") {
        const name = (params?.instances as { targets: string[] }).targets[0];
        return {
          character: { data: { clientId: "client" } },
          instances: {
            data: {
              instances: [
                {
                  name,
                  Value: {
                    Type: "String",
                    String: JSON.stringify({
                      protocolVersion: 1,
                      harnessId: "sample",
                      revision: ++revision,
                      gameTimeSeconds: revision,
                      state: { done: injected },
                      decisionState: { scene: "panel" },
                      actions: injected
                        ? []
                        : [
                            {
                              id: "inspect",
                              description: "Inspect",
                              events: [{ type: "wait", durationMs: 1 }],
                              expectations: [{ key: "done", op: "equals", value: true }],
                            },
                            { id: "leave", description: "Leave", events: [{ type: "wait", durationMs: 1 }] },
                          ],
                      ...(injected ? { terminal: { outcome: "success", reason: "Synthetic test completion" } } : {}),
                    }),
                  },
                },
              ],
            },
          },
        };
      }
      throw Error(method);
    };
    const run = createPlaytestTools({
      cwd: dir,
      callRpc: rpc as never,
      decisionOptions: {
        resolveApiKey: async () => "test-secret",
        fetch: async (_url, init) => {
          requests++;
          const payload = JSON.parse(String(init.body));
          expect(payload.input[0].content[1].type).toBe("input_image");
          return Response.json({ answers: [{ name: "action", type: "choice", choice: "inspect" }] });
        },
      },
    })[1]!;
    const result = await run.execute(
      {
        harnessName: "sample",
        goal: "inspect",
        decisionProvider: "openai-decisions",
        observationMode: "structured+image",
        maxDurationMs: 2000,
        maxVisualAgeMs: 2000,
      },
      context,
    );
    expect(requests).toBe(1);
    expect(injected).toBe(true);
    expect(running).toBe(false);
    const output = JSON.parse(result.output);
    expect(output.outcome).toBe("success");
    expect(output.decisionConfig).toMatchObject({ provider: "openai-decisions", observationMode: "structured+image" });
    expect(output.cleanup.stopped).toBe(true);
    const summary = JSON.parse(await readFile(output.summaryPath, "utf8"));
    expect(summary.decisionConfig).toEqual(output.decisionConfig);
    const trace = await readFile(output.tracePath, "utf8");
    expect(trace).toContain('"type":"visual_observation"');
    expect(trace).not.toContain("test-secret");
    expect(trace).not.toContain("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
