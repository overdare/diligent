import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithSessionExecutionContext } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import { studioRpcSessionId } from "../../../src/tools/studiorpc/rpc-context";
import {
  type EditLogEnvelope,
  STUDIO_CHANGES_LIMITS,
  studioChangeDetails,
  summarizeEditLog,
} from "../../../src/tools/studiorpc/tools/edit-log";
import { snapshotsDir } from "../../../src/tools/studiorpc/tools/snapshot";
import {
  getStudioChangeCollector,
  stopStudioChangeCollector,
} from "../../../src/tools/studiorpc/tools/studio-change-collector";
import { captureStudioChanges, createStudioChangesTool } from "../../../src/tools/studiorpc/tools/studio-changes-tool";

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
    expect(seen.every((value) => value === studioRpcSessionId())).toBe(true);
  } finally {
    await stopStudioChangeCollector(cwd);
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
    const collector = getStudioChangeCollector(cwd);
    const consumer = { sessionId: "self", rootSessionId: "self", resumed: false };
    await collector.refresh();
    const capture = captureStudioChanges(collector.store.read(consumer));
    expect(capture.result.metadata?.transactions).toBe(4);
    expect(
      collector.store
        .read({ sessionId: "observer", rootSessionId: "observer", resumed: false })
        .envelopes.map((v) => v.objects[0].guid),
    ).toEqual(["own", "other", "legacy", "unknown", "mixed"]);
    capture.finalize();
    writeFileSync(join(cwd, "Edit.Log"), records.map((v) => JSON.stringify(v)).join("\n"));
    const tool = createStudioChangesTool(collector, () => consumer);
    const result = await tool.execute({ view: "new" }, {} as never);
    const batch = collector.store.readBatch(result.metadata!.batchId as string, consumer);
    expect(batch.map((v) => v.objects[0].guid)).toEqual(["other", "legacy", "unknown", "mixed"]);
    const details = await tool.execute({ view: "details", batchId: result.metadata!.batchId }, {} as never);
    expect(details.output).not.toContain("(own)");
    expect(details.output).toContain("(other)");
  } finally {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("interleaved roots keep separate rollback baselines and children share only their root request", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-snapshot-groups-"));
  writeFileSync(join(cwd, "world.umap"), "umap");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{}}');
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({ success: true }) });
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
        user_message_id: `message-${id}`,
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
    expect(JSON.parse(readFileSync(join(snapshotsDir(cwd), "A_0.json"), "utf8")).userMessageId).toBe("message-A");
    expect(JSON.parse(readFileSync(join(snapshotsDir(cwd), "B_0.json"), "utf8")).userMessageId).toBe("message-B");
  } finally {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("shared change queries filter and deduplicate separately for each executing session", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-shared-origin-"));
  try {
    const provider = createStudioRpcToolProvider();
    await provider.onUserPromptSubmit!({
      session_id: "parent",
      transcript_path: "",
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "inspect",
    });
    const tool = (await provider.createTools({ cwd })).find((entry) => entry.name === "studiorpc_studio_changes")!;
    const records = ["parent", "child", "legacy"].map((guid) => ({
      Timestamp: "2026-09-28T00:00:00Z",
      Action: "SetProperty",
      ActorGuids: [guid],
      ...(guid !== "legacy" && { Origin: { Kind: "mcp", SessionId: guid } }),
      Objects: [
        {
          ActorGuid: guid,
          Name: guid,
          InstanceType: "Part",
          Changes: [{ Property: "Name", Before: "old", After: guid }],
        },
      ],
    }));
    writeFileSync(join(cwd, "Edit.Log"), records.map((record) => JSON.stringify(record)).join("\n"));
    const context = (sessionId: string) => ({
      sessionId,
      toolCallId: sessionId,
      signal: new AbortController().signal,
      abort() {},
    });
    const parent = await tool.execute({}, context("parent"));
    expect(parent.output).not.toContain("(parent)");
    expect(parent.output).toContain("(child)");
    expect(parent.output).toContain("(legacy)");
    const child = await tool.execute({}, context("child"));
    expect(child.output).not.toContain("(child)");
    expect(child.output).toContain("(parent)");
    expect(child.output).toContain("(legacy)");
    for (const sessionId of ["parent", "child"]) {
      const repeated = await tool.execute({}, context(sessionId));
      expect(repeated.metadata?.studioChangesDetected).not.toBe(true);
    }
  } finally {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("summaries group each session's changes separately and collect unattributed records under unknown", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "studio-summary-sessions-"));
  const entry = (guid: string, sessionId?: string, kind = "mcp") => ({
    Timestamp: "2026-09-28T00:00:00Z",
    Action: "SetProperty",
    ActorGuids: [guid],
    ...(sessionId && { Origin: { Kind: kind, SessionId: sessionId } }),
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
      entry("own", "viewer"),
      entry("shared", "parent"),
      entry("shared", "child"),
      entry("legacy"),
      entry("mixed", "child", "mixed"),
    ];
    writeFileSync(join(cwd, "Edit.Log"), records.map((record) => JSON.stringify(record)).join("\n"));
    const collector = getStudioChangeCollector(cwd);
    const consumer = { sessionId: "viewer", rootSessionId: "viewer", resumed: false };
    await collector.refresh();
    const capture = captureStudioChanges(collector.store.read(consumer));
    expect(capture.result.output).toContain('Session: parent\n\nModified (1):\n~ Part "shared" (shared)');
    expect(capture.result.output).toContain('Session: child\n\nModified (1):\n~ Part "shared" (shared)');
    expect(capture.result.output).toContain("Session: unknown\n\nModified (2):");
    expect(capture.result.output).toContain("(legacy)");
    expect(capture.result.output).toContain("(mixed)");
    expect(capture.result.output).toContain("Total changes: 4");
    expect(capture.result.output).not.toContain("(own)");
    capture.finalize();
    const tool = createStudioChangesTool(collector, () => consumer);
    const details = await tool.execute({ view: "details", batchId: capture.id, guid: "shared" }, {} as never);
    expect(details.output).toContain('Session: parent\n~ Part "shared" (shared)');
    expect(details.output).toContain('Session: child\n~ Part "shared" (shared)');
    writeFileSync(join(cwd, "Edit.Log"), JSON.stringify(entry("later", "child")));
    const live = await tool.execute({}, {} as never);
    expect(live.output).toContain('Session: child\n\nModified (1):\n~ Part "later" (later)');
  } finally {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("many sessions share one output budget and keep complete counts when session groups are omitted", () => {
  const envelopes: EditLogEnvelope[] = Array.from({ length: 100 }, (_, index) => ({
    timestamp: "",
    operation: "Create",
    subjectGuids: ["shared"],
    origin: { kind: "mcp", sessionId: `${index}-${"s".repeat(1000)}` },
    objects: [{ guid: "shared", name: "Shared", type: "Part", changes: [] }],
  }));
  const summary = summarizeEditLog(envelopes);
  expect(summary.output).toContain("Session:");
  expect(summary.output).toContain("session groups omitted");
  expect(summary.output).toContain("Total changes: 100");
  expect(summary.output.match(/^Session:/gm)?.length).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxSessions);
  expect(summary.output).not.toContain("s".repeat(1000));
  expect(Buffer.byteLength(summary.output, "utf8")).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxBytes);
  const transient = summarizeEditLog([envelopes[0], { ...envelopes[0], operation: "Delete" }]);
  expect(transient.output).toContain("Added then removed (1)");
  expect(transient.output).toContain("Session:");
  expect(Buffer.byteLength(transient.output, "utf8")).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxBytes);
});

test("session grouping keeps another session's delete and undo from swallowing the first session's edits", () => {
  const entry = (
    sessionId: string,
    operation: string,
    changes: EditLogEnvelope["objects"][number]["changes"] = [],
  ): EditLogEnvelope => ({
    timestamp: "",
    operation,
    subjectGuids: ["same"],
    origin: { kind: "mcp", sessionId },
    objects: [{ guid: "same", name: "Same", type: "Part", changes }],
  });
  const lifecycle = [
    entry("creator", "Create"),
    entry("editor", "SetProperty", [{ property: "Name", before: "Old", after: "New" }]),
    entry("deleter", "Delete"),
  ];
  const summary = summarizeEditLog(lifecycle);
  expect(summary.editCount).toBe(3);
  expect(summary.output).toContain("Session: creator\n\nAdded (1):");
  expect(summary.output).toContain("Session: editor\n\nModified (1):");
  expect(summary.output).toContain("Session: deleter\n\nRemoved (1):");
  const undo = [
    entry("first", "SetProperty", [{ property: "Value", before: 0, after: 1 }]),
    entry("second", "SetProperty", [{ property: "Value", before: 1, after: 0 }]),
  ];
  expect(summarizeEditLog(undo).editCount).toBe(2);
  const page = studioChangeDetails(undo);
  expect(page.total).toBe(2);
  expect(page.output).toContain('Session: first\n~ Part "Same" (same)\n  Value: 0 -> 1');
  expect(page.output).toContain('Session: second\n~ Part "Same" (same)\n  Value: 1 -> 0');
});
