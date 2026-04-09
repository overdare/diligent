// @summary Tests script add/delete/edit tools against temp ovdrjm fixtures.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/plugin-sdk";

const levelApplyMock = mock(async () => ({ ok: true }));
const levelSaveFileMock = mock(async () => "World file saved.");

mock.module("../../src/rpc.ts", () => ({
  applyAndSave: async () => {
    const result = await levelApplyMock("level.apply", {});
    await levelSaveFileMock("level.save.file", {});
    return result;
  },
  call: (method: string, params?: Record<string, unknown>) => {
    if (method === "level.apply") return levelApplyMock(method, params);
    if (method === "level.save.file") return levelSaveFileMock(method, params);
    throw new Error(`Unexpected RPC method in test: ${method}`);
  },
}));

const { createScriptAddTool } = await import("../../src/tools/script-add-tool.ts");
const { createScriptDeleteTool } = await import("../../src/tools/script-delete-tool.ts");
const { createScriptEditTool } = await import("../../src/tools/script-edit-tool.ts");
const { createScriptGrepTool } = await import("../../src/tools/script-grep-tool.ts");
const { createScriptReadTool } = await import("../../src/tools/script-read-tool.ts");
const { createWriteLock } = await import("../../src/write-lock.ts");

function createToolContext(): ToolContext {
  return {
    toolCallId: "tool-call-1",
    signal: new AbortController().signal,
    abort: () => {},
    approve: async () => "always",
    ask: async () => null,
  };
}

function createWorldDocument() {
  return {
    MapObjectKeyIndex: 5,
    Root: {
      ActorGuid: "ROOT_GUID",
      Name: "Root",
      InstanceType: "Folder",
      LuaChildren: [
        {
          ActorGuid: "SCRIPTS_GUID",
          Name: "Scripts",
          InstanceType: "Folder",
          LuaChildren: [
            {
              ActorGuid: "HELLO_SCRIPT_GUID",
              Name: "HelloScript",
              InstanceType: "Script",
              Source: 'print("hello world")\nprint("goodbye")',
              LuaChildren: [],
            },
            {
              ActorGuid: "UTIL_SCRIPT_GUID",
              Name: "UtilModule",
              InstanceType: "ModuleScript",
              Source: 'local M = {}\nfunction M.greet()\n\tprint("hello from util")\nend\nreturn M',
              LuaChildren: [],
            },
          ],
        },
        {
          ActorGuid: "PART_GUID",
          Name: "SpawnPoint",
          InstanceType: "Part",
          LuaChildren: [],
        },
      ],
    },
  };
}

async function readWorld(tempDir: string) {
  const raw = await readFile(join(tempDir, "world.ovdrjm"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

type OvdrjmNode = Record<string, unknown> & { LuaChildren?: OvdrjmNode[] };

function findNode(node: OvdrjmNode, guid: string): OvdrjmNode | undefined {
  if (node.ActorGuid === guid) return node;
  for (const child of node.LuaChildren ?? []) {
    const found = findNode(child, guid);
    if (found) return found;
  }
  return undefined;
}

describe("script tools", () => {
  let tempDir: string;
  const writeLock = createWriteLock();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "script-tools-"));
    await writeFile(join(tempDir, "world.umap"), "placeholder", "utf-8");
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(createWorldDocument(), null, 2)}\n`, "utf-8");
    levelApplyMock.mockClear();
    levelSaveFileMock.mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // script.add
  // -------------------------------------------------------------------------

  test("script.add creates a script node with Source property", async () => {
    const tool = createScriptAddTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        class: "LocalScript",
        parentGuid: "SCRIPTS_GUID",
        name: "NewScript",
        source: 'print("new")',
      },
      createToolContext(),
    );

    const world = await readWorld(tempDir);
    const root = world.Root as OvdrjmNode;
    const scripts = findNode(root, "SCRIPTS_GUID")!;
    const added = scripts.LuaChildren!.find((n) => n.Name === "NewScript");

    expect(added).toBeDefined();
    expect(added!.InstanceType).toBe("LocalScript");
    expect(added!.Source).toBe('print("new")');
    expect(typeof added!.ActorGuid).toBe("string");
    expect((added!.ActorGuid as string).length).toBe(32);
    expect(world.MapObjectKeyIndex).toBe(6);
    expect(levelApplyMock).toHaveBeenCalledTimes(1);
    expect(levelSaveFileMock).toHaveBeenCalledTimes(1);
    expect(result.render).toMatchObject({ inputSummary: "LocalScript NewScript" });
    const addDiffBlock = result.render?.blocks[0] as
      | { type: string; files?: Array<{ filePath?: string; action?: string; hunks?: Array<{ newString?: string }> }> }
      | undefined;
    expect(addDiffBlock?.type).toBe("diff");
    expect(addDiffBlock?.files?.[0]?.action).toBe("Add");
    expect(addDiffBlock?.files?.[0]?.filePath).toContain("NewScript");
    expect(addDiffBlock?.files?.[0]?.hunks?.[0]?.newString).toBe('print("new")');
  });

  test("script.add throws when parentGuid is missing", async () => {
    const tool = createScriptAddTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        class: "Script",
        parentGuid: "MISSING_GUID",
        name: "Bad",
        source: "",
      },
      createToolContext(),
    );

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("MISSING_GUID");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // script.delete
  // -------------------------------------------------------------------------

  test("script.delete removes a script node", async () => {
    const tool = createScriptDeleteTool(tempDir, writeLock);

    const result = await tool.execute({ targetGuid: "HELLO_SCRIPT_GUID" }, createToolContext());

    const world = await readWorld(tempDir);
    const root = world.Root as OvdrjmNode;
    const found = findNode(root, "HELLO_SCRIPT_GUID");

    expect(found).toBeUndefined();
    expect(levelApplyMock).toHaveBeenCalledTimes(1);
    expect(result.output).toBe("Deleted.");
  });

  test("script.delete rejects non-script instances", async () => {
    const tool = createScriptDeleteTool(tempDir, writeLock);

    const result = await tool.execute({ targetGuid: "PART_GUID" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not a script");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  test("script.delete throws when guid is missing", async () => {
    const tool = createScriptDeleteTool(tempDir, writeLock);

    const result = await tool.execute({ targetGuid: "MISSING_GUID" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("MISSING_GUID");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // script.edit
  // -------------------------------------------------------------------------

  test("script.edit replaces a unique string in Source", async () => {
    const tool = createScriptEditTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: "hello world",
        new_string: "hi there",
      },
      createToolContext(),
    );

    const world = await readWorld(tempDir);
    const root = world.Root as OvdrjmNode;
    const script = findNode(root, "HELLO_SCRIPT_GUID")!;

    expect(script.Source).toBe('print("hi there")\nprint("goodbye")');
    expect(result.output).toContain("replaced 1 occurrence(s)");
    expect(levelApplyMock).toHaveBeenCalledTimes(1);
    expect(result.render).toMatchObject({ inputSummary: "HelloScript", outputSummary: "1 edit applied" });
    const editDiffBlock = result.render?.blocks[0] as
      | {
          type: string;
          files?: Array<{
            filePath?: string;
            action?: string;
            hunks?: Array<{ oldString?: string; newString?: string }>;
          }>;
        }
      | undefined;
    expect(editDiffBlock?.type).toBe("diff");
    expect(editDiffBlock?.files?.[0]?.action).toBe("Update");
    expect(editDiffBlock?.files?.[0]?.filePath).toContain("HelloScript");
    expect(editDiffBlock?.files?.[0]?.hunks?.[0]?.oldString).toBe("hello world");
    expect(editDiffBlock?.files?.[0]?.hunks?.[0]?.newString).toBe("hi there");
  });

  test("script.edit with replace_all replaces all occurrences", async () => {
    const tool = createScriptEditTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: "print",
        new_string: "warn",
        replace_all: true,
      },
      createToolContext(),
    );

    const world = await readWorld(tempDir);
    const root = world.Root as OvdrjmNode;
    const script = findNode(root, "HELLO_SCRIPT_GUID")!;

    expect(script.Source).toBe('warn("hello world")\nwarn("goodbye")');
    expect(result.output).toContain("replaced 2 occurrence(s)");
  });

  test("script.edit fails when old_string is not unique without replace_all", async () => {
    const tool = createScriptEditTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: "print",
        new_string: "warn",
      },
      createToolContext(),
    );

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not unique");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  test("script.edit fails when old_string is not found", async () => {
    const tool = createScriptEditTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: "nonexistent",
        new_string: "replacement",
      },
      createToolContext(),
    );

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not found");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // script.edit — leading 4-space → tab normalization
  // -------------------------------------------------------------------------

  test("script.edit converts leading 4-spaces to tabs in result", async () => {
    // Seed a script whose Source uses 4-space indentation
    const world = createWorldDocument();
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source =
      'if true then\n    print("indented")\nend';
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    const result = await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: '    print("indented")',
        new_string: '    print("changed")',
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const root = saved.Root as OvdrjmNode;
    const script = findNode(root, "HELLO_SCRIPT_GUID")!;

    // leading 4 spaces → 1 tab
    expect(script.Source).toBe('if true then\n\tprint("changed")\nend');
    expect(result.output).toContain("converted to tabs");
  });

  test("script.edit normalizes mixed tab+4spaces: \\t    \\tabcd → \\t\\t\\tabcd", async () => {
    const world = createWorldDocument();
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source = "\t    \tabcd";
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    await tool.execute(
      { targetGuid: "HELLO_SCRIPT_GUID", old_string: "\t    \tabcd", new_string: "\t    \tchanged" },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const script = findNode(saved.Root as OvdrjmNode, "HELLO_SCRIPT_GUID")!;
    expect(script.Source).toBe("\t\t\tchanged");
  });

  test("script.edit normalizes \\t\\t    abcd → \\t\\t\\tabcd", async () => {
    const world = createWorldDocument();
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source = "\t\t    abcd";
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    await tool.execute(
      { targetGuid: "HELLO_SCRIPT_GUID", old_string: "\t\t    abcd", new_string: "\t\t    xyz" },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const script = findNode(saved.Root as OvdrjmNode, "HELLO_SCRIPT_GUID")!;
    expect(script.Source).toBe("\t\t\txyz");
  });

  test("script.edit converts 8 leading spaces to 2 tabs", async () => {
    const world = createWorldDocument();
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source = "        deep";
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    await tool.execute(
      { targetGuid: "HELLO_SCRIPT_GUID", old_string: "        deep", new_string: "        changed" },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const script = findNode(saved.Root as OvdrjmNode, "HELLO_SCRIPT_GUID")!;
    expect(script.Source).toBe("\t\tchanged");
  });

  test("script.edit preserves trailing <4 spaces in leading area", async () => {
    const world = createWorldDocument();
    // tab + 2 spaces (not a full 4-space group) → should stay as-is
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source = "\t  code";
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    await tool.execute(
      { targetGuid: "HELLO_SCRIPT_GUID", old_string: "\t  code", new_string: "\t  changed" },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const script = findNode(saved.Root as OvdrjmNode, "HELLO_SCRIPT_GUID")!;
    expect(script.Source).toBe("\t  changed");
  });

  test("script.edit does not touch non-leading spaces", async () => {
    const world = createWorldDocument();
    (world.Root.LuaChildren[0].LuaChildren[0] as Record<string, unknown>).Source = '\tprint("hello    world")';
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(world, null, 2)}\n`, "utf-8");

    const tool = createScriptEditTool(tempDir, writeLock);
    await tool.execute(
      {
        targetGuid: "HELLO_SCRIPT_GUID",
        old_string: '\tprint("hello    world")',
        new_string: '\tprint("hello    earth")',
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const script = findNode(saved.Root as OvdrjmNode, "HELLO_SCRIPT_GUID")!;
    // 4 spaces inside string literal should NOT be converted
    expect(script.Source).toBe('\tprint("hello    earth")');
  });

  // -------------------------------------------------------------------------
  // script.add — leading 4-space → tab normalization
  // -------------------------------------------------------------------------

  test("script.add converts leading 4-spaces to tabs", async () => {
    const tool = createScriptAddTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        class: "Script",
        parentGuid: "SCRIPTS_GUID",
        name: "IndentedScript",
        source: 'if true then\n    print("hi")\n        print("deep")\nend',
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const root = saved.Root as OvdrjmNode;
    const scripts = findNode(root, "SCRIPTS_GUID")!;
    const added = scripts.LuaChildren!.find((n) => n.Name === "IndentedScript");

    expect(added!.Source).toBe('if true then\n\tprint("hi")\n\t\tprint("deep")\nend');
    expect(result.output).toContain("converted to tabs");
  });

  test("script.edit rejects non-script instances", async () => {
    const tool = createScriptEditTool(tempDir, writeLock);

    const result = await tool.execute(
      {
        targetGuid: "PART_GUID",
        old_string: "a",
        new_string: "b",
      },
      createToolContext(),
    );

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not a script");
    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // script.read
  // -------------------------------------------------------------------------

  test("script.read returns source with line numbers", async () => {
    const tool = createScriptReadTool(tempDir);

    const result = await tool.execute({ targetGuid: "HELLO_SCRIPT_GUID" }, createToolContext());

    expect(result.output).toContain('1\tprint("hello world")');
    expect(result.output).toContain('2\tprint("goodbye")');
    expect(result.metadata?.totalLines).toBe(2);
    expect(result.metadata?.linesReturned).toBe(2);
    expect(result.render).toMatchObject({ inputSummary: "HelloScript", outputSummary: "2 lines read" });
    const readFileBlock = result.render?.blocks[0] as
      | { type: string; filePath?: string; content?: string; offset?: number; limit?: number }
      | undefined;
    expect(readFileBlock?.type).toBe("file");
    expect(readFileBlock?.filePath).toContain("HelloScript");
    expect(readFileBlock?.content).toBe('1\tprint("hello world")\n2\tprint("goodbye")');
    expect(readFileBlock?.offset).toBe(1);
    expect(readFileBlock?.limit).toBe(2000);
  });

  test("script.read supports offset and limit", async () => {
    const tool = createScriptReadTool(tempDir);

    const result = await tool.execute({ targetGuid: "HELLO_SCRIPT_GUID", offset: 2, limit: 1 }, createToolContext());

    expect(result.output).toContain('2\tprint("goodbye")');
    const readSliceBlock = result.render?.blocks[0] as
      | { type: string; filePath?: string; content?: string; offset?: number; limit?: number }
      | undefined;
    expect(readSliceBlock?.type).toBe("file");
    expect(readSliceBlock?.filePath).toContain("HelloScript");
    expect(readSliceBlock?.content).toBe('2\tprint("goodbye")');
    expect(readSliceBlock?.offset).toBe(2);
    expect(readSliceBlock?.limit).toBe(1);
    expect(result.output).not.toContain("hello world");
    expect(result.metadata?.linesReturned).toBe(1);
  });

  test("script.read rejects non-script instances", async () => {
    const tool = createScriptReadTool(tempDir);

    const result = await tool.execute({ targetGuid: "PART_GUID" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not a script");
  });

  test("script.read returns error for missing guid", async () => {
    const tool = createScriptReadTool(tempDir);

    const result = await tool.execute({ targetGuid: "MISSING_GUID" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("MISSING_GUID");
  });

  // -------------------------------------------------------------------------
  // script.grep
  // -------------------------------------------------------------------------

  test("script.grep finds matches across multiple scripts", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "print" }, createToolContext());

    expect(result.output).toContain("HelloScript [HELLO_SCRIPT_GUID]:");
    expect(result.output).toContain("UtilModule [UTIL_SCRIPT_GUID]:");
    expect(result.metadata?.matchCount).toBe(3); // 2 in HelloScript + 1 in UtilModule
    expect(result.metadata?.scriptsSearched).toBe(2);
  });

  test("script.grep returns no matches for unmatched pattern", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "nonexistent_xyz" }, createToolContext());

    expect(result.output).toBe("No matches found.");
    expect(result.metadata?.matchCount).toBe(0);
  });

  test("script.grep supports case-insensitive search", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "HELLO", ignore_case: true }, createToolContext());

    expect(result.output).toContain("HelloScript");
    expect(result.output).toContain("UtilModule");
    expect(result.metadata?.matchCount).toBeGreaterThan(0);
  });

  test("script.grep supports regex patterns", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "^local" }, createToolContext());

    // Only UtilModule starts a line with "local"
    expect(result.output).toContain("UtilModule");
    expect(result.output).not.toContain("HelloScript");
  });

  test("script.grep scopes search with parentGuid", async () => {
    const tool = createScriptGrepTool(tempDir);

    // Search only under SCRIPTS_GUID — should find both scripts
    const all = await tool.execute({ pattern: "print", parentGuid: "SCRIPTS_GUID" }, createToolContext());
    expect(all.metadata?.matchCount).toBe(3);

    // Search under PART_GUID — no scripts there
    const none = await tool.execute({ pattern: "print", parentGuid: "PART_GUID" }, createToolContext());
    expect(none.metadata?.error).toBe(true);
    expect(none.output).toContain("No scripts found");
  });

  test("script.grep returns error for missing parentGuid", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "print", parentGuid: "MISSING_GUID" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("MISSING_GUID");
  });

  test("script.grep returns error for invalid regex", async () => {
    const tool = createScriptGrepTool(tempDir);

    const result = await tool.execute({ pattern: "[invalid" }, createToolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("invalid regex");
  });
});
