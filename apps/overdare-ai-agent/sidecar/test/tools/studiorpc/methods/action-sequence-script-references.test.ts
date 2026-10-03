// @summary Verifies literal runner and signal references against saved and proposed sequence data.
import { describe, expect, test } from "bun:test";
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
      expect(result.issues).toHaveLength(1);
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
});
