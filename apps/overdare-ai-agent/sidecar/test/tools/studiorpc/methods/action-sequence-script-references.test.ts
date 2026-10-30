// @summary Verifies literal runner and signal references against saved and proposed sequence data.
import { describe, expect, test } from "bun:test";
import { callRegistryTool } from "../../../../src/mcp-server";
import { createStudioRpcTools } from "../../../../src/tools/studiorpc";
import {
  checkScriptReferences,
  enrichScriptReferences,
} from "../../../../src/tools/studiorpc/methods/action-sequence-script-references";

const track = { Class: "/Script/LuaAPI.ActionSequenceTriggerTrack", TriggerName: "ActiveSkill" };
const sequence = {
  InstanceType: "ActionSequence",
  ActorGuid: "sequence",
  Name: "Attack",
  Data: JSON.stringify({ Tracks: [track] }),
};
const script = (Source: string) => ({ InstanceType: "Script", ActorGuid: "script", Name: "GameLogic", Source });
const root = (Source: string) => ({ LuaChildren: [sequence, script(Source)] });

const controllerSource = `local SequenceController = {}
function SequenceController.Bind(runtimeScript)
  SequenceController._bindSequenceEnd(runtimeScript.Parent)
  SequenceController._bindCombo(runtimeScript.Parent)
  SequenceController._bindCancelWindow(runtimeScript.Parent)
end
function SequenceController._bindMovement(actionSequence)
  actionSequence:TriggerStarted("Sequence"):Connect(onStart)
  actionSequence:TriggerEnded("Sequence"):Connect(onEnd)
end
function SequenceController._bindSequenceEnd(actionSequence)
  actionSequence:TriggerEnded("Sequence"):Connect(function() charModel:OnSequenceEnd() end)
end
function SequenceController._bindCombo(actionSequence)
  actionSequence:TriggerStarted("KeyInput"):Connect(function() charModel:SetComboReady() end)
  actionSequence:TriggerEnded("KeyInput"):Connect(function() charModel:ClearComboReady() end)
end
function SequenceController._bindCancelWindow(actionSequence)
  actionSequence:TriggerStarted("CancelWindow"):Connect(function() charModel:AdvanceComboImmediate() end)
  actionSequence:TriggerEnded("CancelWindow"):Connect(function() charModel:ClearCancelable() end)
end
return SequenceController`;
const bindingSource = `local Controller = require(game:GetService("ServerStorage"):WaitForChild("Module"):WaitForChild("Controller"):WaitForChild("SequenceController"))
Controller.Bind(script)`;
const tpaRoot = (Source = bindingSource): { LuaChildren: Array<Record<string, unknown>> } => ({
  LuaChildren: [
    {
      ...sequence,
      Data: JSON.stringify({ Length: 1, Tracks: [] }),
      LuaChildren: [{ ...script(Source), Name: "ServerRuntime" }],
    },
    {
      InstanceType: "ServerStorage",
      Name: "ServerStorage",
      LuaChildren: [
        {
          Name: "Module",
          LuaChildren: [
            {
              Name: "Controller",
              LuaChildren: [
                {
                  InstanceType: "ModuleScript",
                  Name: "SequenceController",
                  ActorGuid: "controller",
                  Source: controllerSource,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
const conventionKinds = new Set([
  "missingSequenceTrigger",
  "sequenceEndsEarly",
  "cancelWindowNotAtEnd",
  "cancelInputPair",
  "cancelInputTiming",
]);
const advice = (value: ReturnType<typeof checkScriptReferences>) =>
  value.issues.filter((issue) => conventionKinds.has(String(issue.kind)));

describe("action sequence script references", () => {
  test("uses saved Studio script subtrees and reports unavailable scans explicitly", async () => {
    const previous = process.env.STUDIO_API_VERSION;
    process.env.STUDIO_API_VERSION = "v2";
    try {
      const calls: string[] = [];
      const result = await enrichScriptReferences({ issues: [] }, "sequence", "unused", async (method) => {
        calls.push(method);
        return method === "level.browse"
          ? { level: [{ ActorGuid: "service" }] }
          : { instance: root('runner:Play("Wrong")') };
      });
      expect(calls).toEqual(["level.browse", "instance.read"]);
      expect(result.scriptReferenceCheck).toMatchObject({ status: "completed", scriptsSearched: 1 });
      expect(result.issues).toEqual([]);
      expect(result.scriptReferenceCheck).toMatchObject({ issues: [{ kind: "missingPlaySequence" }] });
      const unavailable = await enrichScriptReferences({ issues: [] }, "sequence", "unused", async () => {
        throw new Error("offline");
      });
      expect(unavailable.scriptReferenceCheck).toMatchObject({ status: "unavailable", reason: "offline" });
      expect(unavailable.issues).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.STUDIO_API_VERSION;
      else process.env.STUDIO_API_VERSION = previous;
    }
  });
  test("reports missing literal Play names with script evidence and respects existing names", () => {
    const result = checkScriptReferences(root('actionRunner:Play("Attak")\nactionRunner:Play("Attack")'), "sequence");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: "missingPlaySequence",
      severity: "warning",
      trackIndex: -1,
      evidence: { referencedName: "Attak", scriptGuid: "script", lineNum: 1 },
    });
  });
  test("matches subscriptions against emitted signals and uses proposed tracks in dryRun", () => {
    const source =
      'sequence:TriggerStarted("ActiveSkill"):Connect(onStart)\nsequence:Hit("HitTrigger1"):Connect(onHit)';
    const saved = checkScriptReferences(root(source), "sequence");
    expect(saved.issues.map((i) => i.kind)).toEqual(["missingSignal"]);
    const proposed = checkScriptReferences(root(source), "sequence", { Tracks: [] });
    expect(proposed.issues).toHaveLength(2);
    expect(proposed.issues[0].evidence).toMatchObject({ signal: "Trigger_ActiveSkill_Start" });
  });
  test("ignores comments, quoted code, dynamic names and unrelated Play methods", () => {
    const source =
      '-- runner:Play("missing")\nlocal text = \'runner:Play("missing")\'\n--[[\nrunner:Play("missing")\n]]\nrunner:Play(sequenceName)\nsound:Play("missing")';
    expect(checkScriptReferences(root(source), "sequence").issues).toEqual([]);
  });
  test("does not infer TPA rules from generic names, comments or an unrelated controller", () => {
    for (const source of [
      "",
      `-- ${bindingSource.replaceAll("\n", "\n-- ")}`,
      `local text = [=[${bindingSource}]=]`,
      bindingSource.replace('"ServerStorage"', '"Server Storage"'),
    ]) {
      expect(advice(checkScriptReferences(tpaRoot(source), "sequence"))).toEqual([]);
    }
    const unrelated = tpaRoot("");
    unrelated.LuaChildren.push({ ...script(bindingSource), Name: "UnrelatedRuntime" });
    expect(advice(checkScriptReferences(unrelated, "sequence"))).toEqual([]);
  });
  test("reports detected TPA timing advice with target binding and controller evidence", () => {
    const tracks = [
      { ...track, TriggerName: "Sequence", StartTime: 0, EndTime: 0.4 },
      { ...track, TriggerName: "KeyInput", StartTime: 0, EndTime: 0.2 },
      { ...track, TriggerName: "CancelWindow", StartTime: 0.5, EndTime: 0.8 },
      { Class: "/Script/LuaAPI.ActionSequenceAnimationTrack", StartTime: 0, EndTime: 1 },
    ];
    const findings = advice(checkScriptReferences(tpaRoot(), "sequence", { Length: 1, Tracks: tracks }));
    expect(findings.map((issue) => issue.kind)).toEqual([
      "sequenceEndsEarly",
      "cancelWindowNotAtEnd",
      "cancelInputTiming",
    ]);
    expect(findings.every((issue) => issue.severity !== "error")).toBe(true);
    expect(findings[0].evidence).toMatchObject({
      convention: "TPA",
      bindingScriptGuid: "script",
      bindingLine: 2,
      controllerGuid: "controller",
      controllerPath: "ServerStorage.Module.Controller.SequenceController",
      controllerLine: controllerSource.split("\n").findIndex((line) => line.includes(":OnSequenceEnd(")) + 1,
      controllerMethod: "TriggerEnded",
      configuration: "notEvaluated",
    });
    expect(findings[1].evidence).toMatchObject({
      controllerLine: controllerSource.split("\n").findIndex((line) => line.includes(":ClearCancelable(")) + 1,
      controllerMethod: "TriggerEnded",
    });
    expect(findings[2].evidence).toMatchObject({
      controllerLine: controllerSource.split("\n").findIndex((line) => line.includes(":AdvanceComboImmediate(")) + 1,
      controllerMethod: "TriggerStarted",
    });
    expect(
      advice(checkScriptReferences(tpaRoot(), "sequence", { Length: 1, Tracks: [] })).map((issue) => issue.kind),
    ).toEqual(["missingSequenceTrigger"]);
    expect(
      advice(checkScriptReferences(tpaRoot(), "sequence", { Length: 1, Tracks: [tracks[0], tracks[1]] })).map(
        (issue) => issue.kind,
      ),
    ).toContain("cancelInputPair");
  });
  test("keeps native facts separate from external convention advice through the public MCP tool", async () => {
    const nativeIssue = { kind: "trackOutsideSequence", severity: "error" };
    const target = tpaRoot();
    target.LuaChildren[0].Data = JSON.stringify({ Length: 1, Tracks: [] });
    const tools = await createStudioRpcTools({
      cwd: "unused",
      callRpc: async (method) =>
        method === "action_sequence.read"
          ? { timeline: [], issues: [nativeIssue] }
          : method === "level.browse"
            ? { level: [{ ActorGuid: "root" }] }
            : { instance: target },
    });
    const result = await callRegistryTool(
      { tools: new Map(tools.map((tool) => [tool.name, tool])), prompts: new Map() },
      "studiorpc_action_sequence_read",
      { instanceGuid: "sequence" },
    );
    expect(result.isError).not.toBe(true);
    const content = result.content[0] as { text: string };
    const output = JSON.parse(content.text);
    expect(output.issues).toEqual([nativeIssue]);
    expect(output.scriptReferenceCheck.issues).toContainEqual(
      expect.objectContaining({ kind: "missingSequenceTrigger" }),
    );
    expect(output.scriptReferenceCheck.limitations).toContain("configuration");
  });
});
