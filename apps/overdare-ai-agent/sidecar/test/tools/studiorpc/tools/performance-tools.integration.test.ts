import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toToolInputSchema } from "@diligent/core/tool-contract";
import { buildRegistries, callRegistryTool, type McpRegistries } from "../../../../src/mcp-server";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";

test("provider and MCP share two performance tools, without map mutations or approval", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "performance-tools-"));
  const calls: string[] = [];
  let approvals = 0;
  let ended = false;
  const provider = createStudioRpcToolProvider({
    callRpc: async (method, params) => {
      calls.push(method);
      if (method === "performance.capabilities")
        return {
          resolvedTarget: { pid: 7, startTimeUtc: "2026-11-01T00:00:00Z", hostName: "remote" },
          metrics: { frame_ms: { status: "ok" } },
          conditions: {},
        };
      if (method === "performance.capture.start") return { nativeJobId: "native", state: "capturing" };
      if (method === "performance.capture.stop") {
        ended = true;
        return { state: "completed" };
      }
      if (method === "performance.capture.status") return { state: ended ? "completed" : "capturing", frameCount: 1 };
      if (method === "performance.report.read" && params?.section === "summary") return { state: "completed" };
      if (method === "performance.report.read")
        return {
          records: [
            {
              frameId: "1",
              beginMonotonicNs: "1",
              endMonotonicNs: "2",
              frame_ms: 10,
              lua_machine_ms: null,
              slate_gt_ms: 0,
              validity: {},
            },
          ],
          nextOffset: null,
        };
      throw new Error(`Unexpected RPC ${method}`);
    },
  });
  try {
    const tools = await provider.createTools({
      cwd,
      host: {
        approve: async () => {
          approvals++;
          return "reject";
        },
      },
    });
    expect(
      tools
        .filter((tool) => tool.name.startsWith("studiorpc_performance_"))
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["studiorpc_performance_capture", "studiorpc_performance_report"]);
    const capture = tools.find((tool) => tool.name === "studiorpc_performance_capture")!;
    expect(capture.description).toContain("debug.profilebegin");
    expect(capture.description).toContain("debug.profileend");
    expect(capture.description).toContain("synchronous");
    expect(toToolInputSchema(capture).type).toBe("object");
    const registries: McpRegistries = { tools: new Map(tools.map((tool) => [tool.name, tool])), prompts: new Map() };
    const invalid = await callRegistryTool(registries, capture.name, { case: "idle", budget: 16 });
    expect(invalid.isError).toBe(true);
    expect(calls).toEqual([]);
    const started = await callRegistryTool(registries, capture.name, { case: "idle", seconds: 1 });
    expect(started.isError).not.toBe(true);
    const jobId = JSON.parse(started.content[0]!.text as string).jobId;
    await callRegistryTool(registries, capture.name, { action: "stop", jobId, outcome: "completed" });
    const report = await callRegistryTool(registries, "studiorpc_performance_report", { jobId });
    const value = JSON.parse(report.content[0]!.text as string);
    expect(value.summaries.frame_ms.p50).toBe(10);
    expect(value.summaries.lua_machine_ms.p50).toBeNull();
    expect(Buffer.byteLength(report.content[0]!.text as string)).toBeLessThanOrEqual(16 * 1024);
    expect(approvals).toBe(0);
    expect(calls.every((method) => method.startsWith("performance."))).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("packaged agent guidance teaches script instrumentation and supported capture scope", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "performance-guidance-"));
  const bootstrapDir = fileURLToPath(new URL("../../../../../bootstrap/", import.meta.url));
  try {
    const registries = await buildRegistries({
      cwd,
      bootstrapDir,
      systemPromptPath: join(bootstrapDir, "system-prompt.txt"),
      revocationStatePath: join(cwd, "revocations.json"),
    });
    const loaded = await callRegistryTool(registries, "load_skill", { name: "performance-optimization" });
    expect(loaded.isError).not.toBe(true);
    const text = loaded.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
    for (const instruction of [
      "debug.profilebegin",
      "debug.profileend",
      "studiorpc_script_edit",
      "studiorpc_performance_capture",
      "luaScopes",
      "compatibility fallback",
      "External Lua labels",
    ])
      expect(text).toContain(instruction);
    expect(text).not.toContain("You cannot read frame time");
    const prompt = await callRegistryTool(registries, "ensure_system_prompt", {});
    expect(
      prompt.content.some(
        (item) => item.type === "text" && item.text.includes("For performance measurement or Lua function profiling"),
      ),
    ).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
