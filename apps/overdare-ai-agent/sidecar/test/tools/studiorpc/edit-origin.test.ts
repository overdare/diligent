import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithSessionExecutionContext } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import { snapshotsDir } from "../../../src/tools/studiorpc/tools/snapshot";
import { readStudioChangeBatch } from "../../../src/tools/studiorpc/tools/studio-change-store";
import { consumeStudioChanges, createStudioChangesTool } from "../../../src/tools/studiorpc/tools/studio-changes-tool";

test("shared provider RPCs use actual execution identity, never the last main prompt", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-session-"));
  const seen: Array<string | undefined> = [];
  const provider = createStudioRpcToolProvider({
    callRpc: async (_method, _params, options) => {
      seen.push(options?.sessionId);
      return { success: true };
    },
  });
  try {
    await provider.onUserPromptSubmit!({
      session_id: "session-from-hook",
      transcript_path: "",
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "inspect",
    });
    const tools = await provider.createTools({ cwd });
    const tool = tools.find((value) => value.name === "studiorpc_execute_luau")!;
    await runWithSessionExecutionContext(
      {
        sessionId: "child-A",
        rootSessionId: "A",
        resumed: false,
        rootRequest: { sessionId: "A", requestId: "A-request" },
      },
      () =>
        tool.execute(
          { target: "Editor", code: "return 1" },
          {
            toolCallId: "origin",
            signal: new AbortController().signal,
            abort() {},
          },
        ),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === "child-A")).toBe(true);
    seen.length = 0;
    await tool.execute(
      { target: "Editor", code: "return 2" },
      { toolCallId: "direct", signal: new AbortController().signal, abort() {} },
    );
    expect(seen.every((value) => value === undefined)).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("only an explicit matching MCP session is excluded at turn start and mid-turn", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-origin-"));
  const entry = (guid: string, Origin?: Record<string, unknown>) => ({
    Timestamp: "2026-09-27T00:00:00Z",
    Action: "SetProperty",
    ActorGuids: [guid],
    Origin,
    Objects: [
      {
        ActorGuid: guid,
        Name: guid,
        InstanceType: "Part",
        Changes: [{ Property: "Name", Before: "old", After: guid }],
      },
    ],
  });
  try {
    const records = [
      entry("own", { Kind: "mcp", SessionId: "self" }),
      entry("other", { Kind: "mcp", SessionId: "other" }),
      entry("legacy"),
      entry("unknown", { Kind: "unknown", SessionId: "self" }),
      entry("mixed", { Kind: "mixed", SessionId: "self" }),
    ];
    writeFileSync(join(cwd, "Edit.Log"), records.map((v) => JSON.stringify(v, null, 2)).join("\n"));
    const capture = consumeStudioChanges(cwd, "self");
    expect(capture.result.metadata?.transactions).toBe(4);
    expect(readStudioChangeBatch(cwd, capture.id!).envelopes.map((v) => v.objects[0].guid)).toEqual([
      "own",
      "other",
      "legacy",
      "unknown",
      "mixed",
    ]);
    capture.finalize();
    writeFileSync(join(cwd, "Edit.Log"), records.map((v) => JSON.stringify(v)).join("\n"));
    const tool = createStudioChangesTool(cwd, undefined, () => "self");
    const result = await tool.execute({ view: "new" }, {} as never);
    const batch = readStudioChangeBatch(cwd, result.metadata!.batchId as string);
    expect(batch.envelopes.map((v) => v.objects[0].guid)).toEqual(["own", "other", "legacy", "unknown", "mixed"]);
    const details = await tool.execute({ view: "details", batchId: result.metadata!.batchId }, {} as never);
    expect(details.output).not.toContain("(own)");
    expect(details.output).toContain("(other)");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("interleaved roots keep separate rollback baselines and children share only their root request", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-snapshot-groups-"));
  writeFileSync(join(cwd, "world.umap"), "umap");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{}}');
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  const rootA = { sessionId: "A", requestId: "A-request" };
  const rootB = { sessionId: "B", requestId: "B-request" };
  try {
    for (const id of ["A", "B"])
      await provider.onUserPromptSubmit!({
        session_id: id,
        cwd,
        transcript_path: `/${id}.jsonl`,
        hook_event_name: "UserPromptSubmit",
        prompt: `edit ${id}`,
      });
    const tools = await provider.createTools({ cwd });
    const tool = tools.find((t) => t.name === "studiorpc_asset_drawer_import")!;
    const execute = (sessionId: string, rootRequest: typeof rootA) =>
      runWithSessionExecutionContext(
        {
          sessionId,
          rootSessionId: rootRequest.sessionId,
          resumed: false,
          rootRequest,
        },
        () =>
          tool.execute(
            { assetid: "ovdrassetid://1", assetName: "Tree", assetType: "MODEL" },
            { toolCallId: sessionId, signal: new AbortController().signal, abort() {} },
          ),
      );
    await execute("A1", rootA);
    await execute("B", rootB);
    await execute("A2", rootA);
    const files = readdirSync(snapshotsDir(cwd))
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(files).toEqual(["A_0.json", "B_0.json"]);
    expect(JSON.parse(readFileSync(join(snapshotsDir(cwd), "A_0.json"), "utf8")).label).toBe("edit A");
    expect(JSON.parse(readFileSync(join(snapshotsDir(cwd), "B_0.json"), "utf8")).label).toBe("edit B");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
