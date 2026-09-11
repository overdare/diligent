// @summary UI inspection reads current Editor properties without saving, executing, or changing the level.
import { expect, mock, test } from "bun:test";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";

const button = (guid: string, x: number, y: number) => ({
  InstanceType: "ImageButton",
  ActorGuid: guid,
  Name: guid,
  BackgroundTransparency: 1,
  Position: { X: { Scale: 0, Offset: x }, Y: { Scale: 0, Offset: y } },
  Size: { X: { Scale: 0, Offset: 100 }, Y: { Scale: 0, Offset: 100 } },
});
const screen = {
  InstanceType: "ScreenGui",
  ActorGuid: "HUD",
  Name: "HUD",
  LuaChildren: [button("Fire", 1100, 400), button("Reload", 1140, 430), button("Outside", -80, 250)],
};

async function setup(overrides: { root?: unknown; reject?: boolean } = {}) {
  const root = overrides.root ?? {
    InstanceType: "StarterGui",
    ActorGuid: "GUI",
    Name: "StarterGui",
    LuaChildren: [screen],
  };
  const callRpc = mock(async (method: string) => {
    if (method === "level.browse")
      return { level: [{ InstanceType: "StarterGui", ActorGuid: "GUI", Name: "StarterGui" }] };
    if (method === "instance.read") return { success: true, instance: root };
    throw new Error(`Unexpected mutation or extra RPC: ${method}`);
  });
  const tools = await createStudioRpcToolProvider({ callRpc }).createTools({
    cwd: "/tmp",
    host: { approve: async () => (overrides.reject ? "reject" : "once") },
  });
  const tool = tools.find((entry) => entry.name === "studiorpc_ui_inspect_layout");
  expect(tool).toBeDefined();
  return {
    tool: tool!,
    callRpc,
    context: { toolCallId: "inspect", signal: new AbortController().signal, abort: () => {} },
  };
}

test("reports reserved areas, button intersections and viewport exits using only two read RPCs", async () => {
  const { tool, callRpc, context } = await setup();
  const result = await tool.execute({}, context);
  const report = JSON.parse(result.output);
  expect(report).toMatchObject({
    status: "complete",
    source: "editor-instance-properties",
    geometry: "authored-estimate",
  });
  expect(report.findings.map((finding: { kind: string }) => finding.kind)).toEqual(
    expect.arrayContaining(["reserved_overlap", "button_overlap", "outside_viewport"]),
  );
  expect(callRpc.mock.calls.map(([method]) => method)).toEqual(["level.browse", "instance.read"]);
  expect(callRpc).toHaveBeenLastCalledWith(
    "instance.read",
    { ActorGuid: "GUI", Depth: -1 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(result.metadata?.error).not.toBe(true);
});

test("hidden-control hints stay local and suppress only the matching reserved finding", async () => {
  const { tool, callRpc, context } = await setup();
  const report = JSON.parse((await tool.execute({ hiddenCoreGui: ["JumpButton"] }, context)).output);
  expect(report.findings.some((finding: { kind: string }) => finding.kind === "button_overlap")).toBe(true);
  expect(
    report.findings
      .filter((finding: { kind: string }) => finding.kind === "reserved_overlap")
      .some((finding: unknown) => JSON.stringify(finding).includes("JumpButton")),
  ).toBe(false);
  expect(JSON.stringify(callRpc.mock.calls)).not.toContain("hiddenCoreGui");
});

test("an unreadable response is unavailable, never a clean bill of health", async () => {
  const { tool, context } = await setup({ root: {} });
  const result = await tool.execute({}, context);
  expect(JSON.parse(result.output).status).toBe("unavailable");
  expect(result.metadata?.error).toBe(true);
});

test("missing authored geometry is partial even when no collision can be reported", async () => {
  const root = {
    InstanceType: "StarterGui",
    ActorGuid: "GUI",
    LuaChildren: [
      {
        InstanceType: "ScreenGui",
        ActorGuid: "HUD",
        Name: "HUD",
        LuaChildren: [{ InstanceType: "ImageButton", ActorGuid: "Incomplete", Name: "Incomplete" }],
      },
    ],
  };
  const { tool, context } = await setup({ root });
  const report = JSON.parse((await tool.execute({}, context)).output);
  expect(report.status).toBe("partial");
  expect(report.findings).toEqual([]);
  expect(report.skippedElements.length).toBeGreaterThan(0);
});

test("rejecting the read or cancelling it does not call Studio", async () => {
  const rejected = await setup({ reject: true });
  expect((await rejected.tool.execute({}, rejected.context)).metadata?.error).toBe(true);
  expect(rejected.callRpc).not.toHaveBeenCalled();
  const cancelled = await setup();
  await expect(
    cancelled.tool.execute({}, { ...cancelled.context, signal: AbortSignal.abort(new Error("cancelled")) }),
  ).rejects.toThrow("cancelled");
  expect(cancelled.callRpc).not.toHaveBeenCalled();
});

test("screen scoping does not inspect other screens or expose their script source", async () => {
  const root = {
    InstanceType: "StarterGui",
    ActorGuid: "GUI",
    Name: "StarterGui",
    LuaChildren: [
      screen,
      {
        InstanceType: "ScreenGui",
        ActorGuid: "Empty",
        Name: "Empty",
        LuaChildren: [{ InstanceType: "LocalScript", Name: "Controller", Source: "private-script-marker" }],
      },
    ],
  };
  const { tool, context } = await setup({ root });
  const report = JSON.parse((await tool.execute({ screenGuid: "Empty" }, context)).output);
  expect(report.findings).toEqual([]);
  expect(JSON.stringify(report)).not.toContain("private-script-marker");
  const missing = JSON.parse((await tool.execute({ screenGuid: "Missing" }, context)).output);
  expect(missing.status).toBe("unavailable");
});
