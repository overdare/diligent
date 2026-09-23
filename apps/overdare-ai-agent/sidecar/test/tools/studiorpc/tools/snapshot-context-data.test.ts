// @summary Exercises historical map inspection and optional transcript context through the bundled tool.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { captureSnapshot } from "../../../../src/tools/studiorpc/tools/snapshot";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const context = () => ({ toolCallId: "inspect", signal: new AbortController().signal, abort() {} });

async function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-context-data-"));
  dirs.push(cwd);
  const livePath = join(cwd, "world.ovdrjm");
  const transcriptPath = join(cwd, "session.jsonl");
  writeFileSync(join(cwd, "world.umap"), "world");
  writeFileSync(
    livePath,
    JSON.stringify({
      Root: {
        ActorGuid: "root",
        Name: "SavedLobby",
        InstanceType: "Workspace",
        LuaChildren: [
          {
            ActorGuid: "part",
            Name: "SavedPlatform",
            InstanceType: "Part",
            Anchored: true,
            Position: { X: 1, Y: 2, Z: 3 },
          },
          {
            ActorGuid: "script",
            Name: "SavedSpawn",
            InstanceType: "Script",
            Enabled: false,
            Source: "local spawn = 1\r\nprint(spawn)\n",
          },
        ],
      },
    }),
  );
  writeFileSync(
    transcriptPath,
    [
      { type: "message", id: "request", message: { role: "user", content: "Build the lobby" } },
      { type: "message", id: "reply", message: { role: "assistant", content: "The lobby spawn is ready" } },
      { type: "message", id: "other", message: { role: "user", content: "Next request" } },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n"),
  );
  const savedPath = captureSnapshot(cwd, "session", 0, {
    userMessageId: "request",
    transcriptPath,
    label: "Lobby baseline",
  });
  writeFileSync(livePath, '{"Root":{"ActorGuid":"live","Name":"ChangedLiveMap"}}');
  const rpcCalls: string[] = [];
  const provider = createStudioRpcToolProvider({
    callRpc: async (method) => {
      rpcCalls.push(method);
      throw new Error("Studio must not be called");
    },
  });
  const tools = await provider.createTools({ cwd });
  const tool = tools.find((value) => value.name === "studiorpc_snapshot_context")!;
  return { tool, cwd, livePath, savedPath, transcriptPath, rpcCalls };
}

test("default context returns saved hierarchy without conversation or live Studio access", async () => {
  const { tool, livePath, rpcCalls } = await setup();
  const before = readFileSync(livePath, "utf8");
  const result = await tool.execute({ snapshotId: "session_0" }, context());
  const output = JSON.parse(result.output);
  expect(output.snapshot).toMatchObject({ id: "session_0", userMessageId: "request", label: "Lobby baseline" });
  expect(output.data.view).toBe("tree");
  expect(output.data.nodes.map((node: { name: string }) => node.name)).toEqual([
    "SavedLobby",
    "SavedPlatform",
    "SavedSpawn",
  ]);
  expect(output.conversation).toBeUndefined();
  expect(result.output).not.toContain("ChangedLiveMap");
  expect(result.output).not.toContain("The lobby spawn is ready");
  expect(readFileSync(livePath, "utf8")).toBe(before);
  expect(rpcCalls).toEqual([]);
});

test("requested conversation accompanies saved data and uses the linked message", async () => {
  const { tool } = await setup();
  const result = await tool.execute({ snapshotId: "session_0", includeConversation: true }, context());
  const output = JSON.parse(result.output);
  expect(output.data.nodes[0].name).toBe("SavedLobby");
  expect(output.conversation).toContain("[user] Build the lobby");
  expect(output.conversation).toContain("The lobby spawn is ready");
  expect(output.conversation).not.toContain("Next request");
});

test("instance view returns saved properties and script view returns the original source", async () => {
  const { tool, rpcCalls } = await setup();
  const instance = JSON.parse(
    (await tool.execute({ snapshotId: "session_0", view: "instance", guid: "part" }, context())).output,
  );
  expect(instance.data.instance.guid).toBe("part");
  expect(JSON.parse(instance.data.content)).toEqual({ Anchored: true, Position: { X: 1, Y: 2, Z: 3 } });
  const script = JSON.parse(
    (await tool.execute({ snapshotId: "session_0", view: "script", guid: "script" }, context())).output,
  );
  expect(script.data.content).toBe("local spawn = 1\r\nprint(spawn)\n");
  expect(rpcCalls).toEqual([]);
});

test("tree and source page offsets allow complete continuation", async () => {
  const { tool } = await setup();
  const first = JSON.parse((await tool.execute({ snapshotId: "session_0", limit: 2 }, context())).output);
  const second = JSON.parse(
    (await tool.execute({ snapshotId: "session_0", offset: first.data.nextOffset, limit: 2 }, context())).output,
  );
  expect(first.data.units).toBe("nodes");
  expect([...first.data.nodes, ...second.data.nodes].map((node: { guid: string }) => node.guid)).toEqual([
    "root",
    "part",
    "script",
  ]);
  const source1 = JSON.parse(
    (await tool.execute({ snapshotId: "session_0", view: "script", guid: "script", limit: 8 }, context())).output,
  );
  const source2 = JSON.parse(
    (
      await tool.execute(
        { snapshotId: "session_0", view: "script", guid: "script", offset: source1.data.nextOffset },
        context(),
      )
    ).output,
  );
  expect(source1.data.units).toBe("characters");
  expect(source1.data.content + source2.data.content).toBe("local spawn = 1\r\nprint(spawn)\n");
});

test("a missing transcript does not prevent saved data inspection", async () => {
  const { tool, transcriptPath } = await setup();
  rmSync(transcriptPath);
  const result = await tool.execute({ snapshotId: "session_0", includeConversation: true }, context());
  const output = JSON.parse(result.output);
  expect(output.data.nodes).toHaveLength(3);
  expect(output.conversation).toContain("could not be read");
  expect(result.metadata?.error).toBeUndefined();
});

test("saved map inspection works after the live project files are removed", async () => {
  const { tool, cwd, livePath, rpcCalls } = await setup();
  rmSync(livePath);
  rmSync(join(cwd, "world.umap"));
  const result = await tool.execute({ snapshotId: "session_0" }, context());
  expect(JSON.parse(result.output).data.nodes[0].name).toBe("SavedLobby");
  expect(rpcCalls).toEqual([]);
});

test("large Unicode tree pages fit the runtime output limit and continue without losing nodes", async () => {
  const { tool, savedPath } = await setup();
  const children = Array.from({ length: 150 }, (_, index) => ({
    ActorGuid: `node-${index}`,
    Name: "\uAC00".repeat(200),
    InstanceType: "\uB098".repeat(200),
  }));
  writeFileSync(savedPath, JSON.stringify({ Root: { ActorGuid: "root", LuaChildren: children } }));
  const guids: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const result = await tool.execute({ snapshotId: "session_0", offset, limit: 200 }, context());
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(50_000);
    const { data } = JSON.parse(result.output);
    guids.push(...data.nodes.map((node: { guid: string }) => node.guid));
    if (data.nextOffset !== undefined) expect(data.nextOffset).toBeGreaterThan(offset);
    offset = data.nextOffset;
  }
  expect(guids).toEqual(["root", ...children.map((child) => child.ActorGuid)]);
});

test("schema-valid large limits are capped to 200 tree nodes", async () => {
  const { tool, savedPath } = await setup();
  writeFileSync(
    savedPath,
    JSON.stringify({
      Root: {
        ActorGuid: "root",
        LuaChildren: Array.from({ length: 205 }, (_, index) => ({ ActorGuid: `node-${index}` })),
      },
    }),
  );
  const result = await tool.execute({ snapshotId: "session_0", limit: 8000 }, context());
  const { data } = JSON.parse(result.output);
  expect(data.nodes).toHaveLength(200);
  expect(data.nextOffset).toBe(200);
  expect(data.total).toBe(206);
});

test("escaped source and summary fit the output limit with lossless continuation", async () => {
  const { tool, savedPath } = await setup();
  const source = `${"\u0000".repeat(8000)}\u{1F680}\r\n`;
  writeFileSync(savedPath, JSON.stringify({ Root: { ActorGuid: "script", Source: source } }));
  const metadataPath = savedPath.replace(/\.ovdrjm$/, ".json");
  writeFileSync(
    metadataPath,
    JSON.stringify({
      ...JSON.parse(readFileSync(metadataPath, "utf8")),
      stateSummary: "\uAC00".repeat(2000),
      summaryStatus: "ready",
    }),
  );
  let offset: number | undefined = 0;
  let reconstructed = "";
  while (offset !== undefined) {
    const result = await tool.execute(
      { snapshotId: "session_0", view: "script", guid: "script", offset, limit: 8000 },
      context(),
    );
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(50_000);
    const { data, snapshot } = JSON.parse(result.output);
    expect(snapshot.stateSummary).toBe("\uAC00".repeat(2000));
    reconstructed += data.content;
    if (data.nextOffset !== undefined) expect(data.nextOffset).toBeGreaterThan(offset);
    offset = data.nextOffset;
  }
  expect(reconstructed).toBe(source);
});

test("a corrupt map reports its error while retaining snapshot and requested conversation", async () => {
  const { tool, savedPath } = await setup();
  writeFileSync(savedPath, '{"Root":null}');
  const result = await tool.execute({ snapshotId: "session_0", includeConversation: true }, context());
  const output = JSON.parse(result.output);
  expect(result.metadata?.error).toBe(true);
  expect(output.snapshot.id).toBe("session_0");
  expect(output.dataError).toBeString();
  expect(output.conversation).toContain("Build the lobby");
});

describe("invalid selections", () => {
  test.each([
    { snapshotId: "session_0", view: "instance" },
    { snapshotId: "session_0", view: "script", guid: "missing" },
    { snapshotId: "session_0", view: "script", guid: "part" },
  ])("reports an explicit target error for %j", async (args) => {
    const { tool } = await setup();
    const result = await tool.execute(args, context());
    expect(result.metadata?.error).toBe(true);
    expect(JSON.parse(result.output).dataError).toBeString();
  });

  test.each([
    { offset: -1 },
    { limit: 0 },
    { view: "script", guid: "script", limit: 8001 },
  ])("rejects out-of-range paging %j", async (args) => {
    const { tool } = await setup();
    await expect(tool.execute({ snapshotId: "session_0", ...args }, context())).rejects.toThrow();
  });
});
