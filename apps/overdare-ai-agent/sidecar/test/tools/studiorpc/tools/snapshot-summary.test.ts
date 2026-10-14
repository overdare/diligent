// @summary Verifies background snapshot summaries use immutable evidence and fail independently of capture.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextGenerationFn } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { listSnapshots, pruneSnapshots } from "../../../../src/tools/studiorpc/tools/snapshot";
import { captureSavedSnapshot } from "../../../../src/tools/studiorpc/tools/snapshot-capture";
import { createSnapshotContextTool } from "../../../../src/tools/studiorpc/tools/snapshot-context-tool";

const dirs: string[] = [];
function project() {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-summary-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "world.umap"), "world");
  writeFileSync(
    join(cwd, "world.ovdrjm"),
    JSON.stringify({
      Root: {
        Name: "CurrentLobby",
        InstanceType: "Workspace",
        LuaChildren: [{ Name: "SpawnController", InstanceType: "Script", Source: "print('lobby ready')" }],
      },
    }),
  );
  return cwd;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const save = async () => ({ success: true });
const ctx = () => ({ toolCallId: "test", signal: new AbortController().signal, abort() {} });

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Snapshot summary did not settle");
    await Bun.sleep(1);
  }
}

test("capture returns before generation finishes; summary evidence is the saved map, not requested future changes", async () => {
  const cwd = project();
  let finish!: (text: string) => void;
  let received = "";
  const generate: TextGenerationFn = async (input, options) => {
    received = input.prompt;
    expect(options?.maxTokens).toBeGreaterThan(0);
    expect(options?.signal).toBeDefined();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const snapshot = await captureSavedSnapshot(
    cwd,
    "session",
    save,
    { label: "Add a future boss arena" },
    undefined,
    generate,
  );
  expect(snapshot.summaryStatus).toBe("pending");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"FutureBossArena"}}');
  await waitFor(() => received.length > 0);
  expect(received).toContain("CurrentLobby");
  expect(received).toContain("lobby ready");
  expect(received).not.toContain("future boss arena");
  expect(received).not.toContain("FutureBossArena");
  finish("Lobby with a spawn controller; runtime behavior has not been tested.");
  await waitFor(() => listSnapshots(cwd)[0].summaryStatus !== "pending");
  const [ready] = listSnapshots(cwd);
  expect(ready.summaryStatus).toBe("ready");
  expect(ready.stateSummary).toContain("spawn controller");
  expect(ready.label).toBe("Add a future boss arena");
  const context = await createSnapshotContextTool(cwd).execute(
    { snapshotId: snapshot.id, includeConversation: true } as never,
    ctx(),
  );
  expect(context.output).toContain("spawn controller");
  expect(context.output).toContain("no transcript");
  expect(readFileSync(snapshot.path, "utf8")).toContain("CurrentLobby");
});

test("manual create takes no label and populates its title and summary in one background request", async () => {
  const cwd = project();
  let finish: ((text: string) => void) | undefined;
  let calls = 0;
  const provider = createStudioRpcToolProvider({ callRpc: save });
  const tools = await provider.createTools({
    cwd,
    sessionId: "session",
    generateText: async () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const create = tools.find((tool) => tool.name === "studiorpc_snapshot_create")!;
  const result = await create.execute({}, ctx());
  expect(result.metadata?.error).toBeUndefined();
  const [pending] = listSnapshots(cwd);
  expect(pending.kind).toBe("manual");
  expect(pending.summaryStatus).toBe("pending");
  expect(pending.label).toBeTruthy();
  await waitFor(() => finish !== undefined);
  finish!(
    JSON.stringify({
      label: "Lobby with spawn controller",
      stateSummary: "The saved lobby includes a SpawnController script.",
    }),
  );
  await waitFor(() => listSnapshots(cwd)[0].summaryStatus !== "pending");
  const [ready] = listSnapshots(cwd);
  expect(ready.summaryStatus).toBe("ready");
  expect(ready.label).toBe("Lobby with spawn controller");
  expect(ready.stateSummary).toBe("The saved lobby includes a SpawnController script.");
  expect(calls).toBe(1);
});

test("invalid generated manual metadata keeps the fallback title and usable snapshot", async () => {
  const cwd = project();
  const snapshot = await captureSavedSnapshot(
    cwd,
    "session",
    save,
    { kind: "manual", label: "Manual checkpoint" },
    undefined,
    async () => JSON.stringify({ label: "", stateSummary: "Lobby" }),
  );
  await waitFor(() => listSnapshots(cwd)[0].summaryStatus !== "pending");
  const [entry] = listSnapshots(cwd);
  expect(entry.summaryStatus).toBe("failed");
  expect(entry.label).toBe("Manual checkpoint");
  expect(entry.stateSummary).toBeUndefined();
  expect(existsSync(snapshot.path)).toBe(true);
});

test("missing model and generation failure leave usable snapshots with explicit status", async () => {
  const cwd = project();
  const missing = await captureSavedSnapshot(cwd, "session", save, {});
  expect(missing.summaryStatus).toBe("unavailable");
  const failed = await captureSavedSnapshot(cwd, "session", save, {}, undefined, async () => {
    throw new Error("offline");
  });
  await waitFor(() => listSnapshots(cwd).find((s) => s.id === failed.id)?.summaryStatus !== "pending");
  expect(listSnapshots(cwd).find((s) => s.id === failed.id)?.summaryStatus).toBe("failed");
  expect(existsSync(failed.path)).toBe(true);
});

test("summary completion does not recreate metadata for pruned snapshots", async () => {
  const cwd = project();
  let finish!: (text: string) => void;
  const snapshot = await captureSavedSnapshot(
    cwd,
    "session",
    save,
    {},
    undefined,
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await waitFor(() => typeof finish === "function");
  pruneSnapshots(cwd, "session", 0);
  finish("Old lobby");
  await Bun.sleep(1);
  expect(existsSync(snapshot.path.replace(/\.ovdrjm$/, ".json"))).toBe(false);
  expect(listSnapshots(cwd)).toEqual([]);
});

test("large script evidence is bounded and identified as partial", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "world.ovdrjm"), JSON.stringify({ Root: { Source: "x".repeat(100_000) } }));
  let prompt = "";
  await captureSavedSnapshot(cwd, "session", save, {}, undefined, async (input) => {
    prompt = input.prompt;
    return "Large script excerpt.";
  });
  await waitFor(() => prompt.length > 0);
  expect(prompt.length).toBeLessThan(40_000);
  expect(prompt).toContain("truncated");
});

test("interrupted summaries do not remain pending indefinitely in list/context", async () => {
  const cwd = project();
  const snapshot = await captureSavedSnapshot(cwd, "session", save, {});
  const metaPath = snapshot.path.replace(/\.ovdrjm$/, ".json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  writeFileSync(metaPath, JSON.stringify({ ...meta, summaryStatus: "pending", createdAt: "2020-01-01T00:00:00Z" }));
  expect(listSnapshots(cwd)[0].summaryStatus).toBe("failed");
  const result = await createSnapshotContextTool(cwd).execute({ snapshotId: snapshot.id } as never, ctx());
  expect(JSON.parse(result.output).snapshot.summaryStatus).toBe("failed");
});
