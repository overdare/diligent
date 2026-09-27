import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import { readStudioChangeBatch } from "../../../src/tools/studiorpc/tools/studio-change-store";
import { consumeStudioChanges, createStudioChangesTool } from "../../../src/tools/studiorpc/tools/studio-changes-tool";

test("provider attaches the agent session automatically to every RPC", async () => {
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
    await tool.execute(
      { target: "Editor", code: "return 1" },
      {
        toolCallId: "origin",
        signal: new AbortController().signal,
        abort() {},
      },
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === "session-from-hook")).toBe(true);
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
