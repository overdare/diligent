// @summary Verifies fresh checkpoints, exact message links, manual retention, and legacy context compatibility.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forkToolForChild } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import {
  captureSnapshot,
  findLatestSnapshot,
  listSnapshots,
  pruneSnapshots,
} from "../../../../src/tools/studiorpc/tools/snapshot";
import { createSnapshotContextTool } from "../../../../src/tools/studiorpc/tools/snapshot-context-tool";
import { createSnapshotListTool } from "../../../../src/tools/studiorpc/tools/snapshot-list-tool";

const dirs: string[] = [];
function project() {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-checkpoints-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "world.umap"), "world");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"stale"}}');
  return cwd;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const context = () => ({ toolCallId: "test", signal: new AbortController().signal, abort() {} });
const importArgs = { assetid: "ovdrassetid://1", assetName: "Tree", assetType: "MODEL" };
const hook = (cwd: string, userMessageId = "request-a", sessionId = "session") => ({
  cwd,
  session_id: sessionId,
  transcript_path: join(cwd, `${sessionId}.jsonl`),
  hook_event_name: "UserPromptSubmit",
  prompt: "add a tree",
  user_message_id: userMessageId,
});

describe("fresh and linked checkpoints", () => {
  test("inherited tools and nested children keep the spawning request after the next parent prompt", async () => {
    const cwd = project();
    const provider = createStudioRpcToolProvider({ callRpc: async () => ({ success: true }) });
    await provider.onUserPromptSubmit!(hook(cwd, "original"));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const mainEdit = tools.find((t) => t.name === "studiorpc_asset_drawer_import")!;
    const childEdit = forkToolForChild(mainEdit);
    const childManual = forkToolForChild(tools.find((t) => t.name === "studiorpc_snapshot_create")!);
    await provider.onStop?.({ ...hook(cwd), hook_event_name: "Stop" });
    await provider.onUserPromptSubmit!(hook(cwd, "next"));
    const nestedEdit = forkToolForChild(childEdit);
    await childEdit.execute(importArgs, context());
    await nestedEdit.execute(importArgs, context());
    await childManual.execute({}, context());
    expect(listSnapshots(cwd)).toHaveLength(2);
    expect(listSnapshots(cwd).every((s) => s.userMessageId === "original")).toBe(true);
    await mainEdit.execute(importArgs, context());
    expect(listSnapshots(cwd).filter((s) => s.userMessageId === "next")).toHaveLength(1);
  });
  test("an aborted capture does not proceed with an edit", async () => {
    const cwd = project();
    const abort = new AbortController();
    const calls: string[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        if (method === "level.save.file") abort.abort();
        return { success: true };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const edit = tools.find((t) => t.name === "studiorpc_asset_drawer_import")!;
    await expect(edit.execute(importArgs, { ...context(), signal: abort.signal })).rejects.toThrow();
    expect(calls).toEqual(["level.save.file"]);
    expect(listSnapshots(cwd)).toEqual([]);
  });

  test("rejecting a manual checkpoint performs no save or capture", async () => {
    const cwd = project();
    const calls: string[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        return { success: true };
      },
    });
    const tools = await provider.createTools({ cwd, host: { approve: async () => "reject" } });
    const result = await tools.find((t) => t.name === "studiorpc_snapshot_create")!.execute({}, context());
    expect(result.metadata?.error).toBe(true);
    expect(calls).toEqual([]);
    expect(listSnapshots(cwd)).toEqual([]);
  });
  test("flushes Studio before copying the first edit baseline and exposes the request ID", async () => {
    const cwd = project();
    const calls: string[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        if (method === "level.save.file") writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"fresh"}}');
        return { success: true };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    await tools.find((t) => t.name === "studiorpc_asset_drawer_import")!.execute(importArgs, context());
    expect(calls.slice(0, 2)).toEqual(["level.save.file", "asset_drawer.import"]);
    const [snapshot] = listSnapshots(cwd);
    expect(readFileSync(snapshot.path, "utf8")).toContain('"fresh"');
    const listed = await createSnapshotListTool(cwd).execute({} as never, context());
    expect(JSON.parse(listed.output)[0].userMessageId).toBe("request-a");
  });

  test("concurrent first edits share one pending save and baseline", async () => {
    const cwd = project();
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saves = 0;
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        if (method === "level.save.file" && ++saves === 1) await saving;
        return { success: true };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const edit = tools.find((t) => t.name === "studiorpc_asset_drawer_import")!;
    const first = edit.execute(importArgs, context());
    const second = edit.execute(importArgs, context());
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(listSnapshots(cwd)).toHaveLength(1);
    expect(saves).toBe(3); // One pre-edit save, plus each successful import's save.
  });

  test("an unconfirmed save creates no stale baseline and is not retried after editing", async () => {
    const cwd = project();
    let saves = 0;
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        if (method === "level.save.file" && ++saves === 1) return { success: false, message: "disk full" };
        return { success: true };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const edit = tools.find((t) => t.name === "studiorpc_asset_drawer_import")!;
    const result = await edit.execute(importArgs, context());
    await edit.execute(importArgs, context());
    expect(listSnapshots(cwd)).toEqual([]);
    expect(result.output).toContain("disk full");
    expect(result.output).toContain("Rollback baseline could not be captured");
  });

  test("tool sets keep request links isolated across sessions", async () => {
    const cwd = project();
    const provider = createStudioRpcToolProvider({ callRpc: async () => ({ success: true }) });
    await provider.onUserPromptSubmit!(hook(cwd, "request-a", "a"));
    const toolsA = await provider.createTools({ cwd, sessionId: "a" });
    await provider.onUserPromptSubmit!(hook(cwd, "request-b", "b"));
    const toolsB = await provider.createTools({ cwd, sessionId: "b" });
    await toolsA.find((t) => t.name === "studiorpc_asset_drawer_import")!.execute(importArgs, context());
    await toolsB.find((t) => t.name === "studiorpc_asset_drawer_import")!.execute(importArgs, context());
    expect(
      listSnapshots(cwd)
        .map((s) => [s.sessionId, s.userMessageId])
        .sort(),
    ).toEqual([
      ["a", "request-a"],
      ["b", "request-b"],
    ]);
  });

  test("rollback safety snapshots link to the current request and unconfirmed saves prevent restore", async () => {
    const cwd = project();
    captureSnapshot(cwd, "old-session", 0, { userMessageId: "old-request" });
    writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"current"}}');
    let saved = false;
    const calls: string[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        return { success: saved };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const rollback = tools.find((t) => t.name === "studiorpc_rollback")!;
    const failed = await rollback.execute({ snapshotId: "old-session_0" }, context());
    expect(failed.metadata?.error).toBe(true);
    expect(calls).toEqual(["level.save.file"]);
    expect(readFileSync(join(cwd, "world.ovdrjm"), "utf8")).toContain("current");
    saved = true;
    const result = await rollback.execute({ snapshotId: "old-session_0" }, context());
    expect(result.metadata?.restored).toBe("old-session_0");
    const safety = listSnapshots(cwd).find((s) => s.kind === "pre-rollback")!;
    expect(safety.sessionId).toBe("session");
    expect(safety.userMessageId).toBe("request-a");
    expect(readFileSync(safety.path, "utf8")).toContain("current");
  });

  test("manual checkpoints save fresh bytes, stay distinct in one request, and do not replace the auto baseline", async () => {
    const cwd = project();
    let liveName = "first";
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        if (method === "level.save.file")
          writeFileSync(join(cwd, "world.ovdrjm"), JSON.stringify({ Root: { Name: liveName } }));
        return { success: true };
      },
    });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const create = tools.find((t) => t.name === "studiorpc_snapshot_create");
    expect(create).toBeDefined();
    await create!.execute({}, context());
    liveName = "second";
    await create!.execute({}, context());
    const manual = listSnapshots(cwd);
    expect(manual).toHaveLength(2);
    expect(new Set(manual.map((s) => s.id)).size).toBe(2);
    expect(manual.every((s) => s.kind === "manual" && s.userMessageId === "request-a")).toBe(true);
    expect(manual.map((s) => JSON.parse(readFileSync(s.path, "utf8")).Root.Name).sort()).toEqual(["first", "second"]);
    expect(() => findLatestSnapshot(cwd)).toThrow("No rollback snapshot");
    await tools.find((t) => t.name === "studiorpc_asset_drawer_import")!.execute(importArgs, context());
    expect(findLatestSnapshot(cwd).kind).toBe("turn");
    pruneSnapshots(cwd, "session", 0);
    expect(
      listSnapshots(cwd)
        .map((s) => s.id)
        .sort(),
    ).toEqual(manual.map((s) => s.id).sort());
  });

  test.each([
    { success: false, message: "cannot save" },
    {},
  ])("manual capture rejects an unconfirmed save: %j", async (response) => {
    const cwd = project();
    const provider = createStudioRpcToolProvider({ callRpc: async () => response });
    await provider.onUserPromptSubmit!(hook(cwd));
    const tools = await provider.createTools({ cwd, sessionId: "session" });
    const create = tools.find((t) => t.name === "studiorpc_snapshot_create");
    expect(create).toBeDefined();
    const result = await create!.execute({}, context());
    expect(result.metadata?.error).toBe(true);
    expect(listSnapshots(cwd)).toEqual([]);
  });
});

describe("exact snapshot conversation links", () => {
  test("resolves an image-only user message by ID", async () => {
    const cwd = project();
    const transcriptPath = join(cwd, "session.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "message",
        id: "image-request",
        message: {
          role: "user",
          content: [{ type: "image", url: "local-image" }],
        },
      }),
    );
    captureSnapshot(cwd, "session", 0, { userMessageId: "image-request", transcriptPath });
    const result = await createSnapshotContextTool(cwd).execute(
      { snapshotId: "session_0", includeConversation: true } as never,
      context(),
    );
    expect(result.output).toContain("[user]");
    expect(result.output).not.toContain("not found");
  });
  test("matches the stored entry ID even when prompts and timestamps suggest another request", async () => {
    const cwd = project();
    const transcriptPath = join(cwd, "session.jsonl");
    writeFileSync(
      transcriptPath,
      [
        {
          type: "message",
          id: "target",
          timestamp: "2026-01-01T00:00:00Z",
          message: { role: "user", content: "[injected context] add a tree" },
        },
        {
          type: "message",
          id: "answer",
          timestamp: "2026-01-01T00:00:01Z",
          message: { role: "assistant", content: "First tree" },
        },
        {
          type: "message",
          id: "other",
          timestamp: "2026-01-01T00:00:02Z",
          message: { role: "user", content: "add a tree" },
        },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    captureSnapshot(cwd, "session", 0, { userMessageId: "target", label: "add a tree", transcriptPath });
    const result = await createSnapshotContextTool(cwd).execute(
      { snapshotId: "session_0", includeConversation: true } as never,
      context(),
    );
    expect(result.output).toContain("[injected context]");
    expect(result.output).toContain("First tree");
  });

  test("a missing exact ID is reported rather than guessing from a matching prompt", async () => {
    const cwd = project();
    const transcriptPath = join(cwd, "session.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({ type: "message", id: "other", message: { role: "user", content: "add a tree" } }),
    );
    captureSnapshot(cwd, "session", 0, { userMessageId: "missing", label: "add a tree", transcriptPath });
    const result = await createSnapshotContextTool(cwd).execute(
      { snapshotId: "session_0", includeConversation: true } as never,
      context(),
    );
    expect(result.output).toContain("missing");
    expect(result.output).toContain("not found");
    expect(result.output).not.toContain("[user]");
  });
});
