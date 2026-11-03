// @summary Verifies ActionSequence compatibility normalization at the bundled tool boundary.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { type call, StudioRpcError } from "../../../../src/tools/studiorpc/rpc";
import { normalizeActionSequenceJson } from "../../../../src/tools/studiorpc/tools/action-sequence-json";
import { createActionSequencerApplyJsonTool } from "../../../../src/tools/studiorpc/tools/action-sequencer-apply-json-tool";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function track(type: string, id: number) {
  return {
    Class: `/Script/LuaAPI.ActionSequence${type}Track`,
    TrackID: { a: id, b: 0, c: 0, d: 0 },
    IsEnable: true,
    StartTime: 0.2,
    EndTime: 0.7,
    ParentTrackID: { a: 0, b: 0, c: 0, d: 0 },
    ChildTrackIDs: [],
    IsLock: false,
  };
}

function sequence() {
  return {
    Class: "/Script/LuaAPI.ActionSequence",
    Header: { version: 2, createTime: "2026.09.25-00.00.00", lastModifyTime: "2026.09.25-00.00.00" },
    ActionSequenceID: "attack",
    SequencerDescription: "test",
    Length: 1,
    Tracks: [
      { ...track("Control", 1), AttachmentOffset: {}, ProxyData: { Props: { untouched: [1, 2] } } },
      { ...track("Sound", 2), OvdrAssetId: { ovdrAssetId: "ovdrassetid://1110127" }, FadeOutTime: 0.1 },
    ],
  };
}

async function setup(
  content: string,
  callRpc: typeof call,
  approve: () => Promise<"once" | "reject"> = async () => "once",
) {
  const dir = mkdtempSync(join(tmpdir(), "action-sequence-test-"));
  dirs.push(dir);
  const path = join(dir, "sequence.json");
  writeFileSync(path, content);
  const tools = await createStudioRpcToolProvider({ callRpc }).createTools({ cwd: dir, host: { approve } });
  const tool = tools.find((candidate) => candidate.name === "studiorpc_action_sequence_write")!;
  const controller = new AbortController();
  return {
    path,
    controller,
    run: (dryRun = false) =>
      tool.execute(
        { instanceGuid: "sequence-guid", jsonFilePath: path, ...(dryRun ? { dryRun: true } : {}) },
        {
          toolCallId: "test",
          signal: controller.signal,
          abort: () => {},
        },
      ),
  };
}

describe("ActionSequence apply JSON", () => {
  test("dryRun bypasses approval and the write lock while retaining normalization and cleanup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "action-sequence-dry-run-"));
    dirs.push(dir);
    const path = join(dir, "sequence.json");
    const content = JSON.stringify(sequence());
    writeFileSync(path, content);
    let staged = "";
    const tool = createActionSequencerApplyJsonTool(
      async (method, args) => {
        expect(method).toBe("action_sequence.write");
        expect(args?.dryRun).toBe(true);
        staged = args?.jsonFilePath as string;
        expect(JSON.parse(readFileSync(staged, "utf8")).Tracks[0].bScaleInheritance).toBe(true);
        return { success: true, dryRun: true, issues: [{ kind: "test", severity: "warning" }], timeline: [] };
      },
      {
        async acquire() {
          throw new Error("dryRun must not acquire the write lock");
        },
      },
    );
    const result = await tool.execute(
      { instanceGuid: "guid", jsonFilePath: path, dryRun: true },
      {
        toolCallId: "test",
        signal: new AbortController().signal,
        abort() {},
        async approve() {
          throw new Error("dryRun must not request approval");
        },
      },
    );
    expect(JSON.parse(result.output).issues[0].kind).toBe("test");
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(existsSync(dirname(staged))).toBe(false);
  });

  test("the provider exposes only write and skips snapshot capture for dryRun", async () => {
    const dir = mkdtempSync(join(tmpdir(), "action-sequence-provider-"));
    dirs.push(dir);
    const path = join(dir, "sequence.json");
    writeFileSync(path, JSON.stringify(sequence()));
    const turnState = {};
    const tools = await createStudioRpcToolProvider({
      callRpc: async () => ({ success: true, dryRun: true, issues: [] }),
    }).createTools({
      cwd: dir,
      turnState,
      host: {
        async approve() {
          throw new Error("dryRun must be read-only");
        },
      },
    });
    expect(tools.some((tool) => tool.name === "studiorpc_action_sequencer_service_apply_json")).toBe(false);
    const tool = tools.find((tool) => tool.name === "studiorpc_action_sequence_write")!;
    const result = await tool.execute(
      { instanceGuid: "guid", jsonFilePath: path, dryRun: true },
      { toolCallId: "test", signal: new AbortController().signal, abort() {} },
    );
    expect(result.output).not.toContain("snapshot");
    expect(turnState).toEqual({});
  });
  test("fills missing Studio fields in a temporary file and preserves the source and track data", async () => {
    const original = JSON.stringify(sequence());
    let stagedPath = "";
    const harness = await setup(original, async (method, args, options) => {
      expect(method).toBe("action_sequence.write");
      expect(args?.instanceGuid).toBe("sequence-guid");
      expect(options?.signal).toBe(harness.controller.signal);
      stagedPath = args?.jsonFilePath as string;
      expect(stagedPath).not.toBe(harness.path);
      const staged = JSON.parse(readFileSync(stagedPath, "utf8"));
      expect(staged).toEqual({
        ...sequence(),
        PreviewTarget: {},
        Tracks: sequence().Tracks.map((item) => ({
          ...item,
          CustomDisplayName: "",
          StartOffsetTime: 0,
          ...(item.Class.endsWith("ControlTrack") ? { bScaleInheritance: true } : {}),
        })),
      });
      return { success: true };
    });
    const result = await harness.run();
    expect(JSON.parse(result.output).success).toBe(true);
    expect(readFileSync(harness.path, "utf8")).toBe(original);
    expect(existsSync(dirname(stagedPath))).toBe(false);
  });

  test("preserves explicit values, legacy header versions, and unknown fields", async () => {
    const input = {
      ...sequence(),
      Header: { ...sequence().Header, version: 1 },
      PreviewTarget: { skeletonId: "custom" },
      Tracks: [
        { ...sequence().Tracks[0], CustomDisplayName: "custom", StartOffsetTime: 0.4, bScaleInheritance: false },
      ],
      FutureProperty: { value: 42 },
    };
    const harness = await setup(JSON.stringify(input), async (_method, args) => {
      expect(JSON.parse(readFileSync(args?.jsonFilePath as string, "utf8"))).toEqual(input);
      return { success: true };
    });
    await harness.run();
  });

  test.each([
    ["invalid JSON", "{", "JSON"],
    ["missing required root field", JSON.stringify({ ...sequence(), Length: undefined }), "Length"],
    [
      "missing required track field",
      JSON.stringify({ ...sequence(), Tracks: [{ ...track("Sound", 1), TrackID: undefined }] }),
      "Tracks[0].TrackID",
    ],
    [
      "invalid existing compatibility field",
      JSON.stringify({ ...sequence(), Tracks: [{ ...track("Sound", 1), StartOffsetTime: null }] }),
      "Tracks[0].StartOffsetTime",
    ],
  ])("reports %s before contacting Studio", async (_name, content, diagnostic) => {
    let calls = 0;
    const harness = await setup(content, async () => {
      calls++;
      return {};
    });
    await expect(harness.run()).rejects.toThrow(diagnostic);
    expect(calls).toBe(0);
    expect(readFileSync(harness.path, "utf8")).toBe(content);
  });

  test("cleans up on Studio rejection and adds guidance only for JSON structure errors", async () => {
    let stagedPath = "";
    const harness = await setup(JSON.stringify(sequence()), async (_method, args) => {
      stagedPath = args?.jsonFilePath as string;
      throw new StudioRpcError("Invalid ActionSequence JSON structure", -32005, { detail: "from Studio" });
    });
    try {
      await harness.run();
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(StudioRpcError);
      expect((error as StudioRpcError).code).toBe(-32005);
      expect((error as StudioRpcError).data).toEqual({ detail: "from Studio" });
      expect((error as Error).message).toContain("Sandbox.log");
      expect((error as Error).message).toContain("optional");
    }
    expect(existsSync(dirname(stagedPath))).toBe(false);

    const otherError = new StudioRpcError("Instance is not an ActionSequence", -32005, undefined);
    const other = await setup(JSON.stringify(sequence()), async () => {
      throw otherError;
    });
    await expect(other.run()).rejects.toBe(otherError);
  });

  test("approval rejection does not call Studio or alter the source", async () => {
    let calls = 0;
    const harness = await setup(
      "{",
      async () => {
        calls++;
        return {};
      },
      async () => "reject",
    );
    expect((await harness.run()).metadata?.error).toBe(true);
    expect(calls).toBe(0);
    expect(readFileSync(harness.path, "utf8")).toBe("{");
  });

  test("every bundled JSON template includes the fields required by current Studio", () => {
    const referenceDir = join(import.meta.dir, "../../../../../bootstrap/skills/actionsequence/references/json");
    const files = readdirSync(referenceDir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const json = JSON.parse(readFileSync(join(referenceDir, file), "utf8"));
      expect(normalizeActionSequenceJson(JSON.stringify(json))).toEqual(json);
      expect(json.Header.version).toBe(2);
      expect(json.PreviewTarget).toEqual(expect.any(Object));
      for (const item of json.Tracks) {
        expect(typeof item.CustomDisplayName).toBe("string");
        expect(typeof item.StartOffsetTime).toBe("number");
        if (item.Class === "/Script/LuaAPI.ActionSequenceControlTrack")
          expect(typeof item.bScaleInheritance).toBe("boolean");
      }
    }
  });
});
